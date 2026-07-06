import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';
import { Alert } from 'react-native';
import { router } from 'expo-router';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'wss://recojossglab.duckdns.org';

let socket: Socket | null = null;

export const getSocket = async (onSessionRevoked?: () => void): Promise<Socket> => {
  if (socket?.connected) return socket;

  const token = await SecureStore.getItemAsync('accessToken');
  socket = io(`${WS_URL}/ws`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: true,
    reconnectionAttempts: 15,
    reconnectionDelay: 2000,
  });

  socket.on('connect', () => console.log('✅ WebSocket conectado'));
  socket.on('disconnect', (r) => console.log('❌ Desconectado:', r));

  // Escuchar evento de sesión revocada (otro dispositivo inició sesión)
  socket.on('auth:session:revoked', async (data) => {
    console.warn('[Socket] Sesión revocada:', data?.message);
    socket?.disconnect();
    socket = null;
    await SecureStore.deleteItemAsync('accessToken');
    await SecureStore.deleteItemAsync('refreshToken');
    Alert.alert(
      'Sesión cerrada',
      data?.message ?? 'Tu sesión fue iniciada en otro dispositivo.',
      [{ text: 'Entendido', onPress: () => { (router as any).dismissAll?.(); setTimeout(() => router.replace('/'), 100); } }]
    );
    if (onSessionRevoked) onSessionRevoked();
  });

  // 📨 Escuchar mensajes del administrador en tiempo real
  socket.on('admin:message', (data) => {
    console.warn('[Socket] Mensaje del admin:', data?.message);
    Alert.alert(
      data?.title || '📢 Administrador',
      data?.message || '',
      [{ text: 'OK' }]
    );
  });

  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};
