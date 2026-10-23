import { buildServer } from './api/server.ts';
import { loadConfig } from './config.ts';
import { getDb } from './db/db.ts';
import { startScheduler } from './jobs/scheduler.ts';
import { log } from './log.ts';

const cfg = loadConfig();
const db = getDb(cfg.DATABASE_PATH);
const app = await buildServer(db, cfg);
await app.listen({ port: cfg.PORT, host: cfg.HOST });
const stop = startScheduler(db, cfg);
log.info({ port: cfg.PORT, db: cfg.DATABASE_PATH }, 'Crypto Radar backend prêt');

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, async () => {
    stop();
    await app.close();
    db.close();
    process.exit(0);
  });
}
