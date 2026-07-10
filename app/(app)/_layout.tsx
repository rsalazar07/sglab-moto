import { Tabs, router } from 'expo-router';
import { Text, AppState } from 'react-native';
import { useEffect, useRef } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuthStore } from '../../src/store/authStore';
import { useTicketsStore } from '../../src/store/ticketsStore';
import { getSocket } from '../../src/socket/socket';
import { ticketsApi } from '../../src/api/tickets';
import type { EstadoTicket } from '../../src/types';

export default function AppLayout() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const user = useAuthStore((s) => s.user);
  const updateTicket = useTicketsStore((s) => s.updateTicket);
  const removeTicket = useTicketsStore((s) => s.removeTicket);
  const requestRefresh = useTicketsStore((s) => s.requestRefresh);
  const setTickets = useTicketsStore((s) => s.setTickets);
  const insets = useSafeAreaInsets();
  const socketInitDone = useRef(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const refreshTickets = async () => {
    try {
      const data = await ticketsApi.getMisTickets();
      setTickets(data);
      requestRefresh();
    } catch {}
  };

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated]);

  // ─── Polling silencioso cada 5s ───
  useEffect(() => {
    if (!isAuthenticated) return;
    // Refrescar inmediatamente al montar
    refreshTickets();
    pollingRef.current = setInterval(refreshTickets, 5000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isAuthenticated]);

  // ─── Refrescar al volver de background ───
  useEffect(() => {
    if (!isAuthenticated) return;
    const sub = AppState.addEventListener('change', (nextState) => {
      if (appStateRef.current.match(/inactive|background/) && nextState === 'active') {
        console.log('[Layout] App en foreground — refrescando tickets');
        refreshTickets();
      }
      appStateRef.current = nextState;
    });
    return () => sub.remove();
  }, [isAuthenticated]);

  // Socket listeners persistentes — viven mientras el layout esté montado (navegación entre tabs)
  useEffect(() => {
    if (!isAuthenticated || !user || socketInitDone.current) return;
    socketInitDone.current = true;

    const initSocket = async () => {
      const socket = await getSocket();
      socket.off('ticket:new');
      socket.off('ticket:update');
      socket.off('connect');

      socket.on('connect', () => {
        console.log('[Layout] WebSocket reconectado — refrescando tickets');
        refreshTickets();
      });

      socket.on('ticket:new', async (_data: { ticketId: string }) => {
        // Para ticket nuevo, simplemente refrescar toda la lista
        refreshTickets();
      });

      socket.on('ticket:update', (data: { ticketId: string; estado: EstadoTicket; motorizadoId?: string; motorizadoNombre?: string; timestamp?: string }) => {
        if (data.motorizadoId !== undefined && data.motorizadoId !== user?.id) {
          removeTicket(data.ticketId);
        } else {
          updateTicket(data.ticketId, data.estado);
        }
        requestRefresh();
        // También refrescar desde API para garantizar que tenemos el ticket si es nuevo
        refreshTickets();
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
