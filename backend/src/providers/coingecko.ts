import { loadConfig } from '../config.ts';
import { fetchJson } from './http.ts';
import { CG_PLATFORM_TO_CHAIN, type CategoryObs, type MarketObs } from './types.ts';

const num = (v: any): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

function base(): { url: string; headers: Record<string, string> } {
  const c = loadConfig();
  if (c.COINGECKO_PLAN === 'pro') return { url: 'https://pro-api.coingecko.com/api/v3', headers: c.COINGECKO_API_KEY ? { 'x-cg-pro-api-key': c.COINGECKO_API_KEY } : {} };
  return { url: 'https://api.coingecko.com/api/v3', headers: c.COINGECKO_API_KEY ? { 'x-cg-demo-api-key': c.COINGECKO_API_KEY } : {} };
}

async function cg<T = any>(path: string, cacheTtlMs?: number): Promise<T> {
  const b = base();
  return fetchJson<T>('coingecko', `${b.url}${path}`, { headers: b.headers, cacheTtlMs });
}

export function mapMarket(m: any): MarketObs {
  return {
    key: {
      symbol: String(m.symbol ?? '').toUpperCase(),
      name: String(m.name ?? m.id),
      coingeckoId: m.id,
      logoUrl: m.image ?? null,
    },
    source: 'coingecko',
    sourceUrl: `https://www.coingecko.com/en/coins/${m.id}`,
    sourceUpdatedAt: m.last_updated ?? null,
    priceUsd: num(m.current_price),
    marketCap: num(m.market_cap) || null,
    fdv: num(m.fully_diluted_valuation),
    volume24h: num(m.total_volume),
    change1h: num(m.price_change_percentage_1h_in_currency),
    change24h: num(m.price_change_percentage_24h_in_currency ?? m.price_change_percentage_24h),
    change7d: num(m.price_change_percentage_7d_in_currency),
    circulatingSupply: num(m.circulating_supply),
    totalSupply: num(m.total_supply),
    maxSupply: num(m.max_supply),
  };
}

/** Marchés triés par capitalisation (250 par page). */
export async function markets(page: number, category?: string): Promise<MarketObs[]> {
  const q = new URLSearchParams({
    vs_currency: 'usd', order: 'market_cap_desc', per_page: '250', page: String(page),
    price_change_percentage: '1h,24h,7d', sparkline: 'false',
  });
  if (category) q.set('category', category);
  const data = await cg<any[]>(`/coins/markets?${q}`);
  return (Array.isArray(data) ? data : []).map(mapMarket);
}

export async function categories(): Promise<CategoryObs[]> {
  const data = await cg<any[]>('/coins/categories?order=market_cap_change_24h_desc', 30 * 60_000);
  return (Array.isArray(data) ? data : []).map((c) => ({
    id: c.id, name: c.name, marketCap: num(c.market_cap), change24h: num(c.market_cap_change_24h), volume24h: num(c.volume_24h),
  }));
}

export async function trending(): Promise<string[]> {
  const data = await cg<any>('/search/trending', 15 * 60_000);
  return (data?.coins ?? []).map((c: any) => c?.item?.id).filter(Boolean);
}

export type CoinDetail = {
  id: string;
  description: string | null;
  categories: string[];
  platforms: { chain: string; address: string }[];
  website: string | null;
  twitter: string | null;
  github: string[];
  devCommits4w: number | null;
  devStars: number | null;
  watchlistUsers: number | null;
  sentimentUpPct: number | null;
  genesisDate: string | null;
};

export async function coinDetail(id: string): Promise<CoinDetail> {
  const d = await cg<any>(`/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=false&community_data=true&developer_data=true&sparkline=false`, 6 * 3600_000);
  const platforms = Object.entries(d?.platforms ?? {})
    .filter(([k, v]) => k && v)
    .map(([k, v]) => ({ chain: CG_PLATFORM_TO_CHAIN[k] ?? k, address: String(v) }));
  return {
    id,
    description: (d?.description?.en ?? '').replace(/<[^>]+>/g, '').trim().slice(0, 1500) || null,
    categories: (d?.categories ?? []).filter(Boolean),
    platforms,
    website: d?.links?.homepage?.find((x: string) => x) ?? null,
    twitter: d?.links?.twitter_screen_name ? `https://x.com/${d.links.twitter_screen_name}` : null,
    github: d?.links?.repos_url?.github ?? [],
    devCommits4w: num(d?.developer_data?.commit_count_4_weeks),
    devStars: num(d?.developer_data?.stars),
    watchlistUsers: num(d?.watchlist_portfolio_users),
    sentimentUpPct: num(d?.sentiment_votes_up_percentage),
    genesisDate: d?.genesis_date ?? null,
  };
}

/** Historique de prix/capitalisation (affichage de la fiche). */
export async function marketChart(id: string, days: number) {
  const d = await cg<any>(`/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`, 30 * 60_000);
  return {
    prices: (d?.prices ?? []) as [number, number][],
    marketCaps: (d?.market_caps ?? []) as [number, number][],
    volumes: (d?.total_volumes ?? []) as [number, number][],
  };
}

/** Correspondance nom de catégorie CoinGecko → id (l'endpoint /coins/{id} renvoie des noms). */
export async function categoryList(): Promise<{ category_id: string; name: string }[]> {
  return cg('/coins/categories/list', 24 * 3600_000);
}
