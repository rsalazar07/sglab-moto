/**
 * useTracking — GPS en background con 4 TIERS + WAKE_LOCK.
 *
 * ARQUITECTURA (4 TIERS):
 * Tier 1: react-native-background-actions → foreground service con WAKE_LOCK
 *   → Mantiene CPU activo con teléfono bloqueado (ESENCIAL en XOS/Infinix)
 *   → Obtiene GPS cada 5s vía getCurrentPositionAsync
 *   → Envía vía sender.fetch()
 * Tier 2: expo-location startLocationUpdatesAsync → foreground service nativo
 *   → Respaldo si Tier 1 falla
 * Tier 3: expo-background-fetch → keepalive cada ~1-15 min
 * Tier 4: Offline Queue → AsyncStorage cuando no hay conexión
 *
 * + AppState listener: revive tracking al desbloquear
 * + Diálogo de optimización de batería (crítico en Infinix)
 * + requestIgnoreBatteryOptimizations (Android 6+)
 */

import { useRef, useCallback, useEffect } from 'react';
import { AppState } from 'react-native';
import * as Location from 'expo-location';
import * as KeepAwake from 'expo-keep-awake';
import * as SecureStore from 'expo-secure-store';
import { getSocket } from '../socket/socket';
import { api } from '../api/client';
import { sendPoint } from './tracking/sender';
import { addToQueue, flushQueue } from './tracking/offlineQueue';
import { startLocationTask, stopLocationTask } from './tracking/locationTask';
import {
  registerBackgroundFetch,
  unregisterBackgroundFetch,
} from './tracking/backgroundFetch';
import {
  startBackgroundService,
  stopBackgroundService,
  isBackgroundServiceRunning,
} from './tracking/backgroundActions';
import {
  showBatteryOptimizationDialog,
  requestIgnoreBatteryOptimizations,
} from './tracking/batteryDialog';

const INTERVAL_MS = 5000;
const TRACKING_FLAG = 'sglab_tracking_active';
const FLUSH_INTERVAL_MS = 30000;

// Referencias a nivel de módulo para que forceStopAllTracking pueda limpiar los intervals
let _globalInterval: any = null;
let _globalFlushInterval: any = null;

export const useTracking = () => {
  const interval = useRef<any>(null);
  const flushInterval = useRef<any>(null);
  const active = useRef(false);

  const startTracking = useCallback(async (): Promise<boolean> => {
    if (active.current) return true;

    try {
      // 1. Permisos
      const fg = await Location.requestForegroundPermissionsAsync();
      if (fg.status !== 'granted') {
        console.warn('[Tracking] Permiso GPS denegado');
        return false;
      }

      // 2. Diálogos de batería (solo primera vez, solo Android)
      showBatteryOptimizationDialog();
      requestIgnoreBatteryOptimizations();

      // 3. Iniciar sesión via REST
      try { await api.post('/tracking/start', {}); } catch {}

      // 4. Keep-awake mientras app visible
      try { await KeepAwake.activateKeepAwakeAsync(); } catch {}

      active.current = true;
      await SecureStore.setItemAsync(TRACKING_FLAG, 'true');

      // Sincronizar referencias globales para forceStopAllTracking
      _globalInterval = null;
      _globalFlushInterval = null;

      // ═══ TIER 1: background-actions con WAKE_LOCK (PRINCIPAL) ═══
      // Este es el foreground service con WAKE_LOCK que mantiene el CPU
      // activo con el teléfono bloqueado. Obtiene GPS cada 5s internamente.
      const bgActionsStarted = await startBackgroundService();
      if (!bgActionsStarted) {
        console.warn('[Tracking] Tier 1 (WAKE_LOCK) falló, continuando con Tier 2');
      }

      // ═══ TIER 2: expo-location foreground service (RESPALDO) ═══
      // El foreground service nativo de expo-location como respaldo.
      // NO tiene WAKE_LOCK pero algunos fabricantes lo respetan.
      const bgPerm = await Location.requestBackgroundPermissionsAsync();
      if (bgPerm.status === 'granted') {
        await startLocationTask();
      }

      // ═══ TIER 3: BackgroundFetch (KEEPALIVE) ═══
      await registerBackgroundFetch();

      // ═══ TIER 4: Offline Queue (RESPALDO) ═══
      flushInterval.current = setInterval(async () => {
        const sent = await flushQueue();
        if (sent > 0) {
          console.log(`[Tracking] Offline queue: ${sent} puntos recuperados`);
        }
      }, FLUSH_INTERVAL_MS);
      _globalFlushInterval = flushInterval.current;

      // ─── Foreground polling (solo cuando app visible) ──
      // WebSocket para tiempo real mientras la app está visible
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
          // WebSocket en foreground (más rápido que REST)
          try {
            const socket = await getSocket();
            socket.emit('tracking:point', payload);
          } catch {
            // Si WebSocket falla, REST
            await api.post('/tracking/point', payload);
          }
        } catch (err) {
          console.warn('[Tracking] Error en foreground polling:', err);
        }
      }, INTERVAL_MS);
      _globalInterval = interval.current;

      console.log('[Tracking] ✅ Tracking iniciado (4 tiers)');
      return true;
    } catch (err) {
      console.warn('[Tracking] Error iniciando tracking:', err);
      return false;
    }
  }, []);

  const stopTracking = useCallback(async () => {
    if (!active.current) return;

    // 1. Detener foreground polling
    if (interval.current) clearInterval(interval.current);
    interval.current = null;

    // 2. Detener flush de offline queue
    if (flushInterval.current) clearInterval(flushInterval.current);
    flushInterval.current = null;

    // Limpiar referencias globales
    _globalInterval = null;
    _globalFlushInterval = null;

    // 3. Detener Tier 1: background-actions (WAKE_LOCK)
    await stopBackgroundService();

    // 4. Detener Tier 2: expo-location task
    await stopLocationTask();

    // 5. Detener Tier 3: BackgroundFetch
    await unregisterBackgroundFetch();

    // 6. Hacer flush final de offline queue
    try { await flushQueue(); } catch {}

    // 7. Notificar servidor
    try { await api.post('/tracking/stop', {}); } catch {}
    try {
      const socket = await getSocket();
      socket.emit('tracking:stop');
    } catch {}

    // 8. Liberar keep-awake
    try { await KeepAwake.deactivateKeepAwake(); } catch {}

    // 9. Limpiar flag
    await SecureStore.setItemAsync(TRACKING_FLAG, 'false');
    active.current = false;
    console.log('[Tracking] ✅ Tracking detenido');
  }, []);

  // ─── AppState Listener — revive tracking al desbloquear ──
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        try {
          const wasActive = await SecureStore.getItemAsync(TRACKING_FLAG);
          if (wasActive === 'true' && !active.current) {
            console.log('[Tracking] App foreground — revive tracking');
            setTimeout(async () => {
              try {
                // Re-asegurar permisos
                await Location.requestForegroundPermissionsAsync();

                // Revivir Tier 1: background-actions (WAKE_LOCK)
                if (!isBackgroundServiceRunning()) {
                  await startBackgroundService();
                }

                // Revivir Tier 2: expo-location
                const bg = await Location.requestBackgroundPermissionsAsync();
                if (bg.status === 'granted') {
                  await startLocationTask();
                }

                // Revivir Tier 3: BackgroundFetch
                await registerBackgroundFetch();

                // Foreground polling (WebSocket para tiempo real)
                if (interval.current) clearInterval(interval.current);
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
                    const socket = await getSocket();
                    socket.emit('tracking:point', payload);
                  } catch {
                    // Si WebSocket falla, reintentar con REST
                    try {
                      const loc = await Location.getCurrentPositionAsync({
                        accuracy: Location.Accuracy.High,
                      });
                      await api.post('/tracking/point', {
                        latitud: loc.coords.latitude,
                        longitud: loc.coords.longitude,
                        velocidad: loc.coords.speed ?? 0,
                      });
                    } catch {}
                  }
                }, INTERVAL_MS);
                _globalInterval = interval.current;

                // Keep-awake
                try { await KeepAwake.activateKeepAwakeAsync(); } catch {}

                active.current = true;
                console.log('[Tracking] ✅ Tracking revivido al desbloquear');
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
 * Detiene TODO el tracking desde fuera del hook.
 * También limpia los intervals de foreground polling y flush.
 */
export async function forceStopAllTracking() {
  // Limpiar intervals creados por el hook (vía refs globales)
  if (_globalInterval) {
    clearInterval(_globalInterval);
    _globalInterval = null;
  }
  if (_globalFlushInterval) {
    clearInterval(_globalFlushInterval);
    _globalFlushInterval = null;
  }

  await stopBackgroundService();
  await stopLocationTask();
  await unregisterBackgroundFetch();
  try { await flushQueue(); } catch {}
  try { await api.post('/tracking/stop', {}); } catch {}
  try {
    const socket = await getSocket();
    socket.emit('tracking:stop');
  } catch {}
  try { await KeepAwake.deactivateKeepAwake(); } catch {}
  try { await SecureStore.setItemAsync(TRACKING_FLAG, 'false'); } catch {}
}
