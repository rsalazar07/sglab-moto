/**
 * locationTask.ts — Tier 1: expo-location foreground service (ÚNICO).
 *
 * Este es el MECANISMO PRINCIPAL de tracking en background.
 * Usa el foreground service NATIVO de expo-location con notificación
 * persistente. Funciona incluso con el teléfono bloqueado.
 *
 * NOTA: No usar con react-native-background-actions. Ambos crean
 * foreground services separados causando conflictos en Android 14+.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { sendPoint } from './sender';
import { addToQueue } from './offlineQueue';

const LOCATION_TASK = 'SGLAB_GPS_TASK';

// ─── Tarea de background (expo-location) ──
TaskManager.defineTask(LOCATION_TASK, async ({ data, error }: any) => {
  if (error) {
    console.error('[Tracking] LocationTask error:', error);
    return;
  }

  // Usar datos del sistema si llegaron
  if (data?.locations?.[0]) {
    const loc = data.locations[0];
    const payload = {
      latitud: loc.coords.latitude,
      longitud: loc.coords.longitude,
      velocidad: loc.coords.speed ?? 0,
    };

    const ok = await sendPoint(payload);
    if (!ok) {
      await addToQueue(payload);
    }
    return;
  }
});

/**
 * Inicia las actualizaciones de ubicación en background con foreground service.
 * NO reinicia si ya está corriendo.
 */
export async function startLocationTask() {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (isRunning) {
      console.log('[Tracking] LocationTask ya está corriendo');
      return;
    }

    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.High,
      timeInterval: 5000,
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
    console.log('[Tracking] LocationTask iniciado ✅');
  } catch (err) {
    console.warn('[Tracking] Error iniciando LocationTask:', err);
  }
}

/**
 * Detiene las actualizaciones de ubicación en background.
 */
export async function stopLocationTask() {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
      console.log('[Tracking] LocationTask detenido');
    }
  } catch (err) {
    console.warn('[Tracking] Error deteniendo LocationTask:', err);
  }
}
