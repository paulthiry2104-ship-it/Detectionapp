import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Banner, Card, Empty, Loading, TokenLogo } from '../components/ui';
import { useApi } from '../lib/api';
import { ago, shortAddr } from '../lib/format';
import { S, T } from '../lib/theme';

export default function Suspects() {
  const router = useRouter();
  const s = useApi<any>('/api/suspects');
  return (
    <Screen refreshing={s.refreshing} onRefresh={s.reload} offline={s}>
      <Banner kind="error" text="Ces tokens présentent des signaux de risque. Ils ne sont jamais présentés comme des opportunités." />
      {s.loading ? <Loading /> : (s.data?.items ?? []).length === 0 ? <Empty title="Aucun suspect récent" /> : s.data.items.map((t: any) => (
        <Card key={t.id} onPress={() => router.push({ pathname: '/token/[id]', params: { id: t.id } })} style={{ marginBottom: S.s, flexDirection: 'row', gap: S.s }}>
          <TokenLogo uri={t.logo_url} symbol={t.symbol} size={32} />
          <View style={{ flex: 1 }}>
            <Text style={T.h3}>{t.symbol} <Text style={T.tiny}>{t.chain} · {shortAddr(t.contract_address)} · {ago(t.last_seen_at)}</Text></Text>
            <Text style={T.sub}>{t.status_reason}</Text>
          </View>
        </Card>
      ))}
    </Screen>
  );
}
