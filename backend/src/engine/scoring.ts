import type { Features } from './features.ts';
import type { RiskFlag } from './suspicion.ts';
import { daysBetween, type Horizon, horizonWindow } from './time.ts';

export const COMPONENTS = ['volumeAccel', 'liquidityGrowth', 'onchain', 'community', 'narrative', 'catalyst', 'headroom', 'tokenomics'] as const;
export type ComponentKey = (typeof COMPONENTS)[number];

export const COMPONENT_LABELS: Record<ComponentKey, string> = {
  volumeAccel: 'Accélération du volume',
  liquidityGrowth: 'Progression de la liquidité',
  onchain: 'Activité on-chain / adoption',
  community: 'Croissance de la communauté',
  narrative: 'Force et fraîcheur de la narrative',
  catalyst: 'Proximité d’un catalyseur vérifiable',
  headroom: 'Marge de progression (comparables)',
  tokenomics: 'Tokenomics et dilution',
};

export type Weights = Record<Horizon, Record<ComponentKey, number>> & {
  manipulationPenalty: number;   // part du score retirée au risque maximal
  overextensionPenalty: number;  // pénalité max pour un token ayant déjà énormément monté
  minCoverage: number;           // part minimale (pondérée) de composantes disponibles
  maxMarketCap: number;          // au-delà, le token sort des listes (focus microcaps / émergents)
  version: string;
};

export const DEFAULT_WEIGHTS: Weights = {
  week: { volumeAccel: 0.25, liquidityGrowth: 0.12, onchain: 0.18, community: 0.05, narrative: 0.1, catalyst: 0.2, headroom: 0.05, tokenomics: 0.05 },
  month: { volumeAccel: 0.12, liquidityGrowth: 0.15, onchain: 0.12, community: 0.08, narrative: 0.18, catalyst: 0.2, headroom: 0.08, tokenomics: 0.07 },
  year: { volumeAccel: 0.05, liquidityGrowth: 0.1, onchain: 0.1, community: 0.1, narrative: 0.2, catalyst: 0.1, headroom: 0.2, tokenomics: 0.15 },
  manipulationPenalty: 0.7,
  overextensionPenalty: 0.4,
  minCoverage: 0.5,
  maxMarketCap: 3e9,
  version: 'v1',
};

export type Component = { value: number | null; raw: string; kind: 'observé' | 'estimation' | 'indisponible' };

const clamp = (x: number, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
const log2 = Math.log2;
const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(0)} %`;

export type ExternalInputs = {
  narrative: { value: number | null; detail: string };
  headroomMultiplier: number | null;  // multiplicateur haut du scénario haussier (ou prudent)
  devCommits4w?: number | null;
  catalystSourceActive: boolean;      // si une source automatique de catalyseurs est configurée
};

export function catalystProximity(f: Features, h: Horizon, asOf: Date) {
  const w = horizonWindow(h, asOf);
  const inWindow = f.catalysts.filter((c) => c.event_date && c.event_date >= w.start.slice(0, 10) && c.event_date <= w.end.slice(0, 10));
  const best = inWindow
    .map((c) => {
      const days = Math.max(0, daysBetween(asOf, c.event_date as string));
      const base = c.status === 'confirmed' ? 1 : 0.35;
      const precision = c.date_precision === 'day' ? 1 : 0.75;
      return { c, days, value: base * precision * (1 - 0.5 * (days / w.days)) };
    })
    .sort((a, b) => b.value - a.value)[0];
  return best
    ? { value: best.value, days: Math.round(best.days), title: best.c.title, status: best.c.status, source: best.c.source_url, date: best.c.event_date, count: inWindow.length }
    : null;
}

export function computeComponents(f: Features, h: Horizon, asOf: Date, ext: ExternalInputs): Record<ComponentKey, Component> {
  const c = {} as Record<ComponentKey, Component>;

  // Volume : comparaison à l'historique propre du token ; à défaut (DEX récents), rythme intrajournalier.
  if (f.volume24h != null && f.avgPrevVolume7d) {
    const r = f.volume24h / f.avgPrevVolume7d;
    c.volumeAccel = { value: clamp(0.3 + 0.233 * log2(Math.max(r, 1e-6))), raw: `${r.toFixed(2)}× la moyenne des jours précédents`, kind: 'observé' };
  } else if (f.intradayVolumeRatio != null) {
    const r = f.intradayVolumeRatio;
    c.volumeAccel = { value: clamp(0.3 + 0.2 * log2(Math.max(r, 1e-6))), raw: `Rythme de la dernière heure : ${r.toFixed(2)}× la moyenne 24 h`, kind: 'observé' };
  } else c.volumeAccel = { value: null, raw: 'Historique de volume insuffisant', kind: 'indisponible' };

  if (f.liquidity != null && f.liquidity3dAgo) {
    const g = f.liquidity / f.liquidity3dAgo;
    c.liquidityGrowth = { value: clamp(0.4 + 0.3 * log2(Math.max(g, 1e-6))), raw: `Liquidité ${pct((g - 1) * 100)} sur ~3 jours`, kind: 'observé' };
  } else c.liquidityGrowth = { value: null, raw: f.liquidity != null ? 'Pas encore d’historique de liquidité (3 j)' : 'Liquidité indisponible', kind: 'indisponible' };

  const onParts: { v: number; d: string }[] = [];
  if (f.buys24h != null && f.sells24h != null && f.buys24h + f.sells24h > 0) {
    const br = f.buys24h / (f.buys24h + f.sells24h);
    onParts.push({ v: clamp((br - 0.35) / 0.3), d: `${Math.round(br * 100)} % d’achats sur ${f.buys24h + f.sells24h} transactions` });
    if (f.txns24hPrev) {
      const g = (f.buys24h + f.sells24h) / f.txns24hPrev;
      onParts.push({ v: clamp(0.4 + 0.3 * log2(Math.max(g, 1e-6))), d: `transactions ${pct((g - 1) * 100)} vs veille` });
    }
  }
  if (ext.devCommits4w != null) onParts.push({ v: clamp(Math.log10(1 + ext.devCommits4w) / 2), d: `${ext.devCommits4w} commits GitHub / 4 sem.` });
  c.onchain = onParts.length
    ? { value: onParts.reduce((a, b) => a + b.v, 0) / onParts.length, raw: onParts.map((p) => p.d).join(' · '), kind: 'observé' }
    : { value: null, raw: 'Activité on-chain non disponible', kind: 'indisponible' };

  if (f.holdersNow != null && f.holdersPrev) {
    const g = f.holdersNow / f.holdersPrev;
    c.community = { value: clamp(0.4 + log2(Math.max(g, 1e-6))), raw: `Détenteurs ${pct((g - 1) * 100)} (${f.holdersNow.toLocaleString('fr-FR')})`, kind: 'observé' };
  } else c.community = { value: null, raw: 'Évolution des détenteurs non disponible', kind: 'indisponible' };

  c.narrative = { value: ext.narrative.value, raw: ext.narrative.detail, kind: ext.narrative.value == null ? 'indisponible' : 'observé' };

  const cat = catalystProximity(f, h, asOf);
  if (cat) c.catalyst = { value: cat.value, raw: `${cat.status === 'confirmed' ? 'Confirmé' : 'Non confirmé'} : ${cat.title} (J-${cat.days})`, kind: 'observé' };
  else if (ext.catalystSourceActive || f.catalysts.length) c.catalyst = { value: 0, raw: 'Aucun catalyseur daté dans la fenêtre', kind: 'observé' };
  else c.catalyst = { value: null, raw: 'Pas de source de catalyseurs configurée', kind: 'indisponible' };

  c.headroom = ext.headroomMultiplier != null
    ? { value: clamp(Math.log10(ext.headroomMultiplier) / Math.log10(20)), raw: `Scénario haussier ≈ ${ext.headroomMultiplier.toFixed(1)}× (comparables)`, kind: 'estimation' }
    : { value: null, raw: 'Aucun scénario défendable', kind: 'indisponible' };

  const ratio = f.circulating && f.total ? f.circulating / f.total : f.marketCap && f.fdv ? f.marketCap / f.fdv : null;
  c.tokenomics = ratio != null
    ? { value: clamp((ratio - 0.2) / 0.7), raw: `${Math.round(ratio * 100)} % de l’offre en circulation`, kind: 'observé' }
    : { value: null, raw: 'Offre en circulation / totale inconnue', kind: 'indisponible' };

  return c;
}

/** Fraîcheur, nombre de sources, recoupement, complétude, profondeur d'historique → 0..100. */
export function confidenceScore(f: Features, coverage: number) {
  const age = f.dataAgeHours ?? 999;
  const fresh = age <= 3 ? 1 : age >= 48 ? 0 : 1 - (age - 3) / 45;
  const sources = f.sourcesCount >= 2 ? 1 : f.sourcesCount === 1 ? 0.6 : 0;
  const agree = f.priceDivergencePct == null ? 0.6 : f.priceDivergencePct < 3 ? 1 : f.priceDivergencePct < 10 ? 0.7 : 0.2;
  const history = clamp(f.historyDays / 7);
  return Math.round(100 * (0.3 * fresh + 0.2 * sources + 0.15 * agree + 0.2 * coverage + 0.15 * history));
}

export type ScoreResult = {
  status: 'ranked' | 'insufficient' | 'suspect' | 'ineligible';
  score: number | null;
  confidence: number;
  coverage: number;
  components: Record<ComponentKey, Component & { weight: number; contribution: number | null }>;
  penalties: { manipulation: number; overextension: number; reliability: number };
  reason?: string;
};

export function eligibleFor(h: Horizon, f: Features, comps: Record<ComponentKey, Component>): string | null {
  if ((f.dataAgeHours ?? 999) > 24) return 'Données de marché de plus de 24 h';
  // Plancher commun : on écarte les tokens quasi morts (aucun marché réel, capitalisation symbolique).
  if ((f.volume24h ?? 0) < 10_000) return 'Volume 24 h < 10 k$ : marché trop peu actif';
  if ((f.marketCap ?? f.fdv ?? 0) < 250_000 && (f.liquidity ?? 0) < 50_000) return 'Capitalisation < 250 k$ sans liquidité suffisante (< 50 k$)';
  if (h === 'week') {
    if ((f.volume24h ?? 0) < 50_000) return 'Volume 24 h < 50 k$ : trop faible pour un signal court terme';
    if (comps.volumeAccel.value == null && comps.onchain.value == null && comps.catalyst.value == null) return 'Aucun signal court terme disponible';
  }
  if (h === 'month' && comps.liquidityGrowth.value == null && comps.narrative.value == null && !comps.catalyst.value) return 'Ni tendance de liquidité, ni narrative, ni catalyseur à 30 j';
  if (h === 'year') {
    if (f.ageDays != null && f.ageDays < 3) return 'Token lancé il y a moins de 3 jours : pas de thèse annuelle évaluable';
    if (f.marketCap == null) return 'Capitalisation inconnue';
  }
  return null;
}

export function scoreToken(f: Features, h: Horizon, asOf: Date, ext: ExternalInputs, weights: Weights, risk: { flags: RiskFlag[]; risk: number; suspect: boolean }): ScoreResult {
  const comps = computeComponents(f, h, asOf, ext);
  const w = weights[h];
  const totalW = COMPONENTS.reduce((a, k) => a + (w[k] ?? 0), 0) || 1;
  let availW = 0;
  let acc = 0;
  const detailed = {} as ScoreResult['components'];
  for (const k of COMPONENTS) {
    const v = comps[k].value;
    const wk = w[k] ?? 0;
    if (v != null) { availW += wk; acc += wk * v; }
    detailed[k] = { ...comps[k], weight: wk / totalW, contribution: v != null ? (wk * v) / totalW : null };
  }
  const coverage = availW / totalW;
  const confidence = confidenceScore(f, coverage);
  const c7 = Math.max(f.change7d ?? -Infinity, f.change24h ?? -Infinity);
  const overextension = Number.isFinite(c7) && c7 > 100 ? clamp((c7 - 100) / 400) * weights.overextensionPenalty : 0;
  const manipulation = risk.risk * weights.manipulationPenalty;
  const reliability = 0.7 + 0.3 * (confidence / 100);
  const penalties = { manipulation, overextension, reliability };

  if (risk.suspect) return { status: 'suspect', score: null, confidence, coverage, components: detailed, penalties, reason: risk.flags.filter((x) => x.severity !== 'medium').map((x) => x.label).join(' · ') };
  const inel = eligibleFor(h, f, comps);
  if (inel) return { status: 'ineligible', score: null, confidence, coverage, components: detailed, penalties, reason: inel };
  if (coverage < weights.minCoverage) return { status: 'insufficient', score: null, confidence, coverage, components: detailed, penalties, reason: `Données insuffisantes (${Math.round(coverage * 100)} % des critères disponibles)` };

  const base = acc / availW; // moyenne pondérée des critères disponibles
  const score = 100 * base * (1 - manipulation) * (1 - overextension) * reliability;
  return { status: 'ranked', score: Math.round(score * 10) / 10, confidence, coverage, components: detailed, penalties };
}
