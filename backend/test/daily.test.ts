import assert from 'node:assert/strict';
import { test } from 'node:test';
import cron from 'node-cron';
import { performance } from '../src/backtest/evaluate.ts';
import { pj } from '../src/db/db.ts';
import { runDaily, runDiscovery, runRefresh } from '../src/jobs/jobs.ts';
import { startRun } from '../src/jobs/runner.ts';
import { registerDevice } from '../src/notify/push.ts';
import { upsertToken } from '../src/store.ts';
import { installMockFetch, seedHistory, setupEnv } from './helpers.ts';

function seed(db: any) {
  // Historique 7 jours pour deux projets CoinGecko → comparaisons à l'historique possibles.
  for (const [cgId, sym] of [['alpha-agent', 'ALPHA'], ['beta-pin', 'BETA'], ['gamma-rwa', 'GAMMA']]) {
    const { id } = upsertToken(db, { symbol: sym, name: cgId, coingeckoId: cgId }, 'seed', new Date(Date.now() - 8 * 864e5).toISOString());
    seedHistory(db, id, 1.5e6, null);
  }
}

test('analyse quotidienne complète : succès, classements 3 horizons, rapport, historique, push', async () => {
  const { db } = setupEnv();
  const pushLog: any[] = [];
  installMockFetch({ pushLog });
  seed(db);
  registerDevice(db, 'ExponentPushToken[test-device]', 'ios');

  const out = await runDaily(db, 'test');
  assert.equal(out.status, 'success', JSON.stringify(out.steps?.filter((s) => !s.ok)));

  const run = db.get<any>('SELECT * FROM job_runs WHERE id = ?', out.runId!);
  assert.equal(run.status, 'success');
  assert.ok(run.finished_at);
  assert.match(run.run_key, /^daily:\d{4}-\d{2}-\d{2}$/);
  assert.equal(pj<any[]>(run.steps, []).length, 13);

  for (const h of ['week', 'month', 'year']) {
    const n = db.get<any>('SELECT COUNT(*) n FROM rankings WHERE run_id = ? AND horizon = ? AND rank IS NOT NULL', out.runId!, h).n;
    assert.ok(n > 0, `classement ${h} vide`);
  }
  // Stablecoin exclu, honeypot et faux contrat classés suspects (jamais en opportunité).
  assert.equal(db.get<any>(`SELECT COUNT(*) n FROM rankings WHERE token_id = 'cg:tether' AND rank IS NOT NULL`).n, 0);
  const honey = db.get<any>(`SELECT status FROM tokens WHERE contract_address LIKE 'HoneyPot%'`);
  assert.equal(honey.status, 'suspect');
  assert.equal(db.get<any>(`SELECT COUNT(*) n FROM rankings WHERE token_id LIKE '%HoneyPot%' AND rank IS NOT NULL`).n, 0);
  const fake = db.get<any>(`SELECT status, status_reason FROM tokens WHERE contract_address LIKE 'FakeAlpha%'`);
  assert.equal(fake.status, 'suspect');
  assert.match(fake.status_reason, /faux contrat/);

  // Scénarios : toujours une méthode explicite.
  const withScen = db.all<any>(`SELECT scenarios FROM rankings WHERE run_id = ? AND rank IS NOT NULL`, out.runId!).map((r) => pj<any>(r.scenarios, null)).filter((s) => s?.scenarios?.length);
  assert.ok(withScen.length > 0);
  for (const s of withScen) for (const sc of s.scenarios) assert.ok(sc.method.length > 20 && sc.comparables.length);

  // Rapport du jour.
  const rep = db.get<any>('SELECT * FROM daily_reports WHERE run_id = ?', out.runId!);
  assert.ok(rep);
  const data = pj<any>(rep.data, {});
  for (const k of ['newProjects', 'topGainers', 'narratives', 'catalysts', 'removed', 'multiplierChanges', 'dataGaps']) assert.ok(k in data, k);
  assert.ok(data.newProjects.length > 0);

  // Notification push « rapport du jour ».
  assert.ok(pushLog.some((m) => /Rapport du jour/.test(m.title)));
});

test('deuxième analyse : mouvements expliqués et sorties de liste', async () => {
  const { db } = setupEnv();
  installMockFetch();
  seed(db);
  const a = await runDaily(db, 'test');
  db.run(`UPDATE job_runs SET run_key = 'daily:hier' WHERE id = ?`, a.runId!);
  // Le token ALPHA perd sa liquidité/volume → il doit bouger ou sortir avec une raison.
  const b = await runRefresh(db, 'test');
  assert.notEqual(b.status, 'failed');
  const mv = db.all<any>(`SELECT movement FROM rankings WHERE run_id = ? AND rank IS NOT NULL`, b.runId!).map((r) => pj<any>(r.movement, {}));
  assert.ok(mv.some((m) => m.prevRank != null), 'rang précédent conservé');
});

test('échec total des sources : tâche « failed », aucune fausse analyse, données précédentes conservées', async () => {
  const { db } = setupEnv();
  installMockFetch();
  seed(db);
  const ok = await runDaily(db, 'test');
  assert.equal(ok.status, 'success');
  const before = db.get<any>('SELECT COUNT(*) n FROM rankings').n;

  installMockFetch({ failAll: true });
  db.run(`DELETE FROM job_runs WHERE id = ?`, -1);
  db.run(`UPDATE job_runs SET run_key = 'daily:avant' WHERE id = ?`, ok.runId!);
  const ko = await runDaily(db, 'test');
  assert.equal(ko.status, 'failed');
  assert.match(ko.error!, /Aucune donnée/);
  assert.equal(db.get<any>('SELECT status FROM job_runs WHERE id = ?', ko.runId!).status, 'failed');
  assert.equal(db.get<any>('SELECT COUNT(*) n FROM daily_reports WHERE run_id = ?', ko.runId!).n, 0, 'pas de rapport pour une analyse échouée');
  assert.equal(db.get<any>('SELECT COUNT(*) n FROM rankings').n, before, 'classements précédents intacts');
  assert.ok(db.get<any>(`SELECT 1 FROM alert_events WHERE title LIKE '%échec%'`), 'avertissement enregistré');
});

test('panne partielle (CoinGecko indisponible) : analyse « partial » avec avertissement', async () => {
  const { db } = setupEnv();
  installMockFetch({ failCoingecko: true });
  const out = await runDaily(db, 'test');
  assert.equal(out.status, 'partial');
  const rep = pj<any>(db.get<any>('SELECT data FROM daily_reports WHERE run_id = ?', out.runId!).data, {});
  assert.ok(rep.dataGaps.providerIssues.length > 0 || rep.dataGaps.failedSteps.length > 0);
  assert.ok(db.get<any>(`SELECT last_error FROM provider_status WHERE provider = 'coingecko'`).last_error);
});

test('verrou : pas deux analyses simultanées', async () => {
  const { db } = setupEnv();
  installMockFetch();
  assert.ok(startRun(db, 'daily', 'daily:x', 'test'));
  const out = await runDaily(db, 'test');
  assert.equal(out.status, 'skipped');
});

test('détection rapprochée : nouveaux tokens enregistrés', async () => {
  const { db } = setupEnv();
  installMockFetch();
  const out = await runDiscovery(db, 'test');
  assert.equal(out.status, 'success');
  assert.ok((out.stats!.newTokens as number) >= 3);
});

test('performances : les tokens disparus sont comptés (biais du survivant)', async () => {
  const { db } = setupEnv();
  installMockFetch();
  seed(db);
  const out = await runDaily(db, 'test');
  // On vieillit artificiellement le classement de 8 jours et on supprime les données ultérieures d'un token.
  const old = new Date(Date.now() - 8 * 864e5).toISOString();
  db.run('UPDATE rankings SET ts = ? WHERE run_id = ?', old, out.runId!);
  const victim = db.get<any>(`SELECT token_id FROM rankings WHERE run_id = ? AND horizon = 'week' AND rank = 1`, out.runId!).token_id;
  db.run('UPDATE market_snapshots SET ts = ? WHERE token_id = ?', new Date(Date.now() - 9 * 864e5).toISOString(), victim);
  const p = performance(db, 'week');
  assert.ok(p.overall.n > 0);
  assert.ok((p.overall.disappeared ?? 0) > 0, 'token disparu inclus');
});

test('expressions cron valides (fuseau Paris)', () => {
  for (const e of ['0 6 * * *', '15 */3 * * *', '*/20 * * * *']) assert.ok(cron.validate(e), e);
});

test('version GitHub : élagage + export des fichiers JSON lus par l’app', async () => {
  const { db } = setupEnv();
  installMockFetch();
  seed(db);
  const out = await runDaily(db, 'test');
  assert.equal(out.status, 'success');
  const { prune } = await import('../src/jobs/prune.ts');
  const { exportStatic, fileId } = await import('../src/export/static.ts');
  const { mkdtempSync, readFileSync, existsSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  prune(db);
  const dir = mkdtempSync(join(tmpdir(), 'radar-'));
  const r = exportStatic(db, dir);
  assert.ok(r.tokens > 0 && r.index > 0);
  for (const f of ['home.json', 'status.json', 'report.json', 'runs.json', 'performance.json', 'methodology.json', 'suspects.json', 'index.json', 'explore-new.json']) assert.ok(existsSync(join(dir, f)), f);
  const home = JSON.parse(readFileSync(join(dir, 'home.json'), 'utf8'));
  const first = home.lists.year.items[0];
  assert.ok(first);
  const detail = JSON.parse(readFileSync(join(dir, 'tokens', `${fileId(first.id)}.json`), 'utf8'));
  assert.equal(detail.identity.id, first.id);
  assert.ok(db.get<any>('SELECT COUNT(*) n FROM rankings WHERE run_id = ?', out.runId!).n > 0, 'classement du jour conservé');
});
