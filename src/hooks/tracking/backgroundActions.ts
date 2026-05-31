/**
 * backgroundActions.ts — ELIMINADO.
 *
 * react-native-background-actions causaba crash en Android 14+ por:
 * 1. Typo en foregroundServiceTypes (debía ser foregroundServiceType)
 * 2. Módulo nativo no autolinkedo en Expo SDK 54
 * 3. Conflicto con el foreground service de expo-location
 *
 * Ahora usamos SOLO expo-location + expo-background-fetch.
 * Ver locationTask.ts, backgroundFetch.ts y sender.ts
 */

export async function startBackgroundService() {
  console.log('[Tracking] BackgroundActions eliminado — usando expo-location');
}

export async function stopBackgroundService() {
  // No-op
}

export function isBackgroundServiceRunning(): boolean {
  return false;
}
