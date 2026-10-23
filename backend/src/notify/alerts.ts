import { type Db, j, nowIso, pj } from '../db/db.ts';
import { buildFeatures } from '../engine/features.ts';
import { HORIZON_LABEL, localHour } from '../engine/time.ts';
import { getSetting } from '../store.ts';
import { type PushMsg, sendPush } from './push.ts';

export type NotifySettings = {
  mode: 'instant' | 'digest' | 'daily_only';  // instantané | résumé groupé | uniquement le rapport du jour
  digestMinutes: number;
  quietStart: number;                          // heure de Paris (0-23)
  quietEnd: number;
  volumeSpikeDefault: number;                  // multiple du volume moyen
  onListEntryFavoritesOnly: boolean;
};
export const DEFAULT_NOTIFY: NotifySettings = { mode: 'instant', digestMinutes: 60, quietStart: 23, quietEnd: 7, volumeSpikeDefault: 3, onListEntryFavoritesOnly: false };

export const getNotifySettings = (db: Db) => ({ ...DEFAULT_NOTIFY, ...getSetting<Partial<NotifySettings>>(db, 'notify', {}) });

type Candidate = { ruleId: number | null; tokenId: string | null; title: string; body: string; data: Record<string, unknown>; urgent?: boolean };

/**
 * Contrôle de plausibilité : on ignore un prix si une variation extrême n'est pas confirmée
 * par une seconde source ou par l'observation précédente.
 */
export function plausiblePrice(db: Db, tokenId: string): { ok: boolean; price: number | null; why?: string } {
  const snaps = db.all<{ price_usd: number; source: string; ts: string }>(
    'SELECT price_usd, source, ts FROM market_snapshots WHERE token_id = ? AND price_usd > 0 ORDER BY ts DESC LIMIT 6', tokenId,
  );
  if (!snaps.length) return { ok: false, price: null, why: 'aucun prix' };
  const [cur, ...rest] = snaps;
  const other = rest.find((s) => s.source !== cur.source && Math.abs(new Date(cur.ts).getTime() - new Date(s.ts).getTime()) < 3 * 3600_000);
  if (other && Math.abs(cur.price_usd / other.price_usd - 1) > 0.25) return { ok: false, price: cur.price_usd, why: `écart de ${Math.round(Math.abs(cur.price_usd / other.price_usd - 1) * 100)} % entre ${cur.source} et ${other.source}` };
  const prev = rest.find((s) => s.source === cur.source);
  if (prev) {
    const r = cur.price_usd / prev.price_usd;
    if ((r > 20 || r < 0.02) && !other) return { ok: false, price: cur.price_usd, why: `variation ×${r.toFixed(2)} non confirmée` };
  }
  return { ok: true, price: cur.price_usd };
}

function cooldownOk(rule: any, now: Date) {
  if (!rule.last_fired_at) return true;
  return now.getTime() - new Date(rule.last_fired_at).getTime() >= (rule.cooldown_minutes ?? 180) * 60_000;
}

/** Règles de prix et de volume (après chaque rafraîchissement). */
export function evaluateMarketRules(db: Db, now = new Date()): Candidate[] {
  const out: Candidate[] = [];
  const rules = db.all<any>(`SELECT r.*, t.symbol FROM alert_rules r LEFT JOIN tokens t ON t.id = r.token_id WHERE r.enabled = 1 AND r.type IN ('price_above','price_below','volume_spike')`);
  const settings = getNotifySettings(db);
  for (const r of rules) {
    if (!r.token_id || !cooldownOk(r, now)) continue;
    const p = pj<any>(r.params, {});
    if (r.type === 'price_above' || r.type === 'price_below') {
      const chk = plausiblePrice(db, r.token_id);
      if (!chk.ok || chk.price == null) continue;
      const hit = r.type === 'price_above' ? chk.price >= p.price : chk.price <= p.price;
      if (hit) out.push({ ruleId: r.id, tokenId: r.token_id, title: `${r.symbol} ${r.type === 'price_above' ? '≥' : '≤'} ${p.price} $`, body: `Prix actuel : ${fmtPrice(chk.price)}`, data: { tokenId: r.token_id, type: r.type } });
    } else {
      const f = buildFeatures(db, r.token_id, now);
      const mult = p.multiple ?? settings.volumeSpikeDefault;
      const ratio = f.volume24h && f.avgPrevVolume7d ? f.volume24h / f.avgPrevVolume7d : f.intradayVolumeRatio;
      // Filtres anti-aberration : volume minimum, liquidité minimale, prix cohérent.
      if (ratio == null || ratio < mult || (f.volume24h ?? 0) < 50_000) continue;
      if (f.liquidity != null && f.liquidity < 20_000) continue;
      if (!plausiblePrice(db, r.token_id).ok) continue;
      out.push({ ruleId: r.id, tokenId: r.token_id, title: `${r.symbol} : volume ×${ratio.toFixed(1)}`, body: `Volume 24 h : ${fmtUsd(f.volume24h ?? 0)} (moyenne précédente ${f.avgPrevVolume7d ? fmtUsd(f.avgPrevVolume7d) : 'rythme intrajournalier'})`, data: { tokenId: r.token_id, type: 'volume_spike' } });
    }
  }
  return out;
}

/** Règles liées à une analyse : entrée dans une liste, catalyseur confirmé. */
export function evaluateRunRules(db: Db, run: { runId: number; entered: { tokenId: string; horizon: string; rank: number }[]; newlyConfirmedCatalysts: string[] }): Candidate[] {
  const out: Candidate[] = [];
  const favs = new Set(db.all<{ token_id: string }>('SELECT token_id FROM favorites').map((r) => r.token_id));
  const listRules = db.all<any>(`SELECT * FROM alert_rules WHERE enabled = 1 AND type = 'entered_list'`);
  for (const rule of listRules) {
    const p = pj<any>(rule.params, {});
    for (const e of run.entered) {
      if (rule.token_id && rule.token_id !== e.tokenId) continue;
      if (!rule.token_id && p.favoritesOnly && !favs.has(e.tokenId)) continue;
      if (p.horizon && p.horizon !== e.horizon) continue;
      if (p.maxRank && e.rank > p.maxRank) continue;
      const t = db.get<any>('SELECT symbol FROM tokens WHERE id = ?', e.tokenId);
      out.push({ ruleId: rule.id, tokenId: e.tokenId, title: `${t?.symbol} entre dans « ${HORIZON_LABEL[e.horizon as 'week']} »`, body: `Rang ${e.rank}`, data: { tokenId: e.tokenId, horizon: e.horizon, type: 'entered_list' } });
    }
  }
  const catRules = db.all<any>(`SELECT * FROM alert_rules WHERE enabled = 1 AND type = 'catalyst_confirmed'`);
  for (const cid of run.newlyConfirmedCatalysts) {
    const c = db.get<any>('SELECT c.*, t.symbol FROM catalysts c JOIN tokens t ON t.id = c.token_id WHERE c.id = ?', cid);
    if (!c) continue;
    for (const rule of catRules) {
      if (rule.token_id && rule.token_id !== c.token_id) continue;
      if (!rule.token_id && !favs.has(c.token_id)) continue;
      out.push({ ruleId: rule.id, tokenId: c.token_id, title: `${c.symbol} : catalyseur confirmé`, body: `${c.title} — ${c.event_date ?? 'date à préciser'} (${c.source_name})`, data: { tokenId: c.token_id, type: 'catalyst_confirmed', source: c.source_url } });
    }
  }
  return out;
}

/** Enregistre les événements et envoie les notifications selon les préférences de fréquence. */
export async function dispatch(db: Db, candidates: Candidate[], now = new Date()) {
  const settings = getNotifySettings(db);
  const ids: number[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const k = `${c.ruleId}:${c.tokenId}:${c.title}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const r = db.run('INSERT INTO alert_events(rule_id, token_id, ts, title, body, data) VALUES(?,?,?,?,?,?)', c.ruleId, c.tokenId, nowIso(), c.title, c.body, j(c.data));
    ids.push(Number(r.lastInsertRowid));
    if (c.ruleId) db.run('UPDATE alert_rules SET last_fired_at = ? WHERE id = ?', nowIso(), c.ruleId);
  }
  return flushPending(db, settings, now, ids.length);
}

/** Envoie les événements non encore poussés (instantané, résumé groupé, heures calmes). */
export async function flushPending(db: Db, settings = getNotifySettings(db), now = new Date(), _fresh = 0) {
  const h = localHour(now);
  const quiet = settings.quietStart > settings.quietEnd ? h >= settings.quietStart || h < settings.quietEnd : h >= settings.quietStart && h < settings.quietEnd;
  const pending = db.all<any>('SELECT * FROM alert_events WHERE pushed = 0 ORDER BY ts LIMIT 50');
  if (!pending.length || quiet) return { pushed: 0, pending: pending.length, quiet };
  const urgentTypes = new Set(['run_failed', 'daily_report']);
  let toSend = pending;
  if (settings.mode === 'daily_only') toSend = pending.filter((e) => urgentTypes.has(pj<any>(e.data, {}).type));
  if (!toSend.length) return { pushed: 0, pending: pending.length, quiet };
  let msgs: PushMsg[];
  if (settings.mode === 'digest' && toSend.length > 1) {
    const last = db.get<{ ts: string }>('SELECT MAX(ts) AS ts FROM alert_events WHERE pushed = 1');
    if (last?.ts && now.getTime() - new Date(last.ts).getTime() < settings.digestMinutes * 60_000) return { pushed: 0, pending: pending.length, quiet };
    msgs = [{ title: `Crypto Radar : ${toSend.length} alertes`, body: toSend.slice(0, 4).map((e) => e.title).join(' · '), data: { type: 'digest' } }];
  } else {
    msgs = toSend.map((e) => ({ title: e.title, body: e.body, data: { ...pj(e.data, {}), eventId: e.id } }));
  }
  const res = await sendPush(db, msgs);
  const err = res.errors.length ? res.errors.slice(0, 3).join(' | ') : null;
  for (const e of toSend) db.run('UPDATE alert_events SET pushed = ?, push_error = ? WHERE id = ?', res.sent > 0 ? 1 : 0, err, e.id);
  if (res.sent === 0) for (const e of toSend) db.run('UPDATE alert_events SET pushed = 2 WHERE id = ?', e.id); // 2 = enregistré sans envoi possible
  return { pushed: res.sent, pending: pending.length, quiet, errors: res.errors };
}

export function systemEvent(db: Db, title: string, body: string, type: string) {
  db.run('INSERT INTO alert_events(rule_id, token_id, ts, title, body, data) VALUES(NULL,NULL,?,?,?,?)', nowIso(), title, body, j({ type }));
}

export const fmtUsd = (v: number) => (v >= 1e9 ? `${(v / 1e9).toFixed(2)} Md$` : v >= 1e6 ? `${(v / 1e6).toFixed(2)} M$` : v >= 1e3 ? `${(v / 1e3).toFixed(1)} k$` : `${v.toFixed(0)} $`);
export const fmtPrice = (v: number) => (v >= 1 ? `${v.toFixed(2)} $` : `${v.toPrecision(4)} $`);
