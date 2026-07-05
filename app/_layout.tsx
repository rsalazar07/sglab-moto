import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as Sentry from '@sentry/react-native';
import { useAuthStore } from '../src/store/authStore';
import { authApi } from '../src/api/auth';
import { api } from '../src/api/client';
import { send as log } from '../src/lib/LogReporter';

// Inicializar Sentry — captura crashes nativos y JS
Sentry.init({
  dsn: 'https://80a8f55c4528ff9f12d6a0b5d3238a19@o4509283363913728.ingest.us.sentry.io/4509283367714816',
  tracesSampleRate: 1.0,
  enableNative: true,
});

export default function RootLayout() {
  const { setUser } = useAuthStore();
  const [loading, setLoading] = useState(true);
  const [d, setD] = useState<any>({});

  useEffect(() => {
    (async () => {
      // Cargar config del VPS (splash visuals)
      try {
        const res = await api.get('/motorizados/config');
        setD(res.data?.dashboard || {});
      } catch {}
      try {
        const token = await SecureStore.getItemAsync('accessToken');
        if (token) {
          const user = await authApi.me();
          setUser(user);
        }
      } catch (e) {
        log('ERROR', 'auth', `_layout init: ${e instanceof Error ? e.message : String(e)}`);
        await SecureStore.deleteItemAsync('accessToken');
        await SecureStore.deleteItemAsync('refreshToken');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: d.splashBg || '#0a0a0a' }}>
        <ActivityIndicator size="large" color={d.splashSpinner || '#00d4ff'} />
        <Text style={{ color: d.splashTextColor || '#888', marginTop: 12 }}>{d.splashText || 'Cargando...'}</Text>
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(app)" />
      </Stack>
    </>
  );
}
