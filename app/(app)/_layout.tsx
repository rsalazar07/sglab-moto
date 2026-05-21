import { Tabs } from 'expo-router';
import { Text, View } from 'react-native';

export default function AppLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: '#111', borderTopColor: '#222', paddingBottom: 8, height: 64 },
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
