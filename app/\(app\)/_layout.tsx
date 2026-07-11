import { Tabs, router } from 'expo-router';
import { Text, AppState } from 'react-native';
import { useEffect, useRef, useCallback } from 'react';
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
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const appStateRef = useRef(AppState.currentState);

  const refreshTickets = useCallback(async () => {
    try {
      const data = await ticketsApi.getMisTickets();
      if (data) {
        setTickets(data);
        requestRefresh();
      }
    } catch (e) {
      console.warn('[Layout] Error refreshing tickets:', e);
    }
  }, [setTickets, requestRefresh]);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated]);

  // ─── Polling silencioso cada 5s ───
  useEffect(() => {
    if (!isAuthenticated) return;
    refreshTickets();
    pollingRef.current = setInterval(refreshTickets, 5000);
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, [isAuthenticated, refreshTickets]);

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
  }, [isAuthenticated, refreshTickets]);

  // ─── Socket listeners: siempre se re-registran al montar el layout ───
  useEffect(() => {
    if (!isAuthenticated || !user) return;

    let mounted = true;

    const initSocket = async () => {
      const socket = await getSocket();

      if (!mounted || !socket) return;

      // Limpiar listeners viejos antes de registrar nuevos
      socket.off('ticket:new');
      socket.off('ticket:update');
      socket.off('connect');

      socket.on('connect', () => {
        console.log('[Layout] WebSocket reconectado — refrescando tickets');
        refreshTickets();
      });

      socket.on('ticket:new', async (_data: { ticketId: string }) => {
        console.log('[Layout] Nuevo ticket vía WS — refrescando');
        refreshTickets();
      });

      socket.on('ticket:update', (data: { ticketId: string; estado: EstadoTicket; motorizadoId?: string; motorizadoNombre?: string; timestamp?: string }) => {
        if (data.motorizadoId !== undefined && data.motorizadoId !== user?.id) {
          removeTicket(data.ticketId);
        } else {
          updateTicket(data.ticketId, data.estado);
        }
        requestRefresh();
        // Refrescar desde API para garantizar datos completos
        refreshTickets();
      });
    };

    initSocket();

    return () => {
      mounted = false;
      // Nota: no desconectamos el socket porque puede ser usado por otros componentes
    };
  }, [isAuthenticated, user, refreshTickets, removeTicket, updateTicket, requestRefresh]);

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
