/**
 * useTracking — GPS en background estilo Uber.
 *
 * - Usa EXPO BACKGROUND TASK para seguir enviando ubicación
 *   aunque el celular esté bloqueado o la app minimizada.
 * - Foreground service con notificación persistente.
 * - WebSocket para puntos en tiempo real + REST como fallback.
 * - Los puntos WebSocket auto-crean sesión en el backend (con estado OCUPADO).
 * - Solo se detiene al llamar stopTracking() (Fin turno).
 * - Intervalo y textos NOTIFICACIÓN vienen del VPS.
 */

import { useRef, useCallback } from 'react';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as KeepAwake from 'expo-keep-awake';
import { getSocket } from '../socket/socket';
import { api } from '../api/client';

const TASK = 'SGLAB_GPS_TASK';
const DEFAULT_INTERVAL_MS = 5000;

// Cache de config (se carga una vez)
let _config: any = null;
const loadConfig = async () => {
  if (_config) return _config;
  try {
    const res = await api.get('/motorizados/config');
    _config = res.data || {};
    return _config;
  } catch { return {}; }
};

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
      // Cargar config del VPS para parámetros
      const cfg = await loadConfig();
      const intervalMs = cfg?.tiemposMaquina?.trackingIntervalMs || DEFAULT_INTERVAL_MS;
      const d = cfg?.dashboard || {};
      const notifTitle = d.trackingTitle || '🏍️ SGLab Moto activo';
      const notifBody = d.trackingBody || 'Enviando ubicación en tiempo real';
      const notifColor = d.trackingColor || d.colors?.blue || '#00d4ff';

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
      }, intervalMs);

      // 5. Background task (para cuando minimizan/bloquean)
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        const isRunning = await Location.hasStartedLocationUpdatesAsync(TASK);
        if (isRunning) await Location.stopLocationUpdatesAsync(TASK);

        await Location.startLocationUpdatesAsync(TASK, {
          accuracy: Location.Accuracy.High,
          timeInterval: intervalMs,
          distanceInterval: 10,
          showsBackgroundLocationIndicator: true,
          foregroundService: {
            notificationTitle: notifTitle,
            notificationBody: notifBody,
            notificationColor: notifColor,
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
