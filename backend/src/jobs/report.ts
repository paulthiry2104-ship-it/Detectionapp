import { type Db, j, nowIso, pj } from '../db/db.ts';
import { narrativeShifts } from '../engine/narratives.ts';
import { LIST_SIZE } from '../engine/ranking.ts';
import { HORIZONS, isoMinus, localDate } from '../engine/time.ts';

const tokenLite = (db: Db, id: string) =>
  db.get<any>('SELECT id, symbol, name, chain, logo_url, contract_address, status FROM tokens WHERE id = ?', id) ?? { id, symbol: '?', name: id };

/** Construit et enregistre le « Rapport du jour » d'une exécution quotidienne. */
export function buildDailyReport(db: Db, runId: number, asOf: Date, extra: { newTokenIds: string[]; removed: any[]; providerIssues: string[]; steps: any[] }) {
  const reportDate = localDate(asOf);

  const newProjects = extra.newTokenIds
    .map((id) => {
      const best = db.get<any>(`SELECT horizon, rank, score, status FROM rankings WHERE run_id = ? AND token_id = ? ORDER BY score DESC LIMIT 1`, runId, id);
      return { token: tokenLite(db, id), best };
    })
    .filter((x) => x.token.status !== 'suspect')
    .sort((a, b) => (b.best?.score ?? -1) - (a.best?.score ?? -1))
    .slice(0, 25);

  const gainers: any[] = [];
  const multiplierChanges: any[] = [];
  for (const h of HORIZONS) {
    const rows = db.all<any>(`SELECT * FROM rankings WHERE run_id = ? AND horizon = ? AND rank IS NOT NULL AND rank <= ?`, runId, h, LIST_SIZE);
    for (const r of rows) {
      const mv = pj<any>(r.movement, {});
      if (mv.prevScore != null && r.score != null && r.score - mv.prevScore >= 3) {
        gainers.push({ horizon: h, token: tokenLite(db, r.token_id), score: r.score, prevScore: mv.prevScore, rank: r.rank, prevRank: mv.prevRank, reasons: mv.reasons });
      }
      // Changement de multiplicateur haussier vs exécution précédente.
      const prev = db.get<any>(`SELECT scenarios FROM rankings WHERE token_id = ? AND horizon = ? AND run_id < ? ORDER BY run_id DESC LIMIT 1`, r.token_id, h, runId);
      const curS = pj<any>(r.scenarios, null)?.scenarios ?? [];
      const prevS = pj<any>(prev?.scenarios, null)?.scenarios ?? [];
      const cur = curS.find((s: any) => s.kind === 'haussier') ?? curS[0];
      const old = prevS.find((s: any) => s.kind === cur?.kind);
      if (cur && old && Math.abs(cur.multiplierHigh / old.multiplierHigh - 1) > 0.25) {
        multiplierChanges.push({ horizon: h, token: tokenLite(db, r.token_id), kind: cur.kind, from: old.display, to: cur.display });
      }
    }
  }
  gainers.sort((a, b) => b.score - b.prevScore - (a.score - a.prevScore));

  const shifts = narrativeShifts(db, asOf);

  const today = asOf.toISOString().slice(0, 10);
  const in30 = new Date(asOf.getTime() + 30 * 86400_000).toISOString().slice(0, 10);
  const catalysts = db.all<any>(
    `SELECT c.*, t.symbol, t.name FROM catalysts c JOIN tokens t ON t.id = c.token_id WHERE c.event_date BETWEEN ? AND ? ORDER BY c.event_date LIMIT 60`, today, in30,
  );

  const insufficient = db.get<{ n: number }>(`SELECT COUNT(DISTINCT token_id) AS n FROM rankings WHERE run_id = ? AND status = 'insufficient'`, runId)?.n ?? 0;
  const suspects = db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM tokens WHERE status = 'suspect' AND last_seen_at >= ?`, isoMinus(asOf, 2))?.n ?? 0;

  const data = {
    reportDate,
    generatedAt: nowIso(),
    runId,
    newProjects,
    topGainers: gainers.slice(0, 15),
    narratives: {
      emerging: shifts.emerging.map((x) => ({ id: x.id, name: x.name, rank: x.rank, rank7dAgo: x.rank7dAgo, change24h: x.change24h })),
      fading: shifts.fading.map((x) => ({ id: x.id, name: x.name, rank: x.rank, rank7dAgo: x.rank7dAgo, change24h: x.change24h })),
      note: shifts.emerging.length + shifts.fading.length === 0 ? 'Historique de narratives < 7 jours : comparaison disponible après une semaine d’analyses.' : null,
    },
    catalysts: {
      confirmed: catalysts.filter((c) => c.status === 'confirmed'),
      unconfirmed: catalysts.filter((c) => c.status !== 'confirmed'),
    },
    removed: extra.removed.map((r) => ({ ...r, token: tokenLite(db, r.tokenId) })).slice(0, 40),
    multiplierChanges: multiplierChanges.slice(0, 20),
    dataGaps: {
      insufficientTokens: insufficient,
      suspectsDetected: suspects,
      providerIssues: extra.providerIssues,
      failedSteps: extra.steps.filter((s) => !s.ok).map((s) => ({ name: s.name, error: s.error })),
    },
  };
  db.run('INSERT OR REPLACE INTO daily_reports(run_id, report_date, created_at, data) VALUES(?,?,?,?)', runId, reportDate, nowIso(), j(data));
  return data;
}
