import type { Features } from './features.ts';

export type RiskFlag = { code: string; label: string; severity: 'critical' | 'high' | 'medium'; weight: number; source?: string | null };

/**
 * Détection des tokens suspects. Un drapeau "critical" ou "high" classe le token en catégorie Suspects :
 * il reste consultable mais n'apparaît JAMAIS comme opportunité.
 */
export function assessRisk(f: Features, knownSymbols: Map<string, string>): { flags: RiskFlag[]; risk: number; suspect: boolean } {
  const flags: RiskFlag[] = [];
  const add = (x: RiskFlag) => flags.push(x);

  for (const sec of f.security) {
    if (sec.is_honeypot === 1) add({ code: 'honeypot', label: 'Honeypot : la revente semble impossible', severity: 'critical', weight: 1, source: sec.source_url });
    if (sec.sell_tax != null && sec.sell_tax > 0.1) add({ code: 'sell_tax', label: `Taxe de vente de ${Math.round(sec.sell_tax * 100)} %`, severity: 'high', weight: 0.5, source: sec.source_url });
    if (sec.top10_holders_pct != null && sec.top10_holders_pct > 60) add({ code: 'concentration', label: `Top 10 détenteurs : ${sec.top10_holders_pct.toFixed(0)} % de l’offre`, severity: 'high', weight: 0.45, source: sec.source_url });
    else if (sec.top10_holders_pct != null && sec.top10_holders_pct > 40) add({ code: 'concentration_med', label: `Top 10 détenteurs : ${sec.top10_holders_pct.toFixed(0)} %`, severity: 'medium', weight: 0.2, source: sec.source_url });
    for (const fl of sec.flags) {
      if (/mint|modifier les soldes|propriétaire caché|blacklist|liste noire|suspendables|taxes modifiables|freeze|danger|⚠/i.test(fl)) {
        add({ code: `sec:${fl.slice(0, 30)}`, label: fl, severity: /soldes|caché|freeze|⚠/i.test(fl) ? 'high' : 'medium', weight: 0.25, source: sec.source_url });
      }
    }
    break; // dernier contrôle par fournisseur suffit (trié par date)
  }

  const isDexOnly = !f.token?.coingecko_id;
  if (f.liquidity != null) {
    if (f.liquidity < 10_000) add({ code: 'low_liquidity', label: `Liquidité très faible (${Math.round(f.liquidity).toLocaleString('fr-FR')} $)`, severity: 'high', weight: 0.5 });
    else if (f.liquidity < 50_000) add({ code: 'thin_liquidity', label: `Liquidité faible (${Math.round(f.liquidity).toLocaleString('fr-FR')} $)`, severity: 'medium', weight: 0.2 });
    if (f.volume24h != null && f.liquidity > 0 && f.volume24h / f.liquidity > 40) {
      add({ code: 'wash', label: `Volume ${Math.round(f.volume24h / f.liquidity)}× supérieur à la liquidité : possible volume artificiel`, severity: 'high', weight: 0.45 });
    }
  } else if (isDexOnly) {
    add({ code: 'no_liquidity_data', label: 'Liquidité non disponible (ex. courbe de lancement pump.fun)', severity: 'medium', weight: 0.25 });
  }

  const tx = (f.buys24h ?? 0) + (f.sells24h ?? 0);
  if ((f.volume24h ?? 0) < 1_000 || (isDexOnly && f.buys24h != null && tx < 20)) {
    add({ code: 'inactive', label: 'Pas de marché actif (volume ou transactions quasi nuls)', severity: 'high', weight: 0.5 });
  }
  if (isDexOnly && f.volume24h && tx > 0 && f.volume24h / tx > 25_000 && f.liquidity != null && f.liquidity < 200_000) {
    add({ code: 'few_big_trades', label: 'Volume concentré sur très peu de transactions', severity: 'medium', weight: 0.25 });
  }

  // Imitation : même symbole qu'un projet établi, mais autre contrat.
  const sym = String(f.token?.symbol ?? '').toUpperCase();
  const known = knownSymbols.get(sym);
  if (isDexOnly && known && known !== f.tokenId) {
    add({ code: 'impersonation', label: `Même symbole que ${known.replace('cg:', '')} : possible faux contrat`, severity: 'high', weight: 0.6 });
  }

  if (f.priceDivergencePct != null && f.priceDivergencePct > 20) {
    add({ code: 'divergence', label: `Prix divergent de ${f.priceDivergencePct.toFixed(0)} % entre sources`, severity: 'medium', weight: 0.2 });
  }

  const risk = 1 - flags.reduce((acc, fl) => acc * (1 - fl.weight), 1);
  const suspect = flags.some((x) => x.severity === 'critical' || x.severity === 'high');
  return { flags, risk: Math.min(1, risk), suspect };
}
