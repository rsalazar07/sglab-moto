import { io, Socket } from 'socket.io-client';
import * as SecureStore from 'expo-secure-store';

const WS_URL = process.env.EXPO_PUBLIC_WS_URL ?? 'wss://recojossglab.duckdns.org';

let socket: Socket | null = null;

export const getSocket = async (): Promise<Socket> => {
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

  return socket;
};

export const disconnectSocket = () => {
  socket?.disconnect();
  socket = null;
};
