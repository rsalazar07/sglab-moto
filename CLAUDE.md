# SGLab — Plataforma de Recojo de Muestras

## Arquitectura General (3 Proyectos)

```
Frontend Admin (Next.js)  ──→  Backend API (NestJS)  ──→  PostgreSQL
     :3002                        :8090
       │
App Motorizado (Expo RN)──→  WebSocket (Socket.IO)
     APK Android                :8090
```

## 1. Backend NestJS (`/root/lablogix/apps/backend/`)

### Stack
- NestJS 10, Prisma 6 (PostgreSQL), Socket.IO, JWT + Passport, bcrypt, class-validator
- Swagger en /api/docs, Helmet, Throttler (rate limit), EventEmitter, Schedule (cron)

### Módulos (20 total)

| Módulo | Archivos | Propósito |
|--------|----------|-----------|
| `auth` | controller, service, guards, strategies, decorators, DTOs | Login/register/refresh/logout, JWT, roles, permisos |
| `tickets` | controller, service, DTOs (create, update, query, cambiar-estado, cancelar, asignar) | CRUD tickets, cambios de estado, evidencias, cobros, registro de recojo |
| `motorizados` | controller, service, DTOs | CRUD motorizados, estado, config SDUI |
| `tracking` | controller, service, cleanup | GPS tracking en tiempo real, sesiones, puntos |
| `websocket` | socket.gateway | WebSocket: conexión JWT, eventos en tiempo real |
| `dashboard` | controller, service | Estadísticas: summary, rendimiento, tickets-por-estado, metrics-semanales |
| `referencias` | controller, service, DTOs | CRUD referencias (clientes/lugares de recojo) |
| `rutas` | controller, service, DTOs | Planificación de rutas para motorizados |
| `configuracion` | controller, service | Configuración del tenant |
| `reportes` | controller, service, template | Generación de reportes PDF/HTML |
| `audit` | controller, service | Logs de auditoría |
| `logs` | controller, service | Logs de dispositivo (desde app motorizado) |
| `stats` | controller, service | Estadísticas varias |
| `super-admin` | controller, service | Gestión de tenants |
| `users` | service | CRUD usuarios |
| `health` | controller | Health check |
| `prisma` | service | Conexión Prisma |

### Base de Datos (Prisma Schema — 438 líneas)

**Modelos principales:**
- **Tenant** — multi-tenencia (plan, status, límites)
- **TenantConfig** — configuración por tenant (maxTicketsSimultaneos, auto-asignación, SLA)
- **User** — usuarios con rol (SUPER_ADMIN, ADMIN, REFERENCIA, MOTORIZADO), currentDeviceId
- **Referencia** — puntos de recojo (nombre, dirección, GPS, horario)
- **Motorizado** — motoristas (vehículo, placa, estado, teléfono)
- **Ticket** — orden de recojo (estado: PENDIENTE→ASIGNADO→EN_RUTA→EN_RECOJO→RECOGIDO→EN_LABORATORIO→ENTREGADO→CERRADO/CANCELADO/FALLIDO)
- **TicketHistory** — historial de cambios de estado
- **Ruta / RutaParada** — rutas planificadas con paradas
- **TrackingSession / TrackingPoint** — sesiones de GPS con puntos
- **RefreshToken** — tokens JWT refresh
- **AuditLog** — auditoría de acciones
- **Subscription** — suscripciones Stripe

### Endpoints API

**Auth:** `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/reset-password/:userId`

**Tickets:** `GET /tickets`, `GET /tickets/:id`, `GET /tickets/:id/flow`, `POST /tickets`, `PATCH /tickets/:id`, `DELETE /tickets/:id`, `POST /tickets/:id/asignar`, `/reasignar`, `/cancelar`, `/cambiar-estado`, `/tomar`, `/evidencia`, `/cobro`, `/registro`, `/validate-registro`

**Motorizados:** `GET /motorizados`, `GET /motorizados/disponibles`, `GET /motorizados/me`, `GET /motorizados/config`, `PATCH /motorizados/me/estado`, CRUD por id

**Tracking:** `POST /tracking/start`, `/tracking/point`, `/tracking/stop`, `GET /tracking/active`, `GET /tracking/sessions/:id`, `GET /tracking/live`

**Dashboard:** `GET /dashboard/summary`, `/motorizado-rendimiento`, `/referencia-rendimiento`, `/tickets-por-estado`, `/metrics-semanales`, `/resumen-diario`

**Reportes:** `GET /reportes/config`, `GET /reportes/generar`

**Otros:** `GET /health`, `GET /logs/device`, CRUD referencias/rutas/configuración, super-admin

### WebSocket (Socket.IO Gateway)
- **Conexión:** Autenticación vía JWT en handshake query (`token`)
- **Rooms:** `tenant:{tenantId}` (todo el tenant), socket individual por userId
- **Eventos entrantes:** `tracking:point` (actualizar posición GPS)
- **Eventos salientes:**
  - `tracking:position` — posición de motorizado a todo el tenant
  - `ticket:update` — cambio de estado de ticket
  - `ticket:new` — nuevo ticket creado
  - `motorizado:estado` — cambio de estado del motorizado
  - `auth:session:revoked` — sesión revocada (DESACTIVADO)
- **Mensajes pendientes:** Se encolan cuando usuario offline y se entregan al reconectar

### SDUI (Server-Driven UI)
- `GET /motorizados/config` devuelve UI_CONFIG con: estadosMoto, opcionesPago, tiemposMaquina, ticketFlow, flowButtons, dashboard (colores, textos, login/splash/tabs/tracking), designTokens (fontSizes, spacing, borderRadius), uiLabels, screenConfig (show/hide elementos), sections (activos, pendientes, asignados, completados)
- **No necesita rebuild de app** — cambios en backend se reflejan al recargar pantalla

### Seguridad
- Rate limiting (ThrottlerModule), Helmet, CORS
- JWT con deviceId (sesión única DESACTIVADA), refresh token rotation (7d expiry)
- Multi-tenencia: toda query filtrada por tenantId

---

## 2. App Motorizado (Expo React Native) — `/root/sglab-moto-build/`

### Stack
- Expo SDK 54, React Native 0.81.5, TypeScript
- expo-router (file-based routing), Zustand (estado), Axios (API), Socket.IO Client (WebSocket)
- expo-location + expo-task-manager (GPS background), expo-image-picker (cámara), expo-file-system (lectura fotos)
- expo-secure-store (tokens), expo-keep-awake (pantalla encendida)

### Archivos

| Archivo | Propósito |
|---------|-----------|
| `app/_layout.tsx` | Root: ErrorBoundary, splash screen, auth init (check token + me()), redirige /login si no auth |
| `app/(app)/_layout.tsx` | Tabs layout: Recojos + Mi día, redirige /login si no auth (SIN check de loading) |
| `app/(app)/tickets.tsx` | PRINCIPAL: lista de tickets con FlatList, filtros SDUI, modal registro de recojo, cámara, logout |
| `app/(app)/dia.tsx` | Mi día: resumen de actividad, progreso, datos motorizado, botón cerrar sesión |
| `app/login.tsx` | Login: email + password + deviceId |
| `app/index.tsx` | Index redirect |
| `src/api/auth.ts` | login(), logout(), me(), getOrCreateDeviceId() |
| `src/api/client.ts` | Axios: token en headers, refresh automático en 401, log de errores |
| `src/api/tickets.ts` | getMisTickets(), updateEstado(), tomarTicket(), subirEvidencia(FormData), guardarRegistro(), registrarCobro() |
| `src/hooks/useTracking.ts` | Hook GPS: start/stop tracking, foreground + background, AppState listener, BackgroundFetch |
| `src/hooks/tracking/*` | Módulos de tracking: backgroundActions, backgroundFetch, batteryDialog, locationTask, offlineQueue, sender |
| `src/socket/socket.ts` | Socket.IO: connect, disconnect, getSocket |
| `src/store/authStore.ts` | Zustand: user, isAuthenticated, setUser, clearUser |
| `src/lib/crashReport.ts` | Crash handler global con ErrorBoundary y logs a archivo |
| `src/lib/LogReporter.ts` | Logger que envía logs a /logs/device del backend |

### Flujo de Autenticación
1. Login: email + password + deviceId (generado como `rn_{timestamp}_{random}`)
2. Backend devuelve accessToken (JWT 7d) + refreshToken
3. Tokens guardados en SecureStore
4. Axios interceptor: agrega `Authorization: Bearer {token}`
5. En 401: intenta refresh con refreshToken, si falla → borra tokens, redirige a login
6. deviceId también se guarda y reusa

### Flujo de Tickets
1. App carga tickets via `GET /tickets` (filtrados por motorizado en backend)
2. Separa por estado usando `config.ticketFlow` (SDUI desde backend)
3. Motorizado ve PENDIENTES → toca "Tomar pedido" → `POST /tickets/:id/tomar`
4. Estado cambia: ASIGNADO → EN_RUTA → EN_RECOJO (abre modal registro)
5. Modal: cámara (foto), nombre referencia, observaciones, pago (Yape/efectivo/transferencia)
6. Botón confirmar: guardarRegistro + updateEstado → RECOGIDO
7. Siguiente: RECOGIDO → EN_LABORATORIO → ENTREGADO

### Flujo de Fotos (Bug conocido)
1. ImagePicker.launchCameraAsync() → devuelve URI (puede ser content:// en algunos Android)
2. FileSystem.readAsStringAsync(uri, { encoding: Base64 }) → puede FALLAR con content:// URIs
3. Base64 se envía en JSON a `POST /tickets/:id/registro`
4. **Alternativa que YA existe pero no se usa:** `POST /tickets/:id/evidencia` con FormData (multipart, nativo)

### Tracking GPS
- startTracking(): pide permisos, inicia LocationUpdatesAsync en background
- setInterval 5s: Location.getCurrentPositionAsync → emite via WebSocket
- AppState listener: al volver a foreground, reinicia polling
- BackgroundFetch: salvavidas para fabricantes agresivos (Xiaomi, Infinix, Huawei)

### Bugs Conocidos

**Bug 1: LOGOUT desde Mi Día (RESUELTO en 9ab9cc7)**
- Causa: import fantasma de `forceStopAllTracking` que NO existe en useTracking.ts
- Metro bundler no corre tsc → compila igual, crash en runtime: `undefined()`
- Fix: eliminar import, reemplazar por API calls directas, clearUser() + router.replace() SINCRÓNICOS (sin await)

**Bug 2: Fotos fallan (PENDIENTE)**
- Causa probable: content:// URIs no compatibles con FileSystem.readAsStringAsync
- Solución recomendada: usar `subirEvidencia()` con FormData en vez de base64
- `removeClippedSubviews=false` NO es la causa

### SDUI Implementado
- `config?.ticketFlow` — mapea estados backend → uiStatus (pendiente/pending/active/done)
- `config?.flowButtons` — labels y colores por estado
- `config?.dashboard.colors` — paleta completa
- `config?.designTokens` — fontSizes, spacing, borderRadius, layout
- `config?.uiLabels` — todos los textos visibles
- `config?.screenConfig` — show/hide header, avatar, GPS status, stats, estado pill, modals
- `config?.screenConfig.sections` — show/hide secciones (activos, pendientes, asignados, completados)
- `config?.estadosMoto` — estados del motorizado con iconos, colores, labels

---

## 3. Frontend Admin (Next.js 14) — `/root/lablogix/apps/frontend/`

### Stack
- Next.js 14, React 18, TypeScript
- Tailwind CSS, shadcn/ui (lucide-react)
- react-leaflet (mapas), next-pwa (PWA)
- Arquitectura: App Router con layouts anidados

### Páginas

**Públicas:**
- `/login` — login de admin
- `/register` — registro de tenant
- `/error`, `/loading`

**App (admin):**
- `/app` — dashboard principal
- `/app/tickets` — lista de tickets con filtros y búsqueda
- `/app/tickets/create` — creación de ticket (referencia, tipo, dirección, etc.)
- `/app/tickets/[id]` — detalle de ticket con timeline, mapa, evidencias
- `/app/tickets/[id]/edit` — editar ticket
- `/app/motorizados` — lista de motorizados
- `/app/motorizados/create` — crear motorizado
- `/app/motorizados/[id]/edit` — editar motorizado
- `/app/referencias` — lista de puntos de recojo
- `/app/referencias/create` — crear referencia
- `/app/referencias/[id]/edit` — editar referencia
- `/app/rutas` — planificación de rutas
- `/app/tracking` — mapa en vivo con posición de motorizados
- `/app/reportes` — reportes (PDF/HTML)
- `/app/usuarios` — gestión de usuarios
- `/app/config` — configuración del tenant

**Especiales:**
- `/referencia` — panel de referencia (cliente que solicita recojos)
- `/rider` — versión web básica del rider/motorizado
- `/super-admin` — panel de super admin (gestión de tenants)

### Servicios API
Todos en `src/services/`: api.ts (axios instance), auth.ts, tickets.ts, motorizados.ts, referencias.ts, rutas.ts, dashboard.ts, config.ts

### Componentes UI
- Sistema de componentes shadcn/ui adaptados: Badge, Button, Card, Input, Modal, Table, SearchInput, EmptyState, LoadingSpinner
- Específicos: EvidenciaModal (ver fotos), LocationPicker (mapa), MapView/RutaMap (Leaflet), WebSocketProvider, AuthInitializer, PWARegister

### WebSocket en Frontend
- `WebSocketProvider.tsx` — conecta al Socket.IO backend
- `useWebSocket.ts` — hook para escuchar eventos: ticket:update, ticket:new, tracking:position, motorizado:estado
- El mapa de tracking se actualiza en tiempo real

---

## Estado Actual del Proyecto
- Backend operativo en localhost:8090
- Frontend admin en recojossglab.duckdns.org (cloudflare tunnel)
- App motorizado build via EAS (GitHub Actions)
- Último commit app: 6fe82f3 (CLAUDE.md agregado)
- Último commit backend: fix sesión única DESACTIVADA
- Build actual en progreso: cf1a3af (fix logout prioritario)
- Pendiente: fix de fotos (usar subirEvidencia con FormData en vez de base64)

## Convenciones Importantes
- Timestamps en BD: UTC, pero app muestra UTC-5
- Filter motorizado tickets: NO excluye PENDIENTE sin motorizado asignado
- Sesión única: DESACTIVADA (multi-dispositivo permitido)
- removeClippedSubviews: false (necesario para fotos)
- Logout: clearUser() SINCRÓNICO antes de cualquier async
