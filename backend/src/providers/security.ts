import { fetchJson } from './http.ts';
import { CHAINS, type SecurityObs } from './types.ts';

const num = (v: any): number | null => (v == null || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const yes = (v: any) => v === '1' || v === 1 || v === true;

/** GoPlus Security (EVM). Gratuit, sans clé pour un usage modéré. */
export async function goplus(chain: string, address: string): Promise<SecurityObs | null> {
  const chainId = CHAINS[chain]?.goplus;
  if (!chainId) return null;
  const url = `https://api.gopluslabs.io/api/v1/token_security/${chainId}?contract_addresses=${address}`;
  const d = await fetchJson<any>('goplus', url, { cacheTtlMs: 6 * 3600_000 });
  const r = d?.result?.[address.toLowerCase()] ?? d?.result?.[address];
  if (!r) return null;
  return parseGoplus(r, `https://gopluslabs.io/token-security/${chainId}/${address}`);
}

export function parseGoplus(r: any, sourceUrl: string): SecurityObs {
  const flags: string[] = [];
  if (yes(r.is_honeypot)) flags.push('Honeypot détecté (vente impossible)');
  if (yes(r.cannot_sell_all)) flags.push('Impossible de tout revendre');
  if (yes(r.is_mintable)) flags.push('Offre modifiable (mint possible)');
  if (yes(r.owner_change_balance)) flags.push('Le propriétaire peut modifier les soldes');
  if (yes(r.hidden_owner)) flags.push('Propriétaire caché');
  if (yes(r.is_proxy)) flags.push('Contrat proxy (modifiable)');
  if (yes(r.transfer_pausable)) flags.push('Transferts suspendables');
  if (yes(r.is_blacklisted)) flags.push('Liste noire d’adresses');
  if (r.is_open_source === '0') flags.push('Code non vérifié');
  if (yes(r.slippage_modifiable)) flags.push('Taxes modifiables');
  const sellTax = num(r.sell_tax);
  const buyTax = num(r.buy_tax);
  if (sellTax != null && sellTax > 0.1) flags.push(`Taxe de vente élevée (${Math.round(sellTax * 100)} %)`);
  const holders: any[] = Array.isArray(r.holders) ? r.holders : [];
  const top10 = holders.length
    ? holders.filter((h) => !yes(h.is_contract) || !yes(h.is_locked)).slice(0, 10).reduce((a, h) => a + (num(h.percent) ?? 0), 0)
    : null;
  return {
    provider: 'goplus',
    sourceUrl,
    isHoneypot: r.is_honeypot == null ? null : yes(r.is_honeypot),
    buyTax,
    sellTax,
    top10HoldersPct: top10 != null ? top10 * 100 : null,
    holderCount: num(r.holder_count),
    flags,
  };
}

/** RugCheck (Solana). */
export async function rugcheck(mint: string): Promise<SecurityObs | null> {
  const d = await fetchJson<any>('rugcheck', `https://api.rugcheck.xyz/v1/tokens/${mint}/report/summary`, { cacheTtlMs: 6 * 3600_000 });
  if (!d) return null;
  return parseRugcheck(d, `https://rugcheck.xyz/tokens/${mint}`);
}

export function parseRugcheck(d: any, sourceUrl: string): SecurityObs {
  const risks: any[] = Array.isArray(d.risks) ? d.risks : [];
  const flags = risks.filter((r) => ['danger', 'warn'].includes(r.level)).map((r) => `${r.level === 'danger' ? '⚠︎ ' : ''}${r.name}${r.value ? ` (${r.value})` : ''}`);
  const top = risks.find((r) => /top 10 holders|single holder/i.test(r.name ?? ''));
  const pct = top?.value ? num(String(top.value).replace('%', '')) : null;
  return {
    provider: 'rugcheck',
    sourceUrl,
    isHoneypot: risks.some((r) => /freeze authority/i.test(r.name ?? '') && r.level === 'danger') ? true : null,
    buyTax: null,
    sellTax: null,
    top10HoldersPct: pct,
    holderCount: null,
    flags,
  };
}
