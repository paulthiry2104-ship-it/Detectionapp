import { type Db, j, nowIso } from '../db/db.ts';
import { log } from '../log.ts';

export type StepResult = { name: string; ok: boolean; critical: boolean; ms: number; info?: unknown; error?: string };

export class JobContext {
  steps: StepResult[] = [];
  stats: Record<string, unknown> = {};
  dataPoints = 0;
  constructor(public db: Db, public runId: number, public job: string, public asOf: Date) {}

  /** Exécute une étape. Une étape critique en échec fait échouer toute la tâche. */
  async step<T>(name: string, critical: boolean, fn: () => Promise<T> | T): Promise<T | null> {
    const t0 = Date.now();
    try {
      const info = await fn();
      this.steps.push({ name, ok: true, critical, ms: Date.now() - t0, info: summarize(info) });
      this.persist('running');
      return info;
    } catch (e) {
      const msg = (e as Error)?.message ?? String(e);
      this.steps.push({ name, ok: false, critical, ms: Date.now() - t0, error: msg });
      log.warn({ job: this.job, step: name, err: msg }, 'étape en échec');
      this.persist('running');
      if (critical) throw new StepFailure(name, msg);
      return null;
    }
  }

  persist(status: string, error?: string) {
    this.db.run(
      'UPDATE job_runs SET status = ?, steps = ?, stats = ?, error = COALESCE(?, error), finished_at = CASE WHEN ? = \'running\' THEN NULL ELSE ? END WHERE id = ?',
      status, j(this.steps), j(this.stats), error ?? null, status, nowIso(), this.runId,
    );
  }
}

export class StepFailure extends Error {
  constructor(public step: string, msg: string) { super(`Étape « ${step} » en échec : ${msg}`); }
}

function summarize(v: unknown) {
  if (v == null || typeof v !== 'object') return v;
  const o: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as object)) {
    if (Array.isArray(x)) o[k] = x.length > 10 ? `${x.length} éléments` : x;
    else if (typeof x !== 'object' || x === null) o[k] = x;
  }
  return o;
}

const STALE_RUN_MIN = 120;

/**
 * Démarre une exécution en base avec verrou : une seule exécution "running" par tâche.
 * Une exécution restée "running" plus de 2 h (crash, redémarrage) est marquée "failed".
 */
export function startRun(db: Db, job: string, runKey: string, trigger: string): number | null {
  const stale = new Date(Date.now() - STALE_RUN_MIN * 60_000).toISOString();
  db.run(`UPDATE job_runs SET status = 'failed', error = 'Interrompue (processus arrêté avant la fin)', finished_at = ? WHERE job = ? AND status = 'running' AND started_at < ?`, nowIso(), job, stale);
  const running = db.get('SELECT id FROM job_runs WHERE job = ? AND status = \'running\'', job);
  if (running) return null;
  const r = db.run('INSERT INTO job_runs(job,run_key,trigger,status,started_at) VALUES(?,?,?,\'running\',?)', job, runKey, trigger, nowIso());
  return Number(r.lastInsertRowid);
}

export type RunOutcome = { runId: number | null; status: 'success' | 'partial' | 'failed' | 'skipped'; error?: string; steps?: StepResult[]; stats?: Record<string, unknown> };

export async function runJob(db: Db, job: string, runKey: string, trigger: string, body: (ctx: JobContext) => Promise<void>): Promise<RunOutcome> {
  const runId = startRun(db, job, runKey, trigger);
  if (runId == null) {
    log.info({ job, runKey }, 'exécution ignorée : une autre est en cours');
    return { runId: null, status: 'skipped', error: 'Une exécution est déjà en cours' };
  }
  const ctx = new JobContext(db, runId, job, new Date());
  log.info({ job, runId, runKey, trigger }, 'début de tâche');
  try {
    await body(ctx);
    // Jamais de "succès" sans nouvelles données réellement récupérées.
    if (ctx.dataPoints === 0) throw new Error('Aucune donnée de marché récupérée : toutes les sources ont échoué');
    const status = ctx.steps.some((s) => !s.ok) ? 'partial' : 'success';
    ctx.persist(status);
    log.info({ job, runId, status, stats: ctx.stats }, 'fin de tâche');
    return { runId, status, steps: ctx.steps, stats: ctx.stats };
  } catch (e) {
    const msg = (e as Error).message;
    ctx.persist('failed', msg);
    log.error({ job, runId, err: msg }, 'tâche en échec');
    return { runId, status: 'failed', error: msg, steps: ctx.steps, stats: ctx.stats };
  }
}
