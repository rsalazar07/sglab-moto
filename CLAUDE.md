# SGLab Moto - Mobile App Expo

## Repositorio GitHub
- **Repo:** https://github.com/rsalazar07/sglab-moto (público)
- Rama principal: `master`
- **Token GitHub:** preguntar a r o a Hermes Agent si se necesita (no guardar en repo)

## Stack
- Expo SDK 54 (bare/workflow)
- Android APK via **GitHub Actions** (GRATIS, 2000 min/mes por repo público)
- Ya NO usamos EAS Build (plan free agotado)
- Build en servidores de GitHub, no satura el VPS

## Build Workflow
- Archivo: `.github/workflows/build-apk.yml`
- **Trigger:**
  - Push a `master` → build automático
  - Manual desde GitHub Actions (Workflow Dispatch)
  - Hermes Agent también puede triggerear desde Telegram con el token
- **Optimización:** build solo para `arm64-v8a` (APK ~35MB)
- **Duración:** ~15-20 min
- **Artifact:** `SGLab-Moto-APK` → contiene `app-release.apk`
- **Descarga:** Actions > Run > Artifacts, o via API con el token

## API / Backend (host en VPS)
- `https://recojossglab.duckdns.org/api`
- WebSocket: `wss://recojossglab.duckdns.org`
- El build injecta estas URLs via `EXPO_PUBLIC_*` env vars

## Estructura del proyecto
```
/home/sglab-moto/ (local) = mirror del repo
├── app.json          - Plugins: expo-location, expo-background-fetch, expo-task-manager, expo-camera
├── eas.json          - production profile con env vars API_URL (ya no se usa para builds)
├── babel.config.js   - expo preset
├── package.json      - expo-router, expo-location, socket.io-client, zustand, axios, jwt-decode
├── index.ts          - entrypoint expo-router
├── app/
│   ├── _layout.tsx   - RootLayout SafeAreaView + StatusBar
│   ├── index.tsx     - Redirect a /login
│   ├── login.tsx     - Login (email + password + role motorizado)
│   └── (app)/
│       ├── _layout.tsx - Tabs protegidas (Recojos | Mi día)
│       ├── tickets.tsx - Lista tickets + GPS tracking
│       └── dia.tsx     - Resumen del día
├── src/
│   ├── types/index.ts      - Ticket, User, TrackingSession, EstadoTicket enum
│   ├── api/client.ts       - Axios con interceptors (API_URL + token JWT)
│   ├── api/auth.ts         - login(), getProfile()
│   ├── api/tickets.ts      - getTickets(), tomarTicket(), startTracking(), stopTracking()
│   ├── socket/socket.ts    - Socket.IO singleton con reconexión automática + auth JWT
│   ├── store/authStore.ts  - Zustand: token, user, isAuthenticated, login/logout
│   └── hooks/useTracking.ts - Core GPS hook
└── .github/workflows/build-apk.yml  - Workflow GitHub Actions
```

## useTracking.ts - Detalles clave
- **Foreground:** watchPositionAsync con timeInterval 5000ms, envía por WebSocket 'tracking:point'
- **Background:** TaskManager con minimumInterval 300000ms (5 min), envía por REST POST /tracking/point
- Auto-creación: si no hay sesión activa, backend crea automáticamente
- Iniciar turno: startTracking() REST + inicia foreground watcher
- Fin turno: stopTracking() REST + stopAsync + limpia todo
- Permisos: foreground + background GPS solicitados al inicio

## tickets.tsx - Pantalla principal
- Protegida contra estados undefined/sesión null
- "Tomar pedido" sin turno activo → inicia tracking automático
- Refresh cada 10s + WebSocket tiempo real
- Muestra: PENDING (todos) + ASSIGNED/IN_PROGRESS del motorizado
- Botón "Iniciar turno" / "Finalizar turno" según estado

## Reglas NUNCA olvidar
1. API_URL = process.env.EXPO_PUBLIC_API_URL (definido en el workflow como 'https://recojossglab.duckdns.org/api')
2. WebSocket se autentica con token JWT en auth: {token}
3. Foreground y background son SEPARADOS - no mezclar
4. NO detener tracking al cerrar app - solo "Fin turno" explícito
5. "Tomar pedido" sin turno → iniciar tracking automáticamente
6. Si necesitas rebuild: push a master o trigger workflow manual

## Estado del APK
- Último build exitoso ✅ APK ~86MB (universal, sin filtro arm64)
- Próximo build: ~35MB (solo arm64, optimizado)
- Firmado con debug keystore (instalable en cualquier celular)
- Para producción formal: generar keystore propio y configurar firma
