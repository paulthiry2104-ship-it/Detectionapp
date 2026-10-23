import type { Horizon } from './time.ts';

export type Peer = { id: string; name: string; cap: number };

export type Scenario = {
  kind: 'prudent' | 'haussier' | 'exceptionnel';
  label: string;
  horizon: string;
  targetCap: number;
  /** Fourchette du multiplicateur de PRIX : bas = cible / FDV (dilution totale), haut = cible / capitalisation actuelle. */
  multiplierLow: number;
  multiplierHigh: number;
  display: string;          // ex. "x2–x5"
  method: string;
  comparables: Peer[];
  assumptions: string[];
  confirmIf: string[];
  invalidateIf: string[];
};

export type ScenarioSet = {
  scenarios: Scenario[];
  basis: { currentCap: number; fdv: number | null; capType: 'market_cap' | 'fdv'; category: string; peerCount: number; currentPercentile: number };
  warnings: string[];
} | { scenarios: []; reason: string };

const MIN_PEERS = 8;
export const JUMPS: Record<Horizon, [number, number, number]> = { week: [0.05, 0.15, 0.3], month: [0.1, 0.25, 0.45], year: [0.15, 0.35, 0.6] };

export const quantile = (sorted: number[], q: number) => {
  if (!sorted.length) return NaN;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};
const percentileOf = (sorted: number[], v: number) => sorted.filter((x) => x <= v).length / sorted.length;

export const fmtMult = (m: number) => (m >= 10 ? `x${Math.round(m)}` : `x${(Math.round(m * 10) / 10).toString().replace('.', ',')}`);

/**
 * Scénarios de capitalisation fondés sur les comparables de la même catégorie.
 * La cible est RELATIVE à la position actuelle du token dans sa catégorie : on monte de N points de percentile
 * (sauts plus petits sur les horizons courts). Ainsi une petite capitalisation ne donne pas mécaniquement un x100.
 *   saut en points de percentile  prudent / haussier / exceptionnel
 *   7 jours                          +5   /   +15    /   +30
 *   30 jours                         +10  /   +25    /   +45
 *   12 mois                          +15  /   +35    /   +60
 * Ces sauts sont des hypothèses de conception, à recalibrer avec la page Performances.
 * Un scénario n'est retenu que si la cible dépasse la capitalisation actuelle d'au moins 25 %.
 */
export function buildScenarios(input: {
  marketCap: number | null; fdv: number | null; liquidity: number | null; circulating: number | null; total: number | null;
  category: string | null; categoryName: string | null; peers: Peer[]; horizon: Horizon; selfId: string;
}): ScenarioSet {
  const { marketCap, fdv, category, peers } = input;
  const currentCap = marketCap ?? null;
  if (!category) return { scenarios: [], reason: 'Aucune catégorie comparable connue' };
  if (currentCap == null || currentCap <= 0) {
    return { scenarios: [], reason: 'Capitalisation en circulation inconnue : aucun scénario défendable' };
  }
  const others = peers.filter((p) => p.id !== input.selfId && p.cap > 0);
  if (others.length < MIN_PEERS) return { scenarios: [], reason: `Pas assez de comparables (${others.length}/${MIN_PEERS}) dans « ${input.categoryName ?? category} »` };

  const caps = others.map((p) => p.cap).sort((a, b) => a - b);
  const pNow = percentileOf(caps, currentCap);
  const warnings: string[] = [];
  const effFdv = fdv && fdv > currentCap * 1.05 ? fdv : null;
  if (effFdv && effFdv / currentCap > 3) warnings.push(`FDV ${(effFdv / currentCap).toFixed(1)}× la capitalisation : forte dilution possible, la borne basse en tient compte.`);
  if (input.liquidity != null && input.liquidity < currentCap * 0.02) {
    warnings.push(`Seulement ${Math.round(input.liquidity).toLocaleString('fr-FR')} $ de liquidité : une capitalisation théorique n’est pas de l’argent retirable.`);
  }

  const horizonLabel = { week: '7 jours', month: '30 jours', year: '12 mois' }[input.horizon];
  const jumps = JUMPS[input.horizon];
  const q = (d: number) => Math.min(0.95, pNow + d);
  if (pNow === 0) warnings.push(`Capitalisation inférieure au plus petit des ${caps.length} comparables suivis : cibles extrapolées, prudence.`);
  const defs: { kind: Scenario['kind']; q: number; jump: number; label: string; horizon: string }[] = [
    { kind: 'prudent', q: q(jumps[0]), jump: jumps[0], label: 'Scénario prudent', horizon: horizonLabel },
    { kind: 'haussier', q: q(jumps[1]), jump: jumps[1], label: 'Scénario haussier', horizon: horizonLabel },
    { kind: 'exceptionnel', q: q(jumps[2]), jump: jumps[2], label: 'Scénario exceptionnel', horizon: horizonLabel },
  ];

  const out: Scenario[] = [];
  let lastTarget = 0;
  for (const d of defs) {
    const target = quantile(caps, d.q);
    if (!(target > currentCap * 1.25) || target <= lastTarget * 1.05) continue;
    lastTarget = target;
    const hi = target / currentCap;
    const lo = effFdv ? Math.max(target / effFdv, 1) : hi;
    const comparables = others
      .slice()
      .sort((a, b) => Math.abs(Math.log(a.cap / target)) - Math.abs(Math.log(b.cap / target)))
      .slice(0, 3);
    out.push({
      kind: d.kind,
      label: d.label,
      horizon: d.horizon,
      targetCap: target,
      multiplierLow: lo,
      multiplierHigh: hi,
      display: Math.abs(hi - lo) / hi < 0.08 ? fmtMult(hi) : `${fmtMult(lo)}–${fmtMult(hi)}`,
      method: `Position actuelle : ${Math.round(pNow * 100)}e percentile de ${caps.length} projets « ${input.categoryName ?? category} ». `
        + `Hypothèse : +${Math.round(d.jump * 100)} points en ${d.horizon} → ${Math.round(d.q * 100)}e percentile, soit ${fmt(target)}. `
        + `Multiplicateur = cible ÷ capitalisation actuelle (${fmt(currentCap)})${effFdv ? ` ; borne basse = cible ÷ FDV (${fmt(effFdv)})` : ''}.`,
      comparables,
      assumptions: [
        `Le projet atteint la valorisation de projets comparables comme ${comparables.map((c) => c.name).join(', ')}.`,
        'La narrative de la catégorie reste au moins aussi forte qu’aujourd’hui.',
        effFdv ? 'Les tokens non encore en circulation ne sont pas vendus massivement (sinon borne basse).' : 'L’offre en circulation reste comparable.',
      ],
      confirmIf: [
        'Volume en hausse durable (plusieurs jours) sans effondrement de la liquidité',
        'Liquidité qui progresse avec la capitalisation',
        'Catalyseur confirmé par une source officielle',
      ],
      invalidateIf: [
        'Liquidité retirée ou en forte baisse',
        'Ventes importantes des principaux portefeuilles / déblocage de tokens',
        'Narrative de la catégorie en perte de vitesse',
      ],
    });
  }
  if (!out.length) return { scenarios: [], reason: `Déjà au ${Math.round(pNow * 100)}e percentile de sa catégorie : aucun scénario de hausse défendable par les comparables` };
  return {
    scenarios: out,
    basis: { currentCap, fdv: effFdv, capType: 'market_cap', category: input.categoryName ?? category, peerCount: caps.length, currentPercentile: pNow },
    warnings,
  };
}

export const fmt = (v: number) => {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2).replace('.', ',')} Md$`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1).replace('.', ',')} M$`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)} k$`;
  return `${v.toFixed(0)} $`;
};
