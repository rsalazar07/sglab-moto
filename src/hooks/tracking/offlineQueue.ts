/**
 * offlineQueue.ts — Cola offline para puntos GPS cuando no hay conexión.
 *
 * Cuando sendPoint() falla (sin red), el punto se encola en AsyncStorage.
 * Un intervalo en useTracking hace flush cada 30s cuando hay conexión.
 * Máximo 1000 puntos (descarta los más viejos si excede).
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { TrackingPayload } from './sender';
import { sendPoint } from './sender';

const QUEUE_KEY = 'tracking_queue';
const MAX_QUEUE = 1000;

/**
 * Lee la cola actual de AsyncStorage.
 */
async function getQueue(): Promise<TrackingPayload[]> {
  try {
    const raw = await AsyncStorage.getItem(QUEUE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Agrega un punto a la cola offline.
 * Si excede MAX_QUEUE, descarta los más viejos.
 */
export async function addToQueue(payload: TrackingPayload) {
  try {
    const queue = await getQueue();
    queue.push(payload);

    // Si excede el máximo, descartar los más viejos
    while (queue.length > MAX_QUEUE) {
      queue.shift();
    }

    await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    console.warn('[Tracking] Error encolando punto offline');
  }
}

/**
 * Intenta enviar todos los puntos encolados.
 * Los puntos exitosos se eliminan de la cola.
 * Los que fallan se quedan para el próximo intento.
 */
export async function flushQueue(): Promise<number> {
  try {
    const queue = await getQueue();
    if (queue.length === 0) return 0;

    const remaining: TrackingPayload[] = [];
    let sent = 0;

    for (const payload of queue) {
      const ok = await sendPoint(payload);
      if (ok) {
        sent++;
      } else {
        remaining.push(payload);
      }
    }

    // Si todos se enviaron, limpiar. Si no, guardar los que faltan.
    if (remaining.length === 0) {
      await AsyncStorage.removeItem(QUEUE_KEY);
    } else {
      await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(remaining));
    }

    return sent;
  } catch {
    return 0;
  }
}

/**
 * Retorna la cantidad de puntos encolados.
 */
export async function getQueueLength(): Promise<number> {
  const queue = await getQueue();
  return queue.length;
}
