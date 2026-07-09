import { useEffect, useState, useCallback, useRef, memo, useMemo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Modal, TextInput, ScrollView,
  ActivityIndicator, Image, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ImagePicker from 'expo-image-picker';
import * as SecureStore from 'expo-secure-store';
import { ticketsApi } from '../../src/api/tickets';
import { useTracking } from '../../src/hooks/useTracking';
import { useAuthStore } from '../../src/store/authStore';
import { useTicketsStore } from '../../src/store/ticketsStore';
import { getSocket, disconnectSocket } from '../../src/socket/socket';
import { api } from '../../src/api/client';
import { router } from 'expo-router';
import { send as log } from '../../src/lib/LogReporter';
import type { Ticket, EstadoTicket } from '../../src/types';

// ─── Stepper de progreso para tab Mi Ruta ───
const PROGRESS_STEPS = [
  { label: 'Tomado', icon: '📋' },
  { label: 'En ruta', icon: '🏍️' },
  { label: 'Recojo', icon: '🧪' },
  { label: 'Entregado', icon: '✅' },
];
const STEP_IDX: Record<string, number> = {
  ASIGNADO: 0, EN_RUTA: 1, EN_RECOJO: 2, RECOGIDO: 2,
  EN_LABORATORIO: 3, ENTREGADO: 3, CERRADO: 4,
};

const ProgressStepper = memo(({ estado, C }: { estado: string; C: any }) => {
  const currentStep = STEP_IDX[estado] ?? 0;
  const green = C?.green || '#22c55e';
  const blue  = C?.blue  || '#3b82f6';
  return (
    <View style={ps.wrap}>
      {/* Fila de puntos y líneas */}
      <View style={ps.track}>
        {PROGRESS_STEPS.map((step, i) => {
          const done   = i < currentStep;
          const active = i === currentStep;
          const dotBg  = done ? green : active ? blue : '#e2e8f0';
          const lineClr = i < currentStep ? green : '#e2e8f0';
          return (
            <View key={i} style={{ flexDirection: 'row', alignItems: 'center', flex: i < PROGRESS_STEPS.length - 1 ? 1 : 0 }}>
              <View style={[ps.dot, { backgroundColor: dotBg, borderColor: dotBg }]}>
                <Text style={ps.dotTxt}>{done ? '✓' : active ? step.icon : String(i + 1)}</Text>
              </View>
              {i < PROGRESS_STEPS.length - 1 && (
                <View style={{ flex: 1, height: 2, backgroundColor: lineClr }} />
              )}
            </View>
          );
        })}
      </View>
      {/* Labels */}
      <View style={ps.labels}>
        {PROGRESS_STEPS.map((step, i) => {
          const done   = i < currentStep;
          const active = i === currentStep;
          return (
            <Text key={i} style={[ps.label, {
              color: done ? green : active ? blue : '#94a3b8',
              textAlign: i === 0 ? 'left' : i === PROGRESS_STEPS.length - 1 ? 'right' : 'center',
            }]}>{step.label}</Text>
          );
        })}
      </View>
    </View>
  );
});

// Colores por defecto (fallback si no hay config)
const C_FALLBACK = {
  blue:'#3498DB', blueDark:'#2980B9', blueLight:'#EBF5FB', blueBorder:'#AED6F1',
  gray:'#7F8C8D', grayLight:'#F2F3F4', grayBorder:'#D5D8DC',
  text:'#1a1a2e', text2:'#7F8C8D',
  green:'#27AE60', greenLight:'#E8F8F0',
  orange:'#E67E22', orangeLight:'#FDF2E9',
  red:'#E74C3C', redLight:'#FDEDEC',
  white:'#FFFFFF',
};

type MetodoPago = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA' | 'SIN_PAGO';

const CLIENT_FLOW_MAP: Record<string, {
  accion: string;
  endpoint: ((id: string) => string) | null;
  body?: any;
  abreModal?: boolean;
}> = {
  PENDIENTE: { accion: 'tomarTicket', endpoint: (id) => `/tickets/${id}/tomar` },
  ASIGNADO:  { accion: 'irAhora',     endpoint: (id) => `/tickets/${id}/cambiar-estado`, body: { estado: 'EN_RUTA' } },
  EN_RUTA:   { accion: 'llegue',      endpoint: (id) => `/tickets/${id}/cambiar-estado`, body: { estado: 'EN_RECOJO' }, abreModal: true },
  EN_RECOJO: { accion: 'completarRecojo', endpoint: null, abreModal: true },
  RECOGIDO:  { accion: 'dejarEnLab',  endpoint: (id) => `/tickets/${id}/cambiar-estado`, body: { estado: 'EN_LABORATORIO' } },
  EN_LABORATORIO: { accion: 'entregar', endpoint: (id) => `/tickets/${id}/cambiar-estado`, body: { estado: 'ENTREGADO' } },
};

const TicketCard = memo(({ item, config, loadingId, onAvanzar }: {
  item: Ticket;
  config: any;
  loadingId: string | null;
  onAvanzar: (ticket: Ticket) => void;
}) => {
  const C = config?.dashboard?.colors || C_FALLBACK;
  const DT = config?.designTokens || {};
  const UL = config?.uiLabels || {};
  const SC = config?.screenConfig || {};
  const screen = SC?.tickets || {};

  const tf2 = config?.ticketFlow || {};
  const uiStatus = tf2[item.estado] || 'done';
  const isDone = uiStatus === 'done';
  const esUrgente = item.tipo === 'URGENTE';

  // Card strip color
  const stripColor = isDone
    ? '#22c55e'
    : uiStatus === 'active'
      ? '#f59e0b'
      : uiStatus === 'pending'
        ? '#f59e0b'
        : esUrgente
          ? '#ef4444'
          : '#3b82f6';

  // Codigo display: usar codigo del backend o generar fallback
  const codigoDisplay = item.codigo || `TKT-${item.id.slice(-4).toUpperCase()}`;
  const horaCreacion = new Date(item.createdAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });

  // Estado badge
  const estadoLabels: Record<string, string> = {
    PENDIENTE: UL.badgePendiente || 'PENDIENTE',
    ASIGNADO: UL.badgeAsignado || 'ASIGNADO',
    EN_RUTA: UL.badgeEnRuta || 'EN RUTA',
    EN_RECOJO: UL.badgeEnRecojo || 'EN RECOJO',
    RECOGIDO: UL.badgeRecogido || 'RECOGIDO',
    EN_LABORATORIO: UL.badgeEnLaboratorio || 'EN LAB',
    ENTREGADO: UL.badgeEntregado || 'ENTREGADO',
    CERRADO: UL.badgeCerrado || '✓ CERRADO',
    CANCELADO: UL.badgeCancelado || 'CANCELADO',
    FALLIDO: UL.badgeFallido || 'FALLIDO',
  };
  const badgeLabel = estadoLabels[item.estado] || item.estado;

  // Estado badge style
  const estadoBgColor = isDone ? '#f0fdf4'
    : uiStatus === 'pendiente' ? '#f8fafc'
    : uiStatus === 'pending' ? (C.orangeLight || '#fffbeb')
    : uiStatus === 'active' ? (C.blueLight || '#eff6ff')
    : '#f8fafc';
  const estadoTextColor = isDone ? '#15803d'
    : uiStatus === 'pendiente' ? '#64748b'
    : uiStatus === 'pending' ? (C.orange || '#d97706')
    : uiStatus === 'active' ? (C.blue || '#2563eb')
    : '#64748b';
  const estadoBorderColor = isDone ? '#86efac'
    : uiStatus === 'pendiente' ? '#cbd5e1'
    : uiStatus === 'pending' ? (C.orange || '#fde68a')
    : uiStatus === 'active' ? (C.blueBorder || '#bfdbfe')
    : '#cbd5e1';

  // Accion button
  const btnLabels: Record<string, string> = {
    pendiente: UL.btnTomarPedido || 'Tomar pedido →',
    pending: UL.btnVoyAhora || '🏍 Voy ahora',
    active: UL.btnYaRecogi || '🧪 Ya recogí',
  };
  const btnColors: Record<string, string> = {
    pendiente: C.green || '#22c55e',
    pending: C.orange || '#f59e0b',
    active: '#6366f1',
  };
  const fb = config?.flowButtons?.[item.estado];
  const btnLabel = fb?.label || btnLabels[uiStatus];
  const btnColor = fb?.color || btnColors[uiStatus];
  const cargando = loadingId === item.id;

  const fs = DT?.fontSizes || {};
  const sp = DT?.spacing || {};
  const showMapBtn = (screen.showMapButton !== false) && !!item.referencia?.latitud && !!item.referencia?.longitud;
  const isOverdue = item.horaLimite ? new Date(item.horaLimite) < new Date() : false;

  return (
    <View style={[s.tcard, {
      borderRadius: DT?.borderRadius?.card ?? 14,
      backgroundColor: (!isDone && esUrgente) ? '#fff5f5' : '#fff',
    }]}>
      {/* Franja horizontal superior */}
      <View style={[s.cardStrip, { backgroundColor: stripColor }]} />

      <View style={[s.cardBody, { padding: sp.cardPadding || 12 }]}>
        {/* Fila superior: codigo+hora IZQUIERDA, badges DERECHA */}
        <View style={s.tcTop}>
          <View style={s.cardMeta}>
            <Text style={s.ticketCode}>
              {codigoDisplay}
              <Text style={s.ticketTime}> · {horaCreacion}</Text>
            </Text>
          </View>
          <View style={s.ticketBadgesRow}>
            {!isDone && (
              <View style={[s.tipoBadge, esUrgente
                ? { backgroundColor: C.redLight || '#fef2f2', borderColor: '#fca5a5' }
                : { backgroundColor: C.blueLight || '#eff6ff', borderColor: C.blueBorder || '#bfdbfe' }]}>
                <Text style={[s.tipoBadgeTxt, { color: esUrgente ? (C.red || '#dc2626') : (C.blue || '#2563eb') }]}>
                  {esUrgente ? `🔴 ${UL.badgeUrgente || 'URGENTE'}` : 'NORMAL'}
                </Text>
              </View>
            )}
            {!isDone && item.modalidad === 'ENTREGA_RESULTADOS' && (
              <View style={[s.tipoBadge, { backgroundColor: '#f0fdf4', borderColor: '#86efac' }]}>
                <Text style={[s.tipoBadgeTxt, { color: '#15803d' }]}>
                  📋 ENTREGA
                </Text>
              </View>
            )}
            <View style={[s.estadoBadge, { backgroundColor: estadoBgColor, borderColor: estadoBorderColor }]}>
              <Text style={[s.estadoBadgeTxt, { color: estadoTextColor }]}>{badgeLabel}</Text>
            </View>
          </View>
        </View>

        {/* Bloque referencia */}
        {item.referencia?.nombreComercial && (
          <View style={s.refBlock}>
            <Text style={s.refBlockIcon}>🏥</Text>
            <View style={{ flex: 1 }}>
              <Text style={[s.refName, { fontSize: fs.caption || 13 }]} numberOfLines={1}>
                {item.referencia.nombreComercial}
              </Text>
              {item.referencia.direccion ? (
                <Text style={[s.refAddress, { fontSize: fs.small || 11 }]} numberOfLines={2}>
                  {item.referencia.direccion}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        {/* Fila muestra + hora límite */}
        <View style={s.muestraRow}>
          <Text style={s.muestraIc}>🧪</Text>
          <Text style={[s.muestraTxt, { fontSize: fs.small || 11 }]}>
            {item.tipoMuestra || item.tipo || 'Muestra'}
          </Text>
          {(screen.showTimeLimit !== false) && item.horaLimite && !isDone && (
            <>
              <Text style={s.muestraSep}>·</Text>
              <View style={[s.horaLimitPill, isOverdue && s.horaLimitUrgent]}>
                <Text style={[s.horaLimitTxt, isOverdue && { color: C.red || '#dc2626' }, { fontSize: fs.micro || 10 }]}>
                  ⏰ {new Date(item.horaLimite).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </>
          )}
        </View>

        {/* Chip teléfono */}
        {!isDone && (item.referencia?.telefono || item.telefonoContacto) && (
          <View style={[s.muestraRow, { marginBottom: 5 }]}>
            <Text style={s.muestraIc}>📞</Text>
            <Text style={[s.muestraTxt, { fontSize: fs.small || 11 }]}>
              {item.referencia?.telefono || item.telefonoContacto}
            </Text>
          </View>
        )}

        {(screen.showNotas !== false) && item.notas && !isDone && (
          <Text style={[s.notas, { fontSize: fs.small || 10 }]}>📝 {item.notas}</Text>
        )}

        {/* Acciones: MAPA a la IZQUIERDA (verde), principal a la DERECHA */}
        {(showMapBtn || (!isDone && !!btnLabel)) && (
          <View style={s.cardActions}>
            {showMapBtn && (
              <TouchableOpacity
                style={[s.mapBtn, { minHeight: DT?.layout?.buttonMinHeight ?? 40, borderRadius: DT?.borderRadius?.button ?? 9 }]}
                onPress={() => Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${item.referencia!.latitud},${item.referencia!.longitud}`)}
                activeOpacity={0.82}
              >
                <Text style={s.mapBtnIc}>📍</Text>
                <Text style={s.mapBtnTxt}>Llegar</Text>
              </TouchableOpacity>
            )}
            {!isDone && !!btnLabel && (
              <TouchableOpacity
                style={[s.abtn, {
                  flex: 1,
                  backgroundColor: btnColor,
                  padding: sp.buttonPadding || 10,
                  minHeight: DT?.layout?.buttonMinHeight ?? 40,
                  borderRadius: DT?.borderRadius?.button ?? 9,
                }, cargando && { opacity: 0.6 }]}
                onPress={() => onAvanzar(item)}
                disabled={cargando}
                activeOpacity={0.82}
              >
                <Text style={[s.abtnTxt, { fontSize: fs.body || 13 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>
                  {cargando ? (UL.btnCargando || 'Actualizando...') : btnLabel}
                </Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {isDone && (
          <Text style={[s.doneTag, { fontSize: fs.small || 10 }]}>✅ {badgeLabel}</Text>
        )}
      </View>
    </View>
  );
});

export default function TicketsScreen() {
  const user = useAuthStore((s) => s.user);
  const clearUser = useAuthStore((s) => s.clearUser);
  const [config, setConfig] = useState<any>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [turnoActivo, setTurnoActivo] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [estadoMoto, setEstadoMoto] = useState<string>('OFF_LINE');

  // Modales
  const [estadoModal, setEstadoModal] = useState(false);
  const [estadoSel, setEstadoSel] = useState<string>('OFF_LINE');
  const [registroModal, setRegistroModal] = useState(false);
  const [confirmModal, setConfirmModal] = useState(false);

  // Datos del registro
  const [refNombre, setRefNombre] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [fotoUri, setFotoUri] = useState<string | null>(null);
  const [fotoBase64, setFotoBase64] = useState<string | undefined>(undefined);
  const [metodoPago, setMetodoPago] = useState<MetodoPago | null>(null);
  const [monto, setMonto] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  const currentTicketId = useRef<string | null>(null);
  const [activeTab, setActiveTab] = useState<'pendientes' | 'mi-ruta'>('pendientes');
  const [completadosExpanded, setCompletadosExpanded] = useState(false);
  const [motorizadoData, setMotorizadoData] = useState<{ placa?: string; vehiculo?: string } | null>(null);
  const { startTracking, stopTracking } = useTracking();

  // ─── Leer configuración SDUI desde VPS ───
  const C = config?.dashboard?.colors || C_FALLBACK;
  const DT = config?.designTokens || {};
  const UL = config?.uiLabels || {};
  const SC = config?.screenConfig || {};
  const screen = SC?.tickets || {};
  const sections = SC?.sections || {};

  const cargarTickets = useCallback(async () => {
    try {
      const data = await ticketsApi.getMisTickets();
      setTickets(data);
      useTicketsStore.getState().setTickets(data);
    } catch (e) {
      console.error('Error cargando tickets:', e);
      log('ERROR', 'tickets', `cargarTickets: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  const fetchConfig = useCallback(async () => {
    try {
      const res = await api.get('/motorizados/config');
      setConfig(res.data);
    } catch (e) {
      log('WARN', 'config', `Error fetching config: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => {
    cargarTickets();
    fetchConfig();
    api.get('/motorizados/me').then(r => setMotorizadoData(r.data)).catch(() => {});
  }, []);

  // Sincronizar con el store compartido (actualizado por _layout.tsx via socket)
  const storeTickets = useTicketsStore((s) => s.tickets);
  const triggerRefresh = useTicketsStore((s) => s.triggerRefresh);
  useEffect(() => {
    if (storeTickets.length > 0) {
      setTickets(storeTickets);
    }
  }, [triggerRefresh]);

  const onRefresh = async () => {
    setRefreshing(true);
    await cargarTickets();
    setRefreshing(false);
  };

  useEffect(() => {
    const hasActive = tickets.some(t => CLIENT_FLOW_MAP[t.estado] !== undefined);
    if (hasActive) {
      activateKeepAwakeAsync();
    } else {
      deactivateKeepAwake();
    }
  }, [tickets]);

  const iniciarTurno = async () => {
    await startTracking();
    setTurnoActivo(true);
    setEstadoMoto('DISPONIBLE');
    try { await api.patch(`/motorizados/me/estado`, { estado: 'DISPONIBLE' }); } catch { log('WARN', 'turno', 'Error al iniciar estado DISPONIBLE'); }
  };

  const finalizarTurno = async () => {
    await stopTracking();
    deactivateKeepAwake();
    setTurnoActivo(false);
    setEstadoMoto('OFF_LINE');
    try { await api.patch(`/motorizados/me/estado`, { estado: config?.estadosMoto?.OFF_LINE?.backendEstado || 'OFFLINE' }); } catch { log('WARN', 'turno', 'Error al finalizar estado'); }
  };

  const logout = () => {
    Alert.alert('Cerrar sesión', '¿Seguro que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: () => {
        // Borrar tokens inmediatamente (fire-and-forget) para que no persistan si la app se cierra
        SecureStore.deleteItemAsync('accessToken').catch(() => {});
        SecureStore.deleteItemAsync('refreshToken').catch(() => {});
        clearUser();
        router.replace('/login');
        (async () => {
          try {
            if (turnoActivo) await finalizarTurno();
            disconnectSocket();
            try { await api.post('/auth/logout'); } catch (e) { log('ERROR', 'logout', String(e)); }
          } catch (e) {
            console.error('[LOGOUT] Error limpieza:', e);
          }
        })();
      }},
    ]);
  };

  // Avanzar estado de ticket
  const avanzarEstado = async (ticket: Ticket) => {
    const flow = CLIENT_FLOW_MAP[ticket.estado];
    if (!flow) return;

    if (flow.accion === 'tomarTicket') {
      setLoadingId(ticket.id);
      const prevTickets = tickets;
      setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, estado: 'ASIGNADO' as EstadoTicket } : t));
      try {
        const res = await ticketsApi.tomarTicket(ticket.id);
        setTickets(prev => prev.map(t => t.id === ticket.id ? (res ?? { ...t, estado: 'ASIGNADO' as EstadoTicket }) : t));
        if (!turnoActivo) await iniciarTurno();
      } catch (e: any) {
        setTickets(prevTickets);
        const msg = e.response?.data?.message;
        log('ERROR', 'avanzarEstado', `tomarTicket: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message || 'unknown'}`);
        Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo tomar el pedido');
      } finally { setLoadingId(null); }
      return;
    }

    if (flow.abreModal) {
      if (ticket.estado === 'EN_RUTA' && flow.endpoint) {
        const prevTickets = tickets;
        setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, estado: 'EN_RECOJO' as EstadoTicket } : t));
        try {
          const res = await api.post(flow.endpoint(ticket.id), flow.body);
          setTickets(prev => prev.map(t => t.id === ticket.id ? (res.data ?? { ...t, estado: 'EN_RECOJO' as EstadoTicket }) : t));
        } catch (e: any) {
          setTickets(prevTickets);
        }
      }
      currentTicketId.current = ticket.id;
      resetRegistroForm();
      setRegistroModal(true);
      return;
    }

    setLoadingId(ticket.id);
    const nextEstado = flow.body?.estado as EstadoTicket;
    const prevTickets = tickets;
    setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, estado: nextEstado } : t));
    try {
      const res = await api.post(flow.endpoint!(ticket.id), flow.body);
      setTickets(prev => prev.map(t => t.id === ticket.id ? (res.data ?? { ...t, estado: nextEstado }) : t));
      if (!turnoActivo) await iniciarTurno();
    } catch (e: any) {
      setTickets(prevTickets);
      const msg = e.response?.data?.message;
      log('ERROR', 'avanzarEstado', `${flow.accion}: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message || 'unknown'}`);
      Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'Error al actualizar');
    } finally { setLoadingId(null); }
  };

  const resetRegistroForm = () => {
    setRefNombre('');
    setObservaciones('');
    setFotoUri(null);
    setFotoBase64(undefined);
    setMetodoPago(null);
    setMonto('');
  };

  const intentarConfirmar = () => {
    const tieneData = fotoUri || refNombre.trim() || observaciones.trim();
    if (!tieneData) {
      setConfirmModal(true);
    } else {
      setRegistroModal(false);
      completarRecojo(false);
    }
  };

  const confirmarSinEventualidades = async () => {
    setConfirmModal(false);
    setRegistroModal(false);
    await completarRecojo(true);
  };

  const volverAlFormulario = () => {
    setConfirmModal(false);
  };

  const completarRecojo = async (sinInfo: boolean = false) => {
    const id = currentTicketId.current;
    if (!id) return;
    setSubiendo(true);

    if (metodoPago && metodoPago !== 'SIN_PAGO' && monto) {
      try {
        await ticketsApi.registrarCobro(id, {
          metodo: metodoPago,
          monto: parseFloat(monto),
        });
      } catch (e) {
        console.error('[completarRecojo] Error registrando cobro:', e);
        log('ERROR', 'completarRecojo', `registrarCobro: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    if (sinInfo) {
      try {
        await ticketsApi.guardarRegistro(id, { sinInfo: true });
      } catch (e) {
        console.error('[completarRecojo] Error guardando registro vacío:', e);
        log('ERROR', 'completarRecojo', `guardarRegistro(sinInfo): ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (refNombre || observaciones || fotoUri) {
      try {
        const body: any = { refNombre, observaciones };
        if (fotoBase64) body.fotoBase64 = fotoBase64;
        await ticketsApi.guardarRegistro(id, body);
      } catch (e) {
        console.error('[completarRecojo] Error guardando registro:', e);
        log('ERROR', 'completarRecojo', `guardarRegistro: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    try {
      await ticketsApi.updateEstado(id, 'RECOGIDO');
      setTickets(prev => prev.map(t => t.id === id ? { ...t, estado: 'RECOGIDO' as EstadoTicket } : t));
      if (sinInfo) {
        Alert.alert('✅ Recojo completado', 'El registro se guardó sin información adicional.');
      } else if (fotoUri || refNombre || observaciones || (metodoPago && metodoPago !== 'SIN_PAGO')) {
        Alert.alert('✅ Registro guardado', 'Los datos del recojo se guardaron correctamente.');
      } else {
        Alert.alert('✅ Recojo completado', 'El ticket se marcó como recogido.');
      }
    } catch (e: any) {
      const msg = e.response?.data?.message;
      log('ERROR', 'completarRecojo', `updateEstado RECOGIDO: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message || 'unknown'}`);
      Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo completar el recojo');
    }

    setSubiendo(false);
    currentTicketId.current = null;
  };

  const tomarFoto = async () => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso requerido', 'Necesitamos acceso a la cámara');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      allowsEditing: false,
      base64: true,
    });
    if (!result.canceled) {
      setFotoUri(result.assets[0].uri);
      if (result.assets[0].base64) {
        setFotoBase64(result.assets[0].base64);
      }
    }
  };

  const confirmarEstadoMoto = async () => {
    setEstadoModal(false);
    setEstadoMoto(estadoSel);
    const e = config?.estadosMoto?.[estadoSel] || {};
    if (estadoSel === 'OFF_LINE') {
      await finalizarTurno();
    } else if (!turnoActivo) {
      await iniciarTurno();
    }
    try { await api.patch(`/motorizados/me/estado`, { estado: e.backendEstado || estadoSel }); } catch { log('WARN', 'turno', 'Error al confirmar estado moto'); }
  };

  const tabData = useMemo(() => {
    const tf = config?.ticketFlow || {};
    const hoy = new Date().toDateString();
    const pendientesArr = tickets.filter(t => (tf[t.estado] || 'done') === 'pendiente');
    const asignadosArr = tickets.filter(t => (tf[t.estado] || 'done') === 'pending');
    const activosArr = tickets.filter(t => (tf[t.estado] || 'done') === 'active');
    const completadosArr = tickets.filter(t => (tf[t.estado] || 'done') === 'done' && new Date(t.createdAt).toDateString() === hoy);
    const PRIO: Record<string, number> = { EN_RECOJO: 0, EN_RUTA: 1, EN_LABORATORIO: 2, RECOGIDO: 3, ASIGNADO: 4 };
    const enCurso = [...asignadosArr, ...activosArr].sort((a, b) => (PRIO[a.estado] ?? 99) - (PRIO[b.estado] ?? 99));
    return { pendientesArr, asignadosArr, activosArr, enCurso, completadosArr };
  }, [tickets, config]);

  const eActual = config?.estadosMoto?.[estadoMoto] || {};

  const tabLabelPendientes = UL.tabPendientes || 'Pendientes';
  const tabLabelMiRuta = UL.tabMiRuta || 'Mi Ruta';
  const seccionEnCurso = UL.seccionEnCurso || 'En curso';
  const seccionCompletados = UL.seccionCompletados || 'Completados hoy';

  const listaCompleta: any[] = activeTab === 'pendientes'
    ? tabData.pendientesArr
    : [
      ...(tabData.enCurso.length > 0 ? [{ _sep: seccionEnCurso, _count: tabData.enCurso.length, _color: C.blue }] : []),
      ...tabData.enCurso.map(t => ({ ...t, _inCurso: true })),
      { _sep: seccionCompletados, _count: tabData.completadosArr.length, _color: C.green, _collapsible: true },
      ...(completadosExpanded ? tabData.completadosArr : []),
    ];

  return (
    <SafeAreaView style={s.root} edges={['top']}>

      {/* ─── HEADER gradiente azul oscuro ─── */}
      {(screen.showHeader !== false) && (
      <View style={s.header}>
        {/* Fila 1: avatar + nombre/placa (flex:1) + logout */}
        <View style={s.hRow1}>
          {(screen.showAvatar !== false) && (
          <View style={s.av}>
            <Text style={s.avTxt}>{user?.nombre?.[0]?.toUpperCase() ?? '🏍'}</Text>
          </View>
          )}
          <View style={s.hNameBlock}>
            <Text style={s.hName} numberOfLines={1} ellipsizeMode="tail">
              {user?.nombre ?? 'Motorizado'}
            </Text>
            {(motorizadoData?.vehiculo || motorizadoData?.placa) ? (
              <Text style={s.hSub} numberOfLines={1} ellipsizeMode="tail">
                {[motorizadoData?.vehiculo, motorizadoData?.placa ? `Placa ${motorizadoData.placa}` : null].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </View>
          <TouchableOpacity onPress={logout} style={s.hLogoutBtn} activeOpacity={0.7}>
            <Text style={s.hLogoutIc}>⏻</Text>
          </TouchableOpacity>
        </View>

        {/* Fila 2: GPS pill + estado pill en la misma fila */}
        <View style={s.hRow2}>
          {(screen.showGpsStatus !== false) && (
          <View style={s.gpsBadge}>
            <View style={[s.gpsDot, { backgroundColor: eActual.gpsColor || '#22c55e' }]} />
            <Text style={s.gpsTxt}>{eActual.gpsTxt || 'GPS activo'}</Text>
          </View>
          )}
          {(screen.showEstadoPill !== false) && (
          <TouchableOpacity
            style={[s.estadoPill, { backgroundColor: eActual.bg || 'rgba(255,255,255,0.12)', borderColor: eActual.border || 'rgba(255,255,255,0.2)' }]}
            onPress={() => { setEstadoSel(estadoMoto); setEstadoModal(true); }}
            activeOpacity={0.82}
          >
            <Text style={s.estadoPillIc}>{eActual.ic || '🟢'}</Text>
            <Text style={[s.estadoPillTxt, { color: eActual.color || '#fff' }]}>{eActual.label || 'Estado'}</Text>
          </TouchableOpacity>
          )}
        </View>

        {/* Stats header — 3 chips: pendientes, en ruta, recogidos */}
        {(screen.showStats !== false) && (
        <View style={s.qsRow}>
          <View style={s.qs}>
            <Text style={s.qsVal}>{tabData.pendientesArr.length}</Text>
            <Text style={s.qsLbl}>{UL.statsPendientes || 'Pendientes'}</Text>
          </View>
          <View style={[s.qs, s.qsGreen]}>
            <Text style={[s.qsVal, { color: '#4ade80' }]}>{tabData.completadosArr.length}</Text>
            <Text style={s.qsLbl}>{UL.statsCompletados || 'Recogidos'}</Text>
          </View>
          <View style={[s.qs, s.qsAmber]}>
            <Text style={[s.qsVal, { color: '#fbbf24' }]}>{tabData.enCurso.length}</Text>
            <Text style={s.qsLbl}>{UL.statsEnCamino || 'En ruta'}</Text>
          </View>
        </View>
        )}
      </View>
      )}

      {/* Banner de estado — solo si tiene contenido */}
      {!!(eActual.bannerIc || eActual.bannerTxt) && (
      <View style={[s.banner, { backgroundColor: eActual.bg || '#f8fafc' }]}>
        <Text style={s.bannerIc}>{eActual.bannerIc || ''}</Text>
        <Text style={[s.bannerTxt, { color: eActual.color || '#64748b' }]}>{eActual.bannerTxt || ''}</Text>
      </View>
      )}

      {/* ─── TAB BAR fondo azul oscuro ─── */}
      <View style={s.tabBar}>
        <TouchableOpacity
          style={[s.tab, activeTab === 'pendientes' && s.tabActive]}
          onPress={() => setActiveTab('pendientes')}
          activeOpacity={0.82}
        >
          <Text style={[s.tabTxt, activeTab === 'pendientes' && s.tabTxtActive]}>{tabLabelPendientes}</Text>
          {tabData.pendientesArr.length > 0 && (
            <View style={s.tabBadge}>
              <Text style={s.tabBadgeTxt}>{tabData.pendientesArr.length}</Text>
            </View>
          )}
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.tab, activeTab === 'mi-ruta' && s.tabActive]}
          onPress={() => setActiveTab('mi-ruta')}
          activeOpacity={0.82}
        >
          <Text style={[s.tabTxt, activeTab === 'mi-ruta' && s.tabTxtActive]}>{tabLabelMiRuta}</Text>
          {(tabData.enCurso.length + tabData.completadosArr.length) > 0 && (
            <View style={s.tabBadge}>
              <Text style={s.tabBadgeTxt}>{tabData.enCurso.length + tabData.completadosArr.length}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* Lista tickets */}
      <FlatList
        data={listaCompleta}
        keyExtractor={(item, i) => item._sep !== undefined ? 'sep-' + i : item.id}
        renderItem={({ item }: { item: any }) => {
          if (item._sep !== undefined) {
            if (item._collapsible) {
              return (
                <TouchableOpacity
                  style={s.sepRow}
                  onPress={() => setCompletadosExpanded(e => !e)}
                  activeOpacity={0.7}
                >
                  <Text style={[s.sepTitle, { fontSize: DT?.fontSizes?.micro || 10 }]}>{item._sep}</Text>
                  <View style={s.sepToggle}>
                    <Text style={s.sepToggleTxt}>
                      {completadosExpanded ? (UL.ocultarLabel || 'Ocultar') : `Ver (${item._count ?? 0})`}
                    </Text>
                    <Text style={s.sepArrow}>{completadosExpanded ? '▲' : '▼'}</Text>
                  </View>
                </TouchableOpacity>
              );
            }
            return (
              <View style={s.sepRow}>
                <Text style={[s.sepTitle, { color: item._color, fontSize: DT?.fontSizes?.micro || 10 }]}>{item._sep}</Text>
                {item._count !== undefined && (
                  <View style={s.sepCount}>
                    <Text style={s.sepCountTxt}>{item._count}</Text>
                  </View>
                )}
              </View>
            );
          }
          if (item._inCurso) {
            return (
              <View>
                <ProgressStepper estado={item.estado} C={C} />
                <TicketCard item={item} config={config} loadingId={loadingId} onAvanzar={avanzarEstado} />
              </View>
            );
          }
          return <TicketCard item={item} config={config} loadingId={loadingId} onAvanzar={avanzarEstado} />;
        }}
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#fff" />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIc}>📭</Text>
            <Text style={[s.emptyTxt, { fontSize: DT?.fontSizes?.body || 14 }]}>{UL.sinTickets || 'Sin tickets por ahora'}</Text>
            <Text style={s.emptySub}>{config?.dashboard?.emptyListSubtitle || 'Tira hacia abajo para actualizar'}</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: DT?.spacing?.cardGap || 10 }} />}
        removeClippedSubviews={false}
        maxToRenderPerBatch={8}
        windowSize={5}
      />

      {/* ══ MODAL ESTADO MOTO ══ */}
      <Modal visible={estadoModal} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={[s.sheetTitle, { fontSize: DT?.fontSizes?.title || 16 }]}>{config?.dashboard?.estadoModalTitle || '¿Cuál es tu estado?'}</Text>
            <Text style={[s.sheetSub, { fontSize: DT?.fontSizes?.caption || 12 }]}>{config?.dashboard?.estadoModalSubtitle || 'La administradora lo ve en tiempo real'}</Text>

            {Object.keys(config?.estadosMoto || {}).map(key => {
              const e = config?.estadosMoto?.[key] || {};
              const isSel = estadoSel === key;
              return (
                <TouchableOpacity
                  key={key}
                  style={[s.eOpt, isSel && { backgroundColor: e.bg, borderColor: e.color, borderWidth: 2 }]}
                  onPress={() => setEstadoSel(key)}
                  activeOpacity={0.82}
                >
                  <Text style={[s.eOptIc, { fontSize: DT?.fontSizes?.title || 16 }]}>{e.ic}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.eOptName, { fontSize: DT?.fontSizes?.body || 14 }]}>{e.label || key}</Text>
                    <Text style={[s.eOptDesc, { fontSize: DT?.fontSizes?.small || 10 }]}>{e.desc || ''}</Text>
                  </View>
                  <View style={[s.eCheck, isSel && { backgroundColor: e.color, borderColor: e.color }]}>
                    {isSel && <Text style={{ color: C.white, fontSize: DT?.fontSizes?.caption || 12, fontWeight: '800' }}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={[s.confirmBtn, { backgroundColor: C.blue }]} onPress={confirmarEstadoMoto}>
              <Text style={s.confirmBtnTxt}>{config?.dashboard?.confirmarEstado || 'Confirmar'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setEstadoModal(false)}>
              <Text style={s.cancelBtnTxt}>{config?.dashboard?.cancelar || 'Cancelar'}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══ MODAL REGISTRO DE RECOJO ══ */}
      {(screen.showRegistroModal !== false) && (
      <Modal visible={registroModal} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '90%' }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.handle} />
              <Text style={[s.sheetTitle, { fontSize: DT?.fontSizes?.title || 16 }]}>Registrar recojo</Text>
              <Text style={[s.sheetSub, { fontSize: DT?.fontSizes?.caption || 12 }]}>Opcional — completa lo que aplique</Text>

              <Text style={[s.msec, { fontSize: DT?.fontSizes?.micro || 9 }]}>Nombre de referencia</Text>
              <TextInput
                style={s.minp}
                value={refNombre}
                onChangeText={setRefNombre}
                placeholder={config?.dashboard?.registroPlaceholders?.paciente || 'Ej. María López'}
                placeholderTextColor={C.grayBorder}
              />

              <Text style={[s.msec, { fontSize: DT?.fontSizes?.micro || 9 }]}>Foto de evidencia <Text style={s.optional}>(opcional)</Text></Text>
              {!fotoUri ? (
                <TouchableOpacity style={s.fotoBtn} onPress={tomarFoto}>
                  <Text style={[s.fotoBtnLbl, { fontSize: DT?.fontSizes?.caption || 12 }]}>📷 Tomar foto</Text>
                  <Text style={[s.fotoBtnSub, { fontSize: DT?.fontSizes?.small || 10 }]}>Toca para abrir la cámara</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.fotoPreview}>
                  <Text style={{ fontSize: DT?.fontSizes?.title || 16 }}>🖼️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={[s.fotoName, { fontSize: DT?.fontSizes?.caption || 12 }]}>evidencia_foto.jpg</Text>
                    <Text style={{ fontSize: DT?.fontSizes?.small || 10, color: C.gray }}>Lista para subir</Text>
                  </View>
                  <TouchableOpacity onPress={() => setFotoUri(null)}>
                    <Text style={{ fontSize: DT?.fontSizes?.caption || 12, color: C.red, fontWeight: '700' }}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              )}

              <Text style={[s.msec, { fontSize: DT?.fontSizes?.micro || 9 }]}>Observaciones <Text style={s.optional}>(opcional)</Text></Text>
              <TextInput
                style={[s.minp, { height: 72, textAlignVertical: 'top' }]}
                value={observaciones}
                onChangeText={setObservaciones}
                placeholder="Ej. Muestra en buen estado, sin incidencias"
                placeholderTextColor={C.grayBorder}
                multiline
              />

              <Text style={[s.msec, { fontSize: DT?.fontSizes?.micro || 9 }]}>Pago recibido <Text style={s.optional}>(opcional)</Text></Text>
              <View style={s.pagoGrid}>
                {(config?.opcionesPago || [
                  { key: 'EFECTIVO', ic: '💵', lbl: 'Efectivo' },
                  { key: 'YAPE', ic: '📱', lbl: 'Yape' },
                  { key: 'TRANSFERENCIA', ic: '🏦', lbl: 'Transferencia' },
                  { key: 'SIN_PAGO', ic: '🚫', lbl: 'Sin pago' },
                ]).map((p: any) => (
                  <TouchableOpacity
                    key={p.key}
                    style={[s.pagoOpt, metodoPago === p.key && { backgroundColor: C.blueLight, borderColor: C.blue }]}
                    onPress={() => setMetodoPago(p.key)}
                    activeOpacity={0.82}
                  >
                    <Text style={{ fontSize: DT?.fontSizes?.title || 16, marginBottom: 3 }}>{p.ic}</Text>
                    <Text style={[s.pagoLbl, metodoPago === p.key && { color: C.blue }, { fontSize: DT?.fontSizes?.small || 10 }]}>{p.lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {metodoPago && metodoPago !== 'SIN_PAGO' && (
                <View>
                  <Text style={[s.msec, { fontSize: DT?.fontSizes?.micro || 9 }]}>Monto recibido</Text>
                  <View style={s.montoRow}>
                    <View style={s.montoPre}><Text style={[s.montoPreTxt, { fontSize: DT?.fontSizes?.body || 14 }]}>S/</Text></View>
                    <TextInput
                      style={s.montoInp}
                      value={monto}
                      onChangeText={setMonto}
                      placeholder="0.00"
                      placeholderTextColor={C.grayBorder}
                      keyboardType="decimal-pad"
                    />
                  </View>
                </View>
              )}

              <View style={s.mActions}>
                <TouchableOpacity style={s.mCancel} onPress={() => setRegistroModal(false)}>
                  <Text style={[s.mCancelTxt, { fontSize: DT?.fontSizes?.caption || 12 }]}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.mConfirm, { backgroundColor: C.blue }, subiendo && { opacity: 0.6 }]}
                  onPress={intentarConfirmar}
                  disabled={subiendo}
                >
                  {subiendo
                    ? <ActivityIndicator color={C.white} />
                    : <Text style={[s.mConfirmTxt, { fontSize: DT?.fontSizes?.caption || 12 }]}>Confirmar recojo ✓</Text>
                  }
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
      )}

      {/* ══ ALERT CONFIRMACIÓN ══ */}
      {(screen.showConfirmModal !== false) && (
      <Modal visible={confirmModal} transparent animationType="fade">
        <View style={[s.overlay, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={s.alertBox}>
            <Text style={s.alertIc}>📋</Text>
            <Text style={[s.alertTitle, { fontSize: DT?.fontSizes?.title || 16 }]}>¿Deseas continuar sin registrar información?</Text>
            <Text style={[s.alertBody, { fontSize: DT?.fontSizes?.caption || 12 }]}>
              Si tienes foto, nombre o notas que agregar, puedes volver al formulario y completarlos.
            </Text>
            <TouchableOpacity style={[s.confirmBtn, { backgroundColor: C.blue, marginTop: 16 }]} onPress={confirmarSinEventualidades}>
              <Text style={s.confirmBtnTxt}>Sí, confirmar recojo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.cancelBtn, { marginTop: 8 }]} onPress={volverAlFormulario}>
              <Text style={[s.cancelBtnTxt, { color: C.text, fontSize: DT?.fontSizes?.body || 14 }]}>No, volver a registrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      )}

    </SafeAreaView>
  );
}

// ─── Styles ───
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#f2f4f7' },

  // Header - compacto
  header: { backgroundColor: '#0d2580', paddingHorizontal: 14, paddingTop: 10, paddingBottom: 10 },
  // Fila 1: avatar + nombre (flex:1) + logout
  hRow1: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  av: { width: 38, height: 38, borderRadius: 19, backgroundColor: '#3b82f6', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.3)', flexShrink: 0 },
  avTxt: { fontSize: 16, fontWeight: '800', color: '#fff' },
  hNameBlock: { flex: 1, marginHorizontal: 9, minWidth: 0 },
  hName: { fontSize: 15, fontWeight: '700', color: '#fff' },
  hSub: { fontSize: 10, color: 'rgba(255,255,255,0.6)', marginTop: 1 },
  hLogoutBtn: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.1)', alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  hLogoutIc: { fontSize: 14, color: 'rgba(255,255,255,0.85)' },

  // Fila 2: GPS pill + estado pill alineados
  hRow2: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },

  // GPS badge - pill oscuro
  gpsBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,0.25)', borderRadius: 20, paddingHorizontal: 10, paddingVertical: 5, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  gpsDot: { width: 7, height: 7, borderRadius: 4 },
  gpsTxt: { fontSize: 11, fontWeight: '600', color: '#fff' },

  // Estado pill
  estadoPill: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, borderWidth: 1.5 },
  estadoPillIc: { fontSize: 13 },
  estadoPillTxt: { fontSize: 10, fontWeight: '800' },

  // Stats row - 3 glass cards compactas
  qsRow: { flexDirection: 'row', gap: 6 },
  qs: { flex: 1, backgroundColor: 'rgba(255,255,255,0.1)', borderRadius: 8, paddingVertical: 6, paddingHorizontal: 4, alignItems: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  qsGreen: {},
  qsAmber: {},
  qsVal: { fontSize: 16, fontWeight: '800', color: '#fff', lineHeight: 18 },
  qsLbl: { fontSize: 9, fontWeight: '600', color: 'rgba(255,255,255,0.55)', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 2 },

  // Banner de estado
  banner: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: '#e2e8f0' },
  bannerIc: { fontSize: 13 },
  bannerTxt: { fontSize: 10, fontWeight: '700' },

  // Tab bar - fondo azul oscuro
  tabBar: { flexDirection: 'row', backgroundColor: '#0c257a', paddingHorizontal: 14, paddingVertical: 8, gap: 6, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.06)' },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 7, paddingHorizontal: 6, borderRadius: 8, gap: 6 },
  tabActive: { backgroundColor: 'rgba(255,255,255,0.15)' },
  tabTxt: { fontSize: 12, fontWeight: '700', color: 'rgba(255,255,255,0.5)', letterSpacing: 0.2 },
  tabTxtActive: { color: '#fff' },
  tabBadge: { backgroundColor: '#ef4444', borderRadius: 10, paddingHorizontal: 5, paddingVertical: 1, minWidth: 16, alignItems: 'center' },
  tabBadgeTxt: { fontSize: 9, fontWeight: '800', color: '#fff', lineHeight: 14 },

  // Lista
  list: { padding: 12, paddingBottom: 32 },

  // Separador de sección
  sepRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 2, marginBottom: 4 },
  sepTitle: { fontSize: 10, fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.8 },
  sepToggle: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#e2e8f0', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 },
  sepToggleTxt: { fontSize: 11, fontWeight: '600', color: '#64748b' },
  sepArrow: { fontSize: 9, color: '#64748b' },
  sepCount: { backgroundColor: '#e2e8f0', borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2 },
  sepCountTxt: { fontSize: 10, fontWeight: '700', color: '#64748b' },

  // Ticket card
  tcard: { backgroundColor: '#fff', overflow: 'hidden', shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2, borderWidth: 1, borderColor: '#e8edf2' },
  cardStrip: { height: 3 },
  cardBody: { padding: 12 },

  // Card top row
  tcTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardMeta: { flex: 1, gap: 2 },
  ticketCode: { fontSize: 12, fontWeight: '700', color: '#1e293b', letterSpacing: 0.3 },
  ticketTime: { fontSize: 10, fontWeight: '500', color: '#94a3b8' },

  // Badges
  ticketBadgesRow: { flexDirection: 'row', gap: 4, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end', maxWidth: '55%' },
  tipoBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  tipoBadgeTxt: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },
  estadoBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6, borderWidth: 1 },
  estadoBadgeTxt: { fontSize: 9, fontWeight: '700', letterSpacing: 0.3 },

  // Reference block
  refBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginBottom: 7, backgroundColor: '#f8fafc', borderRadius: 8, padding: 8, borderWidth: 1, borderColor: '#e2e8f0' },
  refBlockIcon: { fontSize: 14, marginTop: 1 },
  refName: { fontSize: 13, fontWeight: '700', color: '#1e293b', lineHeight: 18 },
  refAddress: { fontSize: 11, color: '#64748b', marginTop: 1, lineHeight: 15 },

  // Muestra row
  muestraRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 9 },
  muestraIc: { fontSize: 12 },
  muestraTxt: { fontSize: 11, color: '#475569', fontWeight: '600' },
  muestraSep: { color: '#cbd5e1', fontSize: 11 },
  horaLimitPill: { backgroundColor: '#f0fdf4', borderRadius: 5, paddingHorizontal: 6, paddingVertical: 2 },
  horaLimitUrgent: { backgroundColor: '#fef2f2' },
  horaLimitTxt: { fontSize: 10, fontWeight: '600', color: '#16a34a' },

  notas: { color: '#7F8C8D', fontStyle: 'italic', marginBottom: 6 },

  // Card actions — mapa izquierda (verde), principal derecha
  cardActions: { flexDirection: 'row', gap: 6, marginTop: 2 },
  mapBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0', borderRadius: 9, paddingVertical: 9, paddingHorizontal: 12 },
  mapBtnIc: { fontSize: 13 },
  mapBtnTxt: { fontSize: 11, fontWeight: '700', color: '#16a34a' },
  abtn: { alignItems: 'center', justifyContent: 'center' },
  abtnTxt: { fontWeight: '800', color: '#fff', letterSpacing: 0.2 },
  doneTag: { fontWeight: '700', color: '#27AE60', marginTop: 8 },

  // Empty state
  empty: { alignItems: 'center', paddingTop: 60 },
  emptyIc: { fontSize: 48, marginBottom: 12 },
  emptyTxt: { color: '#7F8C8D', fontWeight: '700' },
  emptySub: { fontSize: 11, color: '#BDC3C7', marginTop: 4 },

  // Modales
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 18, paddingBottom: 32 },
  handle: { width: 36, height: 3, backgroundColor: '#D5D8DC', borderRadius: 2, alignSelf: 'center', marginBottom: 14 },
  sheetTitle: { fontWeight: '800', color: '#1a1a2e', marginBottom: 3 },
  sheetSub: { color: '#7F8C8D', marginBottom: 16 },
  msec: { fontWeight: '700', color: '#7F8C8D', textTransform: 'uppercase', letterSpacing: 0.8, marginTop: 12, marginBottom: 6 },
  optional: { color: '#BDC3C7', fontWeight: '400' },
  minp: { backgroundColor: '#F2F3F4', borderWidth: 1.5, borderColor: '#D5D8DC', borderRadius: 9, padding: 10, fontSize: 12, color: '#1a1a2e' },
  fotoBtn: { backgroundColor: '#F2F3F4', borderWidth: 1.5, borderColor: '#D5D8DC', borderStyle: 'dashed', borderRadius: 10, padding: 20, alignItems: 'center' },
  fotoBtnLbl: { fontWeight: '700', color: '#7F8C8D' },
  fotoBtnSub: { color: '#BDC3C7', marginTop: 2 },
  fotoPreview: { backgroundColor: '#EBF5FB', borderWidth: 1.5, borderColor: '#AED6F1', borderRadius: 10, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  fotoName: { fontWeight: '700', color: '#3498DB' },
  pagoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pagoOpt: { width: '47%', backgroundColor: '#F2F3F4', borderWidth: 1.5, borderColor: '#D5D8DC', borderRadius: 10, padding: 12, alignItems: 'center' },
  pagoLbl: { fontWeight: '700', color: '#7F8C8D' },
  montoRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#F2F3F4', borderWidth: 1.5, borderColor: '#D5D8DC', borderRadius: 9, overflow: 'hidden' },
  montoPre: { padding: 10, backgroundColor: '#D5D8DC' },
  montoPreTxt: { fontWeight: '800', color: '#7F8C8D' },
  montoInp: { flex: 1, padding: 10, fontSize: 16, fontWeight: '800', color: '#1a1a2e' },
  mActions: { flexDirection: 'row', gap: 8, marginTop: 16 },
  mCancel: { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1.5, borderColor: '#D5D8DC', alignItems: 'center' },
  mCancelTxt: { fontWeight: '700', color: '#7F8C8D' },
  mConfirm: { flex: 2, padding: 12, borderRadius: 10, alignItems: 'center' },
  mConfirmTxt: { fontWeight: '800', color: '#fff' },
  eOpt: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 13, borderRadius: 12, borderWidth: 1.5, borderColor: '#D5D8DC', marginBottom: 8 },
  eOptIc: { width: 32, textAlign: 'center' },
  eOptName: { fontWeight: '800', color: '#1a1a2e' },
  eOptDesc: { color: '#7F8C8D', marginTop: 1 },
  eCheck: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#D5D8DC', alignItems: 'center', justifyContent: 'center' },
  confirmBtn: { borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 8 },
  confirmBtnTxt: { fontSize: 14, fontWeight: '800', color: '#fff' },
  cancelBtn: { padding: 12, alignItems: 'center' },
  cancelBtnTxt: { fontSize: 13, fontWeight: '700', color: '#7F8C8D' },
  alertBox: { backgroundColor: '#fff', borderRadius: 18, padding: 24, margin: 24, alignItems: 'center' },
  alertIc: { fontSize: 40, marginBottom: 8 },
  alertTitle: { fontWeight: '800', color: '#1a1a2e', textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  alertBody: { color: '#7F8C8D', textAlign: 'center', lineHeight: 18 },
});

// Estilos del ProgressStepper (separados para no contaminar el StyleSheet principal)
const ps = StyleSheet.create({
  wrap: { backgroundColor: '#f0f7ff', borderRadius: 10, padding: 10, marginBottom: 6, borderWidth: 1, borderColor: '#dbeafe' },
  track: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 4 },
  dot: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 2 },
  dotTxt: { fontSize: 11, fontWeight: '800', color: '#fff' },
  labels: { flexDirection: 'row', marginTop: 5, paddingHorizontal: 0 },
  label: { flex: 1, fontSize: 9, fontWeight: '700', letterSpacing: 0.2 },
});
