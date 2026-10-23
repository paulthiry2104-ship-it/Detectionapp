import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Screen } from '../../components/Screen';
import { type CardData, TokenCard } from '../../components/TokenCard';
import { Banner, Button, Card, Chip, Empty, Loading, Segmented } from '../../components/ui';
import { useApi } from '../../lib/api';
import { ago, date, dateTime } from '../../lib/format';
import { C, R, S, T } from '../../lib/theme';

type H = 'week' | 'month' | 'year';
const CAPS = [
  { k: 'all', label: 'Toutes cap.', min: undefined, max: undefined },
  { k: 'micro', label: '< 10 M$', min: 0, max: 1e7 },
  { k: 'small', label: '10–100 M$', min: 1e7, max: 1e8 },
  { k: 'mid', label: '100 M$–1 Md$', min: 1e8, max: 1e9 },
  { k: 'large', label: '> 1 Md$', min: 1e9, max: undefined },
] as const;
const CHAINS = [
  { k: 'all', label: 'Toutes chaînes' }, { k: 'solana', label: 'Solana' }, { k: 'ethereum', label: 'Ethereum' },
  { k: 'base', label: 'Base' }, { k: 'bsc', label: 'BNB' }, { k: 'arbitrum', label: 'Arbitrum' },
];

export default function Home() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const res = useApi<any>('/api/home');
  const [h, setH] = useState<H>('week');
  const [q, setQ] = useState('');
  const [cap, setCap] = useState<(typeof CAPS)[number]['k']>('all');
  const [chain, setChain] = useState('all');
  const [cat, setCat] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const list = res.data?.lists?.[h];
  const status = res.data?.status;
  const categories = useMemo(() => {
    const all = new Set<string>();
    for (const k of ['week', 'month', 'year']) for (const i of res.data?.lists?.[k]?.items ?? []) if (i.narrative) all.add(i.narrative);
    return [...all].sort();
  }, [res.data]);

  const items: CardData[] = useMemo(() => {
    const c = CAPS.find((x) => x.k === cap)!;
    return (list?.items ?? []).filter((i: CardData) => {
      if (q && !`${i.symbol} ${i.name}`.toLowerCase().includes(q.toLowerCase())) return false;
      if (chain !== 'all' && i.chain !== chain) return false;
      if (cat && i.narrative !== cat) return false;
      if (c.min != null && (i.marketCap ?? -1) < c.min) return false;
      if (c.max != null && (i.marketCap == null || i.marketCap > c.max)) return false;
      return true;
    });
  }, [list, q, cap, chain, cat]);

  const notConfigured = res.status === 404 && !res.data;
  const activeFilters = (cap !== 'all' ? 1 : 0) + (chain !== 'all' ? 1 : 0) + (cat ? 1 : 0);

  return (
    <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top }}>
      <Screen refreshing={res.refreshing} onRefresh={res.reload} offline={notConfigured ? undefined : res}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: S.s }}>
          <Ionicons name="radio" size={26} color={C.ai} />
          <Text style={[T.h1, { marginLeft: 8, flex: 1 }]}>Crypto Radar</Text>
          <Pressable onPress={() => router.push('/report')} hitSlop={10} style={{ marginRight: 16 }}><Ionicons name="newspaper-outline" size={22} color={C.text} /></Pressable>
          <Pressable onPress={() => router.push('/settings')} hitSlop={10}><Ionicons name="settings-outline" size={22} color={C.text} /></Pressable>
        </View>

        {status ? (
          <Text style={[T.sub, { marginBottom: S.s }]}>
            Dernière analyse {ago(status.lastRankingRun?.at)} · <Text style={{ color: C.text, fontWeight: '700' }}>{status.projectsAnalyzed}</Text> projets analysés
            {status.scheduler?.nextDaily ? ` · prochaine analyse ${dateTime(status.scheduler.nextDaily)}` : ''}
          </Text>
        ) : null}
        {(status?.warnings ?? []).slice(0, 3).map((w: string) => <Banner key={w} text={w} onPress={() => router.push('/history')} />)}

        <View style={{ flexDirection: 'row', gap: S.s, marginBottom: S.s }}>
          <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: R.m, paddingHorizontal: 10, borderWidth: 0.5, borderColor: C.line }}>
            <Ionicons name="search" size={16} color={C.dim} />
            <TextInput value={q} onChangeText={setQ} placeholder="Rechercher dans la liste" placeholderTextColor={C.dim} style={{ flex: 1, color: C.text, paddingVertical: 10, marginLeft: 6, fontSize: 15 }} autoCorrect={false} autoCapitalize="none" />
          </View>
          <Pressable onPress={() => setShowFilters((v) => !v)} style={{ backgroundColor: activeFilters ? C.aiBg : C.surface, borderRadius: R.m, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 0.5, borderColor: activeFilters ? C.ai : C.line }}>
            <Ionicons name="options-outline" size={18} color={activeFilters ? C.ai : C.text} />
          </Pressable>
        </View>
        {showFilters ? (
          <View style={{ gap: 8, marginBottom: S.s }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{CAPS.map((c) => <Chip key={c.k} label={c.label} on={cap === c.k} onPress={() => setCap(c.k)} />)}</ScrollView>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>{CHAINS.map((c) => <Chip key={c.k} label={c.label} on={chain === c.k} onPress={() => setChain(c.k)} />)}</ScrollView>
            {categories.length ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }}>
                <Chip label="Toutes catégories" on={!cat} onPress={() => setCat(null)} />
                {categories.map((c) => <Chip key={c} label={c} on={cat === c} onPress={() => setCat(c)} />)}
              </ScrollView>
            ) : null}
          </View>
        ) : null}

        <Segmented<H> value={h} onChange={setH} options={[{ key: 'week', label: 'Cette semaine' }, { key: 'month', label: 'Le mois prochain' }, { key: 'year', label: 'Durant l’année' }]} />
        {list?.window ? <Text style={[T.tiny, { marginTop: 6, marginBottom: S.s }]}>Fenêtre : du {date(list.window.start)} au {date(list.window.end)} · classement {list.run?.job === 'daily' ? 'quotidien' : 'actualisé'} {ago(list.run?.at)}</Text> : <View style={{ height: S.s }} />}

        {notConfigured ? (
          <Card><Empty icon="hourglass-outline" title="Première analyse en cours" text="GitHub n’a pas encore publié de données. Reviens dans quelques minutes (l’analyse complète prend ~10 min)." action={<Button kind="ghost" title="Paramètres" onPress={() => router.push('/settings')} />} /></Card>
        ) : res.loading ? <Loading /> : !list?.run ? (
          <Card><Empty title="Aucune analyse disponible" text="Le classement apparaîtra après la première analyse réussie du serveur. Aucun token n’est affiché tant qu’il n’a pas été calculé sur des données réelles." /></Card>
        ) : items.length === 0 ? (
          <Card><Empty icon="filter" title="Aucun projet" text={activeFilters || q ? 'Aucun projet ne correspond aux filtres.' : 'Aucun projet n’a assez de données pour cet horizon. Mieux vaut une liste vide qu’un classement fabriqué.'} /></Card>
        ) : (
          items.map((t) => <TokenCard key={t.id} t={t} horizon={h} />)
        )}

        <Text style={[T.tiny, { marginTop: S.l, textAlign: 'center' }]}>Scores et scénarios = estimations d’un modèle, pas des promesses ni des conseils en investissement.</Text>
      </Screen>
    </View>
  );
}
