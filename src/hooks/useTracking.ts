/**
 * useTracking — GPS en background estilo Uber.
 *
 * - Usa EXPO BACKGROUND TASK para seguir enviando ubicación
 *   aunque el celular esté bloqueado o la app minimizada.
 * - Foreground service con notificación persistente.
 * - WebSocket para puntos en tiempo real + REST como fallback.
 * - BACKGROUND FETCH como capa extra para Infinix/XOS que matan procesos.
 * - AppState listener: al desbloquear, revive tracking automático.
 */

import { useRef, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as KeepAwake from 'expo-keep-awake';
import * as BackgroundFetch from 'expo-background-fetch';
import * as SecureStore from 'expo-secure-store';
import { getSocket } from '../socket/socket';
import { api } from '../api/client';

const GPS_TASK = 'SGLAB_GPS_TASK';
const BG_FETCH_TASK = 'SGLAB_BG_FETCH';
const INTERVAL_MS = 5000; // cada 5 segundos
const TRACKING_FLAG = 'sglab_tracking_active';

// ─── Task de background GPS (corre mientras app está en background) ──
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

// ─── Background Fetch task (capa extra para Infinix/XOS) ──
// Se ejecuta periódicamente aunque el proceso haya sido kill
TaskManager.defineTask(BG_FETCH_TASK, async () => {
  try {
    const loc = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
    if (loc) {
      await api.post('/tracking/point', {
        latitud: loc.coords.latitude,
        longitud: loc.coords.longitude,
        velocidad: loc.coords.speed ?? 0,
      });
    }
    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

export const useTracking = () => {
  const interval = useRef<any>(null);
  const active = useRef(false);
  const appStateRef = useRef(false);

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

      // 2. Iniciar sesión via REST (no es crítica, WebSocket auto-crea si falla)
      try { await api.post('/tracking/start', {}); } catch {}

      // 3. Keep-awake (no crítico, si falla seguimos)
      try { await KeepAwake.activateKeepAwakeAsync(); } catch {}

      active.current = true;

      // 4. Foreground polling — envía puntos via WebSocket
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

      // 5. Background task (para cuando minimizan/bloquean)
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

      // 6. Background Fetch — capa extra para Infinix/XOS que matan procesos
      try {
        const bfStatus = await BackgroundFetch.getStatusAsync();
        if (bfStatus === BackgroundFetch.BackgroundFetchStatus.Available) {
          await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK, {
            minimumInterval: 60, // 1 min (lo respetan algunos dispositivos)
            stopOnTerminate: false,
            startOnBoot: true,
          });
        }
      } catch {}

      // 7. Guardar flag en SecureStore para AppState
      try { await SecureStore.setItemAsync(TRACKING_FLAG, 'true'); } catch {}

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

    // 2. Detener background task
    const isRunning = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
    if (isRunning) await Location.stopLocationUpdatesAsync(GPS_TASK);

    // 3. Unregister Background Fetch
    try { await BackgroundFetch.unregisterTaskAsync(BG_FETCH_TASK); } catch {}

    // 4. Clear flag
    try { await SecureStore.setItemAsync(TRACKING_FLAG, 'false'); } catch {}

    // 5. Notificar servidor
    try { await api.post('/tracking/stop', {}); } catch {}
    try {
      const socket = await getSocket();
      socket.emit('tracking:stop');
    } catch {}

    // 6. Liberar keep-awake
    try { await KeepAwake.deactivateKeepAwake(); } catch {}

    active.current = false;
  }, []);

  // ─── AppState Listener — revive tracking al desbloquear ──
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      // Si la app vuelve a foreground (desbloqueo)
      if (nextState === 'active' && !active.current) {
        // Verificar si tracking estaba activo antes de morir
        try {
          const wasActive = await SecureStore.getItemAsync(TRACKING_FLAG);
          if (wasActive === 'true') {
            console.log('[Tracking] App foreground — tracking revive');
            // Pequeño delay para que todo se inicialice
            setTimeout(async () => {
              try {
                // Permiso foreground
                const fg = await Location.requestForegroundPermissionsAsync();
                if (fg.status !== 'granted') return;

                await api.post('/tracking/start', {});
                active.current = true;

                // Foreground polling
                interval.current = setInterval(async () => {
                  try {
                    const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
                    const payload = { latitud: loc.coords.latitude, longitud: loc.coords.longitude, velocidad: loc.coords.speed ?? 0 };
                    const socket = await getSocket();
                    socket.emit('tracking:point', payload);
                  } catch {}
                }, INTERVAL_MS);

                // Background task
                const bg = await Location.requestBackgroundPermissionsAsync();
                if (bg.status === 'granted') {
                  const running = await Location.hasStartedLocationUpdatesAsync(GPS_TASK);
                  if (running) await Location.stopLocationUpdatesAsync(GPS_TASK);
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

                // Background fetch
                try {
                  const bfStatus = await BackgroundFetch.getStatusAsync();
                  if (bfStatus === BackgroundFetch.BackgroundFetchStatus.Available) {
                    await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK, {
                      minimumInterval: 60,
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
