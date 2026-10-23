/** Observation de marché normalisée, quelle que soit la source. */
export type MarketObs = {
  key: TokenKey;
  source: 'coingecko' | 'dexscreener' | 'geckoterminal';
  sourceUrl: string;
  sourceUpdatedAt?: string | null;
  priceUsd: number | null;
  marketCap: number | null;
  fdv: number | null;
  volume24h: number | null;
  volume1h?: number | null;
  volume6h?: number | null;
  liquidityUsd?: number | null;
  change1h?: number | null;
  change24h?: number | null;
  change7d?: number | null;
  circulatingSupply?: number | null;
  totalSupply?: number | null;
  maxSupply?: number | null;
  buys24h?: number | null;
  sells24h?: number | null;
};

export type TokenKey = {
  symbol: string;
  name: string;
  chain?: string | null;           // id normalisé (solana, ethereum, base, bsc, arbitrum…)
  contractAddress?: string | null;
  coingeckoId?: string | null;
  logoUrl?: string | null;
  website?: string | null;
  twitter?: string | null;
  dexUrl?: string | null;
  pairCreatedAt?: string | null;
  description?: string | null;
  categories?: string[];
};

export type CategoryObs = {
  id: string;
  name: string;
  marketCap: number | null;
  change24h: number | null;
  volume24h: number | null;
};

export type SecurityObs = {
  provider: 'goplus' | 'rugcheck';
  sourceUrl: string;
  isHoneypot: boolean | null;
  buyTax: number | null;
  sellTax: number | null;
  top10HoldersPct: number | null;
  holderCount: number | null;
  flags: string[];               // libellés lisibles
};

export type CatalystObs = {
  id: string;
  title: string;
  kind: string | null;
  eventDate: string | null;
  datePrecision: 'day' | 'month' | 'quarter' | 'unknown';
  status: 'confirmed' | 'rumor';
  sourceName: string;
  sourceUrl: string;
  coingeckoId?: string | null;
  symbol?: string | null;
};

/** Correspondance des identifiants de blockchain entre fournisseurs. */
export const CHAINS: Record<string, { dexscreener: string; geckoterminal: string; goplus?: string; label: string }> = {
  solana: { dexscreener: 'solana', geckoterminal: 'solana', label: 'Solana' },
  ethereum: { dexscreener: 'ethereum', geckoterminal: 'eth', goplus: '1', label: 'Ethereum' },
  base: { dexscreener: 'base', geckoterminal: 'base', goplus: '8453', label: 'Base' },
  bsc: { dexscreener: 'bsc', geckoterminal: 'bsc', goplus: '56', label: 'BNB Chain' },
  arbitrum: { dexscreener: 'arbitrum', geckoterminal: 'arbitrum', goplus: '42161', label: 'Arbitrum' },
};

export const chainFromGeckoTerminal = (net: string) =>
  Object.entries(CHAINS).find(([, v]) => v.geckoterminal === net)?.[0] ?? net;
export const chainFromDexScreener = (id: string) =>
  Object.entries(CHAINS).find(([, v]) => v.dexscreener === id)?.[0] ?? id;

/** Plateformes CoinGecko → id normalisé. */
export const CG_PLATFORM_TO_CHAIN: Record<string, string> = {
  solana: 'solana',
  ethereum: 'ethereum',
  base: 'base',
  'binance-smart-chain': 'bsc',
  'arbitrum-one': 'arbitrum',
};
