import { Tabs, router } from 'expo-router';
import { Text } from 'react-native';
import { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated]);

  const tabBarHeight = 64 + insets.bottom;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111', borderTopColor: '#222', paddingBottom: insets.bottom + 4, height: tabBarHeight },
        tabBarActiveTintColor: '#00d4ff',
        tabBarInactiveTintColor: '#555',
      }}
    >
      <Tabs.Screen name="tickets"
        options={{
          title: 'Recojos',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>📋</Text>,
        }}
      />
      <Tabs.Screen name="dia"
        options={{
          title: 'Mi día',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>📊</Text>,
        }}
      />
    </Tabs>
  );
}
