import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from '../backtest/evaluate.ts';
import { type Db, pj } from '../db/db.ts';
import { buildFeatures } from '../engine/features.ts';
import { getWeights } from '../engine/ranking.ts';
import { COMPONENT_LABELS, DEFAULT_WEIGHTS } from '../engine/scoring.ts';
import { HORIZONS, isoMinus } from '../engine/time.ts';
import { catalystSourceActive } from '../jobs/collect.ts';
import { rankingsView, statusView, tokenDetail } from '../api/views.ts';

/** Nom de fichier sûr et déterministe pour un id de token (même fonction côté app). */
export const fileId = (id: string) => encodeURIComponent(id).replace(/%/g, '~');

export const METHODOLOGY_TEXT = {
  horizons: {
    week: 'Fenêtre [maintenant, +7 jours] — signaux courts : volume, transactions, catalyseurs à 7 j.',
    month: 'Fenêtre [maintenant, +30 jours] — liquidité, narrative, catalyseurs à 30 j.',
    year: 'Fenêtre [maintenant, +365 jours] — thèse : narrative, marge de progression, tokenomics.',
  },
  multipliers: 'Scénarios de capitalisation par comparables de la même catégorie : la cible monte de N points de percentile depuis la position actuelle du token (7 j : +5/+15/+30 ; 30 j : +10/+25/+45 ; 12 mois : +15/+35/+60). Fourchette : cible ÷ FDV (dilution totale) → cible ÷ capitalisation en circulation. Aucun scénario si moins de 8 comparables ou si aucune cible n’est supérieure de 25 % à la capitalisation actuelle.',
  confidence: 'Fraîcheur (30 %), nombre de sources (20 %), recoupement des prix (15 %), complétude des critères (20 %), profondeur d’historique (15 %).',
  sources: [
    { name: 'CoinGecko', use: 'Prix, capitalisations, offres, catégories/narratives, comparables, activité développeurs', key: 'Clé Demo gratuite recommandée' },
    { name: 'DexScreener', use: 'Paires DEX, liquidité, volumes, transactions, nouveaux profils', key: 'Aucune' },
    { name: 'GeckoTerminal', use: 'Nouveaux pools et pools tendance (2e source DEX)', key: 'Aucune' },
    { name: 'GoPlus Security', use: 'Honeypot, taxes, droits du propriétaire, concentration (EVM)', key: 'Aucune' },
    { name: 'RugCheck', use: 'Risques des tokens Solana', key: 'Aucune' },
    { name: 'CoinMarketCal', use: 'Catalyseurs datés (preuve jointe = confirmé)', key: 'Optionnelle' },
  ],
  limits: [
    'Analyses exécutées par GitHub Actions : 06 h (Paris) + actualisation toutes les 3 h. GitHub peut retarder une exécution de quelques dizaines de minutes.',
    'Les alertes sont vérifiées quand tu ouvres l’app (pas de serveur pour envoyer des notifications push).',
    'Pas de données de réseaux sociaux (API X payante) : critère « communauté » limité aux détenteurs on-chain.',
    'Calendriers de déblocage non intégrés : la borne basse des multiplicateurs utilise la FDV pour couvrir la dilution totale.',
    'Les « boosts » DexScreener sont des promotions payantes : utilisés pour découvrir, jamais comme signal positif.',
    'Les pondérations par défaut sont des choix de conception à valider avec la page Performances.',
  ],
};

/** Exporte tout ce dont l'app a besoin sous forme de fichiers JSON statiques. */
export function exportStatic(db: Db, outDir: string) {
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(join(outDir, 'tokens'), { recursive: true });
  const w = (name: string, data: unknown) => writeFileSync(join(outDir, name), JSON.stringify(data));
  const now = new Date();

  const status = statusView(db);
  w('status.json', status);
  const lists = Object.fromEntries(HORIZONS.map((h) => [h, rankingsView(db, h, {})]));
  w('home.json', { status, lists });

  const detailIds = new Set<string>();
  for (const h of HORIZONS) for (const i of lists[h].items) detailIds.add(i.id);

  // Explorer (4 tris)
  for (const sort of ['new', 'volume', 'liquidity', 'gainers'] as const) {
    const order = { new: 't.first_seen_at DESC', volume: 's.volume_24h DESC', liquidity: 's.liquidity_usd DESC', gainers: 's.change_24h DESC' }[sort];
    const items = db.all<any>(
      `SELECT t.id, t.symbol, t.name, t.chain, t.logo_url, t.status, t.first_seen_at, t.discovered_via, s.price_usd, s.market_cap, s.volume_24h, s.liquidity_usd, s.change_24h, s.ts
       FROM tokens t JOIN market_snapshots s ON s.id = (SELECT id FROM market_snapshots WHERE token_id = t.id ORDER BY ts DESC LIMIT 1)
       WHERE t.status = 'active' AND t.last_seen_at >= ? ORDER BY ${order} NULLS LAST LIMIT 60`, isoMinus(now, 2),
    );
    items.slice(0, 40).forEach((i) => detailIds.add(i.id));
    w(`explore-${sort}.json`, { items });
  }

  const suspects = db.all<any>(`SELECT id, symbol, name, chain, logo_url, contract_address, status_reason, last_seen_at FROM tokens WHERE status = 'suspect' AND last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 100`, isoMinus(now, 3));
  w('suspects.json', { note: 'Ces tokens présentent des signaux de risque. Ils ne sont JAMAIS présentés comme des opportunités.', items: suspects });
  suspects.slice(0, 40).forEach((s) => detailIds.add(s.id));

  // Index de recherche (+ données pour favoris et alertes locales)
  const recent = db.all<any>(`SELECT id, symbol, name, chain, logo_url, status, contract_address, coingecko_id, dex_url FROM tokens WHERE last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 3000`, isoMinus(now, 3));
  const index = recent.map((t) => {
    const f = buildFeatures(db, t.id, now);
    return {
      id: t.id, symbol: t.symbol, name: t.name, chain: t.chain, logo_url: t.logo_url, status: t.status, contract_address: t.contract_address,
      coingecko_id: t.coingecko_id, dex_url: t.dex_url,
      price_usd: f.price, market_cap: f.marketCap, change_24h: f.change24h, volume_24h: f.volume24h, liquidity_usd: f.liquidity,
      vol_ratio: f.volume24h && f.avgPrevVolume7d ? f.volume24h / f.avgPrevVolume7d : f.intradayVolumeRatio,
      ts: f.latest?.ts ?? null,
    };
  });
  w('index.json', { at: now.toISOString(), items: index });

  for (const id of detailIds) {
    const d = tokenDetail(db, id);
    if (d) w(`tokens/${fileId(id)}.json`, { ...d, favorite: false });
  }

  const rep = db.get<any>('SELECT * FROM daily_reports ORDER BY run_id DESC LIMIT 1');
  if (rep) {
    const run = db.get<any>('SELECT id, status, started_at, finished_at, steps FROM job_runs WHERE id = ?', rep.run_id);
    w('report.json', { ...pj(rep.data, {}), run: { ...run, steps: pj(run?.steps, []) }, status });
  }
  w('runs.json', { items: db.all<any>(`SELECT id, job, run_key, trigger, status, started_at, finished_at, error, stats FROM job_runs WHERE job != 'discovery' ORDER BY id DESC LIMIT 100`).map((r) => ({ ...r, stats: pj(r.stats, {}) })) });
  w('performance.json', {
    method: 'Chaque classement quotidien enregistré est comparé au prix observé à la fin de son horizon. Les tokens disparus sont inclus (dernier prix connu). Référence : Bitcoin sur la même période.',
    horizons: Object.fromEntries(HORIZONS.map((h) => [h, performance(db, h)])),
  });
  w('methodology.json', { weights: getWeights(db), defaults: DEFAULT_WEIGHTS, components: COMPONENT_LABELS, catalystSourceActive: catalystSourceActive(), ...METHODOLOGY_TEXT });
  return { tokens: detailIds.size, index: index.length };
}
