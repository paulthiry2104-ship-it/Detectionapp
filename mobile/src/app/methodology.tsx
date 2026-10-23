import { Text } from 'react-native';
import { Screen } from '../components/Screen';
import { Card, Loading, Row, Section } from '../components/ui';
import { useApi } from '../lib/api';
import { C, S, T } from '../lib/theme';

export default function Methodology() {
  const m = useApi<any>('/api/methodology');
  if (m.loading) return <Loading />;
  const d = m.data;
  if (!d) return <Screen offline={m}><Text style={T.sub}>Indisponible.</Text></Screen>;
  return (
    <Screen offline={m} refreshing={m.refreshing} onRefresh={m.reload}>
      <Text style={T.body}>Crypto Radar classe des projets à partir de données réelles récupérées par le serveur. Il distingue toujours les données <Text style={{ color: C.up }}>observées</Text>, les <Text style={{ color: C.warn }}>hypothèses</Text> et les <Text style={{ color: C.ai }}>estimations</Text> du modèle.</Text>

      <Section title="Horizons">
        <Card>{Object.entries(d.horizons).map(([k, v]) => <Text key={k} style={[T.sub, { marginBottom: 6 }]}>• {String(v)}</Text>)}</Card>
      </Section>

      <Section title="Score de potentiel (0–100)">
        <Card>
          <Text style={[T.sub, { marginBottom: S.s }]}>Moyenne pondérée des critères DISPONIBLES, puis pénalités (manipulation, token déjà très monté) et facteur de fiabilité. Si moins de {Math.round(d.weights.minCoverage * 100)} % des critères (pondérés) sont disponibles : « Données insuffisantes ».</Text>
          {Object.entries(d.components).map(([k, label]) => (
            <Row key={k} label={String(label)} value={`${Math.round(d.weights.week[k] * 100)} / ${Math.round(d.weights.month[k] * 100)} / ${Math.round(d.weights.year[k] * 100)} %`} />
          ))}
          <Text style={[T.tiny, { marginTop: 6 }]}>Poids 7 j / 30 j / 12 mois — modifiables dans Paramètres. Version : {d.weights.version}</Text>
        </Card>
      </Section>

      <Section title="Multiplicateurs">
        <Card><Text style={T.sub}>{d.multipliers}</Text><Text style={[T.tiny, { marginTop: 6 }]}>Une capitalisation théorique n’est pas de l’argent qui peut être retiré : la liquidité réelle est signalée.</Text></Card>
      </Section>

      <Section title="Confiance dans les données">
        <Card><Text style={T.sub}>{d.confidence}</Text></Card>
      </Section>

      <Section title="Sources">
        {d.sources.map((s: any) => (
          <Card key={s.name} style={{ marginBottom: 6 }}>
            <Text style={T.h3}>{s.name}</Text>
            <Text style={T.sub}>{s.use}</Text>
            <Text style={T.tiny}>Clé : {s.key}</Text>
          </Card>
        ))}
        <Text style={[T.tiny, { marginTop: 4 }]}>Catalyseurs automatiques : {d.catalystSourceActive ? 'actifs (CoinMarketCal)' : 'inactifs (pas de clé CoinMarketCal)'}</Text>
      </Section>

      <Section title="Limites connues">
        <Card>{d.limits.map((l: string) => <Text key={l} style={[T.sub, { marginBottom: 6 }]}>• {l}</Text>)}</Card>
      </Section>
      <Text style={[T.tiny, { marginTop: S.l }]}>Rien ici n’est un conseil en investissement. Les microcaps et memecoins peuvent perdre 100 % de leur valeur.</Text>
    </Screen>
  );
}
