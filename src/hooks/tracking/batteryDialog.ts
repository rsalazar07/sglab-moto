/**
 * batteryDialog.ts — Diálogo para desactivar optimización de batería.
 *
 * En Infinix/Xiaomi/Huawei, sin esto el tracking en background no funciona.
 * Se muestra UNA SOLA VEZ (guarda flag en AsyncStorage).
 */

import { Alert, Linking, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const BATTERY_FLAG = 'battery_opt_dismissed';
const REQUEST_FLAG = 'battery_request_dismissed';

/**
 * Solicita al usuario desactivar la optimización de batería para esta app.
 * En Android 6+, abre la pantalla de configuración de batería.
 * En algunos fabricantes (XOS, MIUI, EMUI), abre la pantalla de la app.
 *
 * Se muestra UNA SOLA VEZ (guarda flag en AsyncStorage).
 */
export async function requestIgnoreBatteryOptimizations() {
  // Solo Android
  if (Platform.OS !== 'android') return;

  try {
    const dismissed = await AsyncStorage.getItem(REQUEST_FLAG);
    if (dismissed === 'true') return;

    Alert.alert(
      '🔋 Sin restricciones de batería',
      'Para que SGLab Moto funcione con el celular bloqueado:\n\n' +
      'Activa "Sin restricciones" o "No optimizar" en la configuración de batería.\n\n' +
      'Esto permite que la app envíe tu ubicación cada 5 segundos ' +
      'incluso con la pantalla apagada.',
      [
        { text: 'Ahora no', style: 'cancel' },
        {
          text: 'Abrir configuración',
          onPress: () => {
            // Intenta abrir ajustes de batería específicos
            tryToOpenBatterySettings();
            AsyncStorage.setItem(REQUEST_FLAG, 'true').catch(() => {});
          },
        },
      ]
    );
  } catch {
    // Si falla AsyncStorage, se mostrará de nuevo
  }
}

/**
 * Intenta abrir la configuración de batería para esta app.
 * Fallback: abre ajustes generales.
 */
async function tryToOpenBatterySettings() {
  try {
    // ACTION_APPLICATION_DETAILS_SETTINGS — pantalla de info de la app
    await Linking.openURL('package:com.sglab.moto');
  } catch {
    try {
      // Fallback: ajustes generales
      await Linking.openSettings();
    } catch {
      // No hay fallback adicional
    }
  }
}

/**
 * Muestra el diálogo de optimización de batería si no se ha mostrado antes.
 * Solo aplica en Android.
 */
export async function showBatteryOptimizationDialog() {
  // Solo Android
  if (Platform.OS !== 'android') return;

  try {
    const dismissed = await AsyncStorage.getItem(BATTERY_FLAG);
    if (dismissed === 'true') return; // Ya lo mostramos antes

    Alert.alert(
      '🔋 Optimización de batería',
      'Para que SGLab Moto funcione con el celular bloqueado:\n\n' +
      '1. Presiona "Abrir configuración"\n' +
      '2. Busca "SGLab Moto" en la lista\n' +
      '3. Selecciona "Sin restricciones" o "No optimizar"\n\n' +
      'Esto permite que la app envíe tu ubicación en tiempo real, ' +
      'como las apps de delivery (Rappi, Uber).',
      [
        { text: 'Ahora no', style: 'cancel' },
        {
          text: 'Abrir configuración',
          onPress: () => {
            Linking.openSettings();
            // Guardamos para no repetir
            AsyncStorage.setItem(BATTERY_FLAG, 'true').catch(() => {});
          },
        },
      ]
    );
  } catch {
    // Si falla AsyncStorage, no importa — el diálogo se mostrará de nuevo
  }
}
