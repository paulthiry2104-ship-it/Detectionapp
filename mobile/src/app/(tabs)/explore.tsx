import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../components/Screen';
import { Badge, Card, CopyCA, Empty, Loading, Segmented, TokenLogo } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { ago, pct, price, usd } from '../../lib/format';
import { C, R, S, T } from '../../lib/theme';

type Sort = 'new' | 'volume' | 'liquidity' | 'gainers';

export default function Explore() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [sort, setSort] = useState<Sort>('new');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [searching, setSearching] = useState(false);
  const list = useApi<any>(`/api/explore?sort=${sort}`, [sort]);

  useEffect(() => {
    if (q.trim().length < 2) { setResults(null); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try { setResults((await api(`/api/search?q=${encodeURIComponent(q.trim())}&live=1`)).items); } catch { setResults([]); } finally { setSearching(false); }
    }, 400);
    return () => clearTimeout(t);
  }, [q]);

  const open = (id: string) => router.push({ pathname: '/token/[id]', params: { id } });
  const rows = results ?? list.data?.items ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Screen refreshing={list.refreshing} onRefresh={list.reload} offline={list}>
        <Text style={[T.h1, { marginBottom: S.m }]}>Explorer</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.m, paddingHorizontal: 10, borderWidth: 0.5, borderColor: C.line, marginBottom: S.m }}>
          <Ionicons name="search" size={16} color={C.dim} />
          <TextInput value={q} onChangeText={setQ} placeholder="Nom, symbole ou adresse de contrat" placeholderTextColor={C.dim} style={{ flex: 1, color: C.text, paddingVertical: 11, marginLeft: 6, fontSize: 15 }} autoCorrect={false} autoCapitalize="none" />
        </View>
        {results == null ? (
          <View style={{ marginBottom: S.m }}>
            <Segmented<Sort> value={sort} onChange={setSort} options={[{ key: 'new', label: 'Nouveaux' }, { key: 'volume', label: 'Volume' }, { key: 'liquidity', label: 'Liquidité' }, { key: 'gainers', label: 'Hausses 24h' }]} />
          </View>
        ) : <Text style={[T.sub, { marginBottom: S.s }]}>{searching ? 'Recherche…' : `${rows.length} résultat(s) — base locale + DexScreener`}</Text>}

        <Card onPress={() => router.push('/suspects')} style={{ marginBottom: S.m, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Ionicons name="warning" size={18} color={C.warn} />
          <Text style={[T.body, { flex: 1 }]}>Tokens suspects (honeypots, faux contrats, liquidité nulle…)</Text>
          <Ionicons name="chevron-forward" size={16} color={C.dim} />
        </Card>

        {list.loading && !results ? <Loading /> : rows.length === 0 ? <Empty title="Rien à afficher" text="Les découvertes apparaissent après les premières détections du serveur." /> : rows.map((t: any) => (
          <Card key={t.id} onPress={() => open(t.id)} style={{ marginBottom: S.s, flexDirection: 'row', alignItems: 'center' }}>
            <TokenLogo uri={t.logo_url} symbol={t.symbol} size={32} />
            <View style={{ flex: 1, marginLeft: S.s }}>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <Text style={T.h3}>{t.symbol}</Text>
                <CopyCA address={t.contract_address} />
                {t.status === 'suspect' ? <Badge text="suspect" color={C.down} bg={C.downBg} /> : null}
                {String(t.discovered_via ?? '').includes('boost') ? <Badge text="promo payante" color={C.warn} bg={C.warnBg} /> : null}
              </View>
              <Text style={T.tiny} numberOfLines={1}>{t.name} · {t.chain ?? '—'}{t.first_seen_at ? ` · repéré ${ago(t.first_seen_at)}` : ''}</Text>
            </View>
            {t.price_usd != null ? (
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={T.num}>{price(t.price_usd)}</Text>
                <Text style={{ color: (t.change_24h ?? 0) >= 0 ? C.up : C.down, fontSize: 12 }}>{pct(t.change_24h)}</Text>
                <Text style={T.tiny}>vol {usd(t.volume_24h)} · liq {t.liquidity_usd != null ? usd(t.liquidity_usd) : 'n.d.'}</Text>
              </View>
            ) : null}
          </Card>
        ))}
      </Screen>
    </View>
  );
}
