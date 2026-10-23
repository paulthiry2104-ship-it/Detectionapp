import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, Switch, Text, View } from 'react-native';
import { popup } from '../../lib/push';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../components/Screen';
import { Badge, Button, Card, Empty, Loading, Section, Segmented } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { dateTime } from '../../lib/format';
import { C, S, T } from '../../lib/theme';

const TYPE_LABEL: Record<string, string> = {
  price_above: 'Prix au-dessus de', price_below: 'Prix en dessous de', volume_spike: 'Pic de volume',
  catalyst_confirmed: 'Catalyseur confirmé', entered_list: 'Entrée dans une liste',
};

export default function Alerts() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [tab, setTab] = useState<'events' | 'rules'>('events');
  const ev = useApi<any>('/api/alerts/events');
  const rules = useApi<any>('/api/alerts/rules');
  useFocusEffect(useCallback(() => { ev.reload(); rules.reload(); api('/api/alerts/events/read', { method: 'POST' }).catch(() => undefined); }, []));

  const addGlobal = async (type: 'entered_list' | 'catalyst_confirmed', params: any) => {
    try { await api('/api/alerts/rules', { method: 'POST', body: { type, params, tokenId: null } }); rules.reload(); }
    catch (e: any) { popup('Erreur', e.message); }
  };

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Screen refreshing={ev.refreshing} onRefresh={() => { ev.reload(); rules.reload(); }} offline={ev}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.m }}>
          <Text style={[T.h1, { flex: 1 }]}>Alertes</Text>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10}><Ionicons name="options-outline" size={22} color={C.text} /></Pressable>
        </View>
        <Segmented value={tab} onChange={setTab} options={[{ key: 'events', label: 'Historique' }, { key: 'rules', label: 'Mes règles' }]} />
        <View style={{ height: S.m }} />

        {tab === 'events' ? (
          ev.loading ? <Loading /> : (ev.data?.items ?? []).length === 0 ? <Empty icon="notifications-off-outline" title="Aucune alerte" text="Les alertes déclenchées apparaîtront ici, même si le push n’est pas activé." /> :
            (ev.data.items as any[]).map((e) => (
              <Card key={e.id} style={{ marginBottom: S.s }} onPress={e.token_id ? () => router.push({ pathname: '/token/[id]', params: { id: e.token_id } }) : e.data?.type === 'daily_report' ? () => router.push('/report') : undefined}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Text style={[T.h3, { flex: 1 }]} numberOfLines={2}>{e.title}</Text>
                  {!e.read ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: C.ai }} /> : null}
                </View>
                <Text style={[T.sub, { marginTop: 2 }]}>{e.body}</Text>
                <Text style={[T.tiny, { marginTop: 4 }]}>{dateTime(e.ts)} · {'vérifié à l’ouverture de l’app'}</Text>
              </Card>
            ))
        ) : (
          <>
            {rules.loading ? <Loading /> : (rules.data?.items ?? []).length === 0 ? <Text style={[T.sub, { marginBottom: S.m }]}>Aucune règle. Les alertes de prix et de volume se créent depuis la fiche d’un token.</Text> :
              (rules.data.items as any[]).map((r) => (
                <Card key={r.id} style={{ marginBottom: S.s }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={T.h3}>{TYPE_LABEL[r.type] ?? r.type}{r.params?.price ? ` ${r.params.price} $` : ''}{r.params?.multiple ? ` ×${r.params.multiple}` : ''}</Text>
                      <Text style={T.tiny}>{r.symbol ?? (r.params?.favoritesOnly ? 'Favoris uniquement' : 'Tous les tokens')}{r.params?.horizon ? ` · ${r.params.horizon}` : ''}{r.params?.maxRank ? ` · top ${r.params.maxRank}` : ''} · délai mini {r.cooldown_minutes} min</Text>
                    </View>
                    <Switch value={!!r.enabled} onValueChange={async (v) => { await api(`/api/alerts/rules/${r.id}`, { method: 'PATCH', body: { enabled: v } }); rules.reload(); }} trackColor={{ true: C.ai, false: C.surface2 }} />
                    <Pressable onPress={async () => { await api(`/api/alerts/rules/${r.id}`, { method: 'DELETE' }); rules.reload(); }} hitSlop={10} style={{ marginLeft: 12 }}>
                      <Ionicons name="trash-outline" size={18} color={C.down} />
                    </Pressable>
                  </View>
                </Card>
              ))}
            <Section title="Ajouter une règle globale">
              <View style={{ gap: S.s }}>
                <Button kind="ghost" icon="trending-up" title="Un favori entre dans une liste" onPress={() => addGlobal('entered_list', { favoritesOnly: true })} />
                <Button kind="ghost" icon="podium-outline" title="Un token entre dans le top 10 « Cette semaine »" onPress={() => addGlobal('entered_list', { horizon: 'week', maxRank: 10 })} />
                              </View>
              <View style={{ marginTop: S.m }}><Badge text="Les données manifestement aberrantes (prix ×20 non confirmé, volume sans liquidité) ne déclenchent pas d’alerte." /></View>
            </Section>
          </>
        )}
      </Screen>
    </View>
  );
}
