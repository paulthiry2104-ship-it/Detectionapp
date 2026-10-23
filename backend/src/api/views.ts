import { type Db, pj } from '../db/db.ts';
import { buildFeatures } from '../engine/features.ts';
import { LIST_SIZE } from '../engine/ranking.ts';
import { COMPONENT_LABELS, COMPONENTS } from '../engine/scoring.ts';
import { type Horizon, HORIZON_LABEL, hoursSince, isoMinus, nextLocalTime } from '../engine/time.ts';
import { loadConfig } from '../config.ts';
import { CHAINS } from '../providers/types.ts';

export const EXPLORERS: Record<string, (a: string) => string> = {
  solana: (a) => `https://solscan.io/token/${a}`,
  ethereum: (a) => `https://etherscan.io/token/${a}`,
  base: (a) => `https://basescan.org/token/${a}`,
  bsc: (a) => `https://bscscan.com/token/${a}`,
  arbitrum: (a) => `https://arbiscan.io/token/${a}`,
};

/** Dernière exécution ayant produit des classements (succès ou partielle). */
export function latestRankingRun(db: Db) {
  return db.get<any>(`SELECT jr.* FROM job_runs jr WHERE jr.status IN ('success','partial') AND EXISTS (SELECT 1 FROM rankings r WHERE r.run_id = jr.id) ORDER BY jr.id DESC LIMIT 1`);
}

export function statusView(db: Db) {
  const now = new Date();
  const jobs: Record<string, any> = {};
  for (const job of ['daily', 'refresh', 'discovery']) {
    const last = db.get<any>('SELECT id, status, started_at, finished_at, error, trigger FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 1', job);
    const lastOk = db.get<any>(`SELECT id, status, started_at, finished_at FROM job_runs WHERE job = ? AND status IN ('success','partial') ORDER BY id DESC LIMIT 1`, job);
    jobs[job] = { last, lastSuccess: lastOk };
  }
  const dailyOkAge = jobs.daily.lastSuccess ? hoursSince(jobs.daily.lastSuccess.finished_at ?? jobs.daily.lastSuccess.started_at, now) : null;
  const rr = latestRankingRun(db);
  const warnings: string[] = [];
  if (dailyOkAge == null) warnings.push('Aucune analyse quotidienne réussie pour le moment.');
  else if (dailyOkAge > 26) warnings.push(`Dernière analyse quotidienne réussie il y a ${Math.round(dailyOkAge)} h : données potentiellement obsolètes.`);
  if (jobs.daily.last?.status === 'failed') warnings.push(`La dernière analyse quotidienne a échoué : ${jobs.daily.last.error}`);
  if (jobs.daily.last?.status === 'partial') warnings.push('La dernière analyse quotidienne est partielle (certaines sources ont échoué).');
  const providers = db.all<any>('SELECT * FROM provider_status ORDER BY provider');
  for (const p of providers) {
    if (p.last_error_at && (!p.last_ok_at || p.last_error_at > p.last_ok_at) && hoursSince(p.last_error_at, now) < 6) warnings.push(`Source ${p.provider} indisponible (${p.last_error}).`);
  }
  const analyzed = rr ? db.get<{ n: number }>('SELECT COUNT(DISTINCT token_id) n FROM rankings WHERE run_id = ?', rr.id)?.n ?? 0 : 0;
  const tracked = db.get<{ n: number }>(`SELECT COUNT(*) n FROM tokens WHERE last_seen_at >= ?`, isoMinus(now, 3))?.n ?? 0;
  const cfg = loadConfig();
  const [mm, hh] = cfg.DAILY_CRON.split(' ');
  let nextDaily: string | null = null;
  try { nextDaily = /^\d+$/.test(mm) && /^\d+$/.test(hh) ? nextLocalTime(Number(hh), Number(mm), cfg.TZ_SCHEDULE, now).toISOString() : null; } catch { nextDaily = null; }
  return {
    now: now.toISOString(),
    scheduler: { enabled: cfg.schedulerEnabled, dailyCron: cfg.DAILY_CRON, timezone: cfg.TZ_SCHEDULE, nextDaily },
    jobs,
    lastRankingRun: rr ? { id: rr.id, job: rr.job, status: rr.status, at: rr.finished_at ?? rr.started_at } : null,
    projectsAnalyzed: analyzed,
    tokensTracked: tracked,
    providers,
    warnings,
  };
}

export function tokenCard(db: Db, r: any) {
  const t = db.get<any>('SELECT * FROM tokens WHERE id = ?', r.token_id);
  const comps = pj<any>(r.components, {});
  const snap = db.get<any>('SELECT * FROM market_snapshots WHERE token_id = ? ORDER BY ts DESC LIMIT 1', r.token_id);
  const scen = pj<any>(r.scenarios, null);
  const scenarios = scen?.scenarios ?? [];
  const main = scenarios.find((s: any) => s.kind === 'haussier') ?? scenarios[0];
  return {
    id: r.token_id,
    rank: r.rank,
    symbol: t?.symbol, name: t?.name, chain: t?.chain, chainLabel: CHAINS[t?.chain]?.label ?? t?.chain ?? null,
    logo: t?.logo_url, contract: t?.contract_address, narrative: comps._narrative?.name ?? null, narrativeSource: comps._narrative?.source ?? null,
    price: r.price_usd, marketCap: r.market_cap, fdv: r.fdv,
    change24h: snap?.change_24h ?? null, change7d: db.get<any>('SELECT change_7d FROM market_snapshots WHERE token_id = ? AND change_7d IS NOT NULL ORDER BY ts DESC LIMIT 1', r.token_id)?.change_7d ?? null,
    volume24h: snap?.volume_24h ?? null,
    liquidity: db.get<any>('SELECT liquidity_usd FROM market_snapshots WHERE token_id = ? AND liquidity_usd IS NOT NULL ORDER BY ts DESC LIMIT 1', r.token_id)?.liquidity_usd ?? null,
    score: r.score, confidence: r.confidence, coverage: r.coverage, status: r.status,
    scenario: main ? { display: main.display, kind: main.kind, label: main.label, horizon: main.horizon, method: main.method } : null,
    scenarioReason: scen && !scenarios.length ? scen.reason : null,
    catalyst: pj<any>(r.catalyst_proximity, null),
    movement: pj<any>(r.movement, null),
    updatedAt: snap?.ts ?? r.ts,
    risk: (comps._risk ?? []).filter((f: any) => f.severity !== 'medium').length ? 'élevé' : (comps._risk ?? []).length ? 'modéré' : 'faible',
  };
}

export function rankingsView(db: Db, horizon: Horizon, q: { chain?: string; category?: string; mcapMin?: number; mcapMax?: number; q?: string; includeInsufficient?: boolean }) {
  const rr = db.get<any>(`SELECT jr.* FROM job_runs jr WHERE jr.status IN ('success','partial') AND EXISTS (SELECT 1 FROM rankings r WHERE r.run_id = jr.id AND r.horizon = ?) ORDER BY jr.id DESC LIMIT 1`, horizon);
  if (!rr) return { horizon, label: HORIZON_LABEL[horizon], run: null, items: [], insufficient: [], window: null };
  const rows = db.all<any>(`SELECT * FROM rankings WHERE run_id = ? AND horizon = ? AND rank IS NOT NULL AND rank <= ? ORDER BY rank`, rr.id, horizon, LIST_SIZE);
  let items = rows.map((r) => tokenCard(db, r));
  if (q.chain) items = items.filter((i) => i.chain === q.chain);
  if (q.category) items = items.filter((i) => (i.narrative ?? '').toLowerCase().includes(q.category!.toLowerCase()));
  if (q.mcapMin != null) items = items.filter((i) => (i.marketCap ?? 0) >= q.mcapMin!);
  if (q.mcapMax != null) items = items.filter((i) => i.marketCap != null && i.marketCap <= q.mcapMax!);
  if (q.q) { const s = q.q.toLowerCase(); items = items.filter((i) => `${i.symbol} ${i.name} ${i.contract}`.toLowerCase().includes(s)); }
  const insufficient = q.includeInsufficient
    ? db.all<any>(`SELECT * FROM rankings WHERE run_id = ? AND horizon = ? AND status = 'insufficient' ORDER BY coverage DESC LIMIT 30`, rr.id, horizon).map((r) => tokenCard(db, r))
    : [];
  return {
    horizon, label: HORIZON_LABEL[horizon],
    run: { id: rr.id, job: rr.job, status: rr.status, at: rr.finished_at ?? rr.started_at },
    window: rows[0] ? { start: rows[0].window_start, end: rows[0].window_end } : null,
    items, insufficient,
  };
}

export function tokenDetail(db: Db, id: string) {
  const t = db.get<any>('SELECT * FROM tokens WHERE id = ?', id);
  if (!t) return null;
  const f = buildFeatures(db, id, new Date());
  const ranks = db.all<any>(`SELECT r.* FROM rankings r WHERE r.token_id = ? AND r.run_id = (SELECT MAX(run_id) FROM rankings WHERE token_id = ?)`, id, id);
  const byH: Record<string, any> = {};
  for (const r of ranks) {
    const comps = pj<any>(r.components, {});
    byH[r.horizon] = {
      rank: r.rank, score: r.score, confidence: r.confidence, coverage: r.coverage, status: r.status, reason: comps._reason,
      scenarios: pj<any>(r.scenarios, null), catalyst: pj<any>(r.catalyst_proximity, null), movement: pj<any>(r.movement, null), at: r.ts,
      components: COMPONENTS.map((k) => ({ key: k, label: COMPONENT_LABELS[k], ...comps[k] })),
      penalties: comps._penalties, narrative: comps._narrative, risk: comps._risk ?? [],
    };
  }
  const history = db.all<any>(
    `SELECT ts, price_usd, market_cap, volume_24h, liquidity_usd, source FROM market_snapshots WHERE token_id = ? AND ts >= ? ORDER BY ts`, id, isoMinus(new Date(), 90),
  );
  const sources: { label: string; url: string; at?: string | null }[] = [];
  const addSrc = (label: string, url: string | null | undefined, at?: string | null) => { if (url && !sources.some((s) => s.url === url)) sources.push({ label, url, at }); };
  if (t.coingecko_id) addSrc('CoinGecko', `https://www.coingecko.com/en/coins/${t.coingecko_id}`, f.latestBySource.coingecko?.ts);
  addSrc('DexScreener', f.latestBySource.dexscreener?.source_url ?? (t.dex_url?.includes('dexscreener') ? t.dex_url : null), f.latestBySource.dexscreener?.ts);
  addSrc('GeckoTerminal', f.latestBySource.geckoterminal?.source_url, f.latestBySource.geckoterminal?.ts);
  if (t.contract_address && EXPLORERS[t.chain]) addSrc('Explorateur blockchain', EXPLORERS[t.chain](t.contract_address));
  addSrc('Site officiel (déclaré)', t.website);
  addSrc('Compte X / Twitter (déclaré)', t.twitter);
  for (const sc of f.security) addSrc(`Sécurité (${sc.provider})`, sc.source_url, sc.ts);
  for (const c of f.catalysts) addSrc(`Catalyseur : ${c.title}`, c.source_url, c.fetched_at);

  const missing: string[] = [];
  if (f.liquidity == null) missing.push('Liquidité');
  if (f.circulating == null) missing.push('Offre en circulation');
  if (f.max == null && f.total == null) missing.push('Offre totale / maximale');
  if (f.holdersNow == null) missing.push('Nombre de détenteurs');
  if (!f.security.length) missing.push('Contrôle de sécurité du contrat');
  missing.push('Calendrier de déblocages (aucune source gratuite fiable intégrée)');
  if (!f.catalysts.length) missing.push('Catalyseurs datés');

  return {
    identity: {
      id, symbol: t.symbol, name: t.name, chain: t.chain, chainLabel: CHAINS[t.chain]?.label ?? t.chain, contract: t.contract_address,
      coingeckoId: t.coingecko_id, logo: t.logo_url, status: t.status, statusReason: t.status_reason, firstSeen: t.first_seen_at,
      pairCreatedAt: t.pair_created_at, discoveredVia: t.discovered_via, website: t.website, twitter: t.twitter,
    },
    market: {
      price: f.price, marketCap: f.marketCap, fdv: f.fdv, volume24h: f.volume24h, liquidity: f.liquidity,
      change24h: f.change24h, change7d: f.change7d, circulating: f.circulating, total: f.total, max: f.max,
      top10HoldersPct: f.security.find((s) => s.top10_holders_pct != null)?.top10_holders_pct ?? null,
      holders: f.holdersNow, buys24h: f.buys24h, sells24h: f.sells24h,
      updatedAt: f.latest?.ts ?? null, dataAgeHours: f.dataAgeHours, sourcesCount: f.sourcesCount, priceDivergencePct: f.priceDivergencePct,
      markets: Object.values(f.latestBySource).map((s) => ({ source: s.source, url: s.source_url, price: s.price_usd, liquidity: s.liquidity_usd, volume24h: s.volume_24h, at: s.ts })),
    },
    narrative: {
      description: t.description, categories: pj<string[]>(t.categories, []), main: byH.year?.narrative ?? byH.month?.narrative ?? null,
      note: t.narrative_source === 'heuristique' || (!t.coingecko_id) ? 'Narrative déduite (token DEX non référencé sur CoinGecko) : hypothèse, pas une donnée officielle.' : null,
      devCommits4w: t.dev_commits_4w,
    },
    catalysts: f.catalysts,
    horizons: byH,
    signals: {
      volume: { now: f.volume24h, avgPrev7d: f.avgPrevVolume7d, intradayRatio: f.intradayVolumeRatio },
      liquidity: { now: f.liquidity, threeDaysAgo: f.liquidity3dAgo },
      transactions: { buys24h: f.buys24h, sells24h: f.sells24h, prev24h: f.txns24hPrev },
      holders: { now: f.holdersNow, prev: f.holdersPrev },
      security: f.security,
      historyDays: Math.round(f.historyDays * 10) / 10,
    },
    history,
    sources,
    missing,
    disclaimer: 'Données observées, hypothèses et estimations sont distinguées. Les scénarios ne sont ni des promesses ni des probabilités. Ceci n’est pas un conseil en investissement.',
  };
}
