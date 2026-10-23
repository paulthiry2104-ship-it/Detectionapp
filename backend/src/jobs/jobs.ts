import { loadConfig } from '../config.ts';
import type { Db } from '../db/db.ts';
import { computeAndStoreRankings, evaluateAll } from '../engine/ranking.ts';
import { isoMinus, localDate, localHour } from '../engine/time.ts';
import { dispatch, evaluateMarketRules, evaluateRunRules, systemEvent } from '../notify/alerts.ts';
import {
  catalystSourceActive, collectCatalysts, collectCategories, collectCoinGeckoMarkets, collectDexDiscovery, collectPeers,
  CORE_NARRATIVES, enrichCoinDetails, isGenericCategory, markDelisted, refreshDexTracked, securityChecks,
} from './collect.ts';
import { buildDailyReport } from './report.ts';
import { type RunOutcome, runJob } from './runner.ts';

export type Trigger = 'cron' | 'manual' | 'catchup' | 'cli' | 'test';

function providerIssues(steps: { name: string; ok: boolean; error?: string; info?: any }[]) {
  const out: string[] = [];
  for (const s of steps) {
    if (!s.ok) out.push(`${s.name} : ${s.error}`);
    else if (s.info && typeof s.info === 'object' && Array.isArray((s.info as any).errors) && (s.info as any).errors.length) {
      out.push(`${s.name} : ${(s.info as any).errors.slice(0, 3).join(' ; ')}`);
    }
  }
  return out;
}

/** ANALYSE QUOTIDIENNE COMPLÈTE (06 h Paris). */
export async function runDaily(db: Db, trigger: Trigger = 'cron'): Promise<RunOutcome> {
  const cfg = loadConfig();
  const runKey = `daily:${localDate(new Date(), cfg.TZ_SCHEDULE)}`;
  const outcome = await runJob(db, 'daily', runKey, trigger, async (ctx) => {
    const since = db.get<{ t: string }>(`SELECT MAX(started_at) AS t FROM job_runs WHERE job = 'daily' AND status IN ('success','partial')`)?.t ?? isoMinus(ctx.asOf, 1);
    const errorsOf = (r: any) => (r?.errors?.length ? r.errors : []);

    const m = await ctx.step('1. Marchés CoinGecko (prix, volumes, capitalisations)', false, () => collectCoinGeckoMarkets(db, cfg.COINGECKO_MARKET_PAGES));
    ctx.dataPoints += m?.count ?? 0;

    const cats = await ctx.step('2. Tendances et narratives (catégories)', false, () => collectCategories(db, ctx.runId));

    const peerIds = new Set<string>(CORE_NARRATIVES);
    for (const c of cats?.ranked ?? []) {
      if (peerIds.size >= 26) break;
      if ((c.marketCap ?? 0) > 50e6 && !isGenericCategory(c.id)) peerIds.add(c.id);
    }
    for (const r of db.all<{ narrative: string }>(`SELECT narrative, COUNT(*) n FROM tokens WHERE narrative IS NOT NULL AND last_seen_at >= ? GROUP BY narrative ORDER BY n DESC LIMIT 8`, isoMinus(ctx.asOf, 3))) peerIds.add(r.narrative);
    await ctx.step('3. Comparables par narrative', false, () => collectPeers(db, [...peerIds]));

    const disc = await ctx.step('4. Découverte (nouveaux pools, nouveaux tokens)', false, () => collectDexDiscovery(db, cfg.dexNetworks));
    ctx.dataPoints += (disc?.dexCount ?? 0) + (disc?.gtPools ?? 0);
    const ref = await ctx.step('5. Volumes, liquidité, transactions (DEX)', false, () => refreshDexTracked(db));
    ctx.dataPoints += ref?.count ?? 0;
    if (ctx.dataPoints === 0) return; // le runner marquera l'échec

    const pre = await ctx.step('6. Pré-classement', true, () => {
      const ev = evaluateAll(db, new Date(), { catalystSourceActive: catalystSourceActive() });
      const best = new Map<string, number>();
      for (const r of ev.rows) best.set(r.tokenId, Math.max(best.get(r.tokenId) ?? 0, r.score ?? r.coverage * 40));
      return { order: [...best.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id) };
    });
    const order = pre?.order ?? [];
    const toEnrich = order.filter((id) => id.startsWith('cg:') && !((db.get<{ d: string | null }>('SELECT detail_updated_at d FROM tokens WHERE id = ?', id)?.d ?? '') > isoMinus(ctx.asOf, 5))).slice(0, 25);
    await ctx.step('7. Projets : catégories, contrats, activité développeurs', false, () => enrichCoinDetails(db, toEnrich));
    const toCheck = order.filter((id) => {
      const t = db.get<any>('SELECT contract_address FROM tokens WHERE id = ?', id);
      if (!t?.contract_address) return false;
      const last = db.get<{ ts: string }>('SELECT MAX(ts) ts FROM security_checks WHERE token_id = ?', id)?.ts;
      return !last || last < isoMinus(ctx.asOf, 2);
    }).slice(0, 60);
    await ctx.step('8. Sécurité des contrats (honeypot, taxes, concentration)', false, () => securityChecks(db, toCheck));
    const cat = await ctx.step('9. Catalyseurs à venir', false, () => collectCatalysts(db));
    await ctx.step('10. Tokens disparus', false, () => ({ delisted: markDelisted(db) }));

    const rk = await ctx.step('11. Scores, scénarios et classements', true, () => computeAndStoreRankings(db, ctx.runId, new Date(), { catalystSourceActive: catalystSourceActive(), keepTop: 200 }));
    ctx.stats = { ...ctx.stats, rankings: rk?.summary, evaluated: rk?.evaluated, suspects: rk?.suspects, catalystsActive: cat?.active ?? false };

    const newTokenIds = db.all<{ id: string }>('SELECT id FROM tokens WHERE first_seen_at >= ?', since).map((r) => r.id);
    await ctx.step('12. Rapport du jour', true, () => buildDailyReport(db, ctx.runId, new Date(), {
      newTokenIds, removed: rk?.removed ?? [], insufficient: Math.max(0, ...Object.values(rk?.summary ?? {}).map((x: any) => x.insufficient ?? 0)), providerIssues: providerIssues(ctx.steps).concat(errorsOf(m).map((e: string) => `CoinGecko : ${e}`)), steps: ctx.steps,
    }));
    ctx.stats.newTokens = newTokenIds.length;

    await ctx.step('13. Notifications', false, async () => {
      const cands = evaluateRunRules(db, { runId: ctx.runId, entered: rk?.entered ?? [], newlyConfirmedCatalysts: cat?.newlyConfirmed ?? [] });
      const partial = ctx.steps.some((s) => !s.ok);
      systemEvent(db, partial ? 'Rapport du jour (données partielles)' : 'Rapport du jour disponible',
        `${newTokenIds.length} nouveaux projets · ${(rk?.removed ?? []).length} sorties de liste${partial ? ' · certaines sources en échec' : ''}`, 'daily_report');
      return dispatch(db, cands);
    });
  });
  if (outcome.status === 'failed') {
    systemEvent(db, '⚠︎ Analyse quotidienne en échec', `${outcome.error ?? 'Erreur inconnue'}. Les dernières données sont conservées avec leur date.`, 'run_failed');
    await dispatch(db, []).catch(() => undefined);
  }
  return outcome;
}

/** Rafraîchissement (plusieurs fois par jour) : prix, volumes, liquidités + re-classement + alertes de marché. */
export async function runRefresh(db: Db, trigger: Trigger = 'cron'): Promise<RunOutcome> {
  const cfg = loadConfig();
  const now = new Date();
  return runJob(db, 'refresh', `refresh:${now.toISOString().slice(0, 13)}`, trigger, async (ctx) => {
    // Hors analyse quotidienne, on limite CoinGecko à 2 pages pour économiser le quota mensuel.
    const m = await ctx.step('Marchés CoinGecko', false, () => collectCoinGeckoMarkets(db, Math.min(2, cfg.COINGECKO_MARKET_PAGES)));
    ctx.dataPoints += m?.count ?? 0;
    const ref = await ctx.step('DEX : volumes et liquidités', false, () => refreshDexTracked(db));
    ctx.dataPoints += ref?.count ?? 0;
    if (ctx.dataPoints === 0) return;
    const rk = await ctx.step('Re-classement', true, () => computeAndStoreRankings(db, ctx.runId, new Date(), { catalystSourceActive: catalystSourceActive(), keepTop: 60 }));
    ctx.stats = { rankings: rk?.summary };
    await ctx.step('Alertes', false, () => dispatch(db, [
      ...evaluateMarketRules(db),
      ...evaluateRunRules(db, { runId: ctx.runId, entered: rk?.entered ?? [], newlyConfirmedCatalysts: [] }),
    ]));
  });
}

/** Détection rapprochée : nouveaux pools / tokens et pics de volume (sans CoinGecko). */
export async function runDiscovery(db: Db, trigger: Trigger = 'cron'): Promise<RunOutcome> {
  const cfg = loadConfig();
  const now = new Date();
  return runJob(db, 'discovery', `discovery:${now.toISOString().slice(0, 16)}`, trigger, async (ctx) => {
    const d = await ctx.step('Nouveaux pools et profils', false, () => collectDexDiscovery(db, cfg.dexNetworks));
    ctx.dataPoints += (d?.dexCount ?? 0) + (d?.gtPools ?? 0);
    ctx.stats = { newTokens: d?.newIds.length ?? 0 };
    await ctx.step('Alertes volume / prix', false, () => dispatch(db, evaluateMarketRules(db)));
  });
}

/** Rattrapage : si l'analyse du jour n'a pas réussi et qu'il est passé 06 h, on la lance. */
export async function ensureDaily(db: Db, trigger: Trigger = 'catchup') {
  const cfg = loadConfig();
  const now = new Date();
  const key = `daily:${localDate(now, cfg.TZ_SCHEDULE)}`;
  const done = db.get(`SELECT id FROM job_runs WHERE run_key = ? AND status IN ('success','partial')`, key);
  if (done) return { ran: false, reason: 'Analyse du jour déjà réussie' };
  if (localHour(now, cfg.TZ_SCHEDULE) < 6) return { ran: false, reason: 'Avant 06 h (Paris)' };
  const out = await runDaily(db, trigger);
  return { ran: true, outcome: out };
}
