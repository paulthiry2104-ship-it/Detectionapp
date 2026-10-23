import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Card, Loading, Row, Section, Segmented } from '../components/ui';
import { useApi } from '../lib/api';
import { dateTime } from '../lib/format';
import { C, S, T } from '../lib/theme';

const p = (v: number | null | undefined) => (v == null ? '—' : `${(v * 100).toFixed(0)} %`);
const r = (v: number | null | undefined) => (v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(1).replace('.', ',')} %`);

export default function History() {
  const router = useRouter();
  const [h, setH] = useState<'week' | 'month' | 'year'>('week');
  const runs = useApi<any>('/api/history/runs');
  const perf = useApi<any>('/api/performance');
  const ph = perf.data?.horizons?.[h];

  return (
    <Screen refreshing={runs.refreshing} onRefresh={() => { runs.reload(); perf.reload(); }} offline={runs}>
      <Section title="Performances passées des signaux">
        <Segmented value={h} onChange={setH} options={[{ key: 'week', label: '7 jours' }, { key: 'month', label: '30 jours' }, { key: 'year', label: '12 mois' }]} />
        {perf.loading ? <Loading /> : !ph ? null : (
          <Card style={{ marginTop: S.s }}>
            {ph.note ? <Text style={[T.sub, { marginBottom: S.s }]}>{ph.note}</Text> : null}
            <Row label="Classements évalués" value={String(ph.overall.n)} hint={`${ph.inProgress} encore en cours`} />
            <Row label="Rendement médian" value={r(ph.overall.medianReturn)} valueColor={(ph.overall.medianReturn ?? 0) >= 0 ? C.up : C.down} />
            <Row label="Part en hausse" value={p(ph.overall.hitRate)} />
            <Row label="Ont doublé au moins une fois" value={p(ph.overall.doubledAtPeak)} />
            <Row label="Ont atteint le scénario haussier" value={p(ph.overall.reachedScenario)} />
            <Row label="Ont battu le Bitcoin" value={p(ph.overall.beatBtc)} />
            <Row label="Disparus (comptés, dernier prix)" value={p(ph.overall.disappeared)} valueColor={C.warn} />
            <Row label="Top 10 — rendement médian" value={r(ph.top10.medianReturn)} />
            <Row label="Rangs 11–50 — rendement médian" value={r(ph.rest.medianReturn)} />
            <Text style={[T.tiny, { marginTop: S.s }]}>{perf.data.method}</Text>
          </Card>
        )}
        {ph?.worst?.length ? (
          <Card style={{ marginTop: S.s }}>
            <Text style={[T.sub, { color: C.text }]}>Pires résultats</Text>
            {ph.worst.slice(0, 5).map((o: any, i: number) => <Text key={i} style={T.tiny} onPress={() => router.push({ pathname: '/token/[id]', params: { id: o.tokenId } })}>• {o.symbol} (rang {o.rank}, {dateTime(o.ts)}) : {r(o.ret)} {o.state === 'disparu' ? '— disparu' : ''}</Text>)}
          </Card>
        ) : null}
      </Section>

      <Section title="Historique des analyses">
        {runs.loading ? <Loading /> : (runs.data?.items ?? []).map((x: any) => (
          <Card key={x.id} style={{ marginBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={[T.h3, { flex: 1 }]}>{x.job === 'daily' ? 'Analyse quotidienne' : 'Actualisation'}</Text>
              <Badge text={x.status} color={x.status === 'success' ? C.up : x.status === 'partial' ? C.warn : x.status === 'running' ? C.ai : C.down} />
            </View>
            <Text style={T.tiny}>{dateTime(x.started_at)} → {x.finished_at ? dateTime(x.finished_at) : '…'} · {x.trigger}</Text>
            {x.error ? <Text style={[T.tiny, { color: C.down }]}>{x.error}</Text> : null}
            {x.stats?.rankings ? <Text style={T.tiny}>Classés : 7 j {x.stats.rankings.week?.ranked ?? 0} · 30 j {x.stats.rankings.month?.ranked ?? 0} · 12 mois {x.stats.rankings.year?.ranked ?? 0}</Text> : null}
          </Card>
        ))}
      </Section>
    </Screen>
  );
}
