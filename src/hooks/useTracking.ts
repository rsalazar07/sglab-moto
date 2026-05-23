/**
 * useTracking — GPS en background estilo Uber v2.
 *
 * - Foreground service con notificación persistente
 * - WebSocket + REST para puntos en tiempo real
 * - Background Fetch (despertar forzado cada ~15 min) para Infinix/Huawei/Xiaomi
 * - AppState listener: al volver a foreground, reinicia tracking automáticamente
 * - Auto-creación de sesión si el backend la cerró por inactividad
 */

import { useRef, useCallback, useEffect } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import * as KeepAwake from 'expo-keep-awake';
import { getSocket } from '../socket/socket';
import { api } from '../api/client';

const GPS_TASK = 'SGLAB_GPS_TASK';
const BG_FETCH_TASK = 'SGLAB_BG_FETCH';
const INTERVAL_MS = 5000; // cada 5 segundos en foreground

// ─── Task de background GPS (corre aunque app esté minimizada) ──
TaskManager.defineTask(GPS_TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.[0]) return;
  const loc = data.locations[0];
  const payload = {
    latitud: loc.coords.latitude,
    longitud: loc.coords.longitude,
    velocidad: loc.coords.speed ?? 0,
  };
  try { await api.post('/tracking/point', payload); } catch {}
});

// ─── Background Fetch: salvavidas para fabricantes agresivos ──
BackgroundFetch.defineTask(BG_FETCH_TASK, async () => {
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const payload = {
      latitud: loc.coords.latitude,
      longitud: loc.coords.longitude,
      velocidad: loc.coords.speed ?? 0,
    };
    // Intentar por REST (más confiable que WS en background)
    await api.post('/tracking/point', payload);
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
});

export const useTracking = () => {
  const interval = useRef<any>(null);
  const active = useRef(false);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // ─── AppState Listener: auto-restart al volver a foreground ──
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      const prevState = appStateRef.current;
      appStateRef.current = nextState;

      // Si venía de background y ahora está en foreground
      if (
        prevState.match(/inactive|background/) &&
        nextState === 'active'
      ) {
        restartForeground();
      }
    });

    return () => subscription.remove();
  }, []);

  const restartForeground = useCallback(async () => {
    if (!active.current) return; // Solo si seguimos "en turno"

    // Limpiar interval anterior por si acaso
    if (interval.current) clearInterval(interval.current);

    console.log('[Tracking] App foreground — reiniciando polling GPS');

    // Iniciar nuevo polling
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
      } catch {}
    }, INTERVAL_MS);

    // Re-asegurar que la task de background sigue activa
    try {
      const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
      if (!isRunning) {
        await Location.startLocationUpdatesAsync(GPS_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: INTERVAL_MS,
          distanceInterval: 10,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: '🏍️ SGLab Moto activo',
            notificationBody: 'Enviando ubicación en tiempo real',
            notificationColor: '#00d4ff',
          },
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
        });
      }
    } catch {}
  }, []);

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

      // 2. Iniciar sesión via REST (falla si ya hay una activa, no es crítico)
      try { await api.post('/tracking/start', {}); } catch {}

      // 3. Keep-awake (no crítico)
      try { await KeepAwake.activateKeepAwakeAsync(); } catch {}

      active.current = true;

      // 4. Foreground polling — envía puntos via WebSocket + REST fallback
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
        } catch {}
      }, INTERVAL_MS);

      // 5. Background task (GPS continuo en segundo plano)
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
        if (isRunning) await Location.stopLocationUpdatesAsync(GPS_TASK);

        await Location.startLocationUpdatesAsync(GPS_TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: INTERVAL_MS,
          distanceInterval: 10,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: '🏍️ SGLab Moto activo',
            notificationBody: 'Enviando ubicación en tiempo real',
            notificationColor: '#00d4ff',
          },
          pausesUpdatesAutomatically: false,
          activityType: Location.ActivityType.AutomotiveNavigation,
        });
      }

      // 6. Background Fetch — salvavidas para fabricantes agresivos
      try {
        const status = await BackgroundFetch.getStatusAsync();
        if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
          console.warn('[Tracking] Background Fetch denegado');
        } else {
          await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK, {
            minimumInterval: 1, // 1 minuto (Android lo respeta o lo fuerza a ~15)
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

    // 1. Limpiar polling
    if (interval.current) clearInterval(interval.current);

    // 2. Detener background task GPS
    const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
    if (isRunning) await Location.stopLocationUpdatesAsync(GPS_TASK);

    // 3. Desregistrar Background Fetch
    try {
      const registered = await BackgroundFetch.getRegisteredTasksAsync();
      if (registered.some(t => t.taskName === BG_FETCH_TASK)) {
        await BackgroundFetch.unregisterTaskAsync(BG_FETCH_TASK);
      }
    } catch {}

    // 4. Notificar servidor
    try { await api.post('/tracking/stop', {}); } catch {}
    try {
      const socket = await getSocket();
      socket.emit('tracking:stop');
    } catch {}

    // 5. Liberar keep-awake
    try { await KeepAwake.deactivateKeepAwake(); } catch {}

    active.current = false;
  }, []);

  return { startTracking, stopTracking };
};
