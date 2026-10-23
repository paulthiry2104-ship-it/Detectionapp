import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { Screen } from '../components/Screen';
import { Button, Card, Row, Section } from '../components/ui';
import { api, DEFAULT_DATA_URL, getConnection, setConnection, useApi } from '../lib/api';
import { ago } from '../lib/format';
import { enableLocalNotifications, popup } from '../lib/push';
import { C, R, S, T } from '../lib/theme';

const LABELS: Record<string, string> = { volumeAccel: 'Volume', liquidityGrowth: 'Liquidité', onchain: 'On-chain', community: 'Communauté', narrative: 'Narrative', catalyst: 'Catalyseur', headroom: 'Marge', tokenomics: 'Tokenomics' };

export default function Settings() {
  const router = useRouter();
  const [url, setUrl] = useState('');
  const [test, setTest] = useState<string | null>(null);
  const settings = useApi<any>('/api/settings');
  useEffect(() => { getConnection().then((c) => setUrl(c.url)); }, []);

  const save = async () => {
    await setConnection(url);
    try {
      const st = await api('/api/status');
      setTest(`✓ Données trouvées · dernière analyse ${ago(st.lastRankingRun?.at)} · ${st.tokensTracked} tokens suivis`);
    } catch (e: any) { setTest(`✗ ${e.message}`); }
  };
  const weights = settings.data?.weights;

  return (
    <Screen>
      <Section title="Source des données">
        <Card>
          <Text style={T.tiny}>Les analyses sont faites chaque jour par GitHub et publiées ici. Laisse la valeur par défaut.</Text>
          <TextInput value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder={DEFAULT_DATA_URL} placeholderTextColor={C.dim}
            style={{ color: C.text, backgroundColor: C.surface2, borderRadius: R.m, padding: 11, marginTop: 6, marginBottom: S.m, fontSize: 13 }} />
          <Button title="Enregistrer et tester" icon="checkmark" onPress={save} />
          {test ? <Text style={[T.sub, { marginTop: S.s, color: test.startsWith('✓') ? C.up : C.down }]}>{test}</Text> : null}
        </Card>
      </Section>

      <Section title="Notifications">
        <Card>
          <Text style={[T.sub, { marginBottom: S.s }]}>Version gratuite : les alertes (prix, volume, entrée dans une liste) sont vérifiées à chaque ouverture de l’app, sur les dernières données (actualisées toutes les 3 h). Elles s’affichent dans l’onglet Alertes.</Text>
          <Button kind="ghost" icon="notifications" title="Autoriser les notifications" onPress={async () => popup('Notifications', await enableLocalNotifications())} />
        </Card>
      </Section>

      {weights ? (
        <Section title="Pondérations du score (7 j / 30 j / 12 mois)">
          <Card>
            {Object.keys(LABELS).map((k) => (
              <Row key={k} label={LABELS[k]} value={`${Math.round((weights.week[k] ?? 0) * 100)} / ${Math.round((weights.month[k] ?? 0) * 100)} / ${Math.round((weights.year[k] ?? 0) * 100)} %`} />
            ))}
            <Text style={[T.tiny, { marginTop: S.s }]}>Version {weights.version}. Pour les modifier : demande-moi, je change le fichier de réglages du dépôt.</Text>
          </Card>
        </Section>
      ) : null}

      <Section title="Plus">
        <View style={{ gap: S.s }}>
          <Button kind="ghost" icon="newspaper-outline" title="Rapport du jour" onPress={() => router.push('/report')} />
          <Button kind="ghost" icon="time-outline" title="Historique et performances" onPress={() => router.push('/history')} />
          <Button kind="ghost" icon="book-outline" title="Sources et méthodologie" onPress={() => router.push('/methodology')} />
        </View>
      </Section>
    </Screen>
  );
}
