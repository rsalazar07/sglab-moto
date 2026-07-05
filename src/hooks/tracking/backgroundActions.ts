/**
 * backgroundActions.ts — Tier 1: WAKE_LOCK foreground service.
 *
 * Usa react-native-background-actions v4.1.0 para crear un foreground
 * service con WAKE_LOCK en Android. Esto mantiene el CPU activo incluso
 * con el teléfono bloqueado, permitiendo que el chip GPS funcione.
 *
 * DIFERENCIA vs expo-location:
 * - expo-location startLocationUpdatesAsync: crea foreground service
 *   pero NO adquiere WAKE_LOCK → CPU se duerme → GPS se apaga
 * - react-native-background-actions: adquiere WAKE_LOCK → CPU activo
 *   → GPS funciona continuamente
 *
 * Cada 5 segundos obtiene ubicación vía getCurrentPositionAsync y la envía.
 *
 * NOTA: NO tiene config plugin. No poner en app.json/plugins.
 * Se autolinkea desde package.json.
 */

import BackgroundService from 'react-native-background-actions';
import * as Location from 'expo-location';
import { sendPoint } from './sender';
import { addToQueue } from './offlineQueue';

const INTERVAL_MS = 5000;

/**
 * Opciones del foreground service.
 * foregroundServiceType es ARRAY (correcto para v4.1.0).
 * NO usar "foregroundServiceTypes" (plural) — ese typo causó crash en build #42.
 */
const serviceOptions = {
  taskName: 'SGLab GPS',
  taskTitle: '🏍️ SGLab Moto activo',
  taskDesc: 'Enviando ubicación en tiempo real',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#00d4ff',
  linkingURI: 'sglab-moto://',
  parameters: {
    delay: INTERVAL_MS,
  },
  // SINGULAR, correcto. Array de tipos de foreground service.
  // NOTA: NO usamos foregroundServiceType porque la librería
  // no declara android:foregroundServiceType en su manifest.
  // Sin esto, funciona en todas las versiones de Android.
  // Con esto, crashea en Android 14+ por MissingForegroundServiceTypeException.
  autoStart: false,
  progressBar: {
    max: 100,
    value: 0,
    indeterminate: true,
  },
};

/**
 * Tarea que se ejecuta en el foreground service.
 * Corre en un bucle mientras BackgroundService.isRunning() sea true.
 * Cada {delay} ms obtiene ubicación GPS y la envía.
 */
const backgroundTask = async (taskData?: { delay?: number }) => {
  const delay = taskData?.delay ?? INTERVAL_MS;

  while (BackgroundService.isRunning()) {
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
    } catch (err: any) {
      // GPS puede no estar disponible temporalmente
      if (__DEV__) {
        console.warn('[BackgroundActions] Error GPS:', err?.message ?? err);
      }
    }

    // Esperar el intervalo antes de la siguiente iteración
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
};

/**
 * Inicia el foreground service con WAKE_LOCK.
 * Crea notificación persistente y mantiene CPU activo.
 */
export async function startBackgroundService(): Promise<boolean> {
  try {
    if (BackgroundService.isRunning()) {
      console.log('[BackgroundActions] Ya está corriendo');
      return true;
    }

    await BackgroundService.start(backgroundTask, serviceOptions);
    console.log('[BackgroundActions] ✅ Foreground service iniciado con WAKE_LOCK');
    return true;
  } catch (err: any) {
    console.warn('[BackgroundActions] Error al iniciar:', err?.message ?? err);
    return false;
  }
}

/**
 * Detiene el foreground service.
 */
export async function stopBackgroundService(): Promise<void> {
  try {
    if (!BackgroundService.isRunning()) return;

    await BackgroundService.stop();
    console.log('[BackgroundActions] ✅ Foreground service detenido');
  } catch (err: any) {
    console.warn('[BackgroundActions] Error al detener:', err?.message ?? err);
  }
}

/**
 * Indica si el foreground service está activo.
 */
export function isBackgroundServiceRunning(): boolean {
  try {
    return BackgroundService.isRunning();
  } catch {
    return false;
  }
}
