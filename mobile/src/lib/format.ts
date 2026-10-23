export const usd = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 1e12) return `${(v / 1e12).toFixed(2).replace('.', ',')} T$`;
  if (a >= 1e9) return `${(v / 1e9).toFixed(2).replace('.', ',')} Md$`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(2).replace('.', ',')} M$`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(1).replace('.', ',')} k$`;
  return `${v.toFixed(0)} $`;
};

export const price = (v: number | null | undefined) => {
  if (v == null || !Number.isFinite(v)) return '—';
  if (v >= 1000) return `${v.toLocaleString('fr-FR', { maximumFractionDigits: 0 })} $`;
  if (v >= 1) return `${v.toFixed(2).replace('.', ',')} $`;
  if (v >= 0.01) return `${v.toFixed(4).replace('.', ',')} $`;
  if (v >= 1e-9) {
    const digits = Math.min(12, Math.ceil(-Math.log10(v)) + 2);
    return `${v.toFixed(digits).replace(/0+$/, '').replace('.', ',')} $`;
  }
  return `${v.toExponential(2).replace('.', ',')} $`;
};

export const pct = (v: number | null | undefined, digits = 1) => {
  if (v == null || !Number.isFinite(v)) return '—';
  return `${v >= 0 ? '+' : ''}${v.toFixed(digits).replace('.', ',')} %`;
};

export const num = (v: number | null | undefined) => (v == null ? '—' : v.toLocaleString('fr-FR', { maximumFractionDigits: 0 }));

export const ago = (iso: string | null | undefined) => {
  if (!iso) return 'jamais';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'à l’instant';
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 48) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
};

export const dateTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Paris' }) : '—';
export const date = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Paris' }) : '—';

export const shortAddr = (a: string | null | undefined) => (!a ? '—' : a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);
export const changeColor = (v: number | null | undefined, up: string, down: string, neutral: string) => (v == null ? neutral : v >= 0 ? up : down);
