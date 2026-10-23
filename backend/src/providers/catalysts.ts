import { loadConfig } from '../config.ts';
import { fetchJson } from './http.ts';
import type { CatalystObs } from './types.ts';

/**
 * CoinMarketCal : calendrier d'événements crypto (communautaire, avec preuves).
 * Un événement est "confirmé" uniquement s'il a une preuve (lien) jointe ; sinon "rumeur".
 * Sans clé API, cette source est désactivée et seuls les catalyseurs saisis à la main (avec source) sont utilisés.
 */
export async function coinmarketcalEvents(daysAhead = 365): Promise<CatalystObs[] | null> {
  const key = loadConfig().COINMARKETCAL_API_KEY;
  if (!key) return null;
  const start = new Date().toISOString().slice(0, 10);
  const end = new Date(Date.now() + daysAhead * 86400_000).toISOString().slice(0, 10);
  const out: CatalystObs[] = [];
  for (let page = 1; page <= 5; page++) {
    const d = await fetchJson<any>(
      'coinmarketcal',
      `https://developers.coinmarketcal.com/v1/events?page=${page}&max=75&dateRangeStart=${start}&dateRangeEnd=${end}&sortBy=created_desc`,
      { headers: { 'x-api-key': key, 'Accept-Encoding': 'deflate, gzip' } },
    );
    const body: any[] = d?.body ?? [];
    out.push(...body.flatMap(parseCmcEvent));
    if (body.length < 75) break;
  }
  return out;
}

export function parseCmcEvent(e: any): CatalystObs[] {
  const title = typeof e.title === 'string' ? e.title : e.title?.en ?? 'Événement';
  const proof: string | null = e.proof || null;
  const source: string | null = e.source || null;
  const url = source || proof || `https://coinmarketcal.com/en/event/${e.id}`;
  const coins: any[] = Array.isArray(e.coins) ? e.coins : [];
  return coins.map((c) => ({
    id: `cmc:${e.id}:${c.id}`,
    title,
    kind: e.categories?.[0]?.name ?? null,
    eventDate: e.date_event ? String(e.date_event).slice(0, 10) : null,
    datePrecision: e.can_occur_before ? 'month' : 'day',
    status: proof ? 'confirmed' : 'rumor',
    sourceName: proof ? 'CoinMarketCal (preuve jointe)' : 'CoinMarketCal (non prouvé)',
    sourceUrl: url,
    coingeckoId: c.id ?? null,
    symbol: c.symbol ?? null,
  }));
}
