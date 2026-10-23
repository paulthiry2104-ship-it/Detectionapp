import { loadConfig } from '../config.ts';
import { getDb } from '../db/db.ts';
import { runDaily, runDiscovery, runRefresh } from './jobs.ts';

/** Usage : npm run job:daily | job:refresh | job:discovery  (code de sortie ≠ 0 si la tâche échoue). */
const job = process.argv[2];
const cfg = loadConfig();
const db = getDb(cfg.DATABASE_PATH);
const fn = { daily: runDaily, refresh: runRefresh, discovery: runDiscovery }[job as 'daily'];
if (!fn) {
  console.error('Tâche inconnue. Utilise : daily | refresh | discovery');
  process.exit(2);
}
const out = await fn(db, 'cli');
console.log(JSON.stringify({ job, runId: out.runId, status: out.status, error: out.error, stats: out.stats, steps: out.steps?.map((s) => ({ name: s.name, ok: s.ok, ms: s.ms, error: s.error })) }, null, 2));
process.exit(out.status === 'failed' ? 1 : 0);
