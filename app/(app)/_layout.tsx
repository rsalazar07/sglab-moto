import { Tabs, router } from 'expo-router';
import { Text } from 'react-native';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { useTicketsStore } from '../../src/store/ticketsStore';
import { getSocket } from '../../src/socket/socket';
import { api } from '../../src/api/client';
import type { EstadoTicket } from '../../src/types';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const addTicket = useTicketsStore((s) => s.addTicket);
  const updateTicket = useTicketsStore((s) => s.updateTicket);
  const removeTicket = useTicketsStore((s) => s.removeTicket);
  const requestRefresh = useTicketsStore((s) => s.requestRefresh);
  const insets = useSafeAreaInsets();
  const socketInitDone = useRef(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated]);

  // Socket listeners persistentes — viven mientras el layout esté montado (navegación entre tabs)
  useEffect(() => {
    if (!isAuthenticated || !user || socketInitDone.current) return;
    socketInitDone.current = true;

    const initSocket = async () => {
      const socket = await getSocket();
      socket.off('ticket:new');
      socket.off('ticket:update');

      socket.on('ticket:new', async (data: { ticketId: string }) => {
        try {
          const { data: t } = await api.get(`/tickets/${data.ticketId}`);
          if (t.motorizadoId && t.motorizadoId !== user?.id) return;
          addTicket(t);
          requestRefresh();
        } catch {}
      });

      socket.on('ticket:update', (data: { ticketId: string; estado: EstadoTicket; motorizadoId?: string; motorizadoNombre?: string; timestamp?: string }) => {
        if (data.motorizadoId !== undefined && data.motorizadoId !== user?.id) {
          removeTicket(data.ticketId);
        } else {
          updateTicket(data.ticketId, data.estado);
        }
        requestRefresh();
      });
    };
    initSocket();
  }, [isAuthenticated, user]);

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
