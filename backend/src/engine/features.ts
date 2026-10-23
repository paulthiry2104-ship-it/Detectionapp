import { type Db, pj } from '../db/db.ts';
import { daysBetween, hoursSince, isoMinus } from './time.ts';

export type Snap = {
  ts: string; source: string; source_url: string | null;
  price_usd: number | null; market_cap: number | null; fdv: number | null;
  volume_24h: number | null; volume_1h: number | null; volume_6h: number | null; liquidity_usd: number | null;
  change_1h: number | null; change_24h: number | null; change_7d: number | null;
  circulating_supply: number | null; total_supply: number | null; max_supply: number | null;
  buys_24h: number | null; sells_24h: number | null;
};

export type Features = {
  tokenId: string;
  asOf: string;
  token: any;
  latest: Snap | null;                  // snapshot principal le plus récent
  latestBySource: Record<string, Snap>;
  dataAgeHours: number | null;
  price: number | null;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  liquidity: number | null;
  change24h: number | null;
  change7d: number | null;
  circulating: number | null;
  total: number | null;
  max: number | null;
  avgPrevVolume7d: number | null;       // moyenne des volumes 24h des 7 jours précédents (historique propre)
  intradayVolumeRatio: number | null;   // (vol 1h × 24) / vol 24h  — DEX uniquement
  liquidity3dAgo: number | null;
  buys24h: number | null;
  sells24h: number | null;
  txns24hPrev: number | null;
  holdersNow: number | null;
  holdersPrev: number | null;
  historyDays: number;
  ageDays: number | null;
  security: { provider: string; flags: string[]; is_honeypot: number | null; sell_tax: number | null; top10_holders_pct: number | null; holder_count: number | null; source_url: string | null; ts: string }[];
  catalysts: { id: string; title: string; kind: string | null; event_date: string | null; date_precision: string; status: string; source_name: string; source_url: string; fetched_at: string }[];
  priceDivergencePct: number | null;    // écart de prix entre sources (recoupement)
  sourcesCount: number;
};

/**
 * Construit les variables d'un token à une date donnée, en n'utilisant QUE
 * des données enregistrées avant `asOf` (pas de fuite d'information future → backtest honnête).
 */
export function buildFeatures(db: Db, tokenId: string, asOfDate: Date): Features {
  const asOf = asOfDate.toISOString();
  const token = db.get('SELECT * FROM tokens WHERE id = ?', tokenId);
  const snaps = db.all<Snap>(
    `SELECT * FROM market_snapshots WHERE token_id = ? AND ts <= ? AND ts >= ? ORDER BY ts DESC`,
    tokenId, asOf, isoMinus(asOfDate, 10),
  );

  const latestBySource: Record<string, Snap> = {};
  for (const sn of snaps) if (!latestBySource[sn.source] && hoursSince(sn.ts, asOfDate) <= 24) latestBySource[sn.source] = sn;
  const fresh = Object.values(latestBySource).sort((a, b) => b.ts.localeCompare(a.ts));
  const cg = latestBySource.coingecko;
  const dex = latestBySource.dexscreener ?? latestBySource.geckoterminal;
  const latest = cg ?? dex ?? snaps[0] ?? null;

  const pick = <K extends keyof Snap>(k: K): Snap[K] | null => {
    for (const sn of [cg, dex, ...fresh]) if (sn && sn[k] != null) return sn[k];
    return null;
  };

  // Volume moyen des 7 jours précédents (un point par jour : la dernière observation du jour), même source que le volume actuel.
  const volSource = cg?.volume_24h != null ? 'coingecko' : dex?.source;
  const byDay = new Map<string, number>();
  for (const sn of snaps) {
    if (sn.source !== volSource || sn.volume_24h == null) continue;
    const age = daysBetween(sn.ts, asOf);
    if (age < 0.9 || age > 8) continue;
    const day = sn.ts.slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, sn.volume_24h);
  }
  const prevVols = [...byDay.values()];
  const avgPrevVolume7d = prevVols.length >= 2 ? prevVols.reduce((a, b) => a + b, 0) / prevVols.length : null;

  const liqSnaps = snaps.filter((sn) => sn.liquidity_usd != null);
  const liq3 = liqSnaps.find((sn) => { const a = daysBetween(sn.ts, asOf); return a >= 2 && a <= 4.5; });

  const txPrev = snaps.find((sn) => sn.source === dex?.source && sn.buys_24h != null && (() => { const a = daysBetween(sn.ts, asOf); return a >= 0.9 && a <= 2; })());

  const security = db.all<any>(
    `SELECT provider, flags, is_honeypot, sell_tax, top10_holders_pct, holder_count, source_url, ts FROM security_checks
     WHERE token_id = ? AND ts <= ? ORDER BY ts DESC LIMIT 4`, tokenId, asOf,
  ).map((r) => ({ ...r, flags: pj<string[]>(r.flags, []) }));
  const holdersNow = security.find((x) => x.holder_count != null)?.holder_count ?? null;
  const holdersPrevRow = db.get<{ holder_count: number }>(
    `SELECT holder_count FROM security_checks WHERE token_id = ? AND holder_count IS NOT NULL AND ts <= ? ORDER BY ts DESC LIMIT 1`,
    tokenId, isoMinus(asOfDate, 3),
  );

  const catalysts = db.all<any>(
    `SELECT id,title,kind,event_date,date_precision,status,source_name,source_url,fetched_at FROM catalysts
     WHERE token_id = ? AND fetched_at <= ? ORDER BY event_date`, tokenId, asOf,
  );

  const prices = fresh.map((x) => x.price_usd).filter((p): p is number => p != null && p > 0);
  const priceDivergencePct = prices.length >= 2 ? ((Math.max(...prices) - Math.min(...prices)) / Math.min(...prices)) * 100 : null;

  const firstSnap = db.get<{ ts: string }>('SELECT MIN(ts) AS ts FROM market_snapshots WHERE token_id = ? AND ts <= ?', tokenId, asOf);
  const historyDays = firstSnap?.ts ? Math.max(0, daysBetween(firstSnap.ts, asOf)) : 0;
  const created = token?.pair_created_at ?? null;

  const vol24 = pick('volume_24h');
  const vol1 = dex?.volume_1h ?? null;
  const dexVol24 = dex?.volume_24h ?? null;

  return {
    tokenId, asOf, token, latest, latestBySource,
    dataAgeHours: latest ? hoursSince(latest.ts, asOfDate) : null,
    price: pick('price_usd'),
    marketCap: pick('market_cap'),
    fdv: pick('fdv'),
    volume24h: vol24,
    liquidity: dex?.liquidity_usd ?? pick('liquidity_usd'),
    change24h: pick('change_24h'),
    change7d: pick('change_7d'),
    circulating: pick('circulating_supply'),
    total: pick('total_supply'),
    max: pick('max_supply'),
    avgPrevVolume7d,
    intradayVolumeRatio: vol1 != null && dexVol24 ? (vol1 * 24) / dexVol24 : null,
    liquidity3dAgo: liq3?.liquidity_usd ?? null,
    buys24h: dex?.buys_24h ?? null,
    sells24h: dex?.sells_24h ?? null,
    txns24hPrev: txPrev ? (txPrev.buys_24h ?? 0) + (txPrev.sells_24h ?? 0) : null,
    holdersNow,
    holdersPrev: holdersPrevRow?.holder_count ?? null,
    historyDays,
    ageDays: created ? daysBetween(created, asOf) : null,
    security,
    catalysts,
    priceDivergencePct,
    sourcesCount: Object.keys(latestBySource).length,
  };
}
