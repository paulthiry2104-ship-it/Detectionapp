import { getDb, nowIso } from '../db/db.ts';
import { log } from '../log.ts';

export class ProviderError extends Error {
  constructor(public provider: string, message: string, public status?: number) {
    super(`[${provider}] ${message}`);
  }
}

type ProviderSpec = { minIntervalMs: number; maxRetries: number; timeoutMs: number };

/** Limites prudentes, alignées sur les plans gratuits documentés (on reste en dessous). */
export const PROVIDERS: Record<string, ProviderSpec> = {
  coingecko: { minIntervalMs: 2_500, maxRetries: 3, timeoutMs: 20_000 }, // demo ≈ 30 req/min
  dexscreener: { minIntervalMs: 1_100, maxRetries: 3, timeoutMs: 15_000 }, // 60 req/min sur profils, 300 sur paires
  geckoterminal: { minIntervalMs: 2_200, maxRetries: 3, timeoutMs: 15_000 }, // 30 req/min
  goplus: { minIntervalMs: 2_000, maxRetries: 2, timeoutMs: 15_000 },
  rugcheck: { minIntervalMs: 1_500, maxRetries: 2, timeoutMs: 15_000 },
  coinmarketcal: { minIntervalMs: 1_200, maxRetries: 2, timeoutMs: 15_000 },
  expo: { minIntervalMs: 200, maxRetries: 2, timeoutMs: 15_000 },
};

const lastCall = new Map<string, number>();
const queues = new Map<string, Promise<unknown>>();
const cache = new Map<string, { exp: number; value: unknown }>();
/** Coupe-circuit : après 3 échecs consécutifs, on n'insiste plus pendant 10 min (évite une analyse bloquée des heures). */
const breaker = new Map<string, { fails: number; openedAt: number }>();
const BREAKER_FAILS = 3;
const BREAKER_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Permet aux tests d'accélérer les attentes. */
export const timing = { scale: 1 };

function recordStatus(provider: string, ok: boolean, err?: string) {
  try {
    const db = getDb();
    if (ok) {
      db.run(
        `INSERT INTO provider_status(provider,last_ok_at,calls_ok) VALUES(?,?,1)
         ON CONFLICT(provider) DO UPDATE SET last_ok_at=excluded.last_ok_at, calls_ok=calls_ok+1`,
        provider, nowIso(),
      );
    } else {
      db.run(
        `INSERT INTO provider_status(provider,last_error_at,last_error,calls_failed) VALUES(?,?,?,1)
         ON CONFLICT(provider) DO UPDATE SET last_error_at=excluded.last_error_at, last_error=excluded.last_error, calls_failed=calls_failed+1`,
        provider, nowIso(), (err ?? '').slice(0, 500),
      );
    }
  } catch {
    /* la base n'est pas critique pour un appel HTTP */
  }
}

export type FetchJsonOpts = {
  headers?: Record<string, string>;
  method?: string;
  body?: unknown;
  cacheTtlMs?: number;
};

/**
 * GET/POST JSON avec : file d'attente par fournisseur (respect des limites),
 * retries exponentiels sur 429/5xx/timeouts, cache mémoire optionnel,
 * et journalisation de l'état du fournisseur.
 */
export async function fetchJson<T = any>(provider: string, url: string, opts: FetchJsonOpts = {}): Promise<T> {
  const spec = PROVIDERS[provider] ?? { minIntervalMs: 1000, maxRetries: 2, timeoutMs: 15000 };
  const key = `${opts.method ?? 'GET'} ${url}`;
  if (opts.cacheTtlMs) {
    const hit = cache.get(key);
    if (hit && hit.exp > Date.now()) return hit.value as T;
  }

  const run = async (): Promise<T> => {
    const br = breaker.get(provider);
    if (br && br.fails >= BREAKER_FAILS && Date.now() - br.openedAt < BREAKER_MS) {
      throw new ProviderError(provider, 'fournisseur indisponible (coupe-circuit actif après plusieurs échecs)');
    }
    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= spec.maxRetries) {
      const wait = (lastCall.get(provider) ?? 0) + spec.minIntervalMs * timing.scale - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall.set(provider, Date.now());
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), spec.timeoutMs);
      try {
        const res = await fetch(url, {
          method: opts.method ?? 'GET',
          headers: { accept: 'application/json', 'user-agent': 'CryptoRadar/0.1', ...(opts.body ? { 'content-type': 'application/json' } : {}), ...opts.headers },
          body: opts.body ? JSON.stringify(opts.body) : undefined,
          signal: ctrl.signal,
        });
        clearTimeout(timer);
        if (res.status === 429 || res.status >= 500) {
          const retryAfter = Number(res.headers.get('retry-after'));
          lastErr = new ProviderError(provider, `HTTP ${res.status}`, res.status);
          const backoff = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 3000;
          attempt++;
          if (attempt <= spec.maxRetries) await sleep(Math.min(backoff, 60_000) * timing.scale);
          continue;
        }
        if (!res.ok) {
          const text = await res.text().catch(() => '');
          throw new ProviderError(provider, `HTTP ${res.status} ${text.slice(0, 200)}`, res.status);
        }
        const data = (await res.json()) as T;
        recordStatus(provider, true);
        breaker.delete(provider);
        if (opts.cacheTtlMs) cache.set(key, { exp: Date.now() + opts.cacheTtlMs, value: data });
        return data;
      } catch (e) {
        clearTimeout(timer);
        if (e instanceof ProviderError && e.status && e.status < 500 && e.status !== 429) {
          recordStatus(provider, false, e.message);
          throw e;
        }
        lastErr = e;
        attempt++;
        if (attempt <= spec.maxRetries) await sleep(2 ** attempt * 1500 * timing.scale);
      }
    }
    const msg = lastErr instanceof Error ? lastErr.message : String(lastErr);
    const b = breaker.get(provider) ?? { fails: 0, openedAt: 0 };
    b.fails++; b.openedAt = Date.now();
    breaker.set(provider, b);
    recordStatus(provider, false, msg);
    log.warn({ provider, url: redact(url), err: msg }, 'appel fournisseur en échec');
    throw lastErr instanceof ProviderError ? lastErr : new ProviderError(provider, msg);
  };

  // Sérialise les appels d'un même fournisseur.
  const prev = queues.get(provider) ?? Promise.resolve();
  const p = prev.then(run, run);
  queues.set(provider, p.catch(() => undefined));
  return p;
}

export function clearHttpCache() {
  cache.clear();
  breaker.clear();
  lastCall.clear();
  queues.clear();
}

export const redact = (url: string) => url.replace(/(api_key|key|token)=[^&]+/gi, '$1=***');
