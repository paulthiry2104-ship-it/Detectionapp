import { Platform } from 'react-native';

export const C = {
  bg: '#07080B',
  surface: '#0F1116',
  surface2: '#161921',
  line: '#232733',
  text: '#F4F5F8',
  sub: '#A7ADBB',
  dim: '#6B7180',
  up: '#2BD98A',
  down: '#FF5C6C',
  warn: '#FFB547',
  ai: '#8B7CFF',      // accents « analyse / modèle »
  ai2: '#4DA3FF',
  aiBg: 'rgba(139,124,255,0.12)',
  upBg: 'rgba(43,217,138,0.12)',
  downBg: 'rgba(255,92,108,0.12)',
  warnBg: 'rgba(255,181,71,0.12)',
};

export const mono = Platform.select({ ios: 'Menlo', default: 'monospace' });

export const R = { s: 8, m: 12, l: 16 };
export const S = { xs: 4, s: 8, m: 12, l: 16, xl: 24 };

export const T = {
  h1: { color: C.text, fontSize: 28, fontWeight: '800' as const, letterSpacing: -0.5 },
  h2: { color: C.text, fontSize: 20, fontWeight: '700' as const },
  h3: { color: C.text, fontSize: 16, fontWeight: '700' as const },
  body: { color: C.text, fontSize: 15, lineHeight: 21 },
  sub: { color: C.sub, fontSize: 13, lineHeight: 18 },
  tiny: { color: C.dim, fontSize: 11, lineHeight: 15 },
  num: { color: C.text, fontSize: 15, fontVariant: ['tabular-nums' as const] },
};
