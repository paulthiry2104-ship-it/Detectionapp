export type Horizon = 'week' | 'month' | 'year';
export const HORIZONS: Horizon[] = ['week', 'month', 'year'];
export const HORIZON_DAYS: Record<Horizon, number> = { week: 7, month: 30, year: 365 };
export const HORIZON_LABEL: Record<Horizon, string> = { week: 'Cette semaine', month: 'Le mois prochain', year: 'Durant l’année' };

const DAY = 86_400_000;

/** Date calendaire (YYYY-MM-DD) dans un fuseau donné. */
export function localDate(d: Date, tz = 'Europe/Paris'): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
export function localHour(d: Date, tz = 'Europe/Paris'): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hourCycle: 'h23' }).format(d));
}

/**
 * Fenêtres des horizons, calculées à partir de l'instant d'analyse :
 *  - week  : [maintenant, maintenant + 7 jours]
 *  - month : [maintenant, maintenant + 30 jours]
 *  - year  : [maintenant, maintenant + 365 jours]
 */
export function horizonWindow(h: Horizon, asOf: Date) {
  const start = asOf;
  const end = new Date(asOf.getTime() + HORIZON_DAYS[h] * DAY);
  return { start: start.toISOString(), end: end.toISOString(), days: HORIZON_DAYS[h] };
}

export const daysBetween = (a: string | Date, b: string | Date) => (new Date(b).getTime() - new Date(a).getTime()) / DAY;
export const hoursSince = (iso: string, asOf: Date) => (asOf.getTime() - new Date(iso).getTime()) / 3_600_000;
export const isoMinus = (asOf: Date, days: number) => new Date(asOf.getTime() - days * DAY).toISOString();

/** Décalage (minutes) d'un fuseau à un instant donné, ex. +120 pour Paris en été. */
export function tzOffsetMinutes(at: Date, tz: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - at.getTime()) / 60_000);
}

/** Prochaine occurrence de HH:MM dans le fuseau (gère l'heure d'été). */
export function nextLocalTime(hour: number, minute: number, tz: string, from = new Date()): Date {
  for (let d = 0; d < 3; d++) {
    const day = new Date(from.getTime() + d * DAY);
    const [y, m, dd] = localDate(day, tz).split('-').map(Number);
    const guess = Date.UTC(y, m - 1, dd, hour, minute);
    const cand = new Date(guess - tzOffsetMinutes(new Date(guess), tz) * 60_000);
    const fixed = new Date(guess - tzOffsetMinutes(cand, tz) * 60_000);
    if (fixed.getTime() > from.getTime()) return fixed;
  }
  throw new Error('nextLocalTime: introuvable');
}
