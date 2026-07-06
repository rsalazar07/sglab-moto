import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Component, useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, TouchableOpacity } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { useAuthStore } from '../src/store/authStore';
import { authApi } from '../src/api/auth';
import { api } from '../src/api/client';
import { send as log } from '../src/lib/LogReporter';
import { installGlobalCrashHandler, readCrashLog, writeCrash } from '../src/lib/crashReport';

// ═══ INSTALAR CRASH HANDLER NATIVO (antes de cualquier otra cosa) ═══
installGlobalCrashHandler();

// ═══ ERROR BOUNDARY — captura crashes y los muestra en pantalla ═══
class ErrorBoundary extends Component<{children: any}, {hasError: boolean; error: Error | null; info: any; crashLog: string}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null, info: null, crashLog: '' };
  }
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: any) {
    this.setState({ info });
    writeCrash('ERROR_BOUNDARY', error.message || '', error.stack || '');
  }
  async loadCrashLog() {
    const log = await readCrashLog();
    this.setState({ crashLog: log });
  }
  render() {
    if (this.state.hasError) {
      const showLog = this.state.crashLog;
      return (
        <View style={{ flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', padding: 20 }}>
          <Text style={{ color: '#E74C3C', fontSize: 18, fontWeight: '800', marginBottom: 10 }}>💥 CRASH DETECTADO</Text>
          <Text style={{ color: '#fff', fontSize: 13, marginBottom: 5 }}>{this.state.error?.name || 'Error'}</Text>
          <Text style={{ color: '#ff6b6b', fontSize: 12, marginBottom: 20 }}>{this.state.error?.message || ''}</Text>
          <Text style={{ color: '#888', fontSize: 10, marginBottom: 20 }}>{this.state.error?.stack?.slice(0, 1000) || ''}</Text>
          {showLog ? (
            <View style={{ marginBottom: 20 }}>
              <Text style={{ color: '#FFD700', fontSize: 14, fontWeight: '700', marginBottom: 5 }}>📋 CRASH LOG:</Text>
              <Text style={{ color: '#aaa', fontSize: 9 }}>{showLog.slice(0, 2000)}</Text>
            </View>
          ) : null}
          <TouchableOpacity
            style={{ backgroundColor: '#3498DB', padding: 12, borderRadius: 8, alignItems: 'center', marginBottom: 10 }}
            onPress={() => this.setState({ hasError: false, error: null })}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Reintentar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={{ backgroundColor: '#2ecc71', padding: 12, borderRadius: 8, alignItems: 'center' }}
            onPress={() => this.loadCrashLog()}
          >
            <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>📋 Leer crash log</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return this.props.children;
  }
}

// ═══ LAYOUT PRINCIPAL ═══
export default function RootLayout() {
  const { setUser } = useAuthStore();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
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

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, loading]);

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: d.splashBg || '#0a0a0a' }}>
        <ActivityIndicator size="large" color={d.splashSpinner || '#00d4ff'} />
        <Text style={{ color: d.splashTextColor || '#888', marginTop: 12 }}>{d.splashText || 'Cargando...'}</Text>
      </View>
    );
  }

  return (
    <ErrorBoundary>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="login" />
        <Stack.Screen name="(app)" />
      </Stack>
    </ErrorBoundary>
  );
}
