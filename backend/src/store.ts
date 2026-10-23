import { type Db, j, n, nowIso, pj, s } from './db/db.ts';
import type { CatalystObs, MarketObs, SecurityObs, TokenKey } from './providers/types.ts';

export const STABLE_SYMBOLS = new Set(['USDT', 'USDC', 'DAI', 'FDUSD', 'TUSD', 'USDE', 'USDD', 'PYUSD', 'USDS', 'FRAX', 'BUSD', 'USD1', 'EURC', 'USDP', 'GUSD', 'RLUSD', 'USDX', 'SUSDE']);
export const EXCLUDED_CATEGORIES = new Set(['stablecoins', 'wrapped-tokens', 'bridged-tokens', 'liquid-staking-tokens', 'tokenized-gold', 'usd-stablecoin', 'eur-stablecoin', 'liquid-restaking-tokens', 'tokenized-btc']);

export function isExcludedAsset(t: { symbol: string; name: string; categories?: string[] | string }) {
  const cats = Array.isArray(t.categories) ? t.categories : pj<string[]>(t.categories as string, []);
  if (STABLE_SYMBOLS.has(t.symbol.toUpperCase())) return 'stablecoin';
  if (cats.some((c) => EXCLUDED_CATEGORIES.has(c))) return 'actif adossé / stablecoin / wrapped';
  if (/\b(wrapped|bridged|staked|liquid staking)\b/i.test(t.name)) return 'actif adossé (wrapped/staked)';
  return null;
}

/** Résout l'identifiant canonique d'un token, en recoupant CoinGecko et les DEX par adresse de contrat. */
export function resolveTokenId(db: Db, key: TokenKey): string {
  if (key.coingeckoId) return `cg:${key.coingeckoId}`;
  if (key.chain && key.contractAddress) {
    const hit = db.get<{ id: string }>(
      `SELECT id FROM tokens WHERE chain = ? AND lower(contract_address) = lower(?) ORDER BY id LIKE 'cg:%' DESC LIMIT 1`,
      key.chain, key.contractAddress,
    );
    if (hit) return hit.id;
    const addr = key.chain === 'solana' ? key.contractAddress : key.contractAddress.toLowerCase();
    return `dex:${key.chain}:${addr}`;
  }
  throw new Error(`Token sans identifiant exploitable : ${key.symbol}`);
}

export function upsertToken(db: Db, key: TokenKey, via: string, ts = nowIso()): { id: string; isNew: boolean } {
  const id = resolveTokenId(db, key);
  const existing = db.get<{ id: string }>('SELECT id FROM tokens WHERE id = ?', id);
  if (!existing) {
    db.run(
      `INSERT INTO tokens(id,symbol,name,chain,contract_address,coingecko_id,logo_url,categories,description,website,twitter,dex_url,pair_created_at,first_seen_at,last_seen_at,discovered_via)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      id, key.symbol || '?', key.name || key.symbol || '?', s(key.chain), s(key.contractAddress), s(key.coingeckoId), s(key.logoUrl),
      j(key.categories ?? []), s(key.description), s(key.website), s(key.twitter), s(key.dexUrl), s(key.pairCreatedAt), ts, ts, via,
    );
    return { id, isNew: true };
  }
  // Le nom/symbole DexScreener (champ baseToken) est plus fiable que celui déduit du nom de pool GeckoTerminal.
  if (via.startsWith('dexscreener') && id.startsWith('dex:') && key.symbol) {
    db.run(`UPDATE tokens SET symbol = ?, name = ? WHERE id = ? AND discovered_via LIKE 'geckoterminal%'`, key.symbol, key.name || key.symbol, id);
  }
  // On complète sans écraser une donnée existante par une valeur vide.
  db.run(
    `UPDATE tokens SET last_seen_at = ?,
       logo_url = COALESCE(logo_url, ?), website = COALESCE(website, ?), twitter = COALESCE(twitter, ?),
       dex_url = COALESCE(dex_url, ?), pair_created_at = COALESCE(pair_created_at, ?),
       chain = COALESCE(chain, ?), contract_address = COALESCE(contract_address, ?),
       description = COALESCE(description, ?)
     WHERE id = ?`,
    ts, s(key.logoUrl), s(key.website), s(key.twitter), s(key.dexUrl), s(key.pairCreatedAt), s(key.chain), s(key.contractAddress), s(key.description), id,
  );
  return { id, isNew: false };
}

export function insertSnapshot(db: Db, tokenId: string, o: MarketObs, ts = nowIso()) {
  db.run(
    `INSERT INTO market_snapshots(token_id,ts,source,source_url,price_usd,market_cap,fdv,volume_24h,volume_1h,volume_6h,liquidity_usd,change_1h,change_24h,change_7d,circulating_supply,total_supply,max_supply,buys_24h,sells_24h,source_updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    tokenId, ts, o.source, o.sourceUrl, n(o.priceUsd), n(o.marketCap), n(o.fdv), n(o.volume24h), n(o.volume1h), n(o.volume6h), n(o.liquidityUsd),
    n(o.change1h), n(o.change24h), n(o.change7d), n(o.circulatingSupply), n(o.totalSupply), n(o.maxSupply), n(o.buys24h), n(o.sells24h), s(o.sourceUpdatedAt),
  );
}

/** Enregistre une liste d'observations ; renvoie les ids nouveaux. */
export function ingest(db: Db, obs: MarketObs[], via: string, ts = nowIso()) {
  const newIds: string[] = [];
  let count = 0;
  db.tx(() => {
    for (const o of obs) {
      if (!o.key.coingeckoId && !(o.key.chain && o.key.contractAddress)) continue;
      if (o.priceUsd == null) continue;
      const { id, isNew } = upsertToken(db, o.key, via, ts);
      insertSnapshot(db, id, o, ts);
      if (isNew) newIds.push(id);
      count++;
    }
  });
  return { count, newIds };
}

export function insertSecurity(db: Db, tokenId: string, sec: SecurityObs, ts = nowIso()) {
  db.run(
    `INSERT INTO security_checks(token_id,ts,provider,source_url,is_honeypot,buy_tax,sell_tax,top10_holders_pct,holder_count,flags) VALUES(?,?,?,?,?,?,?,?,?,?)`,
    tokenId, ts, sec.provider, sec.sourceUrl, sec.isHoneypot == null ? null : sec.isHoneypot ? 1 : 0, n(sec.buyTax), n(sec.sellTax), n(sec.top10HoldersPct), n(sec.holderCount), j(sec.flags),
  );
}

export function upsertCatalyst(db: Db, tokenId: string, c: CatalystObs, ts = nowIso()): { newlyConfirmed: boolean } {
  const prev = db.get<{ status: string }>('SELECT status FROM catalysts WHERE id = ?', c.id);
  db.run(
    `INSERT INTO catalysts(id,token_id,title,kind,event_date,date_precision,status,source_name,source_url,fetched_at,first_confirmed_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET title=excluded.title, kind=excluded.kind, event_date=excluded.event_date, date_precision=excluded.date_precision,
       status=excluded.status, source_name=excluded.source_name, source_url=excluded.source_url, fetched_at=excluded.fetched_at,
       first_confirmed_at=COALESCE(catalysts.first_confirmed_at, excluded.first_confirmed_at)`,
    c.id, tokenId, c.title, s(c.kind), s(c.eventDate), c.datePrecision, c.status, c.sourceName, c.sourceUrl, ts, c.status === 'confirmed' ? ts : null,
  );
  return { newlyConfirmed: c.status === 'confirmed' && prev?.status !== 'confirmed' };
}

export function getSetting<T>(db: Db, key: string, fallback: T): T {
  const r = db.get<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
  return r ? pj<T>(r.value, fallback) : fallback;
}
export function setSetting(db: Db, key: string, value: unknown) {
  db.run('INSERT INTO settings(key,value,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at', key, j(value), nowIso());
}
