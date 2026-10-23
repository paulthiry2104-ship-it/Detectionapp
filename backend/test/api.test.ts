import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildServer } from '../src/api/server.ts';
import { installMockFetch, setupEnv } from './helpers.ts';

test('API : authentification, statut, classements, fiche, rapport, favoris, alertes', async () => {
  const { db, cfg } = setupEnv();
  installMockFetch();
  const app = await buildServer(db, cfg);
  const H = { 'x-app-key': cfg.APP_API_KEY };

  assert.equal((await app.inject({ url: '/api/rankings' })).statusCode, 401);
  assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  assert.equal((await app.inject({ method: 'POST', url: '/internal/jobs/daily/run' })).statusCode, 401);

  // Avant toute analyse : pas de liste inventée, avertissement explicite.
  const empty = (await app.inject({ url: '/api/home', headers: H })).json();
  assert.equal(empty.lists.week.items.length, 0);
  assert.ok(empty.status.warnings.some((w: string) => /Aucune analyse/.test(w)));
  assert.equal((await app.inject({ url: '/api/report', headers: H })).statusCode, 404);

  const run = await app.inject({ method: 'POST', url: '/internal/jobs/daily/run?wait=1', headers: { 'x-internal-secret': cfg.INTERNAL_JOB_SECRET } });
  assert.equal(run.statusCode, 200);
  assert.notEqual(run.json().status, 'failed');

  const home = (await app.inject({ url: '/api/home', headers: H })).json();
  assert.ok(home.status.scheduler.nextDaily);
  assert.ok(home.lists.year.items.length > 0);
  const card = home.lists.year.items[0];
  for (const k of ['rank', 'symbol', 'chain', 'price', 'marketCap', 'score', 'confidence', 'updatedAt']) assert.ok(k in card, k);

  const detail = (await app.inject({ url: `/api/tokens/${encodeURIComponent(card.id)}`, headers: H })).json();
  assert.ok(detail.sources.length > 0);
  assert.ok(detail.missing.length > 0);
  assert.ok(detail.horizons.year.components.length === 8);

  const rep = (await app.inject({ url: '/api/report', headers: H })).json();
  assert.ok(rep.run.steps.length === 13);

  assert.equal((await app.inject({ method: 'PUT', url: `/api/favorites/${encodeURIComponent(card.id)}`, headers: H })).statusCode, 200);
  assert.equal((await app.inject({ url: '/api/favorites', headers: H })).json().items.length, 1);
  const rule = await app.inject({ method: 'POST', url: '/api/alerts/rules', headers: H, payload: { tokenId: card.id, type: 'price_above', params: { price: 0.0000001 } } });
  assert.equal(rule.statusCode, 200);
  const bad = await app.inject({ method: 'POST', url: '/api/alerts/rules', headers: H, payload: { type: 'price_above', params: {} } });
  assert.equal(bad.statusCode, 400);
  const cat = await app.inject({ method: 'POST', url: '/api/catalysts', headers: H, payload: { tokenId: card.id, title: 'Mainnet', eventDate: '2026-11-01', status: 'confirmed', sourceName: 'Blog officiel' } });
  assert.equal(cat.statusCode, 400, 'source obligatoire');

  const perf = (await app.inject({ url: '/api/performance', headers: H })).json();
  assert.ok(perf.horizons.week.note);
  await app.close();
});
