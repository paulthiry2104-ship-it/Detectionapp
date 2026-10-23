import { type Db, pj } from '../db/db.ts';
import { evaluateAll, LIST_SIZE } from '../engine/ranking.ts';
import { type Horizon, HORIZON_DAYS } from '../engine/time.ts';

const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

type Outcome = {
  tokenId: string; symbol: string; rank: number; score: number; ts: string; startPrice: number;
  endPrice: number | null; ret: number | null; peakRet: number | null; btcRet: number | null;
  state: 'évalué' | 'disparu' | 'en cours'; scenarioHigh: number | null;
};

function priceAt(db: Db, tokenId: string, target: string, maxDriftDays = 1.5) {
  const after = db.get<{ price_usd: number; ts: string }>(
    'SELECT price_usd, ts FROM market_snapshots WHERE token_id = ? AND ts >= ? AND price_usd > 0 ORDER BY ts LIMIT 1', tokenId, target,
  );
  if (after && (new Date(after.ts).getTime() - new Date(target).getTime()) / 86400_000 <= maxDriftDays) return after;
  return null;
}

/**
 * Mesure a posteriori des classements enregistrés (aucune information future n'a servi à les produire).
 * Les tokens disparus sont COMPTÉS (biais du survivant) : rendement au dernier prix connu, et part de disparus affichée.
 */
export function performance(db: Db, horizon: Horizon, now = new Date(), maxRank = LIST_SIZE) {
  const days = HORIZON_DAYS[horizon];
  const rows = db.all<any>(
    `SELECT r.*, t.symbol FROM rankings r JOIN job_runs jr ON jr.id = r.run_id JOIN tokens t ON t.id = r.token_id
     WHERE jr.job = 'daily' AND jr.status IN ('success','partial') AND r.horizon = ? AND r.rank IS NOT NULL AND r.rank <= ? AND r.price_usd > 0
     ORDER BY r.ts DESC LIMIT 5000`, horizon, maxRank,
  );
  const outcomes: Outcome[] = [];
  for (const r of rows) {
    const target = new Date(new Date(r.ts).getTime() + days * 86400_000);
    const scen = pj<any>(r.scenarios, null);
    const scenarioHigh = scen?.scenarios?.find((s: any) => s.kind === 'haussier')?.multiplierHigh ?? scen?.scenarios?.[0]?.multiplierHigh ?? null;
    const base: Omit<Outcome, 'endPrice' | 'ret' | 'peakRet' | 'btcRet' | 'state'> = { tokenId: r.token_id, symbol: r.symbol, rank: r.rank, score: r.score, ts: r.ts, startPrice: r.price_usd, scenarioHigh };
    const peak = db.get<{ p: number }>('SELECT MAX(price_usd) p FROM market_snapshots WHERE token_id = ? AND ts > ? AND ts <= ?', r.token_id, r.ts, target.toISOString())?.p ?? null;
    const peakRet = peak ? peak / r.price_usd - 1 : null;
    if (target > now) {
      outcomes.push({ ...base, endPrice: null, ret: null, peakRet, btcRet: null, state: 'en cours' });
      continue;
    }
    const end = priceAt(db, r.token_id, target.toISOString());
    const btcStart = priceAt(db, 'cg:bitcoin', r.ts, 0.5);
    const btcEnd = priceAt(db, 'cg:bitcoin', target.toISOString());
    const btcRet = btcStart && btcEnd ? btcEnd.price_usd / btcStart.price_usd - 1 : null;
    if (end) {
      outcomes.push({ ...base, endPrice: end.price_usd, ret: end.price_usd / r.price_usd - 1, peakRet, btcRet, state: 'évalué' });
    } else {
      const last = db.get<{ price_usd: number }>('SELECT price_usd FROM market_snapshots WHERE token_id = ? AND ts <= ? AND price_usd > 0 ORDER BY ts DESC LIMIT 1', r.token_id, target.toISOString());
      outcomes.push({ ...base, endPrice: last?.price_usd ?? null, ret: last ? last.price_usd / r.price_usd - 1 : -1, peakRet, btcRet, state: 'disparu' });
    }
  }
  const done = outcomes.filter((o) => o.state !== 'en cours');
  const rets = done.map((o) => o.ret as number);
  const agg = (list: Outcome[]) => {
    const rs = list.map((o) => o.ret as number);
    return {
      n: list.length,
      medianReturn: median(rs),
      meanReturn: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null,
      hitRate: rs.length ? rs.filter((x) => x > 0).length / rs.length : null,
      doubledAtPeak: list.length ? list.filter((o) => (o.peakRet ?? -1) >= 1).length / list.length : null,
      reachedScenario: list.filter((o) => o.scenarioHigh).length
        ? list.filter((o) => o.scenarioHigh && (o.peakRet ?? -1) + 1 >= o.scenarioHigh).length / list.filter((o) => o.scenarioHigh).length : null,
      disappeared: list.length ? list.filter((o) => o.state === 'disparu').length / list.length : null,
      beatBtc: list.filter((o) => o.btcRet != null).length ? list.filter((o) => o.btcRet != null && (o.ret as number) > (o.btcRet as number)).length / list.filter((o) => o.btcRet != null).length : null,
    };
  };
  return {
    horizon,
    windowDays: days,
    note: done.length ? null : `Pas encore de classement vieux de ${days} jours : les résultats apparaîtront automatiquement.`,
    overall: agg(done),
    top10: agg(done.filter((o) => o.rank <= 10)),
    rest: agg(done.filter((o) => o.rank > 10)),
    inProgress: outcomes.filter((o) => o.state === 'en cours').length,
    worst: [...done].sort((a, b) => (a.ret as number) - (b.ret as number)).slice(0, 10),
    best: [...done].sort((a, b) => (b.ret as number) - (a.ret as number)).slice(0, 10),
    sampleMedian: median(rets),
  };
}

/** Rejoue le moteur à une date passée avec les seules données disponibles à cette date (pondérations éventuellement différentes). */
export function replayAt(db: Db, asOf: Date, catalystSourceActive: boolean) {
  const { rows } = evaluateAll(db, asOf, { catalystSourceActive });
  const byH: Record<string, any[]> = {};
  for (const r of rows.filter((x) => x.status === 'ranked')) (byH[r.horizon] ??= []).push({ tokenId: r.tokenId, score: r.score, price: r.price });
  for (const k of Object.keys(byH)) byH[k] = byH[k].sort((a, b) => b.score - a.score).slice(0, LIST_SIZE);
  return byH;
}
