# SGLab Moto - App Android para Motorizados

## Stack
- **Framework:** Expo SDK 54 (React Native)
- **Router:** expo-router (file-based)
- **Estado:** Zustand
- **WebSocket:** socket.io-client
- **Mapa:** react-native-maps
- **Build:** GitHub Actions (APK arm64 gratuito)

## Estructura del proyecto
```
/home/sglab-moto/
  app/
    (app)/            → rutas principales
      tickets.tsx     → pantalla principal de tickets (motorizado)
      dia.tsx         → resumen del día
      _layout.tsx     → layout protegido (NO MODIFICAR)
    _layout.tsx       → layout raíz (NO MODIFICAR)
    index.tsx         → splash/redirección (NO MODIFICAR)
    login.tsx         → login (NO MODIFICAR)
  src/
    api/              → llamadas API
      client.ts       → axios instance (NO MODIFICAR)
      tickets.ts      → tickets API calls
      auth.ts         → auth API (NO MODIFICAR)
    store/
      authStore.ts    → zustand auth store (NO MODIFICAR)
    hooks/
      useTracking.ts  → GPS tracking (NO MODIFICAR)
    socket/
      socket.ts       → WebSocket (NO MODIFICAR)
    types/            → TypeScript types
```

## Repositorio
- URL: https://github.com/rsalazar07/sglab-moto
- Branch: `master`
- Build APK: disparar con `workflow_dispatch` en GitHub Actions
- APK ≈ 39MB, disponible en Artifacts del workflow

## API
- Base URL: `https://recojossglab.duckdns.org/api`
- WebSocket: `wss://recojossglab.duckdns.org`
- Endpoints usados:
  - GET /api/tickets — lista tickets (PENDIENTE + asignados)
  - POST /api/tickets/:id/tomar — tomar ticket
  - POST /api/tickets/:id/cambiar-estado — avanzar estado
  - POST /api/tickets/:id/evidencia — subir foto
  - POST /api/tickets/:id/registro — guardar registro de recojo
  - POST /api/tickets/:id/cobro — registrar pago
  - POST /api/auth/login — login con deviceId
  - PATCH /api/motorizados/me/estado — cambiar estado (DISPONIBLE/EN_REFRIGERIO/OFFLINE)
  - GET /api/tracking/me — obtener tracking

## Flujo de Tickets (NO CAMBIAR)
1. La app llama GET /api/tickets → recibe tickets PENDIENTE + asignados al motorizado
2. Los tickets se separan en UI:
   - **Pendientes** (azul) = tickets con estado `PENDIENTE` (sin asignar, para agarrar)
   - **Asignados** (naranja) = tickets con estado `ASIGNADO` (ya tomados)
   - **En camino** (azul) = tickets con estado `EN_RUTA/EN_RECOJO/RECOGIDO`
   - **Completados** (verde) = tickets con estado `ENTREGADO/CERRADO`
3. Botón en ticket PENDIENTE: "📋 Tomar pedido" → POST /api/tickets/:id/tomar
4. Botón en ticket ASIGNADO: "🏍️ Voy ahora" → cambia a EN_RUTA
5. Botón en ticket EN_RUTA/EN_RECOJO: "🧪 Ya recogí la muestra" → abre modal de registro

## Estados del Motorizado (DISEÑO FINAL)
Solo 3 estados, el motorizado controla manualmente (NO el backend por GPS):

| Código | App muestra | Backend guarda | Admin muestra |
|--------|------------|---------------|---------------|
| DISPONIBLE | 🟢 Disponible | DISPONIBLE | 🟢 Disponible |
| EN_REFRIGERIO | 🍽️ Refrigerio | EN_REFRIGERIO | 🍽️ En refrigerio |
| OFFLINE | 🏁 Fin de turno | OFFLINE | 🏁 Fuera de línea |

**REGLAS:**
- El estado es INDEPENDIENTE de los tickets activos
- Tracking GPS NO cambia estado
- Solo el motorizado decide su estado desde la app
- Login sin tickets → DISPONIBLE (o el estado que tenía antes)

## Info build
- **Proyecto Expo:** `/home/sglab-moto/`
- **Comando build (local):** `npx eas build --platform android --profile preview --local`
- **GitHub Actions:** el workflow `build-apk.yml` corre en push a master o workflow_dispatch
- Archivos protegidos (NO TOCAR): client.ts, auth.ts, socket.ts, authStore.ts, useTracking.ts, _layout.tsx, index.tsx, login.tsx, (app)/_layout.tsx
