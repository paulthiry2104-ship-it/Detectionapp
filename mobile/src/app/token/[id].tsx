import Ionicons from '@expo/vector-icons/Ionicons';
import * as Clipboard from 'expo-clipboard';
import { Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import { popup } from '../../lib/push';
import { Screen } from '../../components/Screen';
import { Badge, Banner, Button, Card, Kind, Loading, Meter, Row, Section, Segmented, SourceLink, Sparkline, TokenLogo } from '../../components/ui';
import { api, useApi } from '../../lib/api';
import { ago, date, dateTime, num, pct, price, shortAddr, usd } from '../../lib/format';
import { C, mono, R, S, T } from '../../lib/theme';

type H = 'week' | 'month' | 'year';

export default function TokenScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const d = useApi<any>(`/api/tokens/${encodeURIComponent(id)}`, [id]);
  const [h, setH] = useState<H>('month');
  const [fav, setFav] = useState<boolean | null>(null);

  if (d.loading) return <Loading />;
  if (!d.data) return <Screen offline={d}><Text style={T.sub}>Fiche indisponible.</Text></Screen>;
  const { identity: idn, market: m, narrative: nar, catalysts, horizons, signals, history, sources, missing } = d.data;
  const isFav = fav ?? d.data.favorite;
  const hz = horizons?.[h];

  const toggleFav = async () => {
    try {
      await api(`/api/favorites/${encodeURIComponent(id)}`, { method: isFav ? 'DELETE' : 'PUT' });
      setFav(!isFav);
    } catch (e: any) { popup('Erreur', e.message); }
  };

  return (
    <>
      <Stack.Screen options={{
        title: idn.symbol,
        headerRight: () => <Pressable onPress={toggleFav} hitSlop={10}><Ionicons name={isFav ? 'star' : 'star-outline'} size={22} color={isFav ? C.warn : C.text} /></Pressable>,
      }} />
      <Screen refreshing={d.refreshing} onRefresh={d.reload} offline={d}>
        {idn.status === 'suspect' ? <Banner kind="error" text={`Token SUSPECT — ce n’est pas une opportunité. ${idn.statusReason ?? ''}`} /> : null}
        {idn.status === 'delisted' ? <Banner text="Aucune donnée de marché récente : token inactif ou disparu." /> : null}

        {/* A. Identité et marché */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: S.m }}>
          <TokenLogo uri={idn.logo} symbol={idn.symbol} size={52} />
          <View style={{ flex: 1 }}>
            <Text style={T.h2}>{idn.name}</Text>
            <Text style={T.sub}>{idn.symbol} · {idn.chainLabel ?? 'multi-chaînes'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={[T.h2, { fontVariant: ['tabular-nums'] }]}>{price(m.price)}</Text>
            <Text style={{ color: (m.change24h ?? 0) >= 0 ? C.up : C.down, fontWeight: '700' }}>{pct(m.change24h)} 24h</Text>
          </View>
        </View>
        <Text style={[T.tiny, { marginTop: 6 }]}>Données du {dateTime(m.updatedAt)} ({ago(m.updatedAt)}) · {m.sourcesCount} source(s){m.priceDivergencePct != null ? ` · écart entre sources ${m.priceDivergencePct.toFixed(1)} %` : ''}</Text>

        <Card style={{ marginTop: S.m }}>
          <Sparkline values={(history ?? []).filter((x: any) => x.source === (history?.[history.length - 1]?.source)).map((x: any) => x.price_usd)} />
          <Text style={T.tiny}>Prix enregistrés par Crypto Radar (90 derniers jours max.)</Text>
        </Card>

        <Section title="A. Identité et marché">
          <Card>
            {idn.contract ? (
              <Pressable onPress={() => Clipboard.setStringAsync(idn.contract)}>
                <Row label="Contrat (toucher pour copier)" value={<Text style={{ color: C.text, fontFamily: mono, fontSize: 12 }}>{shortAddr(idn.contract)}</Text>} hint={idn.chainLabel} />
              </Pressable>
            ) : <Row label="Contrat" value="Non identifié" />}
            <Row label="Capitalisation (en circulation)" value={usd(m.marketCap)} />
            <Row label="Valorisation diluée (FDV)" value={usd(m.fdv)} />
            <Row label="Offre en circulation" value={num(m.circulating)} />
            <Row label="Offre totale / max." value={`${num(m.total)} / ${num(m.max)}`} />
            <Row label="Volume 24 h" value={usd(m.volume24h)} />
            <Row label="Liquidité DEX" value={m.liquidity != null ? usd(m.liquidity) : 'Non disponible'} valueColor={m.liquidity != null && m.liquidity < 50000 ? C.warn : undefined} />
            <Row label="Variation 7 j" value={pct(m.change7d)} valueColor={(m.change7d ?? 0) >= 0 ? C.up : C.down} />
            <Row label="Top 10 détenteurs" value={m.top10HoldersPct != null ? `${m.top10HoldersPct.toFixed(0)} %` : 'Non disponible'} valueColor={(m.top10HoldersPct ?? 0) > 40 ? C.warn : undefined} />
            <Row label="Détenteurs" value={num(m.holders)} />
            <Row label="Déblocages futurs" value="Non disponible" hint="Aucune source fiable gratuite intégrée" />
          </Card>
          {m.markets?.length ? (
            <Card style={{ marginTop: S.s }}>
              <Text style={[T.sub, { marginBottom: 4 }]}>Marchés observés</Text>
              {m.markets.map((x: any) => <Row key={x.source} label={x.source} value={price(x.price)} hint={`liq. ${x.liquidity != null ? usd(x.liquidity) : 'n.d.'} · vol. ${usd(x.volume24h)} · ${ago(x.at)}`} />)}
            </Card>
          ) : null}
        </Section>

        {/* B. Narrative */}
        <Section title="B. Narrative du projet">
          <Card>
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap', marginBottom: S.s }}>
              {nar.main?.name ? <Badge text={nar.main.name} color={C.ai} bg={C.aiBg} /> : <Badge text="Narrative inconnue" />}
              {nar.main?.source === 'heuristique' ? <Kind kind="hypothèse" /> : nar.main?.name ? <Kind kind="observé" /> : null}
            </View>
            <Text style={T.body}>{nar.description ?? 'Aucune description officielle disponible.'}</Text>
            {nar.note ? <Text style={[T.tiny, { marginTop: S.s }]}>{nar.note}</Text> : null}
            {hz?.components?.find((c: any) => c.key === 'narrative')?.raw ? <Text style={[T.sub, { marginTop: S.s }]}>Dynamique : {hz.components.find((c: any) => c.key === 'narrative').raw}</Text> : null}
            {nar.devCommits4w != null ? <Text style={[T.sub, { marginTop: 4 }]}>Activité développeurs : {nar.devCommits4w} commits sur 4 semaines (GitHub via CoinGecko)</Text> : null}
            <Text style={[T.tiny, { marginTop: S.s }]}>Adoption réelle du token : non mesurable sans revenus de protocole (non intégrés) — à vérifier sur les sources.</Text>
          </Card>
        </Section>

        {/* C. Catalyseurs */}
        <Section title="C. Catalyseurs à venir">
          <Card>
            {catalysts?.length ? catalysts.map((c: any) => (
              <View key={c.id} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
                <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                  <Badge text={c.status === 'confirmed' ? 'CONFIRMÉ' : 'RUMEUR'} color={c.status === 'confirmed' ? C.up : C.warn} bg={c.status === 'confirmed' ? C.upBg : C.warnBg} />
                  <Text style={T.tiny}>{c.event_date ? date(c.event_date) : 'date inconnue'}{c.date_precision !== 'day' ? ' (approx.)' : ''}</Text>
                </View>
                <Text style={[T.body, { marginTop: 4 }]}>{c.title}</Text>
                <Text style={T.tiny}>{c.source_name}</Text>
              </View>
            )) : <Text style={T.sub}>Aucun catalyseur daté et sourcé. (Source automatique : clé CoinMarketCal à ajouter dans les secrets GitHub.)</Text>}
          </Card>
        </Section>

        {/* Horizon */}
        <View style={{ marginTop: S.xl }}>
          <Segmented<H> value={h} onChange={setH} options={[{ key: 'week', label: '7 jours' }, { key: 'month', label: '30 jours' }, { key: 'year', label: '12 mois' }]} />
        </View>
        {!hz ? <Text style={[T.sub, { marginTop: S.s }]}>Pas encore évalué sur cet horizon.</Text> : (
          <>
            <Card style={{ marginTop: S.s }}>
              <View style={{ flexDirection: 'row', gap: S.s }}>
                <Stat label="Score de potentiel" value={hz.score != null ? `${Math.round(hz.score)}/100` : 'Données insuffisantes'} color={C.ai} />
                <Stat label="Confiance données" value={`${hz.confidence}/100`} />
              </View>
              <View style={{ flexDirection: 'row', gap: S.s, marginTop: S.s }}>
                <Stat label="Rang" value={hz.rank ? `#${hz.rank}` : '—'} />
                <Stat label="Catalyseur" value={hz.catalyst ? `J-${hz.catalyst.days}` : 'aucun'} />
              </View>
              {hz.reason ? <Text style={[T.sub, { marginTop: S.s }]}>{hz.reason}</Text> : null}
              {hz.movement?.reasons?.length ? <Text style={[T.sub, { marginTop: S.s }]}>Évolution : {hz.movement.delta != null ? `${hz.movement.delta > 0 ? '+' : ''}${hz.movement.delta} place(s) · ` : ''}{hz.movement.reasons.join(', ')}</Text> : null}
              <Text style={[T.tiny, { marginTop: S.s }]}>Calculé {ago(hz.at)}</Text>
            </Card>

            {/* D. Multiplicateurs */}
            <Section title="D. Scénarios de multiplication" accent>
              {hz.scenarios?.scenarios?.length ? (
                <>
                  <Text style={[T.tiny, { marginBottom: S.s }]}>Base : {usd(hz.scenarios.basis.currentCap)} en circulation{hz.scenarios.basis.fdv ? ` · FDV ${usd(hz.scenarios.basis.fdv)}` : ''} · {hz.scenarios.basis.peerCount} comparables « {hz.scenarios.basis.category} ». Aucune probabilité n’est attribuée.</Text>
                  {hz.scenarios.warnings?.map((w: string) => <Banner key={w} text={w} />)}
                  {hz.scenarios.scenarios.map((s: any) => (
                    <Card key={s.kind} style={{ marginBottom: S.s, borderColor: C.ai }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={[T.h3, { flex: 1 }]}>{s.label}</Text>
                        <Text style={{ color: C.ai, fontSize: 20, fontWeight: '900' }}>{s.display}</Text>
                      </View>
                      <Text style={T.sub}>Capitalisation cible {usd(s.targetCap)} · horizon {s.horizon}</Text>
                      <View style={{ marginTop: 6 }}><Kind kind="estimation" /></View>
                      <Text style={[T.tiny, { marginTop: 6 }]}>{s.method}</Text>
                      <Text style={[T.sub, { marginTop: 8, color: C.text }]}>Comparables</Text>
                      {s.comparables.map((p: any) => <Text key={p.id} style={T.tiny}>• {p.name} — {usd(p.cap)}</Text>)}
                      <Text style={[T.sub, { marginTop: 8, color: C.text }]}>Hypothèses nécessaires</Text>
                      {s.assumptions.map((a: string) => <Text key={a} style={T.tiny}>• {a}</Text>)}
                      <Text style={[T.sub, { marginTop: 8, color: C.up }]}>Signaux qui confirmeraient</Text>
                      {s.confirmIf.map((a: string) => <Text key={a} style={T.tiny}>• {a}</Text>)}
                      <Text style={[T.sub, { marginTop: 8, color: C.down }]}>Signaux qui invalideraient</Text>
                      {s.invalidateIf.map((a: string) => <Text key={a} style={T.tiny}>• {a}</Text>)}
                    </Card>
                  ))}
                </>
              ) : <Card><Text style={T.sub}>Aucun multiplicateur affiché : {hz.scenarios?.reason ?? 'aucun scénario défendable.'}</Text></Card>}
            </Section>

            {/* E. Signaux */}
            <Section title="E. Analyse des signaux">
              <Card>
                {hz.components.map((c: any) => (
                  <View key={c.key} style={{ paddingVertical: 8, borderBottomWidth: 0.5, borderBottomColor: C.line }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={[T.sub, { flex: 1, color: C.text }]}>{c.label}</Text>
                      <Text style={T.tiny}>poids {Math.round((c.weight ?? 0) * 100)} %</Text>
                      <Kind kind={c.kind} />
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 5 }}>
                      <Meter value={c.value} />
                      <Text style={[T.tiny, { width: 30, textAlign: 'right' }]}>{c.value != null ? Math.round(c.value * 100) : '—'}</Text>
                    </View>
                    <Text style={[T.tiny, { marginTop: 3 }]}>{c.raw}</Text>
                  </View>
                ))}
                {hz.penalties ? (
                  <Text style={[T.tiny, { marginTop: S.s }]}>
                    Pénalités : manipulation −{Math.round(hz.penalties.manipulation * 100)} % · déjà monté −{Math.round(hz.penalties.overextension * 100)} % · fiabilité ×{hz.penalties.reliability.toFixed(2)}
                  </Text>
                ) : null}
              </Card>
              {hz.risk?.length ? (
                <Card style={{ marginTop: S.s, borderColor: C.warn }}>
                  <Text style={[T.h3, { color: C.warn, marginBottom: 4 }]}>Signaux de risque</Text>
                  {hz.risk.map((r: any) => <Text key={r.code} style={[T.sub, { marginTop: 2 }]}>• {r.label} <Text style={T.tiny}>({r.severity})</Text></Text>)}
                </Card>
              ) : null}
              <Card style={{ marginTop: S.s }}>
                <Row label="Volume 24 h vs moyenne précédente" value={signals.volume.avgPrev7d ? `${(signals.volume.now / signals.volume.avgPrev7d).toFixed(2)}×` : signals.volume.intradayRatio ? `rythme 1 h ${signals.volume.intradayRatio.toFixed(2)}×` : 'n.d.'} />
                <Row label="Liquidité vs il y a 3 j" value={signals.liquidity.threeDaysAgo ? pct((signals.liquidity.now / signals.liquidity.threeDaysAgo - 1) * 100) : 'n.d.'} />
                <Row label="Achats / ventes 24 h" value={signals.transactions.buys24h != null ? `${num(signals.transactions.buys24h)} / ${num(signals.transactions.sells24h)}` : 'n.d.'} />
                <Row label="Détenteurs (évolution)" value={signals.holders.prev ? pct((signals.holders.now / signals.holders.prev - 1) * 100) : 'n.d.'} />
                <Row label="Historique enregistré" value={`${signals.historyDays} j`} />
                <Row label="Réseaux sociaux / recherches" value="Non intégré" hint="API X/Twitter payante" />
                <Row label="Revenus du protocole" value="Non intégré" />
              </Card>
            </Section>
          </>
        )}

        <AlertForm tokenId={id} symbol={idn.symbol} current={m.price} />

        {/* F. Sources */}
        <Section title="F. Sources">
          <Card>{sources.map((s: any) => <SourceLink key={s.url} label={s.label} url={s.url} at={s.at} />)}</Card>
          <Card style={{ marginTop: S.s }}>
            <Text style={[T.sub, { color: C.text, marginBottom: 4 }]}>Données manquantes</Text>
            {missing.map((x: string) => <Text key={x} style={T.tiny}>• {x}</Text>)}
          </Card>
          <Text style={[T.tiny, { marginTop: S.m }]}>{d.data.disclaimer}</Text>
        </Section>
      </Screen>
    </>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={{ flex: 1, backgroundColor: C.surface2, borderRadius: R.m, padding: S.s }}>
      <Text style={T.tiny}>{label}</Text>
      <Text style={{ color: color ?? C.text, fontSize: 16, fontWeight: '800', marginTop: 2 }} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function AlertForm({ tokenId, symbol, current }: { tokenId: string; symbol: string; current: number | null }) {
  const [p, setP] = useState('');
  const create = async (type: string, params: any) => {
    try {
      await api('/api/alerts/rules', { method: 'POST', body: { tokenId, type, params } });
      popup('Alerte créée', `${symbol} : ${type === 'volume_spike' ? `volume ×${params.multiple}` : `${type === 'price_above' ? '≥' : '≤'} ${params.price} $`}`);
      setP('');
    } catch (e: any) { popup('Erreur', e.message); }
  };
  const val = Number(p.replace(',', '.'));
  return (
    <Section title="Alertes sur ce token">
      <Card>
        <Text style={T.tiny}>Prix actuel : {price(current)}</Text>
        <TextInput value={p} onChangeText={setP} keyboardType="decimal-pad" placeholder="Prix cible en $" placeholderTextColor={C.dim}
          style={{ color: C.text, backgroundColor: C.surface2, borderRadius: R.m, padding: 10, marginVertical: S.s, fontSize: 15 }} />
        <View style={{ flexDirection: 'row', gap: S.s }}>
          <View style={{ flex: 1 }}><Button kind="ghost" title="Au-dessus" icon="arrow-up" disabled={!(val > 0)} onPress={() => create('price_above', { price: val })} /></View>
          <View style={{ flex: 1 }}><Button kind="ghost" title="En dessous" icon="arrow-down" disabled={!(val > 0)} onPress={() => create('price_below', { price: val })} /></View>
        </View>
        <View style={{ marginTop: S.s }}><Button kind="ghost" icon="pulse" title="Pic de volume (×3 la moyenne)" onPress={() => create('volume_spike', { multiple: 3 })} /></View>
      </Card>
    </Section>
  );
}
