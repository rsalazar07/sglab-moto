/**
 * locationTask.ts — Tier 2: expo-location background task (COMPLEMENTO).
 *
 * Usa el task manager de expo-location para recibir ubicaciones
 * cuando Android las entrega. Es COMPLEMENTO del foreground service.
 *
 * Si Android entrega datos (algunos fabricantes sí lo hacen a veces),
 * enviamos el punto. Si no, el Tier 1 (BackgroundActions) se encarga.
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

  // Fallback: obtener ubicación manual
  try {
    const loc = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
    const payload = {
      latitud: loc.coords.latitude,
      longitud: loc.coords.longitude,
      velocidad: loc.coords.speed ?? 0,
    };

    const ok = await sendPoint(payload);
    if (!ok) {
      await addToQueue(payload);
    }
  } catch (err) {
    console.warn('[Tracking] LocationTask fallback error:', err);
  }
});

/**
 * Inicia las actualizaciones de ubicación en background (expo-location).
 */
export async function startLocationTask() {
  try {
    const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
    if (isRunning) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
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
    }
  } catch (err) {
    console.warn('[Tracking] Error deteniendo LocationTask:', err);
  }
}
