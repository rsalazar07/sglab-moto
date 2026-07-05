/**
 * crashReport.ts — Logger de crashes nativo.
 * Escribe errores en el sistema de archivos del celular
 * para diagnosticar crashes que React no puede capturar con ErrorBoundary.
 *
 * El archivo se guarda en: DocumentDirectory/crash-log.txt
 * Lo puedes leer con "Leer archivo de crash" en la app o extrayendo con adb.
 */

import * as FileSystem from 'expo-file-system';

const CRASH_LOG = `${FileSystem.documentDirectory}crash-log.txt`;

/**
 * Escribe un mensaje de crash en el archivo de log.
 * Función sincrónica en esencia (usa then, no await) para no interferir.
 */
export function writeCrash(tag: string, message: string, stack?: string): void {
  const timestamp = new Date().toISOString();
  const entry = [
    `[${timestamp}] ${tag}: ${message}`,
    stack ? `STACK: ${stack}` : '',
    '---',
  ].join('\n');

  FileSystem.readAsStringAsync(CRASH_LOG)
    .then((existing) => FileSystem.writeAsStringAsync(CRASH_LOG, existing + '\n' + entry))
    .catch(() => FileSystem.writeAsStringAsync(CRASH_LOG, entry))
    .catch(() => {}); // si no se puede escribir, silencio total
}

/**
 * Lee el archivo de crash log completo.
 */
export async function readCrashLog(): Promise<string> {
  try {
    return await FileSystem.readAsStringAsync(CRASH_LOG);
  } catch {
    return '(sin crashes registrados)';
  }
}

/**
 * Limpia el archivo de crash log.
 */
export async function clearCrashLog(): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(CRASH_LOG, '');
  } catch {}
}

/**
 * Instala handlers globales para capturar errores no controlados.
 * Debe llamarse AL INICIO del layout, antes de cualquier otro código.
 */
export function installGlobalCrashHandler(): void {
  if (typeof __DEV__ !== 'undefined' && __DEV__) return; // no en dev

  writeCrash('BOOT', 'App iniciando', '');

  // ErrorHandler global de React Native
  const origHandler = ErrorUtils.getGlobalHandler && ErrorUtils.getGlobalHandler();
  if (ErrorUtils && ErrorUtils.setGlobalHandler) {
    ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
      writeCrash('FATAL', error.message || 'Unknown', error.stack || '');
      if (origHandler) origHandler(error, isFatal);
    });
  }

  // Unhandled promise rejections
  if (typeof global !== 'undefined') {
    const origOnError = global.onerror;
    global.onerror = (message: any, source?: string, lineno?: number, colno?: number, error?: Error) => {
      writeCrash('ONERROR', String(message), error?.stack || `${source}:${lineno}:${colno}`);
      if (origOnError) origOnError(message, source, lineno, colno, error);
    };

    // @ts-ignore — React Native specific
    const origOnUnhandled = global.onunhandledrejection;
    // @ts-ignore
    global.onunhandledrejection = (event: any) => {
      const reason = event?.reason || event;
      writeCrash('UNHANDLED_PROMISE', reason?.message || String(reason), reason?.stack || '');
      if (origOnUnhandled) origOnUnhandled(event);
    };
  }

  // setTimeout / setInterval error catch
  const origSetTimeout = global.setTimeout;
  // @ts-ignore
  global.setTimeout = (fn: Function, ms?: number, ...args: any[]) => {
    return origSetTimeout(() => {
      try {
        fn(...args);
      } catch (e: any) {
        writeCrash('TIMEOUT', e.message || String(e), e.stack || '');
        throw e;
      }
    }, ms);
  };

  writeCrash('BOOT', 'Global crash handlers installed', '');
}
