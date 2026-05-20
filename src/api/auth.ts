import { api } from './client';
import * as SecureStore from 'expo-secure-store';
import type { AuthResponse, User } from '../types';

const getOrCreateDeviceId = async (): Promise<string> => {
  let deviceId = await SecureStore.getItemAsync('deviceId');
  if (!deviceId) {
    deviceId = `rn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    await SecureStore.setItemAsync('deviceId', deviceId);
  }
  return deviceId;
};

export const authApi = {
  login: async (email: string, password: string): Promise<AuthResponse> => {
    const deviceId = await getOrCreateDeviceId();
    const { data } = await api.post<AuthResponse>('/auth/login', {
      email,
      password,
      deviceId,
    });
    await SecureStore.setItemAsync('accessToken', data.accessToken);
    await SecureStore.setItemAsync('refreshToken', data.refreshToken);
    return data;
  },

  logout: async () => {
    try { await api.post('/auth/logout'); } finally {
      await SecureStore.deleteItemAsync('accessToken');
      await SecureStore.deleteItemAsync('refreshToken');
    }
  },

  me: async (): Promise<User> => {
    const { data } = await api.get<User>('/auth/me');
    return data;
  },
};
