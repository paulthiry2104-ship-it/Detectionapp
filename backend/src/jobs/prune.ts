import type { Db } from '../db/db.ts';
import { isoMinus } from '../engine/time.ts';

/**
 * Garde la base compacte (elle est stockée dans le dépôt GitHub entre deux exécutions) :
 *  - snapshots de plus de 3 jours : 1 par token / source / jour (le dernier du jour) ; supprimés après 400 jours
 *  - tokens jamais classés et inactifs depuis 14 jours : leurs snapshots sont supprimés (la fiche token reste)
 *  - classements des actualisations (non quotidiennes) de plus de 2 jours : supprimés
 *  - classements quotidiens de plus de 2 jours : seuls les rangs ≤ 100 sont gardés ; détail des critères vidé après 14 jours
 * Les tokens classés puis disparus restent dans l'historique (biais du survivant).
 */
export function prune(db: Db, now = new Date()) {
  const d3 = isoMinus(now, 3);
  const d2 = isoMinus(now, 2);
  const out: Record<string, number> = {};
  db.tx(() => {
    out.snapshotsDownsampled = Number(db.run(
      `DELETE FROM market_snapshots WHERE ts < ? AND id NOT IN (
         SELECT MAX(id) FROM market_snapshots WHERE ts < ? GROUP BY token_id, source, substr(ts, 1, 10))`, d3, d3,
    ).changes);
    out.snapshotsOld = Number(db.run('DELETE FROM market_snapshots WHERE ts < ?', isoMinus(now, 400)).changes);
    out.snapshotsUnranked = Number(db.run(
      `DELETE FROM market_snapshots WHERE token_id IN (
         SELECT t.id FROM tokens t WHERE t.last_seen_at < ? AND NOT EXISTS (SELECT 1 FROM rankings r WHERE r.token_id = t.id AND r.rank IS NOT NULL))`, isoMinus(now, 14),
    ).changes);
    out.rankingsRefresh = Number(db.run(
      `DELETE FROM rankings WHERE ts < ? AND run_id IN (SELECT id FROM job_runs WHERE job != 'daily')`, d2,
    ).changes);
    out.rankingsTail = Number(db.run(`DELETE FROM rankings WHERE ts < ? AND (rank IS NULL OR rank > 100)`, d2).changes);
    db.run(`UPDATE rankings SET components = '{}' WHERE ts < ? AND components != '{}'`, isoMinus(now, 14));
    db.run(`DELETE FROM category_snapshots WHERE ts < ?`, isoMinus(now, 60));
    db.run(`DELETE FROM category_peers WHERE ts < ?`, isoMinus(now, 10));
    db.run(`DELETE FROM security_checks WHERE ts < ?`, isoMinus(now, 30));
    db.run(`DELETE FROM job_runs WHERE job = 'discovery' AND started_at < ?`, isoMinus(now, 7));
  });
  db.raw.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.raw.exec('VACUUM');
  return out;
}
