/**
 * sender.ts — Envío directo de puntos GPS con fetch (sin axios).
 *
 * Más robusto en background porque no depende de interceptors ni
 * manejo de refresco de token. Si falla, retorna false para que
 * offlineQueue lo encola.
 */

import * as SecureStore from 'expo-secure-store';

const API_BASE = 'https://recojossglab.duckdns.org/api';

export interface TrackingPayload {
  latitud: number;
  longitud: number;
  velocidad: number;
}

/**
 * Envía un punto de tracking al servidor usando fetch directo.
 * @returns true si el envío fue exitoso, false si falló.
 */
export async function sendPoint(payload: TrackingPayload): Promise<boolean> {
  try {
    const token = await SecureStore.getItemAsync('accessToken');
    if (!token) {
      console.warn('[Tracking] No hay token para enviar punto');
      return false;
    }

    const response = await fetch(`${API_BASE}/tracking/point`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.warn(`[Tracking] sendPoint HTTP ${response.status}`);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[Tracking] sendPoint error:', err);
    return false;
  }
}
