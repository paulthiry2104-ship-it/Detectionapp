import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildFeatures } from '../src/engine/features.ts';
import { buildScenarios } from '../src/engine/multipliers.ts';
import { DEFAULT_WEIGHTS, scoreToken } from '../src/engine/scoring.ts';
import { assessRisk } from '../src/engine/suspicion.ts';
import { horizonWindow, localDate, nextLocalTime } from '../src/engine/time.ts';
import { upsertToken } from '../src/store.ts';
import { setupEnv } from './helpers.ts';

const peers = (n: number, from = 3e6, to = 3e9) => Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `Peer ${i}`, cap: from * Math.pow(to / from, i / (n - 1)) }));

test('multiplicateur : exemple du cahier des charges (5 M$ → 100 M$ = x20)', () => {
  const ps = peers(20, 1e6, 1e8); // le 90e percentile est proche de 100 M$
  const r = buildScenarios({ marketCap: 5e6, fdv: null, liquidity: 1e6, circulating: null, total: null, category: 'ai-agents', categoryName: 'AI Agents', peers: ps, horizon: 'year', selfId: 'x' });
  assert.ok('basis' in r);
  const exc = r.scenarios.find((s) => s.kind === 'exceptionnel')!;
  assert.ok(exc.targetCap > 5e7 && exc.targetCap <= 1e8);
  assert.equal(Math.round(exc.multiplierHigh), Math.round(exc.targetCap / 5e6));
  assert.match(exc.method, /percentile/);
  assert.ok(exc.comparables.length === 3);
});

test('multiplicateur : fourchette basse = cible ÷ FDV (dilution)', () => {
  const r = buildScenarios({ marketCap: 10e6, fdv: 50e6, liquidity: 1e6, circulating: 1, total: 5, category: 'c', categoryName: 'C', peers: peers(30), horizon: 'month', selfId: 'x' });
  assert.ok('basis' in r);
  for (const s of r.scenarios) {
    assert.ok(s.multiplierLow < s.multiplierHigh);
    assert.ok(Math.abs(s.multiplierLow - s.targetCap / 50e6) < 1e-6 || s.multiplierLow === 1);
    assert.match(s.display, /–/);
  }
  assert.ok(r.warnings.some((w) => /dilution/.test(w)));
});

test('multiplicateur : aucun scénario sans comparables suffisants ou sans capitalisation', () => {
  const a = buildScenarios({ marketCap: 5e6, fdv: null, liquidity: null, circulating: null, total: null, category: 'c', categoryName: 'C', peers: peers(5), horizon: 'year', selfId: 'x' });
  assert.equal(a.scenarios.length, 0);
  assert.ok('reason' in a && /comparables/.test(a.reason));
  const b = buildScenarios({ marketCap: null, fdv: 1e7, liquidity: null, circulating: null, total: null, category: 'c', categoryName: 'C', peers: peers(30), horizon: 'year', selfId: 'x' });
  assert.equal(b.scenarios.length, 0);
  const c = buildScenarios({ marketCap: 5e9, fdv: null, liquidity: null, circulating: null, total: null, category: 'c', categoryName: 'C', peers: peers(30), horizon: 'year', selfId: 'x' });
  assert.equal(c.scenarios.length, 0, 'déjà au sommet de sa catégorie : pas de x100 fabriqué');
});

test('score : « Données insuffisantes » plutôt qu’un score fabriqué', () => {
  const { db } = setupEnv();
  const { id } = upsertToken(db, { symbol: 'NEW', name: 'New', chain: 'solana', contractAddress: 'Abc' }, 't');
  db.run(`INSERT INTO market_snapshots(token_id, ts, source, price_usd, volume_24h) VALUES(?,?,?,?,?)`, id, new Date().toISOString(), 'dexscreener', 1, 200000);
  const f = buildFeatures(db, id, new Date());
  const risk = { flags: [], risk: 0, suspect: false };
  const r = scoreToken(f, 'month', new Date(), { narrative: { value: null, detail: '' }, headroomMultiplier: null, catalystSourceActive: false }, DEFAULT_WEIGHTS, risk);
  assert.notEqual(r.status, 'ranked');
  assert.equal(r.score, null);
});

test('score : pénalité sur un token ayant déjà énormément monté', () => {
  const { db } = setupEnv();
  const mk = (sym: string, ch7: number) => {
    const { id } = upsertToken(db, { symbol: sym, name: sym, coingeckoId: sym.toLowerCase() }, 't');
    for (let d = 6; d >= 1; d--) db.run(`INSERT INTO market_snapshots(token_id, ts, source, price_usd, volume_24h, market_cap) VALUES(?,?,?,?,?,?)`, id, new Date(Date.now() - d * 864e5).toISOString(), 'coingecko', 1, 1e6, 2e7);
    db.run(`INSERT INTO market_snapshots(token_id, ts, source, price_usd, volume_24h, market_cap, change_7d, circulating_supply, total_supply) VALUES(?,?,?,?,?,?,?,?,?)`, id, new Date().toISOString(), 'coingecko', 1, 3e6, 2e7, ch7, 7, 10);
    return buildFeatures(db, id, new Date());
  };
  const ext = { narrative: { value: 0.7, detail: 'x' }, headroomMultiplier: 5, catalystSourceActive: false };
  const risk = { flags: [], risk: 0, suspect: false };
  const calm = scoreToken(mk('CALM', 10), 'year', new Date(), ext, DEFAULT_WEIGHTS, risk);
  const pumped = scoreToken(mk('PUMP', 400), 'year', new Date(), ext, DEFAULT_WEIGHTS, risk);
  assert.equal(calm.status, 'ranked');
  assert.ok((pumped.score as number) < (calm.score as number));
});

test('suspicion : honeypot, imitation, liquidité insuffisante', () => {
  const { db } = setupEnv();
  const { id } = upsertToken(db, { symbol: 'PEPE', name: 'Pepe', chain: 'solana', contractAddress: 'Fake1' }, 't');
  db.run(`INSERT INTO market_snapshots(token_id, ts, source, price_usd, volume_24h, liquidity_usd, buys_24h, sells_24h) VALUES(?,?,?,?,?,?,?,?)`, id, new Date().toISOString(), 'dexscreener', 1, 900000, 5000, 400, 300);
  db.run(`INSERT INTO security_checks(token_id, ts, provider, is_honeypot, flags) VALUES(?,?,?,?,?)`, id, new Date().toISOString(), 'rugcheck', 1, '[]');
  const r = assessRisk(buildFeatures(db, id, new Date()), new Map([['PEPE', 'cg:pepe']]));
  assert.equal(r.suspect, true);
  const codes = r.flags.map((f) => f.code);
  for (const c of ['honeypot', 'impersonation', 'low_liquidity', 'wash']) assert.ok(codes.includes(c), c);
});

test('point-in-time : les données postérieures à la date simulée sont ignorées', () => {
  const { db } = setupEnv();
  const { id } = upsertToken(db, { symbol: 'T', name: 'T', coingeckoId: 't' }, 't');
  const past = new Date(Date.now() - 5 * 864e5);
  db.run(`INSERT INTO market_snapshots(token_id, ts, source, price_usd) VALUES(?,?,?,?)`, id, new Date(past.getTime() - 3600e3).toISOString(), 'coingecko', 1);
  db.run(`INSERT INTO market_snapshots(token_id, ts, source, price_usd) VALUES(?,?,?,?)`, id, new Date().toISOString(), 'coingecko', 50);
  assert.equal(buildFeatures(db, id, past).price, 1);
  assert.equal(buildFeatures(db, id, new Date()).price, 50);
});

test('horizons : fenêtres calculées depuis la date actuelle', () => {
  const now = new Date('2026-10-22T18:00:00Z');
  assert.equal(horizonWindow('week', now).end, '2026-10-29T18:00:00.000Z');
  assert.equal(horizonWindow('month', now).end, '2026-11-21T18:00:00.000Z');
  assert.equal(horizonWindow('year', now).end, '2027-10-22T18:00:00.000Z');
});

test('planification : 06 h Paris, heure d’été et d’hiver', () => {
  // 22/10/2026 20:00 Paris (UTC+2) → prochaine exécution 23/10 06:00 Paris = 04:00 UTC
  assert.equal(nextLocalTime(6, 0, 'Europe/Paris', new Date('2026-10-22T18:00:00Z')).toISOString(), '2026-10-23T04:00:00.000Z');
  // Passage à l'heure d'hiver le 25/10/2026 → 06:00 Paris = 05:00 UTC le 26/10
  assert.equal(nextLocalTime(6, 0, 'Europe/Paris', new Date('2026-10-25T12:00:00Z')).toISOString(), '2026-10-26T05:00:00.000Z');
  assert.equal(localDate(new Date('2026-10-22T22:30:00Z')), '2026-10-23');
});

test('coupe-circuit : un fournisseur en panne ne bloque pas l’analyse', async () => {
  setupEnv();
  const { fetchJson } = await import('../src/providers/http.ts');
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return new Response('{}', { status: 503 }); }) as typeof fetch;
  for (let i = 0; i < 3; i++) await assert.rejects(fetchJson('dexscreener', `https://api.dexscreener.com/x${i}`));
  const before = calls;
  await assert.rejects(fetchJson('dexscreener', 'https://api.dexscreener.com/y'), /coupe-circuit/);
  assert.equal(calls, before, 'aucun appel réseau supplémentaire');
});

test('multiplicateur : pas de x100 « parce que c’est petit » (sous tous les comparables)', () => {
  const r = buildScenarios({ marketCap: 20_000, fdv: null, liquidity: 5_000, circulating: null, total: null, category: 'c', categoryName: 'C', peers: peers(30, 1e6, 1e9), horizon: 'year', selfId: 'x' });
  assert.equal(r.scenarios.length, 0);
  assert.ok('reason' in r && /inférieure à tous les comparables/.test(r.reason));
});
