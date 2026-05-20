/**
 * useTracking — GPS en background estilo Uber.
 *
 * - Usa EXPO BACKGROUND TASK para seguir enviando ubicación
 *   aunque el celular esté bloqueado o la app minimizada.
 * - Foreground service con notificación persistente.
 * - WebSocket para puntos en tiempo real + REST como fallback.
 * - Los puntos WebSocket auto-crean sesión en el backend (con estado OCUPADO).
 * - Solo se detiene al llamar stopTracking() (Fin turno).
 */

import { useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as KeepAwake from 'expo-keep-awake';
import { getSocket } from '../socket/socket';
import { api } from '../api/client';

const TASK = 'SGLAB_GPS_TASK';
const INTERVAL_MS = 5000; // cada 5 segundos

// ─── Task de background (corre aunque app esté en background) ──
TaskManager.defineTask(TASK, async ({ data, error }: any) => {
  if (error || !data?.locations?.[0]) return;
  const loc = data.locations[0];
  const payload = {
    latitud: loc.coords.latitude,
    longitud: loc.coords.longitude,
    velocidad: loc.coords.speed ?? 0,
  };
  try { await api.post('/tracking/point', payload); }
  catch {}
});

export const useTracking = () => {
  const interval = useRef<any>(null);
  const active = useRef(false);

  const startTracking = useCallback(async (): Promise<boolean> => {
    if (active.current) return true;

    try {
      // 1. Permiso foreground
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        // Intentar pedir de nuevo
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
        const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK);
        if (isRunning) await Location.stopLocationUpdatesAsync(TASK);

        await Location.startLocationUpdatesAsync(TASK, {
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
    const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK);
    if (isRunning) await Location.stopLocationUpdatesAsync(TASK);

    // 3. Notificar servidor
    try { await api.post('/tracking/stop', {}); } catch {}
    try {
      const socket = await getSocket();
      socket.emit('tracking:stop');
    } catch {}

    // 4. Liberar keep-awake
    try { await KeepAwake.deactivateKeepAwake(); } catch {}

    active.current = false;
  }, []);

  return { startTracking, stopTracking };
};
