import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Badge, Banner, Card, Empty, Loading, Section } from '../components/ui';
import { useApi } from '../lib/api';
import { date, dateTime } from '../lib/format';
import { C, S, T } from '../lib/theme';

const H: Record<string, string> = { week: '7 j', month: '30 j', year: '12 mois' };

export default function Report() {
  const router = useRouter();
  const r = useApi<any>('/api/report');
  const open = (id: string) => router.push({ pathname: '/token/[id]', params: { id } });
  if (r.loading) return <Loading />;
  if (!r.data) {
    return (
      <Screen offline={r.status === 404 ? undefined : r} onRefresh={r.reload} refreshing={r.refreshing}>
        <Empty icon="newspaper-outline" title="Aucun rapport" text="Le premier rapport est produit par l’analyse quotidienne de 06 h (heure de Paris). Aucun rapport n’est créé si l’analyse échoue." />
      </Screen>
    );
  }
  const d = r.data;
  const runStatus = d.run?.status;
  return (
    <Screen refreshing={r.refreshing} onRefresh={r.reload} offline={r}>
      <Text style={T.h2}>Rapport du {date(d.reportDate)}</Text>
      <Text style={[T.sub, { marginBottom: S.s }]}>Analyse terminée le {dateTime(d.run?.finished_at)} · {runStatus === 'success' ? 'complète' : 'partielle'}</Text>
      {runStatus === 'partial' ? <Banner text="Analyse partielle : certaines sources n’ont pas répondu. Détails en bas de page." /> : null}
      {(d.status?.warnings ?? []).map((w: string) => <Banner key={w} text={w} />)}

      <Section title={`Nouveaux projets détectés (${d.newProjects.length})`}>
        {d.newProjects.length === 0 ? <Text style={T.sub}>Aucun nouveau projet retenu.</Text> : d.newProjects.map((p: any) => (
          <Card key={p.token.id} onPress={() => open(p.token.id)} style={{ marginBottom: 6 }}>
            <Text style={T.h3}>{p.token.symbol} <Text style={T.tiny}>{p.token.name} · {p.token.chain ?? '—'}</Text></Text>
            <Text style={T.tiny}>{p.best?.score != null ? `Meilleur score ${Math.round(p.best.score)} (${H[p.best.horizon]}, rang ${p.best.rank})` : p.best?.status === 'insufficient' ? 'Données insuffisantes pour l’instant' : 'Pas encore classé'}</Text>
          </Card>
        ))}
      </Section>

      <Section title="Plus fortes progressions de score">
        {d.topGainers.length === 0 ? <Text style={T.sub}>Pas de comparaison possible (première analyse) ou aucune progression notable.</Text> : d.topGainers.map((g: any) => (
          <Card key={`${g.horizon}${g.token.id}`} onPress={() => open(g.token.id)} style={{ marginBottom: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Text style={[T.h3, { flex: 1 }]}>{g.token.symbol} <Text style={T.tiny}>{H[g.horizon]}</Text></Text>
              <Text style={{ color: C.up, fontWeight: '800' }}>{Math.round(g.prevScore)} → {Math.round(g.score)}</Text>
            </View>
            <Text style={T.tiny}>Rang {g.prevRank ?? '—'} → {g.rank}{g.reasons?.length ? ` · ${g.reasons.join(', ')}` : ''}</Text>
          </Card>
        ))}
      </Section>

      <Section title="Changements de narrative">
        {d.narratives.note ? <Text style={T.sub}>{d.narratives.note}</Text> : null}
        {d.narratives.emerging.map((n: any) => <Text key={n.id} style={[T.body, { color: C.up }]}>▲ {n.name} : rang {n.rank7dAgo} → {n.rank}</Text>)}
        {d.narratives.fading.map((n: any) => <Text key={n.id} style={[T.body, { color: C.down }]}>▼ {n.name} : rang {n.rank7dAgo} → {n.rank}</Text>)}
      </Section>

      <Section title="Prochains catalyseurs (30 j)">
        {d.catalysts.confirmed.length === 0 ? <Text style={T.sub}>Aucun catalyseur confirmé et sourcé.</Text> : d.catalysts.confirmed.map((c: any) => (
          <Card key={c.id} onPress={() => open(c.token_id)} style={{ marginBottom: 6 }}>
            <Text style={T.h3}>{c.symbol} · {date(c.event_date)}</Text>
            <Text style={T.sub}>{c.title}</Text>
            <Text style={T.tiny}>{c.source_name}</Text>
          </Card>
        ))}
        {d.catalysts.unconfirmed.length ? <Text style={[T.tiny, { marginTop: 6 }]}>+ {d.catalysts.unconfirmed.length} événement(s) NON confirmé(s), listés à part sur les fiches.</Text> : null}
      </Section>

      <Section title="Retirés des listes">
        {d.removed.length === 0 ? <Text style={T.sub}>Aucun retrait.</Text> : d.removed.map((x: any, i: number) => (
          <Card key={`${x.tokenId}${x.horizon}${i}`} onPress={() => open(x.tokenId)} style={{ marginBottom: 6 }}>
            <Text style={T.h3}>{x.token?.symbol} <Text style={T.tiny}>{H[x.horizon]} · ex-rang {x.prevRank}</Text></Text>
            <Text style={T.tiny}>{x.reason}</Text>
          </Card>
        ))}
      </Section>

      <Section title="Multiplicateurs modifiés">
        {d.multiplierChanges.length === 0 ? <Text style={T.sub}>Aucun changement significatif (&gt; 25 %).</Text> : d.multiplierChanges.map((x: any) => (
          <Text key={`${x.token.id}${x.horizon}`} style={T.body}>{x.token.symbol} ({H[x.horizon]}) : {x.from} → {x.to}</Text>
        ))}
      </Section>

      <Section title="Données manquantes et non confirmées">
        <Card>
          <Text style={T.sub}>{d.dataGaps.insufficientTokens} token(s) en « données insuffisantes » · {d.dataGaps.suspectsDetected} suspect(s) écarté(s)</Text>
          {d.dataGaps.providerIssues.map((p: string) => <Text key={p} style={[T.tiny, { marginTop: 4, color: C.warn }]}>• {p}</Text>)}
          {d.dataGaps.failedSteps.map((p: any) => <Text key={p.name} style={[T.tiny, { marginTop: 4, color: C.down }]}>• Étape « {p.name} » : {p.error}</Text>)}
        </Card>
        <View style={{ marginTop: S.s, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          {(d.run?.steps ?? []).map((s: any) => <Badge key={s.name} text={`${s.ok ? '✓' : '✗'} ${s.name.replace(/^\d+\. /, '')}`} color={s.ok ? C.up : C.down} />)}
        </View>
      </Section>
    </Screen>
  );
}
