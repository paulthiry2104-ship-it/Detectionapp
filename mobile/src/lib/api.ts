import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { notifyLocal } from './push';

/**
 * Version gratuite : pas de serveur. GitHub Actions publie les analyses sous forme de fichiers JSON
 * sur GitHub Pages ; l'app les lit. Favoris, alertes et historique d'alertes sont gardés sur l'appareil.
 */
export const DEFAULT_DATA_URL = 'https://paulthiry2104-ship-it.github.io/Detectionapp/api';
const K_URL = 'radar.dataUrl';

let mem: { url: string } | null = null;
const listeners = new Set<() => void>();

export async function getConnection() {
  if (mem) return mem;
  let url: string | null = null;
  try { url = await AsyncStorage.getItem(K_URL); } catch { /* stockage indisponible */ }
  mem = { url: url || DEFAULT_DATA_URL };
  return mem;
}
export async function setConnection(url: string) {
  const clean = (url.trim() || DEFAULT_DATA_URL).replace(/\/+$/, '');
  try { await AsyncStorage.setItem(K_URL, clean); } catch { /* ignore */ }
  mem = { url: clean };
  listeners.forEach((l) => l());
}
export function onConnectionChange(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export class ApiError extends Error {
  constructor(message: string, public status?: number) { super(message); }
}

export const fileId = (id: string) => encodeURIComponent(id).replace(/%/g, '~');

async function getJson<T = any>(file: string): Promise<T> {
  const { url } = await getConnection();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20000);
  try {
    // Le paramètre évite le cache du navigateur ; GitHub Pages met à jour en ~1 min.
    const res = await fetch(`${url}/${file}?t=${Math.floor(Date.now() / 60000)}`, { signal: ctrl.signal });
    if (res.status === 404) throw new ApiError('Pas encore de données publiées.', 404);
    if (!res.ok) throw new ApiError(`Erreur ${res.status}`, res.status);
    return (await res.json()) as T;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    throw new ApiError(e?.name === 'AbortError' ? 'La source de données ne répond pas.' : 'Pas de connexion à la source de données.', 0);
  } finally {
    clearTimeout(timer);
  }
}

// ── stockage local ──
async function load<T>(k: string, fb: T): Promise<T> {
  try { const r = await AsyncStorage.getItem(k); return r ? (JSON.parse(r) as T) : fb; } catch { return fb; }
}
async function save(k: string, v: unknown) {
  try { await AsyncStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ }
}
const K_FAV = 'radar.favorites';
const K_RULES = 'radar.rules';
const K_EVENTS = 'radar.events';
const K_NOTIFY = 'radar.notify';

type Rule = { id: number; token_id: string | null; symbol?: string | null; type: string; params: any; enabled: number; cooldown_minutes: number; last_fired_at: string | null; created_at: string };
type Ev = { id: number; rule_id: number | null; token_id: string | null; ts: string; title: string; body: string; data: any; pushed: number; read: number };

let indexCache: { at: number; items: any[] } | null = null;
async function getIndex(): Promise<any[]> {
  if (indexCache && Date.now() - indexCache.at < 60_000) return indexCache.items;
  const d = await getJson<{ items: any[] }>('index.json');
  indexCache = { at: Date.now(), items: d.items ?? [] };
  return indexCache.items;
}

function minimalDetail(t: any) {
  const sources = [] as { label: string; url: string }[];
  if (t.coingecko_id) sources.push({ label: 'CoinGecko', url: `https://www.coingecko.com/en/coins/${t.coingecko_id}` });
  if (t.dex_url) sources.push({ label: 'Marché DEX', url: t.dex_url });
  return {
    identity: { id: t.id, symbol: t.symbol, name: t.name, chain: t.chain, chainLabel: t.chain, contract: t.contract_address, logo: t.logo_url, status: t.status },
    market: { price: t.price_usd, marketCap: t.market_cap, volume24h: t.volume_24h, liquidity: t.liquidity_usd, change24h: t.change_24h, updatedAt: t.ts, sourcesCount: 1, markets: [] },
    narrative: { description: null, categories: [] },
    catalysts: [], horizons: {}, signals: null, history: [], sources,
    missing: ['Fiche détaillée : publiée seulement pour les tokens classés, explorés ou suspects'],
    disclaimer: 'Ceci n’est pas un conseil en investissement.',
  };
}

/** Vérifie les alertes locales à partir des dernières données publiées. */
export async function checkAlerts(home?: any) {
  const rules = (await load<Rule[]>(K_RULES, [])).filter((r) => r.enabled);
  if (!rules.length) return 0;
  let index: any[] = [];
  try { index = await getIndex(); } catch { return 0; }
  const byId = new Map(index.map((t) => [t.id, t]));
  const favs = new Set(await load<string[]>(K_FAV, []));
  const events = await load<Ev[]>(K_EVENTS, []);
  const now = Date.now();
  const fired: Ev[] = [];
  const fire = (r: Rule, tokenId: string | null, title: string, body: string, data: any) => {
    fired.push({ id: now + fired.length, rule_id: r.id, token_id: tokenId, ts: new Date().toISOString(), title, body, data, pushed: 0, read: 0 });
    r.last_fired_at = new Date().toISOString();
  };
  for (const r of rules) {
    if (r.last_fired_at && now - new Date(r.last_fired_at).getTime() < r.cooldown_minutes * 60_000) continue;
    const t = r.token_id ? byId.get(r.token_id) : null;
    if ((r.type === 'price_above' || r.type === 'price_below') && t?.price_usd != null) {
      const hit = r.type === 'price_above' ? t.price_usd >= r.params.price : t.price_usd <= r.params.price;
      if (hit) fire(r, t.id, `${t.symbol} ${r.type === 'price_above' ? '≥' : '≤'} ${r.params.price} $`, `Prix : ${t.price_usd} $`, { tokenId: t.id });
    } else if (r.type === 'volume_spike' && t?.vol_ratio != null) {
      // anti-aberration : volume et liquidité minimum
      if (t.vol_ratio >= (r.params.multiple ?? 3) && (t.volume_24h ?? 0) >= 50_000 && (t.liquidity_usd == null || t.liquidity_usd >= 20_000)) {
        fire(r, t.id, `${t.symbol} : volume ×${t.vol_ratio.toFixed(1)}`, `Volume 24 h : ${Math.round(t.volume_24h).toLocaleString('fr-FR')} $`, { tokenId: t.id });
      }
    } else if (r.type === 'entered_list' && home?.lists) {
      for (const h of ['week', 'month', 'year']) {
        if (r.params.horizon && r.params.horizon !== h) continue;
        for (const i of home.lists[h]?.items ?? []) {
          if (!i.movement?.entered) continue;
          if (r.token_id && r.token_id !== i.id) continue;
          if (!r.token_id && r.params.favoritesOnly && !favs.has(i.id)) continue;
          if (r.params.maxRank && i.rank > r.params.maxRank) continue;
          const key = `${h}:${i.id}:${home.lists[h].run?.id}`;
          if (events.some((e) => e.data?.key === key)) continue;
          fire(r, i.id, `${i.symbol} entre dans « ${home.lists[h].label} »`, `Rang ${i.rank}`, { tokenId: i.id, key });
        }
      }
    }
  }
  if (!fired.length) return 0;
  const all = await load<Rule[]>(K_RULES, []);
  for (const r of rules) { const x = all.find((a) => a.id === r.id); if (x) x.last_fired_at = r.last_fired_at; }
  await save(K_RULES, all);
  await save(K_EVENTS, [...fired, ...events].slice(0, 300));
  for (const e of fired.slice(0, 3)) notifyLocal(e.title, e.body, e.data).catch(() => undefined);
  return fired.length;
}

/** Même interface qu'avant (chemins « /api/... »), servie par les fichiers publiés + le stockage local. */
export async function api<T = any>(path: string, init: { method?: string; body?: any } = {}): Promise<T> {
  const method = init.method ?? 'GET';
  const [p, qs] = path.split('?');
  const q = new URLSearchParams(qs ?? '');
  const out = async (): Promise<any> => {
    if (p === '/api/home') { const h = await getJson('home.json'); checkAlerts(h).catch(() => undefined); return h; }
    if (p === '/api/status') return getJson('status.json');
    if (p === '/api/report') return getJson('report.json');
    if (p === '/api/history/runs') return getJson('runs.json');
    if (p === '/api/performance') return getJson('performance.json');
    if (p === '/api/methodology') return getJson('methodology.json');
    if (p === '/api/suspects') return getJson('suspects.json');
    if (p === '/api/explore') return getJson(`explore-${q.get('sort') ?? 'new'}.json`);
    if (p === '/api/search') {
      const s = (q.get('q') ?? '').toLowerCase();
      const items = (await getIndex()).filter((t) => `${t.symbol} ${t.name}`.toLowerCase().includes(s) || (t.contract_address ?? '').toLowerCase() === s);
      items.sort((a, b) => Number(b.symbol.toLowerCase() === s) - Number(a.symbol.toLowerCase() === s));
      return { items: items.slice(0, 40), remote: 0 };
    }
    if (p.startsWith('/api/tokens/')) {
      const id = decodeURIComponent(p.slice('/api/tokens/'.length));
      const favorite = (await load<string[]>(K_FAV, [])).includes(id);
      try { return { ...(await getJson(`tokens/${fileId(id)}.json`)), favorite }; } catch (e: any) {
        if (e.status !== 404) throw e;
        const t = (await getIndex()).find((x) => x.id === id);
        if (!t) throw new ApiError('Token introuvable dans les dernières données.', 404);
        return { ...minimalDetail(t), favorite };
      }
    }
    if (p === '/api/favorites') {
      const ids = await load<string[]>(K_FAV, []);
      let idx: any[] = [];
      try { idx = await getIndex(); } catch { /* hors ligne */ }
      const byId = new Map(idx.map((t) => [t.id, t]));
      return { items: ids.map((id) => byId.get(id) ?? { id, symbol: id.split(':').pop()?.slice(0, 8), name: 'Plus de données récentes' }) };
    }
    if (p.startsWith('/api/favorites/')) {
      const id = decodeURIComponent(p.slice('/api/favorites/'.length));
      const ids = (await load<string[]>(K_FAV, [])).filter((x) => x !== id);
      if (method === 'PUT') ids.unshift(id);
      await save(K_FAV, ids);
      return { ok: true };
    }
    if (p === '/api/alerts/rules') {
      const rules = await load<Rule[]>(K_RULES, []);
      if (method === 'GET') return { items: rules };
      const b = init.body ?? {};
      if ((b.type === 'price_above' || b.type === 'price_below') && !(Number(b.params?.price) > 0)) throw new ApiError('Prix cible requis', 400);
      let symbol: string | null = null;
      if (b.tokenId) { try { symbol = (await getIndex()).find((t) => t.id === b.tokenId)?.symbol ?? null; } catch { /* ignore */ } }
      const r: Rule = { id: Date.now(), token_id: b.tokenId ?? null, symbol, type: b.type, params: b.params ?? {}, enabled: 1, cooldown_minutes: b.cooldownMinutes ?? 180, last_fired_at: null, created_at: new Date().toISOString() };
      await save(K_RULES, [r, ...rules]);
      return { id: r.id };
    }
    if (p.startsWith('/api/alerts/rules/')) {
      const id = Number(p.split('/').pop());
      let rules = await load<Rule[]>(K_RULES, []);
      if (method === 'DELETE') rules = rules.filter((r) => r.id !== id);
      else rules = rules.map((r) => (r.id === id ? { ...r, enabled: init.body?.enabled === undefined ? r.enabled : init.body.enabled ? 1 : 0 } : r));
      await save(K_RULES, rules);
      return { ok: true };
    }
    if (p === '/api/alerts/events') {
      const local = await load<Ev[]>(K_EVENTS, []);
      return { items: local };
    }
    if (p === '/api/alerts/events/read') {
      await save(K_EVENTS, (await load<Ev[]>(K_EVENTS, [])).map((e) => ({ ...e, read: 1 })));
      return { ok: true };
    }
    if (p === '/api/settings') {
      const m = await getJson<any>('methodology.json').catch(() => null);
      return { weights: m?.weights ?? null, notify: await load(K_NOTIFY, { local: true }) };
    }
    throw new ApiError(`Fonction indisponible dans la version gratuite (${p})`, 400);
  };
  return out() as Promise<T>;
}

type State<T> = { data: T | null; error: string | null; loading: boolean; refreshing: boolean; fromCache: boolean; cachedAt: string | null; status?: number };

/** Charge une ressource ; en cas d'échec réseau, affiche la dernière version en cache (avec sa date). */
export function useApi<T = any>(path: string | null, deps: unknown[] = []) {
  const [st, setSt] = useState<State<T>>({ data: null, error: null, loading: true, refreshing: false, fromCache: false, cachedAt: null });
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const loadIt = useCallback(async (isRefresh = false) => {
    if (!path) return;
    setSt((s) => ({ ...s, loading: !isRefresh && !s.data, refreshing: isRefresh }));
    const cacheKey = `cache:${path}`;
    try {
      const data = await api<T>(path);
      if (!alive.current) return;
      setSt({ data, error: null, loading: false, refreshing: false, fromCache: false, cachedAt: null });
      if (!path.includes('/alerts') && !path.includes('/favorites')) save(cacheKey, { at: new Date().toISOString(), data });
    } catch (e: any) {
      const cached = await load<{ at: string; data: T } | null>(cacheKey, null);
      if (!alive.current) return;
      setSt((s) => ({ data: cached?.data ?? s.data, error: e.message, loading: false, refreshing: false, fromCache: !!cached, cachedAt: cached?.at ?? null, status: e.status }));
    }
  }, [path, ...deps]);

  useEffect(() => { loadIt(); return onConnectionChange(() => loadIt()); }, [loadIt]);
  return { ...st, reload: () => loadIt(true) };
}

export const isWeb = Platform.OS === 'web';
