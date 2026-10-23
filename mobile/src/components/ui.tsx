import Ionicons from '@expo/vector-icons/Ionicons';
import * as Haptics from 'expo-haptics';
import { Image } from 'expo-image';
import * as WebBrowser from 'expo-web-browser';
import { type ReactNode, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { dateTime } from '../lib/format';
import { C, R, S, T } from '../lib/theme';

export function Card({ children, style, onPress }: { children: ReactNode; style?: ViewStyle; onPress?: () => void }) {
  if (!onPress) return <View style={[st.card, style]}>{children}</View>;
  return (
    <Pressable onPress={() => { Haptics.selectionAsync().catch(() => undefined); onPress(); }} style={({ pressed }) => [st.card, style, pressed && { opacity: 0.75, transform: [{ scale: 0.99 }] }]}>
      {children}
    </Pressable>
  );
}

export function Section({ title, right, children, accent }: { title: string; right?: ReactNode; children: ReactNode; accent?: boolean }) {
  return (
    <View style={{ marginTop: S.xl }}>
      <View style={st.sectionHead}>
        <Text style={[T.h3, accent && { color: C.ai }]}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

export function Row({ label, value, valueColor, hint }: { label: string; value: ReactNode; valueColor?: string; hint?: string }) {
  return (
    <View style={st.row}>
      <View style={{ flex: 1, paddingRight: S.s }}>
        <Text style={T.sub}>{label}</Text>
        {hint ? <Text style={T.tiny}>{hint}</Text> : null}
      </View>
      {typeof value === 'string' || typeof value === 'number' ? <Text style={[T.num, { textAlign: 'right' }, valueColor ? { color: valueColor } : null]}>{value}</Text> : value}
    </View>
  );
}

export function Badge({ text, color = C.sub, bg = C.surface2, icon }: { text: string; color?: string; bg?: string; icon?: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={[st.badge, { backgroundColor: bg }]}>
      {icon ? <Ionicons name={icon} size={11} color={color} style={{ marginRight: 3 }} /> : null}
      <Text style={{ color, fontSize: 11, fontWeight: '700' }} numberOfLines={1}>{text}</Text>
    </View>
  );
}

export function Banner({ kind = 'warn', text, onPress }: { kind?: 'warn' | 'error' | 'info'; text: string; onPress?: () => void }) {
  const col = kind === 'error' ? C.down : kind === 'info' ? C.ai : C.warn;
  const bg = kind === 'error' ? C.downBg : kind === 'info' ? C.aiBg : C.warnBg;
  return (
    <Pressable onPress={onPress} style={[st.banner, { backgroundColor: bg, borderColor: col }]}>
      <Ionicons name={kind === 'info' ? 'information-circle' : 'warning'} size={16} color={col} />
      <Text style={{ color: col, fontSize: 13, flex: 1, marginLeft: 6 }}>{text}</Text>
    </Pressable>
  );
}

export function Empty({ icon = 'radio-outline', title, text, action }: { icon?: keyof typeof Ionicons.glyphMap; title: string; text?: string; action?: ReactNode }) {
  return (
    <View style={{ alignItems: 'center', padding: S.xl, gap: S.s }}>
      <Ionicons name={icon} size={36} color={C.dim} />
      <Text style={T.h3}>{title}</Text>
      {text ? <Text style={[T.sub, { textAlign: 'center' }]}>{text}</Text> : null}
      {action}
    </View>
  );
}

export function Loading() {
  return <View style={{ padding: S.xl }}><ActivityIndicator color={C.ai} /></View>;
}

export function Button({ title, onPress, kind = 'primary', icon, disabled }: { title: string; onPress: () => void; kind?: 'primary' | 'ghost' | 'danger'; icon?: keyof typeof Ionicons.glyphMap; disabled?: boolean }) {
  const [busy, setBusy] = useState(false);
  const bg = kind === 'primary' ? C.ai : kind === 'danger' ? C.downBg : C.surface2;
  const fg = kind === 'primary' ? '#fff' : kind === 'danger' ? C.down : C.text;
  return (
    <Pressable
      disabled={disabled || busy}
      onPress={async () => { setBusy(true); try { await onPress(); } finally { setBusy(false); } }}
      style={({ pressed }) => [st.btn, { backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1 }]}
    >
      {busy ? <ActivityIndicator color={fg} size="small" /> : icon ? <Ionicons name={icon} size={16} color={fg} /> : null}
      <Text style={{ color: fg, fontWeight: '700', fontSize: 15 }}>{title}</Text>
    </Pressable>
  );
}

export function Segmented<K extends string>({ value, options, onChange }: { value: K; options: { key: K; label: string }[]; onChange: (k: K) => void }) {
  return (
    <View style={st.seg}>
      {options.map((o) => {
        const on = o.key === value;
        return (
          <Pressable key={o.key} onPress={() => { Haptics.selectionAsync().catch(() => undefined); onChange(o.key); }} style={[st.segItem, on && st.segOn]}>
            <Text style={{ color: on ? C.text : C.sub, fontWeight: on ? '800' : '600', fontSize: 12.5 }} numberOfLines={1}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Chip({ label, on, onPress }: { label: string; on?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[st.chip, on && { backgroundColor: C.aiBg, borderColor: C.ai }]}>
      <Text style={{ color: on ? C.ai : C.sub, fontSize: 12, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function TokenLogo({ uri, symbol, size = 36 }: { uri?: string | null; symbol?: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  if (!uri || failed) {
    return (
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface2, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: C.sub, fontWeight: '800', fontSize: size * 0.36 }}>{(symbol ?? '?').slice(0, 2)}</Text>
      </View>
    );
  }
  return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: C.surface2 }} onError={() => setFailed(true)} transition={150} />;
}

export function Sparkline({ values, width = 320, height = 90, color }: { values: number[]; width?: number; height?: number; color?: string }) {
  const v = values.filter((x) => Number.isFinite(x));
  if (v.length < 2) return <Text style={T.tiny}>Historique insuffisant pour tracer un graphique.</Text>;
  const min = Math.min(...v); const max = Math.max(...v);
  const span = max - min || 1;
  const d = v.map((y, i) => `${i ? 'L' : 'M'}${((i / (v.length - 1)) * width).toFixed(1)},${(height - ((y - min) / span) * (height - 6) - 3).toFixed(1)}`).join(' ');
  const col = color ?? (v[v.length - 1] >= v[0] ? C.up : C.down);
  return (
    <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
      <Path d={d} stroke={col} strokeWidth={2} fill="none" />
    </Svg>
  );
}

export function Meter({ value, color = C.ai }: { value: number | null; color?: string }) {
  return (
    <View style={{ height: 6, backgroundColor: C.surface2, borderRadius: 3, overflow: 'hidden', flex: 1 }}>
      {value != null ? <View style={{ width: `${Math.max(2, Math.min(100, value * 100))}%`, height: 6, backgroundColor: color, borderRadius: 3 }} /> : null}
    </View>
  );
}

export function SourceLink({ label, url, at }: { label: string; url: string; at?: string | null }) {
  return (
    <Pressable onPress={() => WebBrowser.openBrowserAsync(url)} style={st.row}>
      <View style={{ flex: 1 }}>
        <Text style={[T.body, { color: C.ai2 }]} numberOfLines={1}>{label}</Text>
        <Text style={T.tiny} numberOfLines={1}>{url.replace(/^https?:\/\//, '')}{at ? ` · ${dateTime(at)}` : ''}</Text>
      </View>
      <Ionicons name="open-outline" size={16} color={C.dim} />
    </Pressable>
  );
}

export function Kind({ kind }: { kind: 'observé' | 'hypothèse' | 'estimation' | 'indisponible' | string }) {
  const map: Record<string, [string, string]> = { 'observé': [C.up, C.upBg], 'hypothèse': [C.warn, C.warnBg], estimation: [C.ai, C.aiBg], indisponible: [C.dim, C.surface2] };
  const [c, b] = map[kind] ?? [C.sub, C.surface2];
  return <Badge text={kind} color={c} bg={b} />;
}

export const st = StyleSheet.create({
  card: { backgroundColor: C.surface, borderRadius: R.l, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, padding: S.m },
  sectionHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: S.s },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  badge: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, maxWidth: 180 },
  banner: { flexDirection: 'row', alignItems: 'center', padding: S.s + 2, borderRadius: R.m, borderWidth: StyleSheet.hairlineWidth, marginBottom: S.s },
  btn: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 16, borderRadius: R.m },
  seg: { flexDirection: 'row', backgroundColor: C.surface, borderRadius: R.m, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line },
  segItem: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 9 },
  segOn: { backgroundColor: C.surface2 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, borderColor: C.line, backgroundColor: C.surface },
});
