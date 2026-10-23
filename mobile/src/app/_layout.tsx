import * as Notifications from 'expo-notifications';
import { DarkTheme, Stack, ThemeProvider, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import '../lib/push';
import { C } from '../lib/theme';

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: C.bg, card: C.bg, text: C.text, border: C.line, primary: C.ai } };

export default function RootLayout() {
  const router = useRouter();
  // Ouvrir la fiche du token quand on touche une notification.
  useEffect(() => {
    if (Platform.OS === 'web') return;
    const sub = Notifications.addNotificationResponseReceivedListener((resp) => {
      const data: any = resp.notification.request.content.data ?? {};
      if (data.tokenId) router.push({ pathname: '/token/[id]', params: { id: String(data.tokenId) } });
      else if (data.type === 'daily_report') router.push('/report');
      else router.push('/alerts');
    });
    return () => sub.remove();
  }, [router]);

  return (
    <ThemeProvider value={theme}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerTintColor: C.text, headerStyle: { backgroundColor: C.bg }, contentStyle: { backgroundColor: C.bg }, headerBackTitle: 'Retour' }}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="token/[id]" options={{ title: '' }} />
        <Stack.Screen name="report" options={{ title: 'Rapport du jour' }} />
        <Stack.Screen name="methodology" options={{ title: 'Sources et méthodologie' }} />
        <Stack.Screen name="history" options={{ title: 'Historique et performances' }} />
        <Stack.Screen name="settings" options={{ title: 'Paramètres' }} />
        <Stack.Screen name="suspects" options={{ title: 'Tokens suspects' }} />
      </Stack>
    </ThemeProvider>
  );
}
