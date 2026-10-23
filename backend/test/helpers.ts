/**
 * Faux fournisseurs pour les tests (aucun réseau). Les formats reproduisent les réponses réelles
 * des API (DexScreener vérifié sur une réponse réelle du 22/10/2026). Ces données ne sont jamais servies à l'app.
 */
import { loadConfig, resetConfigCache } from '../src/config.ts';
import { Db, setDb } from '../src/db/db.ts';
import { clearHttpCache, timing } from '../src/providers/http.ts';

export function setupEnv(extra: Record<string, string> = {}) {
  Object.assign(process.env, {
    APP_API_KEY: 'test-app-key-123', INTERNAL_JOB_SECRET: 'test-internal-secret-123', DATABASE_PATH: ':memory:',
    SCHEDULER_ENABLED: 'false', COINGECKO_MARKET_PAGES: '1', DEX_NETWORKS: 'solana,base', LOG_LEVEL: 'error', COINMARKETCAL_API_KEY: '',
    ...extra,
  });
  resetConfigCache();
  timing.scale = 0;
  clearHttpCache();
  const db = new Db(':memory:');
  setDb(db);
  return { db, cfg: loadConfig() };
}

const CATS = [
  { id: 'ai-agents', name: 'AI Agents', ch: 9.5, mc: 6e9 },
  { id: 'meme-token', name: 'Meme', ch: 4.1, mc: 6e10 },
  { id: 'solana-meme-coins', name: 'Solana Meme', ch: 6.2, mc: 1.2e10 },
  { id: 'depin', name: 'DePIN', ch: 2.3, mc: 2e10 },
  { id: 'real-world-assets-rwa', name: 'Real World Assets (RWA)', ch: 1.1, mc: 2.5e10 },
  { id: 'gaming', name: 'Gaming (GameFi)', ch: -1.5, mc: 1e10 },
  { id: 'decentralized-finance-defi', name: 'Decentralized Finance (DeFi)', ch: -0.4, mc: 9e10 },
  { id: 'layer-1', name: 'Layer 1 (L1)', ch: 0.2, mc: 2e12 },
  { id: 'stablecoins', name: 'Stablecoins', ch: 0, mc: 3e11 },
  { id: 'solana-ecosystem', name: 'Solana Ecosystem', ch: 3, mc: 1.5e11 },
];

const coin = (id: string, sym: string, cap: number, price: number, extra: any = {}) => ({
  id, symbol: sym.toLowerCase(), name: id.replace(/-/g, ' '), image: `https://coin-images.coingecko.com/coins/images/1/large/${id}.png`,
  current_price: price, market_cap: cap, market_cap_rank: 100, fully_diluted_valuation: cap * (extra.fdvMult ?? 1.4), total_volume: cap * (extra.volRatio ?? 0.12),
  circulating_supply: cap / price, total_supply: (cap / price) * (extra.fdvMult ?? 1.4), max_supply: null,
  price_change_percentage_1h_in_currency: 0.5, price_change_percentage_24h_in_currency: extra.ch24 ?? 3, price_change_percentage_7d_in_currency: extra.ch7 ?? 8,
  last_updated: new Date().toISOString(),
});

export const MAIN_COINS = [
  coin('bitcoin', 'BTC', 1.9e12, 96000, { ch7: 2 }),
  coin('tether', 'USDT', 1.6e11, 1, { ch24: 0, ch7: 0 }),
  coin('alpha-agent', 'ALPHA', 12e6, 0.012, { volRatio: 0.6 }),
  coin('beta-pin', 'BETA', 45e6, 0.45, { volRatio: 0.2 }),
  coin('gamma-rwa', 'GAMMA', 80e6, 0.8),
  coin('delta-game', 'DELTA', 22e6, 0.022, { ch7: 350, ch24: 120 }), // a déjà explosé
  coin('epsilon-meme', 'EPS', 9e6, 0.0009, { volRatio: 1.1 }),
];

/** Comparables générés pour chaque catégorie : capitalisations log-réparties de 3 M$ à 3 Md$. */
function peersFor(cat: string) {
  const list = [] as any[];
  for (let i = 0; i < 24; i++) {
    const cap = 3e6 * Math.pow(10, (i / 23) * 3);
    list.push(coin(`${cat}-peer-${i}`, `P${i}`, cap, cap / 1e8));
  }
  const members: Record<string, string[]> = {
    'ai-agents': ['alpha-agent'], depin: ['beta-pin'], 'real-world-assets-rwa': ['gamma-rwa'], gaming: ['delta-game'], 'meme-token': ['epsilon-meme'], 'solana-meme-coins': ['epsilon-meme'],
  };
  for (const id of members[cat] ?? []) list.push(MAIN_COINS.find((c) => c.id === id));
  return list.sort((a, b) => b.market_cap - a.market_cap);
}

const SOL_NEW = ['NewSoLMint1111111111111111111111111111pump', 'HoneyPotMint222222222222222222222222222pump', 'FakeAlphaMint3333333333333333333333333pump'];
const BASE_NEW = ['0x1111111111111111111111111111111111111111'];

function dexPair(chainId: string, address: string, idx = 0) {
  const isHoney = address.startsWith('HoneyPot');
  const isFake = address.startsWith('FakeAlpha');
  const sym = isFake ? 'BTC' : isHoney ? 'HONEY' : chainId === 'base' ? 'BASED' : 'NEWSOL';
  return {
    chainId, dexId: 'raydium', url: `https://dexscreener.com/${chainId}/pair${address.slice(0, 6)}${idx}`, pairAddress: `pair${address.slice(0, 6)}${idx}`,
    baseToken: { address, name: `${sym} token`, symbol: sym }, quoteToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
    priceNative: '0.0000033', priceUsd: '0.00042',
    txns: { m5: { buys: 3, sells: 1 }, h1: { buys: 120, sells: 60 }, h6: { buys: 600, sells: 400 }, h24: { buys: 1800, sells: 1200 } },
    volume: { h24: 420000, h6: 160000, h1: 52000, m5: 3000 }, priceChange: { m5: 1, h1: 4, h6: 12, h24: 35 },
    liquidity: { usd: isHoney ? 4000 : 95000, base: 1, quote: 1 }, fdv: 4.2e6, marketCap: 4.2e6, pairCreatedAt: Date.now() - 2 * 86400_000,
    info: { imageUrl: 'https://cdn.dexscreener.com/cms/images/x.png', websites: [{ url: 'https://example.org', label: 'Website' }], socials: [{ type: 'twitter', url: 'https://x.com/example' }] },
  };
}

function gtPool(net: string, address: string, name: string) {
  return {
    id: `${net}_pool${address.slice(0, 6)}`, type: 'pool',
    attributes: {
      name: `${name} / SOL`, address: `pool${address.slice(0, 6)}`, base_token_price_usd: '0.000421', fdv_usd: '4210000', market_cap_usd: null,
      reserve_in_usd: '94000', pool_created_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
      price_change_percentage: { m5: '1', h1: '4', h6: '12', h24: '34' },
      transactions: { h24: { buys: 1790, sells: 1210, buyers: 900, sellers: 700 } }, volume_usd: { h1: '51000', h6: '159000', h24: '418000' },
    },
    relationships: { base_token: { data: { id: `${net}_${address}`, type: 'token' } }, quote_token: { data: { id: `${net}_So111`, type: 'token' } } },
  };
}

export type MockOpts = { failAll?: boolean; failCoingecko?: boolean; failDex?: boolean; pushLog?: any[] };

export function installMockFetch(opts: MockOpts = {}) {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    calls.push(url);
    if (url.includes('exp.host')) {
      const body = JSON.parse(init.body);
      opts.pushLog?.push(...body);
      return json({ data: body.map(() => ({ status: 'ok', id: 'x' })) });
    }
    if (opts.failAll) return json({ error: 'down' }, 503);
    const u = new URL(url);
    if (u.hostname.includes('coingecko.com')) {
      if (opts.failCoingecko) return json({ error: 'down' }, 503);
      if (u.pathname.endsWith('/coins/markets')) {
        const cat = u.searchParams.get('category');
        return json(cat ? peersFor(cat) : MAIN_COINS);
      }
      if (u.pathname.endsWith('/coins/categories')) return json(CATS.map((c) => ({ id: c.id, name: c.name, market_cap: c.mc, market_cap_change_24h: c.ch, volume_24h: c.mc / 20, updated_at: new Date().toISOString() })));
      if (u.pathname.endsWith('/coins/categories/list')) return json(CATS.map((c) => ({ category_id: c.id, name: c.name })));
      const m = u.pathname.match(/\/coins\/([^/]+)$/);
      if (m) {
        const cats: Record<string, string[]> = { 'alpha-agent': ['AI Agents'], 'beta-pin': ['DePIN'], 'gamma-rwa': ['Real World Assets (RWA)'], 'delta-game': ['Gaming (GameFi)'], 'epsilon-meme': ['Meme', 'Solana Meme'] };
        return json({
          id: m[1], categories: cats[m[1]] ?? [], description: { en: `<p>${m[1]} description officielle</p>` },
          platforms: m[1] === 'alpha-agent' ? { base: '0xa1fa000000000000000000000000000000000001' } : {},
          links: { homepage: [`https://${m[1]}.example`], twitter_screen_name: m[1], repos_url: { github: [] } },
          developer_data: { commit_count_4_weeks: m[1] === 'alpha-agent' ? 85 : 4 },
        });
      }
      return json({}, 404);
    }
    if (u.hostname.includes('geckoterminal.com')) {
      if (opts.failDex) return json({}, 503);
      const net = u.pathname.split('/')[4];
      const addrs = net === 'solana' ? SOL_NEW : BASE_NEW;
      return json({ data: addrs.map((a, i) => gtPool(net, a, i === 2 ? 'ALPHA' : 'NEWSOL')) });
    }
    if (u.hostname.includes('dexscreener.com')) {
      if (opts.failDex) return json({}, 503);
      if (u.pathname.startsWith('/token-profiles') || u.pathname.startsWith('/token-boosts')) {
        return json([{ url: 'https://dexscreener.com/solana/x', chainId: 'solana', tokenAddress: SOL_NEW[0], icon: 'https://cdn.dexscreener.com/i.png', description: 'Nouveau token', links: [] }]);
      }
      const m = u.pathname.match(/^\/tokens\/v1\/([^/]+)\/(.+)$/);
      if (m) return json(m[2].split(',').flatMap((a) => [dexPair(m[1], a, 0), dexPair(m[1], a, 1)]));
      return json({ pairs: [] });
    }
    if (u.hostname.includes('rugcheck.xyz')) {
      if (url.includes('HoneyPot')) return json({ score: 9000, risks: [{ name: 'Freeze Authority still enabled', level: 'danger', value: '' }, { name: 'Top 10 holders high ownership', level: 'danger', value: '82%' }] });
      return json({ score: 300, risks: [{ name: 'Low Liquidity', level: 'warn', value: '' }] });
    }
    if (u.hostname.includes('gopluslabs.io')) {
      const addr = url.split('contract_addresses=')[1];
      return json({ code: 1, result: { [addr.toLowerCase()]: { is_honeypot: '0', buy_tax: '0', sell_tax: '0', is_open_source: '1', holder_count: '5300', holders: [{ percent: '0.05' }, { percent: '0.03' }] } } });
    }
    return json({}, 404);
  }) as typeof fetch;
  return calls;
}

/** Ajoute un historique de 7 jours (snapshots passés) pour tester les comparaisons à l'historique. */
export function seedHistory(db: Db, tokenId: string, baseVolume: number, liq: number | null, days = 7) {
  for (let d = days; d >= 1; d--) {
    const ts = new Date(Date.now() - d * 86400_000).toISOString();
    db.run(
      `INSERT INTO market_snapshots(token_id, ts, source, price_usd, market_cap, volume_24h, liquidity_usd) VALUES(?,?,?,?,?,?,?)`,
      tokenId, ts, tokenId.startsWith('cg:') ? 'coingecko' : 'dexscreener', 1, 1e7, baseVolume, liq,
    );
  }
}
