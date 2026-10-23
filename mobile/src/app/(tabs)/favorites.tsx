import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../components/Screen';
import { Card, CopyCA, Empty, Loading, TokenLogo } from '../../components/ui';
import { useApi } from '../../lib/api';
import { ago, pct, price, usd } from '../../lib/format';
import { C, S, T } from '../../lib/theme';

export default function Favorites() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const fav = useApi<any>('/api/favorites');
  useFocusEffect(useCallback(() => { fav.reload(); }, []));
  const items = fav.data?.items ?? [];
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Screen refreshing={fav.refreshing} onRefresh={fav.reload} offline={fav}>
        <Text style={[T.h1, { marginBottom: S.m }]}>Favoris</Text>
        {fav.loading ? <Loading /> : items.length === 0 ? (
          <Empty icon="star-outline" title="Aucun favori" text="Ajoute un token depuis sa fiche (étoile en haut à droite)." />
        ) : items.map((t: any) => (
          <Card key={t.id} onPress={() => router.push({ pathname: '/token/[id]', params: { id: t.id } })} style={{ marginBottom: S.s, flexDirection: 'row', alignItems: 'center' }}>
            <TokenLogo uri={t.logo_url} symbol={t.symbol} />
            <View style={{ flex: 1, marginLeft: S.s }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Text style={T.h3}>{t.symbol}</Text><CopyCA address={t.contract_address} /></View>
              <Text style={T.tiny}>{t.name} · cap. {usd(t.market_cap)} · {ago(t.ts)}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={T.num}>{price(t.price_usd)}</Text>
              <Text style={{ color: (t.change_24h ?? 0) >= 0 ? C.up : C.down, fontSize: 12, fontWeight: '700' }}>{pct(t.change_24h)}</Text>
            </View>
          </Card>
        ))}
      </Screen>
    </View>
  );
}
