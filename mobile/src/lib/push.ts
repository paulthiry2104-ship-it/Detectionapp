import * as Notifications from 'expo-notifications';
import { Alert, Platform } from 'react-native';

if (Platform.OS !== 'web') {
  try {
    Notifications.setNotificationHandler({
      handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true }),
    });
  } catch { /* non supporté */ }
}

/** Notification locale quand une alerte se déclenche (l'app doit être ouverte ; pas de push serveur dans la version gratuite). */
export async function notifyLocal(title: string, body: string, data: Record<string, unknown> = {}) {
  if (Platform.OS === 'web') {
    const N: any = (globalThis as any).Notification;
    if (N && N.permission === 'granted') new N(title, { body });
    return;
  }
  const { status } = await Notifications.getPermissionsAsync();
  if (status !== 'granted') return;
  await Notifications.scheduleNotificationAsync({ content: { title, body, data }, trigger: null });
}

export async function enableLocalNotifications(): Promise<string> {
  if (Platform.OS === 'web') {
    const N: any = (globalThis as any).Notification;
    if (!N) return 'Ton navigateur ne gère pas les notifications. Sur iPhone : ajoute l’app à l’écran d’accueil (Partager → Sur l’écran d’accueil), puis réessaie depuis l’icône.';
    const p = await N.requestPermission();
    return p === 'granted' ? 'Notifications activées : tu seras prévenu quand une alerte se déclenche à l’ouverture de l’app.' : 'Autorisation refusée.';
  }
  const r = await Notifications.requestPermissionsAsync();
  return r.status === 'granted' ? 'Notifications activées.' : 'Autorisation refusée dans Réglages iOS.';
}

/** Alert.alert ne fait rien sur le web : on utilise window.alert. */
export function popup(title: string, msg?: string) {
  if (Platform.OS === 'web') (globalThis as any).alert?.(msg ? `${title}\n\n${msg}` : title);
  else Alert.alert(title, msg);
}
