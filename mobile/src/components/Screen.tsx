import type { ReactNode } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { ago } from '../lib/format';
import { C, S } from '../lib/theme';
import { Banner } from './ui';

/** Conteneur standard : défilement, tirer pour rafraîchir, bandeau hors-ligne. */
export function Screen({ children, refreshing, onRefresh, offline, padTop = true }: {
  children: ReactNode; refreshing?: boolean; onRefresh?: () => void;
  offline?: { error: string | null; fromCache: boolean; cachedAt: string | null }; padTop?: boolean;
}) {
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: C.bg }}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: S.l, paddingTop: padTop ? S.s : 0, paddingBottom: 48 }}
      refreshControl={onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={C.ai} /> : undefined}
      keyboardShouldPersistTaps="handled"
    >
      {offline?.error ? (
        <View style={{ marginBottom: S.s }}>
          <Banner kind="error" text={offline.fromCache ? `${offline.error} Affichage des données en cache (${ago(offline.cachedAt)}).` : offline.error} />
        </View>
      ) : null}
      {children}
    </ScrollView>
  );
}
