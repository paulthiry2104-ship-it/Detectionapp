/**
 * Point d'entrée GitHub Actions (version gratuite, sans serveur).
 *   node --import tsx src/jobs/ci.ts <auto|daily|refresh|export> <dossier_sortie>
 *  - auto    : analyse quotidienne si celle du jour (Paris) manque et qu'il est ≥ 06 h ; sinon actualisation + détection
 *  - export  : régénère seulement les fichiers JSON depuis la base
 * Les fichiers JSON sont TOUJOURS exportés (même en cas d'échec : l'app affiche alors l'avertissement et les dernières données).
 * Code de sortie 1 si l'analyse a échoué → GitHub marque l'exécution en rouge et t'envoie un e-mail.
 */
import { loadConfig } from '../config.ts';
import { getDb } from '../db/db.ts';
import { localDate, localHour } from '../engine/time.ts';
import { exportStatic } from '../export/static.ts';
import { runDaily, runDiscovery, runRefresh } from './jobs.ts';
import { prune } from './prune.ts';
import type { RunOutcome } from './runner.ts';

const mode = process.argv[2] ?? 'auto';
const outDir = process.argv[3] ?? './site-api';
const cfg = loadConfig();
const db = getDb(cfg.DATABASE_PATH);

let outcome: RunOutcome | null = null;
let ran = 'export';
if (mode !== 'export') {
  const now = new Date();
  const doneToday = db.get(`SELECT 1 FROM job_runs WHERE run_key = ? AND status IN ('success','partial')`, `daily:${localDate(now, cfg.TZ_SCHEDULE)}`);
  const wantDaily = mode === 'daily' || (mode === 'auto' && !doneToday && localHour(now, cfg.TZ_SCHEDULE) >= 6);
  if (wantDaily) {
    ran = 'daily';
    outcome = await runDaily(db, 'cron');
  } else {
    ran = 'refresh';
    outcome = await runRefresh(db, 'cron');
    await runDiscovery(db, 'cron');
  }
}
const pruned = prune(db);
const exported = exportStatic(db, outDir);
console.log(JSON.stringify({ mode, ran, status: outcome?.status ?? 'export', error: outcome?.error, stats: outcome?.stats, pruned, exported }, null, 2));
db.close();
process.exit(outcome?.status === 'failed' ? 1 : 0);
