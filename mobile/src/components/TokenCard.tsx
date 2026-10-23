import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';
import { ago, pct, price, usd } from '../lib/format';
import { C, S, T } from '../lib/theme';
import { Badge, Card, TokenLogo } from './ui';

export type CardData = {
  id: string; rank: number | null; symbol: string; name: string; chain: string | null; chainLabel: string | null; logo: string | null;
  narrative: string | null; price: number | null; marketCap: number | null; change24h: number | null; change7d: number | null;
  volume24h: number | null; liquidity: number | null; score: number | null; confidence: number; status: string;
  scenario: { display: string; kind: string; label: string; horizon: string } | null; scenarioReason: string | null;
  catalyst: { days: number; title: string; status: string } | null; movement: { delta: number | null; entered: boolean; reasons: string[] } | null;
  updatedAt: string; risk: string;
};

const H_LABEL: Record<string, string> = { week: '7 j', month: '30 j', year: '12 mois' };

export function TokenCard({ t, horizon }: { t: CardData; horizon?: string }) {
  const router = useRouter();
  const ch = (v: number | null) => (v == null ? C.dim : v >= 0 ? C.up : C.down);
  const mv = t.movement;
  return (
    <Card onPress={() => router.push({ pathname: '/token/[id]', params: { id: t.id } })} style={{ marginBottom: S.s }}>
      <View style={s.top}>
        <Text style={s.rank}>{t.rank ?? '–'}</Text>
        <TokenLogo uri={t.logo} symbol={t.symbol} />
        <View style={{ flex: 1, marginLeft: S.s }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={T.h3} numberOfLines={1}>{t.symbol}</Text>
            {mv?.entered ? <Badge text="NOUVEAU" color={C.ai} bg={C.aiBg} /> : mv?.delta ? <Text style={{ color: mv.delta > 0 ? C.up : C.down, fontSize: 11, fontWeight: '800' }}>{mv.delta > 0 ? '▲' : '▼'}{Math.abs(mv.delta)}</Text> : null}
          </View>
          <Text style={T.tiny} numberOfLines={1}>{t.name} · {t.chainLabel ?? 'multi-chaînes'}{t.narrative ? ` · ${t.narrative}` : ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={T.num}>{price(t.price)}</Text>
          <Text style={{ color: ch(t.change24h), fontSize: 12, fontWeight: '700' }}>{pct(t.change24h)} <Text style={{ color: C.dim, fontWeight: '400' }}>24h</Text></Text>
        </View>
      </View>

      <View style={s.grid}>
        <Mini label="Cap." value={usd(t.marketCap)} />
        <Mini label="Vol. 24h" value={usd(t.volume24h)} />
        <Mini label="Liquidité" value={t.liquidity != null ? usd(t.liquidity) : 'n.d.'} />
        <Mini label="7 j" value={pct(t.change7d, 0)} color={ch(t.change7d)} />
      </View>

      <View style={s.bottom}>
        <View style={s.score}>
          <Text style={{ color: C.ai, fontWeight: '900', fontSize: 17 }}>{t.score != null ? Math.round(t.score) : '—'}</Text>
          <Text style={T.tiny}>score</Text>
        </View>
        <View style={{ flex: 1, gap: 4 }}>
          {t.scenario ? (
            <Text style={{ color: C.text, fontSize: 13 }} numberOfLines={1}>
              <Text style={{ color: C.ai, fontWeight: '800' }}>scénario {t.scenario.display}</Text>
              <Text style={{ color: C.dim }}> · {t.scenario.label.replace('Scénario ', '')} · {H_LABEL[horizon ?? ''] ?? t.scenario.horizon}</Text>
            </Text>
          ) : (
            <Text style={T.tiny} numberOfLines={1}>Pas de multiplicateur : {t.scenarioReason ?? 'aucun scénario défendable'}</Text>
          )}
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Badge text={`confiance ${t.confidence}`} color={t.confidence >= 70 ? C.up : t.confidence >= 45 ? C.warn : C.down} />
            {t.catalyst ? <Badge icon="calendar" text={`J-${t.catalyst.days} ${t.catalyst.status === 'confirmed' ? 'confirmé' : 'rumeur'}`} color={t.catalyst.status === 'confirmed' ? C.up : C.warn} /> : null}
            {t.risk !== 'faible' ? <Badge icon="alert-circle" text={`risque ${t.risk}`} color={C.warn} bg={C.warnBg} /> : null}
          </View>
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.dim} />
      </View>
      <Text style={[T.tiny, { marginTop: 6 }]}>Actualisé {ago(t.updatedAt)}</Text>
    </Card>
  );
}

function Mini({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={T.tiny}>{label}</Text>
      <Text style={[T.num, { fontSize: 13 }, color ? { color } : null]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'center' },
  rank: { color: C.dim, fontWeight: '800', width: 24, fontSize: 13 },
  grid: { flexDirection: 'row', marginTop: S.m, paddingTop: S.s, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, gap: S.s },
  bottom: { flexDirection: 'row', alignItems: 'center', marginTop: S.s, gap: S.s },
  score: { width: 50, height: 46, borderRadius: 12, backgroundColor: C.aiBg, alignItems: 'center', justifyContent: 'center' },
});
