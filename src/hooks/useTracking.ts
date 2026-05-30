/**
 * useTracking — GPS en background estilo Uber v3.
 *
 * MULTI-CAPA para funcionar en Infinix/Xiaomi/Huawei:
 * 1. Foreground service con notificación persistente
 * 2. Background location task (expo-location)
 * 3. Direct fetch en background (sin axios interceptors)
 * 4. Background Fetch cada ~1 min
 * 5. AppState listener: revive tracking al desbloquear
 * 6. getCurrentPositionAsync fallback si location updates no llegan
 */

import { useRef, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as KeepAwake from 'expo-keep-awake';
import * as SecureStore from 'expo-secure-store';
import { getSocket } from '../socket/socket';
import { api } from '../api/client';

const GPS_TASK = 'SGLAB_GPS_TASK';
const BG_FETCH_TASK = 'SGLAB_BG_FETCH';
const INTERVAL_MS = 5000; // cada 5 segundos en foreground
const TRACKING_FLAG = 'sglab_tracking_active';
const API_BASE = 'https://recojossglab.duckdns.org/api';

// ─── Helper: enviar punto directamente (sin axios, más robusto en background) ──
async function sendPointDirect(payload: any) {
  try {
    const token = await SecureStore.getItemAsync('accessToken');
    if (!token) {
      // Fallback a axios si no hay token directo
      await api.post('/tracking/point', payload);
      return;
    }
    await fetch(`${API_BASE}/tracking/point`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.warn('[Tracking] sendPointDirect error:', err);
  }
}

// ─── Task de background GPS (corre aunque app esté minimizada/bloqueada) ──
TaskManager.defineTask(GPS_TASK, async ({ data, error }: any) => {
  if (error) {
    console.error('[BG] GPS task error:', error);
    return;
  }

  // Si hay datos del sistema, úsalos
  if (data?.locations?.[0]) {
    const loc = data.locations[0];
    const payload = {
      latitud: loc.coords.latitude,
      longitud: loc.coords.longitude,
      velocidad: loc.coords.speed ?? 0,
    };
    await sendPointDirect(payload);
    return;
  }

  // Fallback: obtener ubicación manual si el sistema no entregó datos
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const payload = {
      latitud: loc.coords.latitude,
      longitud: loc.coords.longitude,
      velocidad: loc.coords.speed ?? 0,
    };
    await sendPointDirect(payload);
  } catch (err) {
    console.warn('[BG] getCurrentPositionAsync fallback error:', err);
  }
});

// ─── Background Fetch: salvavidas para fabricantes agresivos ──
TaskManager.defineTask(BG_FETCH_TASK, async () => {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const payload = {
      latitud: loc.coords.latitude,
      longitud: loc.coords.longitude,
      velocidad: loc.coords.speed ?? 0,
    };
    await sendPointDirect(payload);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
});

export const useTracking = () => {
  const interval = useRef<any>(null);
  const active = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  const startTracking = useCallback(async (): Promise<boolean> => {
    if (active.current) return true;

    try {
      // 1. Permiso foreground
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        const fg2 = await Location.requestForegroundPermissionsAsync();
        if (fg2.status !== 'granted') {
          console.warn('[Tracking] Permiso GPS denegado');
          return false;
        }
      }

      // 2. Iniciar sesión via REST
      try { await api.post('/tracking/start', {}); } catch {}

      // 3. Keep-awake
      try { await KeepAwake.activateKeepAwakeAsync(); } catch {}

      active.current = true;
      await SecureStore.setItemAsync(TRACKING_FLAG, 'true');

      // 4. Foreground polling — cada 5s mientras app visible
      interval.current = setInterval(async () => {
        try {
          const loc = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          const payload = {
            latitud: loc.coords.latitude,
            longitud: loc.coords.longitude,
            velocidad: loc.coords.speed ?? 0,
          };
          try {
            const socket = await getSocket();
            socket.emit('tracking:point', payload);
          } catch {
            await api.post('/tracking/point', payload);
          }
        } catch (err) { console.warn('[Tracking] Error en foreground polling:', err); }
      }, INTERVAL_MS);

      // 5. Background task (GPS en segundo plano)
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
        if (isRunning) await Location.stopLocationUpdatesAsync(GPS_TASK);

        await Location.startLocationUpdatesAsync(GPS_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: INTERVAL_MS,
          distanceInterval: 5, // cada 5 metros (antes 10)
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: '🏍️ SGLab Moto activo',
            notificationBody: 'Enviando ubicación en tiempo real',
            notificationColor: '#00d4ff',
          },
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
          deferredUpdatesInterval: 0,     // NO diferir actualizaciones
          deferredUpdatesDistance: 0,     // NO diferir por distancia
        });
      }

      // 6. Background Fetch — cada 1 min (respetado o no según fabricante)
      try {
        const status = await BackgroundFetch.getStatusAsync();
        if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
          console.warn('[Tracking] Background Fetch denegado');
        } else {
          await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK, {
            minimumInterval: 1,
            stopOnTerminate: false,
            startOnBoot: true,
          });
          console.log('[Tracking] Background Fetch registrado');
        }
      } catch (e) {
        console.warn('[Tracking] Error registrando Background Fetch:', e);
      }

      return true;
    } catch (err) {
      console.warn('[Tracking] Error iniciando tracking:', err);
      return false;
    }
  }, []);

  const stopTracking = useCallback(async () => {
    if (!active.current) return;

    if (interval.current) clearInterval(interval.current);

    const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
    if (isRunning) await Location.stopLocationUpdatesAsync(GPS_TASK);

    try {
      await BackgroundFetch.unregisterTaskAsync(BG_FETCH_TASK);
    } catch {}

    try { await api.post('/tracking/stop', {}); } catch {}
    try {
      const socket = await getSocket();
      socket.emit('tracking:stop');
    } catch {}

    try { await KeepAwake.deactivateKeepAwake(); } catch {}

    await SecureStore.setItemAsync(TRACKING_FLAG, 'false');
    active.current = false;
  }, []);

  // ─── AppState Listener — revive tracking al desbloquear ──
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        try {
          const wasActive = await SecureStore.getItemAsync(TRACKING_FLAG);
          if (wasActive === 'true') {
            console.log('[Tracking] App foreground — tracking revive');
            setTimeout(async () => {
              try {
                // Re-request permissions (algunas ROMs las revocan en bg)
                const fg = await Location.requestForegroundPermissionsAsync();
                if (fg.status !== 'granted') return;

                await api.post('/tracking/start', {});
                active.current = true;

                // Reanudar polling foreground
                interval.current = setInterval(async () => {
                  try {
                    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                    const payload = { latitud: loc.coords.latitude, longitud: loc.coords.longitude, velocidad: loc.coords.speed ?? 0 };
                    const socket = await getSocket();
                    socket.emit('tracking:point', payload);
                  } catch {}
                }, INTERVAL_MS);

                // Reanudar background task
                const bg = await Location.requestBackgroundPermissionsAsync();
                if (bg.status === 'granted') {
                  const running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
                  if (running) await Location.stopLocationUpdatesAsync(GPS_TASK);
                  await Location.startLocationUpdatesAsync(GPS_TASK, {
                    accuracy: Location.Accuracy.High,
                    timeInterval: INTERVAL_MS,
                    distanceInterval: 5,
                    showsBackgroundLocationIndicator: true,
                    foregroundService: {
                      notificationTitle: '🏍️ SGLab Moto activo',
                      notificationBody: 'Enviando ubicación en tiempo real',
                      notificationColor: '#00d4ff',
                    },
                    pausesUpdatesAutomatically: false,
                    activityType: Location.ActivityType.AutomotiveNavigation,
                    deferredUpdatesInterval: 0,
                    deferredUpdatesDistance: 0,
                  });
                }

                // Re-registrar Background Fetch
                try {
                  const bfStatus = await BackgroundFetch.getStatusAsync();
                  if (bfStatus === BackgroundFetch.BackgroundFetchStatus.Available) {
                    await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK, {
                      minimumInterval: 1,
                      stopOnTerminate: false,
                      startOnBoot: true,
                    });
                  }
                } catch {}

                try { await KeepAwake.activateKeepAwakeAsync(); } catch {}
              } catch (e) {
                console.warn('[Tracking] Error reviviendo tracking:', e);
              }
            }, 2000);
          }
        } catch {}
      }
    });
    return () => sub.remove();
  }, []);

  return { startTracking, stopTracking };
};

/**
 * Detiene todo el tracking GPS desde fuera del hook.
 */
export async function forceStopAllTracking() {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
    if (isRunning) await Location.stopLocationUpdatesAsync(GPS_TASK);
  } catch {}
  try { await BackgroundFetch.unregisterTaskAsync(BG_FETCH_TASK); } catch {}
  try { await api.post('/tracking/stop', {}); } catch {}
  try {
    const socket = await getSocket();
    socket.emit('tracking:stop');
  } catch {}
  try { await KeepAwake.deactivateKeepAwake(); } catch {}
  try { await SecureStore.setItemAsync(TRACKING_FLAG, 'false'); } catch {}
}
