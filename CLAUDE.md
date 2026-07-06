# SGLab Moto — App Motorizado

## Stack
- **App:** Expo SDK 54, React Native, TypeScript
- **Router:** expo-router (file-based)
- **Estado:** Zustand (authStore)
- **API:** Axios + interceptors (token refresh automático)
- **Navegación:** Stack (root _layout.tsx) → Tabs (app/(app)/_layout.tsx)
- **Auth:** JWT + refresh token, deviceId único por dispositivo
- **Backend:** NestJS en /root/lablogix/apps/backend (puerto 8090)
- **Build:** EAS Build via GitHub Actions (rsalazar07/sglab-moto)

## Archivos Clave

### App (Expo)
| Archivo | Propósito |
|---------|-----------|
| `app/_layout.tsx` | Root layout: ErrorBoundary, splash, auth init, redirige a /login si no autenticado |
| `app/(app)/_layout.tsx` | Tab layout: Tabs (Recojos + Mi día), redirige a /login si no autenticado |
| `app/(app)/tickets.tsx` | Pantalla de tickets: lista, filtros, logout, modal de registro de recojo, fotos |
| `app/(app)/dia.tsx` | Pantalla "Mi día": resumen, progreso, datos motorizado, botón cerrar sesión |
| `app/login.tsx` | Pantalla de login |
| `src/api/auth.ts` | Auth API: login, logout, me, deviceId |
| `src/api/client.ts` | Axios instance con interceptors: token en headers, refresh automático en 401 |
| `src/api/tickets.ts` | Tickets API: getMisTickets, updateEstado, tomarTicket, subirEvidencia, guardarRegistro, registrarCobro |
| `src/hooks/useTracking.ts` | Hook de GPS tracking: foreground + background, AppState listener, BackgroundFetch |
| `src/store/authStore.ts` | Zustand store: user, isAuthenticated, setUser, clearUser |
| `src/socket/socket.ts` | WebSocket (Socket.IO) |
| `src/lib/crashReport.ts` | Crash handler global (escribe logs a archivo) |
| `src/lib/LogReporter.ts` | Logger que manda logs al endpoint /logs/device del backend |

### Backend (NestJS)
| Archivo | Propósito |
|---------|-----------|
| `apps/backend/src/auth/auth.service.ts` | Login con deviceId, refresh tokens, multi-dispositivo (DESACTIVADO) |
| `apps/backend/src/auth/strategies/jwt.strategy.ts` | JWT validation — sesión única (DESACTIVADA) |
| `apps/backend/src/tickets/tickets.controller.ts` | Endpoints de tickets: listar, cambiar estado, evidencia (FileInterceptor) |
| `apps/backend/src/tickets/tickets.service.ts` | Lógica de tickets: filtros por motorizado, guardar registro, transiciones de estado |
| `apps/backend/src/motorizados/motorizados.service.ts` | UI_CONFIG (SDUI): colores, textos, ticketFlow, screenConfig |
| `apps/backend/src/socket/socket.gateway.ts` | WebSocket gateway para eventos en tiempo real |

## Bugs Conocidos y Fixes

### Bug 1: LOGOUT no funciona (RESUELTO en 9ab9cc7)
- **Causa raíz:** `dia.tsx` importaba `forceStopAllTracking` de `useTracking.ts`, pero esa función NO EXISTE en ese módulo (solo exporta `useTracking`). Metro bundler no corre TypeScript, compila sin error. En runtime: `undefined()` → crash → nunca llega a `clearUser()`.
- **Fix:** 
  - Eliminar el import fantasma de `forceStopAllTracking`
  - Reemplazar por llamadas API directas (`/tracking/stop`, `/motorizados/me/estado`)
  - `clearUser()` + `router.replace('/login')` se ejecutan SIN await antes que cualquier async
  - La limpieza (tracking, socket, logout API) corre en IIFE con try/catch

### Bug 2: Fotos fallan con "No se pudo leer la foto" (PENDIENTE)
- **Causa probable:** `ImagePicker.launchCameraAsync` devuelve URI tipo `content://media/...` en algunos Android. `expo-file-system.readAsStringAsync` no siempre soporta `content://` URIs.
- **Fix recomendado por Claude Code:** NO usar `FileSystem.readAsStringAsync` + base64. Usar el endpoint `POST /tickets/:id/evidencia` que ya existe con `FormData` (multipart, nativo, sin heap JS). Cambiar el orden en `completarRecojo`:
  1. `subirEvidencia(ticketId, fotoUri)` → obtiene URL
  2. `guardarRegistro(ticketId, { refNombre, observaciones, fotoUrl: url })`
  3. `updateEstado → RECOGIDO`
- **Nota:** `removeClippedSubviews=false` NO es la causa real (Claude Code lo confirmó).

## SDUI (Server-Driven UI)
La app ya carga colores, textos, botones y visibilidad de secciones desde `/motorizados/config`. El archivo UI_CONFIG está en `motorizados.service.ts` líneas 23-302. Cambios allí se reflejan SIN rebuild.

## Sesión única DESACTIVADA
Se eliminó la verificación de deviceId en JWT, login y refresh. Los motorizados pueden iniciar sesión en múltiples dispositivos sin que se revoquen entre sí.

## Estado Actual
- Último commit: 9ab9cc7 (fix logout)
- Build actual en GitHub Actions (cf1a3af) — tiene el fix de logout prioritario pero NO el fix de fotos
- Pendiente: arreglar fotos usando `subirEvidencia` con FormData
