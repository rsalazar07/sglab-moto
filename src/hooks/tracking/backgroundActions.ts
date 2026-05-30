/**
 * backgroundActions.ts — Tier 1: Foreground service con WAKE_LOCK.
 *
 * Usa react-native-background-actions para mantener el JS runtime
 * vivo y el GPS despierto incluso con el teléfono bloqueado.
 *
 * Es el mecanismo PRINCIPAL de tracking (no respaldo).
 * Las apps de delivery (Rappi, Uber) usan este mismo enfoque.
 */

import BackgroundService from 'react-native-background-actions';
import * as Location from 'expo-location';
import { sendPoint } from './sender';
import { addToQueue } from './offlineQueue';

const INTERVAL_MS = 5000; // cada 5 segundos

interface BackgroundPayload {
  delay?: number;
}

/**
 * Tarea que se ejecuta en el foreground service.
 * Corre en un hilo JS real con PARTIAL_WAKE_LOCK.
 * setInterval funciona aunque el teléfono esté bloqueado.
 */
const backgroundTask = async (taskData?: BackgroundPayload) => {
  const delay = taskData?.delay ?? INTERVAL_MS;

  // Loop infinito controlado por BackgroundService
  await new Promise<void>(async (resolve) => {
    const interval = setInterval(async () => {
      // Verificar si debemos detenernos
      if (!BackgroundService.isRunning()) {
        clearInterval(interval);
        resolve();
        return;
      }

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
          // Sin conexión — encolar para después
          await addToQueue(payload);
        }
      } catch (err) {
        console.warn('[Tracking] BackgroundActions GPS error:', err);
      }
    }, delay);
  });
};

/**
 * Opciones del foreground service.
 * La notificación es OBLIGATORIA en Android y no descartable.
 */
const serviceOptions = {
  taskName: 'SGLab Moto',
  taskTitle: '🏍️ SGLab Moto — Enviando ubicación',
  taskDesc: 'Tracking activo en tiempo real',
  taskIcon: {
    name: 'ic_launcher',
    type: 'mipmap',
  },
  color: '#00d4ff',
  linkingURI: 'sglabmoto://',
  parameters: {
    delay: INTERVAL_MS,
  },
  // Para Android 14+
  foregroundServiceTypes: ['location' as any],
  // Notificación con prioridad máxima
  progressBar: {
    max: 100,
    value: 0,
    indeterminate: true,
  },
};

/**
 * Inicia el foreground service de background-actions.
 * Esto mantiene el JS runtime vivo y el GPS activo.
 */
export async function startBackgroundService() {
  try {
    if (BackgroundService.isRunning()) {
      console.log('[Tracking] BackgroundActions ya está corriendo');
      return;
    }
    await BackgroundService.start(backgroundTask, serviceOptions);
    console.log('[Tracking] BackgroundActions iniciado ✅');
  } catch (err) {
    console.warn('[Tracking] Error iniciando BackgroundActions:', err);
  }
}

/**
 * Detiene el foreground service.
 */
export async function stopBackgroundService() {
  try {
    if (!BackgroundService.isRunning()) return;
    await BackgroundService.stop();
    console.log('[Tracking] BackgroundActions detenido');
  } catch (err) {
    console.warn('[Tracking] Error deteniendo BackgroundActions:', err);
  }
}

/**
 * Verifica si el servicio está corriendo.
 */
export function isBackgroundServiceRunning(): boolean {
  return BackgroundService.isRunning();
}
