import Ionicons from '@expo/vector-icons/Ionicons';
import { Tabs } from 'expo-router/js-tabs';
import { C } from '../../lib/theme';

const icon = (name: keyof typeof Ionicons.glyphMap) => ({ color, size }: { color: unknown; size: number }) => <Ionicons name={name} color={typeof color === 'string' ? color : undefined} size={size} />;

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: C.ai,
        tabBarInactiveTintColor: C.dim,
        tabBarStyle: { backgroundColor: C.bg, borderTopColor: C.line },
        sceneStyle: { backgroundColor: C.bg },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Accueil', tabBarIcon: icon('radio') }} />
      <Tabs.Screen name="explore" options={{ title: 'Explorer', tabBarIcon: icon('compass') }} />
      <Tabs.Screen name="favorites" options={{ title: 'Favoris', tabBarIcon: icon('star') }} />
      <Tabs.Screen name="alerts" options={{ title: 'Alertes', tabBarIcon: icon('notifications') }} />
    </Tabs>
  );
}
