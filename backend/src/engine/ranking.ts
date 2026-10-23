import { type Db, j, nowIso, pj } from '../db/db.ts';
import { getSetting, isExcludedAsset } from '../store.ts';
import { buildFeatures, type Features } from './features.ts';
import { buildScenarios, type Peer } from './multipliers.ts';
import { narrativeContext, narrativeScore } from './narratives.ts';
import { COMPONENT_LABELS, COMPONENTS, catalystProximity, DEFAULT_WEIGHTS, scoreToken, type Weights } from './scoring.ts';
import { assessRisk } from './suspicion.ts';
import { type Horizon, HORIZONS, horizonWindow, isoMinus } from './time.ts';

export const LIST_SIZE = 50;

export function getWeights(db: Db): Weights {
  const stored = getSetting<Partial<Weights> | null>(db, 'weights', null);
  if (!stored) return DEFAULT_WEIGHTS;
  return {
    ...DEFAULT_WEIGHTS,
    ...stored,
    week: { ...DEFAULT_WEIGHTS.week, ...(stored.week ?? {}) },
    month: { ...DEFAULT_WEIGHTS.month, ...(stored.month ?? {}) },
    year: { ...DEFAULT_WEIGHTS.year, ...(stored.year ?? {}) },
  };
}

/** Catégorie de comparables la plus récente (avant asOf). */
export function getPeers(db: Db, category: string, asOf: Date): Peer[] {
  const r = db.get<{ peer_names: string }>('SELECT peer_names FROM category_peers WHERE category_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 1', category, asOf.toISOString());
  return r ? pj<Peer[]>(r.peer_names, []) : [];
}

const HEURISTIC_MEME_BY_CHAIN: Record<string, string[]> = {
  solana: ['solana-meme-coins', 'meme-token'],
  base: ['base-meme-coins', 'meme-token'],
  bsc: ['bnb-chain-meme-coins', 'meme-token'],
  ethereum: ['meme-token'],
  arbitrum: ['meme-token'],
};

export function resolveNarrative(db: Db, token: any, asOf: Date): { category: string | null; name: string | null; source: string | null; peers: Peer[] } {
  const candidates: { id: string; source: string }[] = [];
  if (token.narrative) candidates.push({ id: token.narrative, source: token.narrative_source ?? 'coingecko' });
  if (!token.coingecko_id) for (const id of HEURISTIC_MEME_BY_CHAIN[token.chain] ?? ['meme-token']) candidates.push({ id, source: 'heuristique' });
  for (const c of candidates) {
    const peers = getPeers(db, c.id, asOf);
    if (peers.length) {
      const name = db.get<{ name: string }>('SELECT name FROM category_snapshots WHERE category_id = ? ORDER BY ts DESC LIMIT 1', c.id)?.name ?? c.id;
      return { category: c.id, name, source: c.source, peers };
    }
  }
  return { category: candidates[0]?.id ?? null, name: null, source: candidates[0]?.source ?? null, peers: [] };
}

export type RankedRow = {
  tokenId: string; horizon: Horizon; status: string; score: number | null; confidence: number; coverage: number;
  components: any; scenarios: any; catalyst: any; price: number | null; marketCap: number | null; fdv: number | null; reason?: string;
  riskFlags: any[]; narrative: { category: string | null; name: string | null; source: string | null };
};

/** Univers : tokens vus récemment, avec un snapshot de moins de 24 h. */
export function candidateTokens(db: Db, asOf: Date): any[] {
  return db.all(
    `SELECT t.* FROM tokens t WHERE t.status != 'delisted' AND t.last_seen_at >= ?
       AND EXISTS (SELECT 1 FROM market_snapshots s WHERE s.token_id = t.id AND s.ts <= ? AND s.ts >= ?)`,
    isoMinus(asOf, 3), asOf.toISOString(), isoMinus(asOf, 1),
  );
}

export function knownSymbolMap(db: Db, asOf: Date): Map<string, string> {
  const rows = db.all<{ id: string; symbol: string }>(
    `SELECT t.id, t.symbol FROM tokens t JOIN market_snapshots s ON s.token_id = t.id
     WHERE t.id LIKE 'cg:%' AND s.source = 'coingecko' AND s.market_cap > 1e8 AND s.ts <= ? AND s.ts >= ?
     GROUP BY t.id`, asOf.toISOString(), isoMinus(asOf, 3),
  );
  const m = new Map<string, string>();
  for (const r of rows) if (!m.has(r.symbol.toUpperCase())) m.set(r.symbol.toUpperCase(), r.id);
  return m;
}

/** Évalue tous les candidats pour les 3 horizons (sans écrire). Utilisé par la tâche et le backtest. */
export function evaluateAll(db: Db, asOf: Date, opts: { catalystSourceActive: boolean; weights?: Weights; onlyIds?: string[] }) {
  const weights = opts.weights ?? getWeights(db);
  const narr = narrativeContext(db, asOf);
  const known = knownSymbolMap(db, asOf);
  const tokens = opts.onlyIds ? opts.onlyIds.map((id) => db.get('SELECT * FROM tokens WHERE id = ?', id)).filter(Boolean) : candidateTokens(db, asOf);
  const rows: RankedRow[] = [];
  const featuresById = new Map<string, Features>();
  const suspects: { tokenId: string; flags: any[] }[] = [];

  for (const t of tokens) {
    if (isExcludedAsset(t)) continue;
    const f = buildFeatures(db, t.id, asOf);
    if (!f.latest) continue;
    featuresById.set(t.id, f);
    const risk = assessRisk(f, known);
    if (risk.suspect) suspects.push({ tokenId: t.id, flags: risk.flags });
    const nv = resolveNarrative(db, t, asOf);
    const ns = narrativeScore(nv.category ? narr.get(nv.category) : undefined);
    const tooBig = f.marketCap != null && f.marketCap > weights.maxMarketCap;

    for (const h of HORIZONS) {
      const scen = buildScenarios({
        marketCap: f.marketCap, fdv: f.fdv, liquidity: f.liquidity, circulating: f.circulating, total: f.total,
        category: nv.category, categoryName: nv.name, peers: nv.peers, horizon: h, selfId: t.coingecko_id ?? t.id,
      });
      const headroomMult = scen.scenarios.length ? (scen.scenarios.find((s) => s.kind === 'haussier') ?? scen.scenarios[0]).multiplierHigh : null;
      const res = scoreToken(f, h, asOf, {
        narrative: ns, headroomMultiplier: headroomMult, devCommits4w: t.dev_commits_4w, catalystSourceActive: opts.catalystSourceActive,
      }, weights, risk);
      let status = res.status as string;
      let reason = res.reason;
      if (status === 'ranked' && tooBig) { status = 'ineligible'; reason = `Capitalisation > ${weights.maxMarketCap / 1e9} Md$ (hors focus microcaps/émergents)`; }
      rows.push({
        tokenId: t.id, horizon: h, status, score: status === 'ranked' ? res.score : null, confidence: res.confidence, coverage: res.coverage,
        components: { ...res.components, _penalties: res.penalties },
        scenarios: scen, catalyst: catalystProximity(f, h, asOf),
        price: f.price, marketCap: f.marketCap, fdv: f.fdv, reason, riskFlags: risk.flags, narrative: nv,
      });
    }
  }
  return { rows, featuresById, suspects, weights };
}

function previousRanks(db: Db, horizon: Horizon, beforeRunId: number) {
  const prevRun = db.get<{ run_id: number }>(
    `SELECT r.run_id FROM rankings r JOIN job_runs jr ON jr.id = r.run_id
     WHERE r.horizon = ? AND r.run_id < ? AND jr.status IN ('success','partial') ORDER BY r.run_id DESC LIMIT 1`, horizon, beforeRunId,
  );
  const map = new Map<string, { rank: number | null; score: number | null; components: any; scenarios: any }>();
  if (!prevRun) return { runId: null as number | null, map };
  for (const r of db.all<any>('SELECT token_id, rank, score, components, scenarios FROM rankings WHERE run_id = ? AND horizon = ?', prevRun.run_id, horizon)) {
    map.set(r.token_id, { rank: r.rank, score: r.score, components: pj(r.components, {}), scenarios: pj(r.scenarios, null) });
  }
  return { runId: prevRun.run_id, map };
}

function explainMove(cur: RankedRow, prev: { components: any } | undefined) {
  if (!prev) return [];
  const deltas = COMPONENTS.map((k) => {
    const a = cur.components[k]?.contribution;
    const b = prev.components?.[k]?.contribution;
    return { k, d: a != null && b != null ? a - b : null };
  }).filter((x) => x.d != null && Math.abs(x.d) > 0.005) as { k: (typeof COMPONENTS)[number]; d: number }[];
  return deltas.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).slice(0, 2).map((x) => `${COMPONENT_LABELS[x.k]} ${x.d > 0 ? '↑' : '↓'}`);
}

/** Calcule et enregistre les classements d'une exécution. */
export function computeAndStoreRankings(db: Db, runId: number, asOf: Date, opts: { catalystSourceActive: boolean }) {
  const { rows, suspects, weights } = evaluateAll(db, asOf, opts);
  const ts = nowIso();
  const summary: Record<string, any> = {};
  const removed: any[] = [];
  const entered: { tokenId: string; horizon: Horizon; rank: number }[] = [];

  db.tx(() => {
    // Statut "suspect" persistant pour l'affichage.
    db.run(`UPDATE tokens SET status = 'active', status_reason = NULL WHERE status = 'suspect'`);
    for (const sp of suspects) {
      db.run(`UPDATE tokens SET status = 'suspect', status_reason = ? WHERE id = ?`, sp.flags.filter((f) => f.severity !== 'medium').map((f) => f.label).join(' · '), sp.tokenId);
    }

    for (const h of HORIZONS) {
      const w = horizonWindow(h, asOf);
      const hr = rows.filter((r) => r.horizon === h);
      const ranked = hr.filter((r) => r.status === 'ranked').sort((a, b) => (b.score as number) - (a.score as number));
      const prev = previousRanks(db, h, runId);
      const rankOf = new Map(ranked.map((r, i) => [r.tokenId, i + 1]));
      // On enregistre : classés + insuffisants + suspects (pour l'historique et le biais du survivant).
      for (const r of hr) {
        if (r.status === 'ineligible' && !prev.map.get(r.tokenId)?.rank) continue;
        const rank = rankOf.get(r.tokenId) ?? null;
        const p = prev.map.get(r.tokenId);
        const listed = rank != null && rank <= LIST_SIZE;
        const wasListed = p?.rank != null && p.rank <= LIST_SIZE;
        const movement = {
          prevRank: p?.rank ?? null,
          delta: rank != null && p?.rank != null ? p.rank - rank : null,
          entered: listed && !wasListed,
          left: !listed && wasListed,
          reasons: explainMove(r, p),
          prevScore: p?.score ?? null,
          leaveReason: !listed && wasListed ? (r.reason ?? (rank ? `Score ${r.score} : hors du top ${LIST_SIZE}` : 'Non classé')) : null,
        };
        if (movement.entered) entered.push({ tokenId: r.tokenId, horizon: h, rank: rank as number });
        if (movement.left) removed.push({ tokenId: r.tokenId, horizon: h, prevRank: p?.rank, reason: movement.leaveReason });
        db.run(
          `INSERT INTO rankings(run_id,ts,horizon,window_start,window_end,token_id,rank,score,confidence,coverage,components,scenarios,catalyst_proximity,price_usd,market_cap,fdv,status,movement,weights_version)
           VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          runId, ts, h, w.start, w.end, r.tokenId, rank, r.score, r.confidence, r.coverage,
          j({ ...r.components, _narrative: r.narrative, _risk: r.riskFlags, _reason: r.reason ?? null }),
          j(r.scenarios), j(r.catalyst), r.price, r.marketCap, r.fdv, r.status, j(movement), weights.version,
        );
      }
      // Tokens précédemment listés qui ne sont même plus candidats (disparus, plus de données).
      for (const [tid, p] of prev.map) {
        if (p.rank != null && p.rank <= LIST_SIZE && !hr.some((r) => r.tokenId === tid)) {
          removed.push({ tokenId: tid, horizon: h, prevRank: p.rank, reason: 'Plus de données de marché récentes (token inactif ou disparu)' });
        }
      }
      summary[h] = { ranked: ranked.length, listed: Math.min(LIST_SIZE, ranked.length), insufficient: hr.filter((r) => r.status === 'insufficient').length };
    }
  });
  return { summary, removed, entered, suspects: suspects.length, evaluated: new Set(rows.map((r) => r.tokenId)).size };
}
