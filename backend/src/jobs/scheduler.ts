import cron from 'node-cron';
import type { Config } from '../config.ts';
import type { Db } from '../db/db.ts';
import { log } from '../log.ts';
import { ensureDaily, runDaily, runDiscovery, runRefresh } from './jobs.ts';

/**
 * Planificateur intégré au backend (tourne 24 h/24 sur le serveur, indépendamment de l'iPhone).
 * Un déclencheur externe (GitHub Actions, voir .github/workflows) appelle en plus /internal/jobs/daily/ensure
 * pour rattraper l'analyse si le serveur était arrêté à 06 h.
 */
export function startScheduler(db: Db, cfg: Config) {
  if (!cfg.schedulerEnabled) {
    log.info('planificateur désactivé (SCHEDULER_ENABLED=false)');
    return () => undefined;
  }
  const opts = { timezone: cfg.TZ_SCHEDULE };
  const safe = (name: string, fn: () => Promise<unknown>) => () => { fn().catch((e) => log.error({ job: name, err: (e as Error).message }, 'tâche planifiée en erreur')); };
  const tasks = [
    cron.schedule(cfg.DAILY_CRON, safe('daily', () => runDaily(db, 'cron')), opts),
    cron.schedule(cfg.REFRESH_CRON, safe('refresh', () => runRefresh(db, 'cron')), opts),
    cron.schedule(cfg.DISCOVERY_CRON, safe('discovery', () => runDiscovery(db, 'cron')), opts),
  ];
  log.info({ daily: cfg.DAILY_CRON, refresh: cfg.REFRESH_CRON, discovery: cfg.DISCOVERY_CRON, tz: cfg.TZ_SCHEDULE }, 'planificateur démarré');
  // Au démarrage : rattrapage si l'analyse du jour manque (redémarrage, déploiement…).
  setTimeout(safe('catchup', () => ensureDaily(db, 'catchup')), 15_000);
  return () => tasks.forEach((t) => t.stop());
}
