# SGLab Moto - Mobile App Expo

## Stack
- Expo SDK 54 (bare/workflow)
- Android APK via EAS (production profile)
- Cuenta Expo: rsalazar.07 (rsalazar.07@gmail.com)
- Project ID: a74f7a4b-3506-4ca5-beea-c86bbf61bf89
- Build plan free agotado (~11 días para reset)
- Último APK: https://expo.dev/artifacts/eas/qVbaFjKKnW2UVRVKnC1A4s.apk

## Estructura
/home/sglab-moto/
├── app.json          - Plugins: expo-location, expo-background-fetch, expo-task-manager, expo-camera
├── eas.json          - production profile con env vars API_URL
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
└── src/
    ├── types/index.ts      - Ticket, User, TrackingSession, EstadoTicket enum
    ├── api/client.ts       - Axios con interceptors (API_URL + token JWT)
    ├── api/auth.ts         - login(), getProfile()
    ├── api/tickets.ts      - getTickets(), tomarTicket(), startTracking(), stopTracking()
    ├── socket/socket.ts    - Socket.IO singleton con reconexión automática + auth JWT
    ├── store/authStore.ts  - Zustand: token, user, isAuthenticated, login/logout
    └── hooks/useTracking.ts - Core GPS hook (ver abajo)

## useTracking.ts - Detalles clave
- **Foreground**: watchPositionAsync con timeInterval 5000ms, envía por WebSocket 'tracking:point'
- **Background**: TaskManager con minimumInterval 300000ms (5 min), envía por REST POST /tracking/point
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

## Expo / EAS Auth
- Cuenta: rsalazar.07 (rsalazar.sistemas@gmail.com)
- Proyecto: @rsalazar.07/sglab-moto
- **EXPO_TOKEN**: `UJumOFg6-_zmFDFh_AQv4NYqVQ4bgtl5PTcw3WkU`
- Build command: `EXPO_TOKEN=UJumOFg6-_zmFDFh_AQv4NYqVQ4bgtl5PTcw3WkU npx eas build --platform android --profile production --non-interactive`
- El token NUNCA persiste entre sesiones - siempre pasarlo como env var

## Reglas NUNCA olvidar
1. API_URL = process.env.EXPO_PUBLIC_API_URL (definido en eas.json como 'https://recojossglab.duckdns.org')
2. WebSocket se autentica con token JWT en auth: {token}
3. Foreground y background son SEPARADOS - no mezclar
4. NO detener tracking al cerrar app - solo "Fin turno" explícito
5. "Tomar pedido" sin turno → iniciar tracking automáticamente
6. APK builds: Siempre usar EXPO_TOKEN antes del comando
