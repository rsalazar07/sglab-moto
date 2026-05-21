const LOG_URL = 'https://recojossglab.duckdns.org/api/logs/device';
const LOG_URL_LOCAL = 'http://81.17.100.158:3456/api/logs/device';
const BATCH_SIZE = 10;
const FLUSH_INTERVAL = 5000; // 5 segundos

interface LogEntry {
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
  tag: string;
  message: string;
  timestamp: string;
  device: string;
}

let buffer: LogEntry[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let deviceId: string = 'unknown';

function getDeviceId(): string {
  return deviceId;
}

export function setDeviceId(id: string) {
  deviceId = id;
}

function getAuthToken(): string | null {
  try {
    // Intenta obtener token de SecureStore dinámicamente
    const SecureStore = require('expo-secure-store');
    // Esto es async, así que mejor lo manejamos aparte
    return null;
  } catch {
    return null;
  }
}

async function flush() {
  if (buffer.length === 0) return;

  const batch = buffer.splice(0);
  const body = JSON.stringify(batch.length === 1 ? batch[0] : batch);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(LOG_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!res.ok) {
      console.warn('[LogReporter] flush failed:', res.status);
    }
  } catch (e) {
    console.warn('[LogReporter] network error:', e);
  }

  // También enviar al server local (fire & forget)
  try {
    fetch(LOG_URL_LOCAL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    }).catch(() => {});
  } catch {}
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_INTERVAL);
}

export function send(
  level: 'DEBUG' | 'INFO' | 'WARN' | 'ERROR',
  tag: string,
  message: string,
) {
  const entry: LogEntry = {
    level,
    tag,
    message: typeof message === 'string' ? message : JSON.stringify(message),
    timestamp: new Date().toISOString(),
    device: deviceId,
  };

  buffer.push(entry);

  if (buffer.length >= BATCH_SIZE) {
    flush();
  } else {
    scheduleFlush();
  }
}

// Intercepta errores no capturados en React Native
if (typeof ErrorUtils !== 'undefined') {
  const originalHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
    send('ERROR', 'uncaught', `[${isFatal ? 'FATAL' : 'NON-FATAL'}] ${error?.name || 'Error'}: ${error?.message || ''}\n${error?.stack || ''}`);
    originalHandler(error, isFatal);
  });
}
