import { fetchJson } from './http.ts';
import { chainFromGeckoTerminal, type MarketObs } from './types.ts';

const API = 'https://api.geckoterminal.com/api/v2';
const num = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function mapPool(p: any, network: string): MarketObs | null {
  const a = p?.attributes ?? {};
  const baseId: string | undefined = p?.relationships?.base_token?.data?.id; // "solana_<adresse>"
  if (!baseId) return null;
  const address = baseId.slice(baseId.indexOf('_') + 1);
  const [baseName] = String(a.name ?? '').split(' / ');
  const tx = a.transactions?.h24 ?? {};
  return {
    key: {
      symbol: (baseName || '?').toUpperCase(),
      name: baseName || address.slice(0, 8),
      chain: chainFromGeckoTerminal(network),
      contractAddress: address,
      pairCreatedAt: a.pool_created_at ?? null,
      dexUrl: `https://www.geckoterminal.com/${network}/pools/${a.address}`,
    },
    source: 'geckoterminal',
    sourceUrl: `https://www.geckoterminal.com/${network}/pools/${a.address}`,
    priceUsd: num(a.base_token_price_usd),
    marketCap: num(a.market_cap_usd),
    fdv: num(a.fdv_usd),
    volume24h: num(a.volume_usd?.h24),
    volume1h: num(a.volume_usd?.h1),
    volume6h: num(a.volume_usd?.h6),
    liquidityUsd: num(a.reserve_in_usd),
    change1h: num(a.price_change_percentage?.h1),
    change24h: num(a.price_change_percentage?.h24),
    buys24h: num(tx.buys),
    sells24h: num(tx.sells),
  };
}

export async function newPools(network: string): Promise<MarketObs[]> {
  const d = await fetchJson<any>('geckoterminal', `${API}/networks/${network}/new_pools?page=1`);
  return (d?.data ?? []).map((p: any) => mapPool(p, network)).filter(Boolean) as MarketObs[];
}

export async function trendingPools(network: string): Promise<MarketObs[]> {
  const d = await fetchJson<any>('geckoterminal', `${API}/networks/${network}/trending_pools?page=1`);
  return (d?.data ?? []).map((p: any) => mapPool(p, network)).filter(Boolean) as MarketObs[];
}
