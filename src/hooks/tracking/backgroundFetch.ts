/**
 * backgroundFetch.ts — Tier 3: BackgroundFetch (KEEPALIVE).
 *
 * Último recurso para fabricantes ultra-agresivos.
 * Android puede espaciar esto hasta 15 min, pero al menos
 * da un punto y mantiene la app "viva" en el sistema.
 */

import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as BackgroundFetch from 'expo-background-fetch';
import { sendPoint } from './sender';
import { addToQueue } from './offlineQueue';

const BG_FETCH_TASK = 'SGLAB_BG_FETCH';

// ─── Tarea de BackgroundFetch ──
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

    const ok = await sendPoint(payload);
    if (!ok) {
      await addToQueue(payload);
    }

    return BackgroundFetch.BackgroundFetchResult.NewData;
  } catch {
    return BackgroundFetch.BackgroundFetchResult.NoData;
  }
});

/**
 * Registra la tarea de BackgroundFetch.
 */
export async function registerBackgroundFetch() {
  try {
    const status = await BackgroundFetch.getStatusAsync();
    if (status === BackgroundFetch.BackgroundFetchStatus.Denied) {
      console.warn('[Tracking] BackgroundFetch denegado por el sistema');
      return;
    }

    await BackgroundFetch.registerTaskAsync(BG_FETCH_TASK, {
      minimumInterval: 1, // 1 minuto (Android decide el mínimo real)
      stopOnTerminate: false,
      startOnBoot: true,
    });

    console.log('[Tracking] BackgroundFetch registrado');
  } catch (err) {
    console.warn('[Tracking] Error registrando BackgroundFetch:', err);
  }
}

/**
 * Desregistra la tarea de BackgroundFetch.
 */
export async function unregisterBackgroundFetch() {
  try {
    await BackgroundFetch.unregisterTaskAsync(BG_FETCH_TASK);
  } catch {
    // No crítico
  }
}
