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

### Base de Datos (Prisma Schema — 439 líneas)

**Enums relevantes:**
- `TicketEstado`: PENDIENTE, ASIGNADO, EN_RUTA, EN_RECOJO, RECOGIDO, EN_LABORATORIO, ENTREGADO, CERRADO, CANCELADO, FALLIDO
- `MotorizadoEstado`: DISPONIBLE, EN_REFRIGERIO, OFFLINE (⚠️ no existe EN_MOTO — app usa OFF_LINE solo como estado local UI)
- `TicketTipo`: NORMAL, URGENTE
- `UserRole`: SUPER_ADMIN, ADMIN, REFERENCIA, MOTORIZADO
- `TenantPlan/Status`, `RutaEstado`, `TrackingSessionEstado`, `SubscriptionPlan/Status`

**Modelos principales:**
- **Tenant** — multi-tenencia (plan, status, límites: maxMotorizados=10, maxReferencias=50, maxTicketsPerDay=200)
- **TenantConfig** — config por tenant: maxTicketsSimultaneos=3, tiempoSLAUrgente=60min, tiempoSLANormal=120min, etc.
- **User** — rol (SUPER_ADMIN, ADMIN, REFERENCIA, MOTORIZADO), currentDeviceId, permissions[], unique(tenantId, email)
- **Referencia** — puntos de recojo (nombreComercial, dirección, GPS, nivelPrioridad, horarioAtencion, userId opcional)
- **Motorizado** — vehiculo, placa, telefono, estado (MotorizadoEstado), ticketsActivos (contador), ultimaUbicacion (Json)
- **Ticket** — codigo autogenerado (`TKT-0001`), tipo, tipoMuestra, cantidadMuestras, fotoUrl, latitud/longitud, horaLimite, prioridad (int), slaCumplido, tiempoRealRecojo
- **TicketHistory** — historial con accion: CREADO, TOMADO, ASIGNADO, REASIGNADO, CANCELADO, EDITADO, ELIMINADO, EVIDENCIA, COBRO, REGISTRO, y estados del ticket
- **Ruta / RutaParada** — rutas planificadas con paradas ordenadas, tiempoEstimado, distanciaEstimada
- **TrackingSession / TrackingPoint** — sesiones GPS (ACTIVA/FINALIZADA), puntos con latitud, longitud, velocidad, precision
- **RefreshToken** — tokens JWT con expiresAt, revokedAt (cascade delete al borrar User)
- **AuditLog** — auditoría con estadoAnterior/Nuevo (Json), IP, userAgent
- **Subscription** — suscripciones Stripe con stripeSubscriptionId, stripeCustomerId

### Endpoints API

**Auth:** `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me`, `POST /auth/reset-password/:userId`

**Tickets:** `GET /tickets`, `GET /tickets/:id`, `GET /tickets/:id/flow`, `POST /tickets`, `PATCH /tickets/:id`, `DELETE /tickets/:id`, `POST /tickets/:id/asignar`, `/reasignar`, `/cancelar`, `/cambiar-estado`, `/tomar`, `/evidencia`, `/cobro`, `/registro`, `/validate-registro`

**Motorizados:** `GET /motorizados`, `GET /motorizados/disponibles`, `GET /motorizados/me`, `GET /motorizados/config`, `PATCH /motorizados/me/estado`, CRUD por id

**Tracking:** `POST /tracking/start`, `/tracking/point`, `/tracking/stop`, `GET /tracking/active`, `GET /tracking/sessions/:id`, `GET /tracking/live`

**Dashboard:** `GET /dashboard/summary`, `/motorizado-rendimiento`, `/referencia-rendimiento`, `/tickets-por-estado`, `/metrics-semanales`, `/resumen-diario`

**Reportes:** `GET /reportes/config`, `GET /reportes/generar`

**Otros:** `GET /health`, `GET /logs/device`, CRUD referencias/rutas/configuración, super-admin

### WebSocket (Socket.IO Gateway)
- **Namespace:** `/ws` — la app conecta a `wss://recojossglab.duckdns.org/ws`
- **Conexión:** JWT en `handshake.auth.token` o `handshake.query.token`
- **Rooms:** `tenant:{tenantId}` (broadcast a todo el tenant), `rider:{userId}` (tracking)
- **Mapas en memoria:** `tenantRooms` (tenantId→Set<socketId>), `userSockets` (userId→socketId), `pendingMessages` (cola offline)
- **Evento al conectar:** `connected` → devuelve `{userId, tenantId, role}`

**Eventos entrantes (cliente → servidor):**
  - `tracking:point` — enviar coordenada GPS; el gateway guarda en BD, actualiza `ultimaUbicacion` del motorizado, y re-emite `tracking:position` a todo el tenant. Auto-crea sesión si no existe.
  - `tracking:start` — inicia sesión de tracking; crea TrackingSession si no hay una ACTIVA
  - `tracking:stop` — finaliza sesión activa de tracking en BD

**Eventos salientes (servidor → cliente):**
  - `tracking:position` — posición de motorizado a todo el tenant (motorizadoId, nombre, lat, lng, velocidad, timestamp)
  - `ticket:update` — cambio de estado de ticket (ticketId, estado, motorizadoId, motorizadoNombre, timestamp)
  - `ticket:new` — nuevo ticket creado (ticketId, referenciaNombre, prioridad, direccion, timestamp)
  - `motorizado:estado` — cambio de estado del motorizado (motorizadoId, nombre, estado, timestamp)
  - `auth:session:revoked` — sesión revocada por nuevo login (escucha evento interno `auth.session.revoked`)
  - `admin:message` — mensaje del administrador al motorizado (title, message) — app muestra Alert
  - `error` — error de autenticación/conexión

**Mensajes pendientes:** Cuando usuario offline, mensajes se encolan en `pendingMessages`. Al reconectar, se entregan todos y la cola se limpia. La desconexión WebSocket NO finaliza sesión de tracking (las conexiones móviles son inestables; la sesión solo se cierra via REST /tracking/stop o WS tracking:stop).

### SDUI (Server-Driven UI)
- `GET /motorizados/config` devuelve UI_CONFIG con: estadosMoto, opcionesPago, tiemposMaquina, ticketFlow, flowButtons, dashboard (colores, textos, login/splash/tabs/tracking), designTokens (fontSizes, spacing, borderRadius), uiLabels, screenConfig (show/hide elementos), sections (activos, pendientes, asignados, completados)
- **dashboard** tiene también: `splashBg`, `splashSpinner`, `splashText`, `splashTextColor` (usados en loading screen), `appName`, `appVersion`, `turnoHoras`, `progresoColor`, `progresoColor100`, `estadoModalTitle`, `estadoModalSubtitle`, `confirmarEstado`, `cancelar`, `logoutLabel`, `registroPlaceholders`
- **No necesita rebuild de app** — cambios en backend se reflejan al recargar pantalla

### Lógica de Negocio Crítica (tickets.service.ts)

**Código de tickets:** Auto-generado como `TKT-0001`, `TKT-0002`... usando transacción Serializable para evitar duplicados.

**`tomarTicket`:** Solo si estado=PENDIENTE. Incrementa `Motorizado.ticketsActivos`. Emite WS `ticket:update`.

**`cambiarEstado`:**
- Solo MOTORIZADO puede cambiar estado de sus propios tickets (verifica `ticket.motorizadoId === motorizado.id`)
- Estados permitidos via este endpoint: EN_RUTA, EN_RECOJO, RECOGIDO, EN_LABORATORIO, ENTREGADO, FALLIDO
- Al llegar a ENTREGADO: calcula `tiempoRealRecojo`, evalúa SLA contra `TenantConfig`, luego **auto-cierra a CERRADO** en la misma transacción, decrementa `ticketsActivos`, y si ya no quedan tickets activos → auto-finaliza TrackingSession
- El socket emite CERRADO (no ENTREGADO) cuando se completa la entrega

**`guardarRegistro`:** Guarda `observaciones` y `fotoUrl` en el Ticket, y crea TicketHistory con accion='REGISTRO'. El campo `fotoBase64` del body de la app no tiene campo homólogo en BD — se almacena mal en `fotoUrl`.

**Filtro de tickets para MOTORIZADO:** `OR [{ motorizadoId: moto.id }, { estado: PENDIENTE, motorizadoId: null }]` — ve sus propios + todos los disponibles sin asignar. Limit forzado a mínimo 50.

### Seguridad
- Rate limiting (ThrottlerModule), Helmet, CORS
- JWT con deviceId (sesión única DESACTIVADA), refresh token rotation
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
| `src/hooks/useTracking.ts` | Hook GPS consolidado: start/stop tracking, task GPS background (`SGLAB_GPS_TASK`), Background Fetch (`SGLAB_BG_FETCH`), AppState listener (auto-restart en foreground), setInterval 5s por WebSocket o REST |
| `src/hooks/tracking/*` | Módulos auxiliares presentes en disco pero NO importados por useTracking.ts: backgroundActions, backgroundFetch, batteryDialog, locationTask, offlineQueue, sender (código legacy o preparado para refactor) |
| `src/socket/socket.ts` | Socket.IO: connect, disconnect, getSocket |
| `src/store/authStore.ts` | Zustand: user, isAuthenticated, setUser, clearUser |
| `src/lib/crashReport.ts` | Crash handler global con ErrorBoundary y logs a archivo |
| `src/lib/LogReporter.ts` | Logger que envía logs a /logs/device del backend |

### Tipos TypeScript (src/types/index.ts)
- `User`: `{ id, email, nombre, rol, tenantId }` — ⚠️ `nombre` (no `name`), `rol` (no `role`)
- `Ticket`: `{ id, estado, prioridad, tipoMuestra, tipo, telefonoContacto, direccionRecojo, referencia{id, nombreComercial, direccion, latitud, longitud, telefono}, horaLimite, notas, createdAt, updatedAt }`
- `EstadoTicket`: union type de los 9 estados
- `MetodoCobro`: 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA'

### Flujo de Autenticación
1. Login: email + password + deviceId (generado como `rn_{timestamp}_{random}`, persistido en SecureStore)
2. Backend devuelve accessToken (JWT) + refreshToken
3. Tokens guardados en SecureStore keys: `accessToken`, `refreshToken`, `deviceId`
4. Axios interceptor: agrega `Authorization: Bearer {token}`
5. En 401: intenta refresh con refreshToken, si falla → borra tokens, redirige a login
6. `_layout.tsx` al iniciar: lee `accessToken` de SecureStore → llama `authApi.me()` → si ok, `setUser()` y muestra app; si falla, borra tokens y redirige a `/login`

### Flujo de Tickets
1. App carga tickets via `GET /tickets` (filtrados por motorizado: ve SUS tickets + TODOS los PENDIENTE sin asignar)
2. Separa por uiStatus usando `config.ticketFlow` SDUI: `pendiente`=disponibles, `pending`=asignados, `active`=en camino, `done`=completados
3. Motorizado ve PENDIENTES → toca "Tomar pedido" → `POST /tickets/:id/tomar` → optimistic update ASIGNADO
4. Progresión: ASIGNADO → EN_RUTA → EN_RECOJO (al marcar "Llegué", abre modal) → RECOGIDO → EN_LABORATORIO → ENTREGADO → **CERRADO automático**
5. ⚠️ Al llegar a ENTREGADO, el backend auto-cierra a CERRADO en la misma transacción y emite socket con estado CERRADO
6. Modal registro (EN_RECOJO): foto (base64 con FileSystem), nombre referencia, observaciones, método pago + monto
7. Flujo modal: si no hay info → Alert de confirmación → `guardarRegistro({sinInfo:true})` → `updateEstado('RECOGIDO')`
8. Si hay info → `registrarCobro()` (si aplica) + `guardarRegistro({refNombre, observaciones, fotoBase64})` + `updateEstado('RECOGIDO')`
9. `CLIENT_FLOW_MAP` en tickets.tsx hardcodea la lógica de botones por estado (independiente del SDUI flowButtons que solo controla label/color)

**Validación de flujo en backend** (validateFlow): ASIGNADO→EN_RUTA, EN_RUTA→[EN_RECOJO|FALLIDO], EN_RECOJO→[RECOGIDO|FALLIDO], RECOGIDO→[EN_LABORATORIO|FALLIDO], EN_LABORATORIO→[ENTREGADO|FALLIDO]. Solo MOTORIZADO puede cambiar estado de sus propios tickets.

### Flujo de Fotos (Bug conocido)
1. `ImagePicker.launchCameraAsync({quality: 0.7})` → devuelve URI (puede ser `content://` en Android)
2. `FileSystem.readAsStringAsync(uri, { encoding: Base64 })` → puede FALLAR con `content://` URIs
3. El `fotoBase64` se envía en JSON body a `POST /tickets/:id/registro` — el backend lo recibe en `dto.fotoUrl`... ⚠️ pero `guardarRegistro` espera `fotoUrl` (URL de archivo), no base64. El campo `fotoBase64` se pasa pero el servicio lo almacena tal cual en `ticket.fotoUrl`.
4. **Alternativa correcta:** `subirEvidencia(ticketId, fotoUri)` usa FormData multipart → `POST /tickets/:id/evidencia` → devuelve `{url}` → luego guardarRegistro con esa URL. Esta función YA existe en `ticketsApi` pero NO se usa en el flujo actual.

### Tracking GPS
- `startTracking()`: pide permisos foreground → `POST /tracking/start` → activa keep-awake → inicia `SGLAB_GPS_TASK` (background continuo, cada 10s/20m) → registra `SGLAB_BG_FETCH` (cada ~15min)
- `SGLAB_GPS_TASK` (background): Location update → `POST /tracking/point` via REST
- Polling foreground (5s via setInterval): `Location.getCurrentPositionAsync` → WS `tracking:point` (fallback: REST `/tracking/point`)
- AppState listener: al volver de background → `restartForeground()` (limpia interval anterior, inicia nuevo, verifica que SGLAB_GPS_TASK siga activo)
- `SGLAB_BG_FETCH`: salvavidas para fabricantes agresivos (Xiaomi, Infinix, Huawei) — usa REST no WS
- `stopTracking()`: limpia interval + detiene GPS task + desregistra BG Fetch + `POST /tracking/stop` + WS `tracking:stop` + desactiva keep-awake
- El backend también auto-finaliza TrackingSession cuando todos los tickets del motorizado llegan a ENTREGADO/CERRADO

### Bugs Conocidos

**Bug 1: LOGOUT desde Mi Día (RESUELTO en 9ab9cc7)**
- Causa: import fantasma de `forceStopAllTracking` que NO existe en useTracking.ts
- Metro bundler no corre tsc → compila igual, crash en runtime: `undefined()`
- Fix: eliminar import, reemplazar por API calls directas (`api.patch('/motorizados/me/estado')`, `api.post('/tracking/stop')`), `clearUser()` + `router.replace()` SINCRÓNICOS antes de cualquier async
- Patrón correcto para logout (tickets.tsx y dia.tsx): `clearUser(); router.replace('/login');` primero, tareas async en `(async () => { ... })()` sin await

**Bug 2: Fotos fallan (PENDIENTE)**
- Causa probable: `content://` URIs no compatibles con `FileSystem.readAsStringAsync`
- Causa adicional: `guardarRegistro` envía `fotoBase64` pero el backend espera URL en `fotoUrl`, no base64 raw
- Solución recomendada: usar `ticketsApi.subirEvidencia(ticketId, fotoUri)` (FormData multipart) → obtener URL → pasar al `guardarRegistro`
- `removeClippedSubviews=false` NO es la causa (es necesario para renderizar bien las imágenes en FlatList)

### SDUI Implementado en App
- `config?.ticketFlow` — mapea estado backend → uiStatus (`pendiente`/`pending`/`active`/`done`)
- `config?.flowButtons[estado]` — `{label, color}` por estado (override sobre `CLIENT_FLOW_MAP` hardcodeado)
- `config?.dashboard.colors` — paleta: blue, blueDark, blueLight, blueBorder, gray, grayLight, grayBorder, text, text2, green, greenLight, orange, orangeLight, red, redLight, white
- `config?.designTokens` — `fontSizes` (micro, small, caption, body, title), `spacing` (cardPadding, buttonPadding, cardGap), `borderRadius` (card, badge, button), `layout` (buttonMinHeight)
- `config?.uiLabels` — textos: badges, botones, secciones, stats, logoutLabel, hechoLabel, avanceLabel, sinTickets, btnCargando
- `config?.screenConfig.tickets` — show/hide: showHeader, showAvatar, showGpsStatus, showStats, showEstadoPill, showTimeLimit, showNotas, showRegistroModal, showConfirmModal
- `config?.screenConfig.sections` — show/hide secciones de lista: activos, pendientes, asignados, completados
- `config?.estadosMoto` — por key (DISPONIBLE, EN_REFRIGERIO, OFF_LINE): `{ic, label, desc, bg, border, color, gpsColor, gpsTxt, bannerIc, bannerTxt, backendEstado}`
- `config?.opcionesPago` — array `[{key, ic, lbl}]` (fallback: EFECTIVO, YAPE, TRANSFERENCIA, SIN_PAGO)

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
- Backend: operativo en localhost:8090, expuesto via Cloudflare tunnel en `recojossglab.duckdns.org`
- Frontend admin: `recojossglab.duckdns.org` (mismo dominio que backend, rutas /api/* al backend)
- App motorizado: build via EAS (GitHub Actions), APK Android
- WS URL app: `EXPO_PUBLIC_WS_URL` = `wss://recojossglab.duckdns.org`
- Último commit app: c417a1f (CLAUDE.md completo)
- Logout corregido en tickets.tsx y dia.tsx (commits cf1a3af, a303a6e, 9ab9cc7)
- Pendiente: fix de fotos (usar `subirEvidencia()` con FormData → URL → `guardarRegistro({fotoUrl})`)

## Convenciones Importantes
- Timestamps en BD: UTC, pero app muestra en locale `es-PE` (UTC-5)
- Tipo `User` en app: campo `nombre` (no `name`), campo `rol` (no `role`) — difiere del modelo Prisma
- `MotorizadoEstado` backend: DISPONIBLE, EN_REFRIGERIO, OFFLINE — la app usa `OFF_LINE` solo como estado UI local (map a `backendEstado` del config SDUI)
- Filter motorizado tickets: VE todos los PENDIENTE sin asignar + sus propios (any estado)
- Sesión única: DESACTIVADA (multi-dispositivo permitido, `currentDeviceId` en User no se usa para revocación)
- `removeClippedSubviews=false` en FlatList (necesario para renderizar bien los ítems con imágenes en Android)
- Logout patrón: `clearUser()` + `router.replace('/login')` SINCRÓNICOS primero, async cleanup en IIFE sin await
- Tickets PENDIENTE→ENTREGADO: backend emite CERRADO por socket (no ENTREGADO), y auto-cierra en misma transacción
- Códigos tickets: formato `TKT-XXXX` generado con transacción Serializable
- `guardarRegistro` espera `fotoUrl` (URL string), NO base64 — usar `subirEvidencia()` primero para obtener URL
- WebSocket namespace: `/ws` (siempre con ese path)
- Tracking: desconexión WS NO finaliza sesión GPS; solo lo hace `/tracking/stop` REST o WS `tracking:stop`
