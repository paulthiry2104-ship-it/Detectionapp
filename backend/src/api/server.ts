import cors from '@fastify/cors';
import Fastify, { type FastifyInstance } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { performance, replayAt } from '../backtest/evaluate.ts';
import type { Config } from '../config.ts';
import { type Db, j, nowIso, pj } from '../db/db.ts';
import { getWeights } from '../engine/ranking.ts';
import { COMPONENT_LABELS, DEFAULT_WEIGHTS } from '../engine/scoring.ts';
import { HORIZONS, type Horizon, isoMinus } from '../engine/time.ts';
import { catalystSourceActive } from '../jobs/collect.ts';
import { ensureDaily, runDaily, runDiscovery, runRefresh } from '../jobs/jobs.ts';
import { DEFAULT_NOTIFY, getNotifySettings } from '../notify/alerts.ts';
import { registerDevice } from '../notify/push.ts';
import * as dex from '../providers/dexscreener.ts';
import { ingest, setSetting, upsertCatalyst } from '../store.ts';
import { rankingsView, statusView, tokenCard, tokenDetail } from './views.ts';

const safeEq = (a: string, b: string) => {
  const x = Buffer.from(a); const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

export async function buildServer(db: Db, cfg: Config): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: cfg.LOG_LEVEL }, trustProxy: true });
  await app.register(cors, { origin: true });

  // Authentification : clé d'application (mobile) ou secret interne (tâches).
  app.addHook('onRequest', async (req, reply) => {
    const url = req.url.split('?')[0];
    if (url === '/health') return;
    if (url.startsWith('/internal/')) {
      const tok = String(req.headers['x-internal-secret'] ?? (req.headers.authorization ?? '').replace(/^Bearer /, ''));
      if (!safeEq(tok, cfg.INTERNAL_JOB_SECRET)) return reply.code(401).send({ error: 'Non autorisé' });
      return;
    }
    if (!safeEq(String(req.headers['x-app-key'] ?? ''), cfg.APP_API_KEY)) return reply.code(401).send({ error: 'Clé d’application invalide' });
  });

  app.get('/health', async () => {
    const st = statusView(db);
    return { ok: true, time: nowIso(), lastDailySuccess: st.jobs.daily.lastSuccess?.finished_at ?? null, warnings: st.warnings.length };
  });

  // ── Lecture ──
  app.get('/api/status', async () => statusView(db));

  app.get('/api/rankings', async (req) => {
    const q = z.object({
      horizon: z.enum(['week', 'month', 'year']).default('week'), chain: z.string().optional(), category: z.string().optional(),
      mcapMin: z.coerce.number().optional(), mcapMax: z.coerce.number().optional(), q: z.string().optional(), insufficient: z.coerce.boolean().optional(),
    }).parse(req.query);
    return { ...rankingsView(db, q.horizon, { ...q, includeInsufficient: q.insufficient }), status: statusView(db) };
  });

  app.get('/api/home', async () => {
    const st = statusView(db);
    return { status: st, lists: Object.fromEntries(HORIZONS.map((h) => [h, rankingsView(db, h, {})])) };
  });

  app.get<{ Params: { id: string } }>('/api/tokens/:id', async (req, reply) => {
    const d = tokenDetail(db, decodeURIComponent(req.params.id));
    if (!d) return reply.code(404).send({ error: 'Token inconnu' });
    return { ...d, favorite: !!db.get('SELECT 1 FROM favorites WHERE token_id = ?', decodeURIComponent(req.params.id)) };
  });

  app.get('/api/search', async (req) => {
    const { q, live } = z.object({ q: z.string().min(1), live: z.coerce.boolean().optional() }).parse(req.query);
    const like = `%${q.toLowerCase()}%`;
    const local = db.all<any>(
      `SELECT id, symbol, name, chain, logo_url, contract_address, status FROM tokens
       WHERE lower(symbol) LIKE ? OR lower(name) LIKE ? OR lower(contract_address) = ? ORDER BY (lower(symbol) = ?) DESC, last_seen_at DESC LIMIT 40`,
      like, like, q.toLowerCase(), q.toLowerCase(),
    );
    let remote = 0;
    if (live && local.length < 5) {
      try { remote = ingest(db, await dex.search(q), 'dexscreener:search').count; } catch { /* source indisponible */ }
      if (remote) return { items: db.all('SELECT id, symbol, name, chain, logo_url, contract_address, status FROM tokens WHERE lower(symbol) LIKE ? OR lower(name) LIKE ? LIMIT 40', like, like), remote };
    }
    return { items: local, remote };
  });

  app.get('/api/explore', async (req) => {
    const { sort, chain, limit } = z.object({ sort: z.enum(['new', 'volume', 'liquidity', 'gainers']).default('new'), chain: z.string().optional(), limit: z.coerce.number().max(200).default(60) }).parse(req.query);
    const order = { new: 't.first_seen_at DESC', volume: 's.volume_24h DESC', liquidity: 's.liquidity_usd DESC', gainers: 's.change_24h DESC' }[sort];
    const rows = db.all<any>(
      `SELECT t.id, t.symbol, t.name, t.chain, t.logo_url, t.status, t.first_seen_at, t.discovered_via, s.price_usd, s.market_cap, s.volume_24h, s.liquidity_usd, s.change_24h, s.ts
       FROM tokens t JOIN market_snapshots s ON s.id = (SELECT id FROM market_snapshots WHERE token_id = t.id ORDER BY ts DESC LIMIT 1)
       WHERE t.status = 'active' AND t.last_seen_at >= ? ${chain ? 'AND t.chain = ?' : ''} ORDER BY ${order} NULLS LAST LIMIT ?`,
      ...(chain ? [isoMinus(new Date(), 2), chain, limit] : [isoMinus(new Date(), 2), limit]),
    );
    return { items: rows };
  });

  app.get('/api/suspects', async () => ({
    note: 'Ces tokens présentent des signaux de risque. Ils ne sont JAMAIS présentés comme des opportunités.',
    items: db.all(`SELECT id, symbol, name, chain, logo_url, contract_address, status_reason, last_seen_at FROM tokens WHERE status = 'suspect' AND last_seen_at >= ? ORDER BY last_seen_at DESC LIMIT 100`, isoMinus(new Date(), 3)),
  }));

  app.get('/api/report', async (req, reply) => {
    const { date } = z.object({ date: z.string().optional() }).parse(req.query);
    const r = date
      ? db.get<any>('SELECT * FROM daily_reports WHERE report_date = ? ORDER BY run_id DESC LIMIT 1', date)
      : db.get<any>('SELECT * FROM daily_reports ORDER BY run_id DESC LIMIT 1');
    if (!r) return reply.code(404).send({ error: 'Aucun rapport disponible', status: statusView(db) });
    const run = db.get<any>('SELECT id, status, started_at, finished_at, steps FROM job_runs WHERE id = ?', r.run_id);
    return { ...pj(r.data, {}), run: { ...run, steps: pj(run?.steps, []) }, status: statusView(db) };
  });
  app.get('/api/reports', async () => ({ items: db.all('SELECT d.report_date, d.run_id, jr.status FROM daily_reports d JOIN job_runs jr ON jr.id = d.run_id ORDER BY d.run_id DESC LIMIT 90') }));

  app.get('/api/history/runs', async () => ({
    items: db.all<any>(`SELECT id, job, run_key, trigger, status, started_at, finished_at, error, stats FROM job_runs WHERE job != 'discovery' ORDER BY id DESC LIMIT 100`).map((r) => ({ ...r, stats: pj(r.stats, {}) })),
  }));
  app.get('/api/history/rankings', async (req) => {
    const { runId, horizon } = z.object({ runId: z.coerce.number().optional(), horizon: z.enum(['week', 'month', 'year']).default('week') }).parse(req.query);
    const id = runId ?? db.get<any>(`SELECT MAX(run_id) id FROM rankings r JOIN job_runs jr ON jr.id = r.run_id WHERE jr.job = 'daily'`)?.id;
    if (!id) return { items: [] };
    return { runId: id, items: db.all<any>('SELECT * FROM rankings WHERE run_id = ? AND horizon = ? AND rank IS NOT NULL ORDER BY rank LIMIT 50', id, horizon).map((r) => tokenCard(db, r)) };
  });
  app.get('/api/tokens/:id/rank-history', async (req) => {
    const id = decodeURIComponent((req.params as any).id);
    return { items: db.all(`SELECT r.ts, r.horizon, r.rank, r.score, r.confidence, r.price_usd, r.market_cap, r.status FROM rankings r JOIN job_runs jr ON jr.id = r.run_id WHERE r.token_id = ? AND jr.job = 'daily' ORDER BY r.ts`, id) };
  });

  app.get('/api/performance', async () => ({
    method: 'Chaque classement quotidien enregistré est comparé au prix observé à la fin de son horizon. Les tokens disparus sont inclus (dernier prix connu). Référence : Bitcoin sur la même période.',
    horizons: Object.fromEntries(HORIZONS.map((h) => [h, performance(db, h)])),
  }));

  app.get('/api/methodology', async () => ({
    weights: getWeights(db),
    defaults: DEFAULT_WEIGHTS,
    components: COMPONENT_LABELS,
    catalystSourceActive: catalystSourceActive(),
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
      'Pas de données de réseaux sociaux (les API X/Twitter sont payantes) : critère « communauté » limité aux détenteurs on-chain.',
      'Calendriers de déblocage (unlocks) non intégrés : la borne basse des multiplicateurs utilise la FDV pour couvrir la dilution totale.',
      'Les « boosts » DexScreener sont des promotions payantes : utilisés pour découvrir, jamais comme signal positif.',
      'Les pondérations par défaut sont des choix de conception à valider avec la page Performances.',
    ],
  }));

  // ── Favoris ──
  app.get('/api/favorites', async () => ({
    items: db.all<any>('SELECT token_id FROM favorites ORDER BY created_at DESC').map((f) => {
      const t = db.get<any>('SELECT id, symbol, name, chain, logo_url, status FROM tokens WHERE id = ?', f.token_id);
      const s = db.get<any>('SELECT price_usd, market_cap, change_24h, volume_24h, ts FROM market_snapshots WHERE token_id = ? ORDER BY ts DESC LIMIT 1', f.token_id);
      return { ...t, ...s };
    }),
  }));
  app.put<{ Params: { id: string } }>('/api/favorites/:id', async (req, reply) => {
    const id = decodeURIComponent(req.params.id);
    if (!db.get('SELECT 1 FROM tokens WHERE id = ?', id)) return reply.code(404).send({ error: 'Token inconnu' });
    db.run('INSERT OR IGNORE INTO favorites(token_id, created_at) VALUES(?,?)', id, nowIso());
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/favorites/:id', async (req) => {
    db.run('DELETE FROM favorites WHERE token_id = ?', decodeURIComponent(req.params.id));
    return { ok: true };
  });

  // ── Alertes ──
  const ruleSchema = z.object({
    tokenId: z.string().nullable().optional(),
    type: z.enum(['price_above', 'price_below', 'volume_spike', 'catalyst_confirmed', 'entered_list']),
    params: z.record(z.any()).default({}),
    cooldownMinutes: z.number().int().min(5).max(10080).default(180),
    enabled: z.boolean().default(true),
  });
  app.get('/api/alerts/rules', async () => ({ items: db.all<any>('SELECT r.*, t.symbol FROM alert_rules r LEFT JOIN tokens t ON t.id = r.token_id ORDER BY r.id DESC').map((r) => ({ ...r, params: pj(r.params, {}) })) }));
  app.post('/api/alerts/rules', async (req, reply) => {
    const b = ruleSchema.parse(req.body);
    if ((b.type === 'price_above' || b.type === 'price_below') && !(Number(b.params.price) > 0)) return reply.code(400).send({ error: 'Prix cible requis' });
    if (['price_above', 'price_below', 'volume_spike'].includes(b.type) && !b.tokenId) return reply.code(400).send({ error: 'Token requis' });
    const r = db.run('INSERT INTO alert_rules(token_id,type,params,enabled,cooldown_minutes,created_at) VALUES(?,?,?,?,?,?)', b.tokenId ?? null, b.type, j(b.params), b.enabled ? 1 : 0, b.cooldownMinutes, nowIso());
    return { id: Number(r.lastInsertRowid) };
  });
  app.patch<{ Params: { id: string } }>('/api/alerts/rules/:id', async (req) => {
    const b = ruleSchema.partial().parse(req.body);
    if (b.enabled !== undefined) db.run('UPDATE alert_rules SET enabled = ? WHERE id = ?', b.enabled ? 1 : 0, Number(req.params.id));
    if (b.params) db.run('UPDATE alert_rules SET params = ? WHERE id = ?', j(b.params), Number(req.params.id));
    if (b.cooldownMinutes) db.run('UPDATE alert_rules SET cooldown_minutes = ? WHERE id = ?', b.cooldownMinutes, Number(req.params.id));
    return { ok: true };
  });
  app.delete<{ Params: { id: string } }>('/api/alerts/rules/:id', async (req) => { db.run('DELETE FROM alert_rules WHERE id = ?', Number(req.params.id)); return { ok: true }; });
  app.get('/api/alerts/events', async () => ({ items: db.all<any>('SELECT * FROM alert_events ORDER BY id DESC LIMIT 200').map((e) => ({ ...e, data: pj(e.data, {}) })) }));
  app.post('/api/alerts/events/read', async () => { db.run('UPDATE alert_events SET read = 1 WHERE read = 0'); return { ok: true }; });

  app.post('/api/devices', async (req) => {
    const b = z.object({ expoToken: z.string().regex(/^(Exponent|Expo)PushToken\[.+\]$/), platform: z.string().optional() }).parse(req.body);
    registerDevice(db, b.expoToken, b.platform ?? null);
    return { ok: true };
  });

  // ── Paramètres ──
  app.get('/api/settings', async () => ({ weights: getWeights(db), notify: getNotifySettings(db), defaults: { weights: DEFAULT_WEIGHTS, notify: DEFAULT_NOTIFY } }));
  app.put('/api/settings/notify', async (req) => {
    const b = z.object({
      mode: z.enum(['instant', 'digest', 'daily_only']).optional(), digestMinutes: z.number().int().min(15).max(1440).optional(),
      quietStart: z.number().int().min(0).max(23).optional(), quietEnd: z.number().int().min(0).max(23).optional(), volumeSpikeDefault: z.number().min(1.5).max(50).optional(),
    }).parse(req.body);
    setSetting(db, 'notify', { ...getNotifySettings(db), ...b });
    return getNotifySettings(db);
  });
  app.put('/api/settings/weights', async (req) => {
    const comp = z.record(z.number().min(0).max(1));
    const b = z.object({ week: comp.optional(), month: comp.optional(), year: comp.optional(), manipulationPenalty: z.number().min(0).max(1).optional(), overextensionPenalty: z.number().min(0).max(1).optional(), minCoverage: z.number().min(0.2).max(1).optional(), maxMarketCap: z.number().positive().optional(), reset: z.boolean().optional() }).parse(req.body);
    if (b.reset) { db.run(`DELETE FROM settings WHERE key = 'weights'`); return getWeights(db); }
    const cur = getWeights(db);
    const next = { ...cur, ...b, week: { ...cur.week, ...(b.week ?? {}) }, month: { ...cur.month, ...(b.month ?? {}) }, year: { ...cur.year, ...(b.year ?? {}) }, version: `custom-${Date.now()}` };
    delete (next as any).reset;
    setSetting(db, 'weights', next);
    return next;
  });

  // Catalyseur ajouté à la main : une source consultable est OBLIGATOIRE.
  app.post('/api/catalysts', async (req, reply) => {
    const b = z.object({ tokenId: z.string(), title: z.string().min(3), eventDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), status: z.enum(['confirmed', 'rumor']), sourceUrl: z.string().url(), sourceName: z.string().min(2), kind: z.string().optional() }).parse(req.body);
    if (!db.get('SELECT 1 FROM tokens WHERE id = ?', b.tokenId)) return reply.code(404).send({ error: 'Token inconnu' });
    const id = `manual:${b.tokenId}:${b.eventDate}:${b.title.slice(0, 40)}`;
    upsertCatalyst(db, b.tokenId, { id, title: b.title, kind: b.kind ?? null, eventDate: b.eventDate, datePrecision: 'day', status: b.status, sourceName: b.sourceName, sourceUrl: b.sourceUrl });
    return { id };
  });

  // ── Interne (planificateur externe / déclenchement manuel) ──
  const running = new Set<string>();
  app.post<{ Params: { job: string } }>('/internal/jobs/:job/run', async (req, reply) => {
    const job = req.params.job;
    const fn = { daily: runDaily, refresh: runRefresh, discovery: runDiscovery }[job as 'daily'];
    if (!fn) return reply.code(404).send({ error: 'Tâche inconnue' });
    const wait = (req.query as any)?.wait === '1';
    if (wait) return fn(db, 'manual');
    if (running.has(job)) return reply.code(409).send({ error: 'Déjà en cours' });
    running.add(job);
    fn(db, 'manual').finally(() => running.delete(job));
    return reply.code(202).send({ accepted: true, job });
  });
  app.post('/internal/jobs/daily/ensure', async () => ensureDaily(db, 'catchup'));
  app.get('/internal/replay', async (req) => {
    const { asOf } = z.object({ asOf: z.string() }).parse(req.query);
    return replayAt(db, new Date(asOf), catalystSourceActive());
  });

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'Requête invalide', details: err.issues });
    app.log.error(err);
    return reply.code(err.statusCode ?? 500).send({ error: err.message ?? 'Erreur serveur' });
  });

  return app;
}

export type { Horizon };
