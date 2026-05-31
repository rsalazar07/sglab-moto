/**
 * useTracking — GPS en background con expo-location (SIMPLIFICADO).
 *
 * ARQUITECTURA (3 TIERS):
 * Tier 1: expo-location startLocationUpdatesAsync → foreground service nativo
 *   → Mantiene GPS activo incluso con teléfono bloqueado (notif persistente)
 *   → Envía ubicaciones vía sender.fetch()
 * Tier 2: expo-background-fetch → keepalive cada ~1-15 min
 * Tier 3: Offline Queue → AsyncStorage cuando no hay conexión
 *
 * + AppState listener: revive tracking al desbloquear
 * + Diálogo de optimización de batería (crítico en Infinix)
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
import { showBatteryOptimizationDialog } from './tracking/batteryDialog';

const INTERVAL_MS = 5000;
const TRACKING_FLAG = 'sglab_tracking_active';
const FLUSH_INTERVAL_MS = 30000;

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

      // 2. Diálogo de batería (solo primera vez, solo Android)
      showBatteryOptimizationDialog();

      // 3. Iniciar sesión via REST
      try { await api.post('/tracking/start', {}); } catch {}

      // 4. Keep-awake mientras app visible
      try { await KeepAwake.activateKeepAwakeAsync(); } catch {}

      active.current = true;
      await SecureStore.setItemAsync(TRACKING_FLAG, 'true');

      // ═══ TIER 1: expo-location foreground service (ÚNICO) ═══
      // Esto mantiene el GPS activo incluso con teléfono bloqueado
      // usando el foreground service NATIVO de expo-location
      const bg = await Location.requestBackgroundPermissionsAsync();
      if (bg.status === 'granted') {
        await startLocationTask();
      }

      // ═══ TIER 2: BackgroundFetch (KEEPALIVE) ═══
      await registerBackgroundFetch();

      // ═══ TIER 3: Offline Queue (RESPALDO) ═══
      flushInterval.current = setInterval(async () => {
        const sent = await flushQueue();
        if (sent > 0) {
          console.log(`[Tracking] Offline queue: ${sent} puntos recuperados`);
        }
      }, FLUSH_INTERVAL_MS);

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

      console.log('[Tracking] ✅ Tracking iniciado (expo-location)');
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

    // 2. Detener flush de offline queue
    if (flushInterval.current) clearInterval(flushInterval.current);

    // 3. Detener Tier 1: expo-location task
    await stopLocationTask();

    // 4. Detener Tier 2: BackgroundFetch
    await unregisterBackgroundFetch();

    // 5. Hacer flush final de offline queue
    try { await flushQueue(); } catch {}

    // 6. Notificar servidor
    try { await api.post('/tracking/stop', {}); } catch {}
    try {
      const socket = await getSocket();
      socket.emit('tracking:stop');
    } catch {}

    // 7. Liberar keep-awake
    try { await KeepAwake.deactivateKeepAwake(); } catch {}

    // 8. Limpiar flag
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

                // Asegurar que Tier 1 sigue vivo
                const bg = await Location.requestBackgroundPermissionsAsync();
                if (bg.status === 'granted') {
                  await startLocationTask();
                }

                // Asegurar Tier 2
                await registerBackgroundFetch();

                // Foreground polling (WebSocket para tiempo real)
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
                    // WebSocket puede fallar al reconectar
                  }
                }, INTERVAL_MS);

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
 */
export async function forceStopAllTracking() {
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
