import { Tabs } from 'expo-router';
import { Text, View, useEffect, useState } from 'react-native';
import { api } from '../../src/api/client';

export default function AppLayout() {
  const [d, setD] = useState<any>({});

  useEffect(() => {
    api.get('/motorizados/config')
      .then(r => setD(r.data?.dashboard || {}))
      .catch(() => {});
  }, []);

  const bg = d.tabBarBg || '#111';
  const border = d.tabBarBorder || '#222';
  const active = d.tabBarActive || '#00d4ff';
  const inactive = d.tabBarInactive || '#555';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: bg, borderTopColor: border, paddingBottom: 8, height: 64 },
        tabBarActiveTintColor: active,
        tabBarInactiveTintColor: inactive,
      }}
    >
      <Tabs.Screen name="tickets"
        options={{
          title: d.tabTitleRecojos || 'Recojos',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>{d.tabIconRecojos || '📋'}</Text>,
        }}
      />
      <Tabs.Screen name="dia"
        options={{
          title: d.tabTitleMiDia || 'Mi día',
          tabBarIcon: ({ color }) => <Text style={{ fontSize: 22 }}>{d.tabIconMiDia || '📊'}</Text>,
        }}
      />
    </Tabs>
  );
}
