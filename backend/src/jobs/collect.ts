import { loadConfig } from '../config.ts';
import { type Db, j, nowIso, pj } from '../db/db.ts';
import { isoMinus } from '../engine/time.ts';
import { log } from '../log.ts';
import * as cg from '../providers/coingecko.ts';
import { coinmarketcalEvents } from '../providers/catalysts.ts';
import * as dex from '../providers/dexscreener.ts';
import * as gt from '../providers/geckoterminal.ts';
import { goplus, rugcheck } from '../providers/security.ts';
import { CHAINS, type MarketObs } from '../providers/types.ts';
import { ingest, insertSecurity, upsertCatalyst } from '../store.ts';

/** Catégories trop génériques pour servir de narrative (écosystèmes, portefeuilles de fonds, etc.). */
export function isGenericCategory(id: string) {
  return /-ecosystem$|portfolio|alleged|made-in|binance-|coinbase-|-launchpad|exchange-based|^layer-0|^smart-contract-platform$|^proof-of-|^pow$|^pos$|world-liberty|holdings|^fan-token$|-alpha-spotlight|^tokenized-|^ftx-|^gmci|index$/.test(id);
}

export const CORE_NARRATIVES = [
  'meme-token', 'solana-meme-coins', 'base-meme-coins', 'ai-agents', 'artificial-intelligence', 'depin',
  'real-world-assets-rwa', 'gaming', 'decentralized-finance-defi', 'layer-1', 'layer-2', 'decentralized-science-desci',
];

export async function collectCoinGeckoMarkets(db: Db, pages: number) {
  let count = 0;
  const errors: string[] = [];
  for (let p = 1; p <= pages; p++) {
    try {
      const obs = await cg.markets(p);
      count += ingest(db, obs, 'coingecko:markets').count;
      if (obs.length < 250) break;
    } catch (e) {
      errors.push(`page ${p}: ${(e as Error).message}`);
      if (p === 1) throw e;
    }
  }
  return { count, errors };
}

export async function collectCategories(db: Db, runId: number) {
  const cats = await cg.categories();
  const ts = nowIso();
  const ranked = cats
    .filter((c) => c.change24h != null && (c.marketCap ?? 0) > 5e6)
    .sort((a, b) => (b.change24h as number) - (a.change24h as number));
  db.tx(() => {
    ranked.forEach((c, i) => {
      db.run(
        'INSERT INTO category_snapshots(ts,run_id,category_id,name,market_cap,change_24h,volume_24h,momentum_rank) VALUES(?,?,?,?,?,?,?,?)',
        ts, runId, c.id, c.name, c.marketCap, c.change24h, c.volume24h, i + 1,
      );
    });
  });
  return { count: ranked.length, ranked };
}

/** Récupère les comparables (capitalisations) de chaque narrative suivie et rattache les tokens à leurs catégories. */
export async function collectPeers(db: Db, categoryIds: string[]) {
  const ts = nowIso();
  const memberships = new Map<string, Set<string>>();
  const catCaps = new Map<string, number>();
  const errors: string[] = [];
  let done = 0;
  for (const id of categoryIds) {
    try {
      const obs = await cg.markets(1, id);
      const peers = obs.filter((o) => o.marketCap && o.marketCap > 0).map((o) => ({ id: o.key.coingeckoId as string, name: o.key.name, cap: o.marketCap as number }));
      if (!peers.length) continue;
      peers.sort((a, b) => a.cap - b.cap);
      db.run('INSERT OR REPLACE INTO category_peers(category_id,ts,peer_caps,peer_names) VALUES(?,?,?,?)', id, ts, j(peers.map((p) => p.cap)), j(peers));
      catCaps.set(id, peers.reduce((a, p) => a + p.cap, 0));
      ingest(db, obs, `coingecko:category:${id}`, ts);
      for (const p of peers) {
        if (!memberships.has(p.id)) memberships.set(p.id, new Set());
        memberships.get(p.id)!.add(id);
      }
      done++;
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  db.tx(() => {
    for (const [cgId, cats] of memberships) {
      const row = db.get<{ categories: string }>('SELECT categories FROM tokens WHERE id = ?', `cg:${cgId}`);
      if (!row) continue;
      const all = new Set([...pj<string[]>(row.categories, []), ...cats]);
      // Narrative principale = la catégorie suivie la plus spécifique (plus petite capitalisation totale).
      const narrative = [...all].filter((c) => catCaps.has(c) && !isGenericCategory(c)).sort((a, b) => (catCaps.get(a) as number) - (catCaps.get(b) as number))[0];
      db.run(`UPDATE tokens SET categories = ?, narrative = COALESCE(?, narrative), narrative_source = CASE WHEN ? IS NOT NULL THEN 'coingecko' ELSE narrative_source END WHERE id = ?`,
        j([...all]), narrative ?? null, narrative ?? null, `cg:${cgId}`);
    }
  });
  return { done, errors };
}

/** Découverte : nouveaux pools / pools tendance (GeckoTerminal) + derniers profils DexScreener. */
export async function collectDexDiscovery(db: Db, networks: string[]) {
  const found: MarketObs[] = [];
  const errors: string[] = [];
  for (const net of networks) {
    const gtNet = CHAINS[net]?.geckoterminal ?? net;
    for (const fn of [gt.newPools, gt.trendingPools]) {
      try { found.push(...(await fn(gtNet))); } catch (e) { errors.push(`geckoterminal ${gtNet}: ${(e as Error).message}`); }
    }
  }
  const profiles: dex.DexProfile[] = [];
  for (const fn of [dex.latestProfiles, dex.latestBoosts]) {
    try { profiles.push(...(await fn())); } catch (e) { errors.push(`dexscreener: ${(e as Error).message}`); }
  }
  // Rassemble les adresses à rafraîchir via DexScreener (agrège toutes les paires d'un token).
  const byChain = new Map<string, Set<string>>();
  const addAddr = (chain: string | null | undefined, addr: string | null | undefined) => {
    if (!chain || !addr || !CHAINS[chain]) return;
    if (!byChain.has(chain)) byChain.set(chain, new Set());
    byChain.get(chain)!.add(addr);
  };
  for (const o of found) addAddr(o.key.chain, o.key.contractAddress);
  for (const p of profiles) addAddr(p.chain, p.address);

  const ts = nowIso();
  // Les observations GeckoTerminal sont enregistrées (2e source indépendante).
  const gtRes = ingest(db, found, 'geckoterminal:discovery', ts);
  const newIds = new Set(gtRes.newIds);
  let dexCount = 0;
  for (const [chain, set] of byChain) {
    try {
      const obs = await dex.tokensOnChain(chain, [...set].slice(0, 120));
      const prof = new Map(profiles.map((p) => [`${p.chain}:${p.address.toLowerCase()}`, p]));
      for (const o of obs) {
        const p = prof.get(`${chain}:${String(o.key.contractAddress).toLowerCase()}`);
        if (p) { o.key.description = p.description; o.key.logoUrl ??= p.icon; }
      }
      const r = ingest(db, obs, 'dexscreener:discovery', ts);
      r.newIds.forEach((id) => newIds.add(id));
      dexCount += r.count;
      for (const p of profiles.filter((x) => x.boosted && x.chain === chain)) {
        db.run(`UPDATE tokens SET discovered_via = 'dexscreener:boost (promotion payante)' WHERE chain = ? AND lower(contract_address) = lower(?) AND discovered_via LIKE 'dexscreener%'`, chain, p.address);
      }
    } catch (e) {
      errors.push(`dexscreener ${chain}: ${(e as Error).message}`);
    }
  }
  return { gtPools: found.length, profiles: profiles.length, dexCount, newIds: [...newIds], errors };
}

/** Rafraîchit via DexScreener les tokens DEX (et CoinGecko avec contrat) vus ces 7 derniers jours. */
export async function refreshDexTracked(db: Db, limit = 600) {
  const rows = db.all<{ chain: string; contract_address: string }>(
    `SELECT chain, contract_address FROM tokens WHERE contract_address IS NOT NULL AND chain IN (${Object.keys(CHAINS).map(() => '?').join(',')})
       AND status != 'delisted' AND last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT ?`,
    ...Object.keys(CHAINS), isoMinus(new Date(), 7), limit,
  );
  const byChain = new Map<string, string[]>();
  for (const r of rows) {
    if (!byChain.has(r.chain)) byChain.set(r.chain, []);
    byChain.get(r.chain)!.push(r.contract_address);
  }
  let count = 0;
  const errors: string[] = [];
  for (const [chain, addrs] of byChain) {
    try {
      count += ingest(db, await dex.tokensOnChain(chain, addrs), 'dexscreener:refresh').count;
    } catch (e) {
      errors.push(`${chain}: ${(e as Error).message}`);
    }
  }
  return { requested: rows.length, count, errors };
}

/** Détails CoinGecko (catégories, contrats, activité dev) pour les candidats les plus prometteurs. */
export async function enrichCoinDetails(db: Db, ids: string[]) {
  let list: { category_id: string; name: string }[] = [];
  try { list = await cg.categoryList(); } catch { /* pas bloquant */ }
  const nameToId = new Map(list.map((c) => [c.name.toLowerCase(), c.category_id]));
  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const cgId = id.replace(/^cg:/, '');
    try {
      const d = await cg.coinDetail(cgId);
      const cats = d.categories.map((n) => nameToId.get(n.toLowerCase())).filter(Boolean) as string[];
      const row = db.get<{ categories: string; chain: string | null }>('SELECT categories, chain FROM tokens WHERE id = ?', id);
      const merged = [...new Set([...pj<string[]>(row?.categories, []), ...cats])];
      const plat = d.platforms.find((p) => CHAINS[p.chain]) ?? d.platforms[0];
      db.run(
        `UPDATE tokens SET categories = ?, description = COALESCE(?, description), website = COALESCE(?, website), twitter = COALESCE(?, twitter),
           chain = COALESCE(chain, ?), contract_address = COALESCE(contract_address, ?), dev_commits_4w = ?, detail_updated_at = ? WHERE id = ?`,
        j(merged), d.description, d.website, d.twitter, plat?.chain ?? null, plat?.address ?? null, d.devCommits4w, nowIso(), id,
      );
      done++;
    } catch (e) {
      errors.push(`${cgId}: ${(e as Error).message}`);
    }
  }
  return { done, errors };
}

export async function securityChecks(db: Db, ids: string[]) {
  let done = 0;
  const errors: string[] = [];
  for (const id of ids) {
    const t = db.get<{ chain: string; contract_address: string }>('SELECT chain, contract_address FROM tokens WHERE id = ?', id);
    if (!t?.contract_address || !t.chain) continue;
    try {
      const res = t.chain === 'solana' ? await rugcheck(t.contract_address) : await goplus(t.chain, t.contract_address);
      if (res) { insertSecurity(db, id, res); done++; }
    } catch (e) {
      errors.push(`${id}: ${(e as Error).message}`);
    }
  }
  return { done, errors };
}

export async function collectCatalysts(db: Db) {
  const events = await coinmarketcalEvents();
  if (events === null) return { active: false, count: 0, newlyConfirmed: [] as string[] };
  const newlyConfirmed: string[] = [];
  let count = 0;
  db.tx(() => {
    for (const e of events) {
      if (!e.coingeckoId) continue;
      const tokenId = `cg:${e.coingeckoId}`;
      if (!db.get('SELECT 1 FROM tokens WHERE id = ?', tokenId)) continue;
      const r = upsertCatalyst(db, tokenId, e);
      if (r.newlyConfirmed) newlyConfirmed.push(e.id);
      count++;
    }
  });
  return { active: true, count, newlyConfirmed };
}

/** Un token non revu depuis 14 jours passe en "delisted" (conservé dans l'historique). */
export function markDelisted(db: Db) {
  const r = db.run(`UPDATE tokens SET status = 'delisted', status_reason = 'Aucune donnée de marché depuis 14 jours' WHERE status != 'delisted' AND last_seen_at < ?`, isoMinus(new Date(), 14));
  return Number(r.changes);
}

export function catalystSourceActive() {
  return Boolean(loadConfig().COINMARKETCAL_API_KEY);
}

export const _log = log;
