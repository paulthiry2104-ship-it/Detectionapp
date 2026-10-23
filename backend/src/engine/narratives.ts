import type { Db } from '../db/db.ts';
import { isoMinus } from './time.ts';

export type NarrativeState = {
  id: string; name: string; rank: number; total: number; rank7dAgo: number | null; change24h: number | null; marketCap: number | null;
};

/** État des narratives (catégories CoinGecko) à une date, uniquement à partir de l'historique enregistré. */
export function narrativeContext(db: Db, asOf: Date): Map<string, NarrativeState> {
  const asOfIso = asOf.toISOString();
  const last = db.get<{ ts: string }>('SELECT MAX(ts) AS ts FROM category_snapshots WHERE ts <= ?', asOfIso);
  const out = new Map<string, NarrativeState>();
  if (!last?.ts) return out;
  const rows = db.all<any>('SELECT * FROM category_snapshots WHERE ts = ?', last.ts);
  const prevTs = db.get<{ ts: string }>('SELECT MAX(ts) AS ts FROM category_snapshots WHERE ts <= ?', isoMinus(asOf, 6.5));
  const prev = new Map<string, number>();
  if (prevTs?.ts) for (const r of db.all<any>('SELECT category_id, momentum_rank FROM category_snapshots WHERE ts = ?', prevTs.ts)) prev.set(r.category_id, r.momentum_rank);
  for (const r of rows) {
    out.set(r.category_id, {
      id: r.category_id, name: r.name, rank: r.momentum_rank, total: rows.length,
      rank7dAgo: prev.get(r.category_id) ?? null, change24h: r.change_24h, marketCap: r.market_cap,
    });
  }
  return out;
}

/** Score de narrative 0..1 : force actuelle (rang de momentum) + fraîcheur (progression sur 7 jours). */
export function narrativeScore(st: NarrativeState | undefined): { value: number | null; detail: string } {
  if (!st || !st.total) return { value: null, detail: 'Narrative inconnue' };
  const strength = 1 - (st.rank - 1) / Math.max(1, st.total - 1);
  if (st.rank7dAgo == null) return { value: strength, detail: `${st.name} : rang ${st.rank}/${st.total} (pas encore d’historique 7 j)` };
  const improvement = (st.rank7dAgo - st.rank) / st.total; // >0 = progresse
  const fresh = Math.max(0, Math.min(1, 0.5 + improvement * 2));
  return {
    value: 0.6 * strength + 0.4 * fresh,
    detail: `${st.name} : rang ${st.rank}/${st.total} (il y a 7 j : ${st.rank7dAgo})`,
  };
}

/** Narratives émergentes / en perte de vitesse entre deux dates (catégories > 50 M$). */
export function narrativeShifts(db: Db, asOf: Date) {
  const ctx = narrativeContext(db, asOf);
  const list = [...ctx.values()].filter((x) => (x.marketCap ?? 0) > 50e6 && x.rank7dAgo != null);
  const withDelta = list.map((x) => ({ ...x, delta: (x.rank7dAgo as number) - x.rank }));
  return {
    emerging: withDelta.filter((x) => x.delta > 0 && x.rank <= Math.max(25, x.total * 0.1)).sort((a, b) => b.delta - a.delta).slice(0, 8),
    fading: withDelta.filter((x) => x.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 8),
  };
}
