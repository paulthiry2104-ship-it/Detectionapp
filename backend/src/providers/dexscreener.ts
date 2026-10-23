import { fetchJson } from './http.ts';
import { CHAINS, chainFromDexScreener, type MarketObs } from './types.ts';

const API = 'https://api.dexscreener.com';
const num = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export type DexProfile = { chain: string; address: string; url: string; icon: string | null; description: string | null; links: { type?: string; label?: string; url: string }[]; boosted: boolean };

function mapProfile(p: any, boosted: boolean): DexProfile {
  return {
    chain: chainFromDexScreener(p.chainId),
    address: p.tokenAddress,
    url: p.url,
    icon: p.icon ?? null,
    description: p.description ?? null,
    links: Array.isArray(p.links) ? p.links : [],
    boosted,
  };
}

/** Derniers profils de tokens publiés (souvent des lancements récents). */
export async function latestProfiles(): Promise<DexProfile[]> {
  const d = await fetchJson<any[]>('dexscreener', `${API}/token-profiles/latest/v1`);
  return (Array.isArray(d) ? d : []).filter((p) => p?.tokenAddress).map((p) => mapProfile(p, false));
}

/** Tokens "boostés" = promotion PAYANTE sur DexScreener. Utilisé seulement pour la découverte, jamais comme signal positif. */
export async function latestBoosts(): Promise<DexProfile[]> {
  const d = await fetchJson<any[]>('dexscreener', `${API}/token-boosts/latest/v1`);
  return (Array.isArray(d) ? d : []).filter((p) => p?.tokenAddress).map((p) => mapProfile(p, true));
}

/** Choisit la paire la plus liquide (ou au plus gros volume) d'un token. */
export function bestPair(pairs: any[], address: string): any | null {
  const own = pairs.filter((p) => p?.baseToken?.address?.toLowerCase() === address.toLowerCase());
  if (!own.length) return null;
  return own.sort((a, b) => (num(b.liquidity?.usd) ?? 0) - (num(a.liquidity?.usd) ?? 0) || (num(b.volume?.h24) ?? 0) - (num(a.volume?.h24) ?? 0))[0];
}

export function mapPair(p: any, allPairs: any[] = [p]): MarketObs {
  const address = p.baseToken.address;
  const own = allPairs.filter((x) => x?.baseToken?.address?.toLowerCase() === address.toLowerCase());
  // Volumes et liquidités agrégés sur toutes les paires du token.
  const sum = (f: (x: any) => number | null) => {
    const vals = own.map(f).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };
  const socials = p.info?.socials ?? [];
  return {
    key: {
      symbol: String(p.baseToken.symbol ?? '').toUpperCase(),
      name: String(p.baseToken.name ?? p.baseToken.symbol),
      chain: chainFromDexScreener(p.chainId),
      contractAddress: address,
      logoUrl: p.info?.imageUrl ?? null,
      website: p.info?.websites?.[0]?.url ?? null,
      twitter: socials.find((s: any) => s.type === 'twitter')?.url ?? null,
      dexUrl: p.url,
      pairCreatedAt: p.pairCreatedAt ? new Date(p.pairCreatedAt).toISOString() : null,
    },
    source: 'dexscreener',
    sourceUrl: p.url,
    priceUsd: num(p.priceUsd),
    marketCap: num(p.marketCap),
    fdv: num(p.fdv),
    volume24h: sum((x) => num(x.volume?.h24)),
    volume1h: sum((x) => num(x.volume?.h1)),
    volume6h: sum((x) => num(x.volume?.h6)),
    liquidityUsd: sum((x) => num(x.liquidity?.usd)),
    change1h: num(p.priceChange?.h1),
    change24h: num(p.priceChange?.h24),
    buys24h: sum((x) => num(x.txns?.h24?.buys)),
    sells24h: sum((x) => num(x.txns?.h24?.sells)),
  };
}

/** Données de marché pour jusqu'à 30 adresses d'une même chaîne. */
export async function tokensOnChain(chain: string, addresses: string[]): Promise<MarketObs[]> {
  const dsChain = CHAINS[chain]?.dexscreener ?? chain;
  const out: MarketObs[] = [];
  for (let i = 0; i < addresses.length; i += 30) {
    const batch = addresses.slice(i, i + 30);
    const pairs = await fetchJson<any[]>('dexscreener', `${API}/tokens/v1/${dsChain}/${batch.join(',')}`);
    const list = Array.isArray(pairs) ? pairs : [];
    for (const addr of batch) {
      const bp = bestPair(list, addr);
      if (bp) out.push(mapPair(bp, list));
    }
  }
  return out;
}

export async function search(q: string): Promise<MarketObs[]> {
  const d = await fetchJson<any>('dexscreener', `${API}/latest/dex/search?q=${encodeURIComponent(q)}`, { cacheTtlMs: 60_000 });
  const pairs: any[] = d?.pairs ?? [];
  const seen = new Set<string>();
  const out: MarketObs[] = [];
  for (const p of pairs) {
    const k = `${p.chainId}:${p.baseToken?.address}`;
    if (!p.baseToken?.address || seen.has(k)) continue;
    seen.add(k);
    out.push(mapPair(p, pairs));
  }
  return out;
}
