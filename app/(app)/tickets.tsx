import { useEffect, useState, useCallback, useRef, memo } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Modal, TextInput, ScrollView,
  ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { ticketsApi } from '../../src/api/tickets';
import { useTracking } from '../../src/hooks/useTracking';
import { useAuthStore } from '../../src/store/authStore';
import { getSocket, disconnectSocket } from '../../src/socket/socket';
import { authApi } from '../../src/api/auth';
import { api } from '../../src/api/client';
import { router } from 'expo-router';
import { send as log } from '../../src/lib/LogReporter';
import type { Ticket, EstadoTicket } from '../../src/types';

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
  const borderColor = uiStatus === 'pendiente' ? C.blue : uiStatus === 'pending' ? C.orange : uiStatus === 'active' ? C.blue : C.green;

  const estadoLabels: Record<string, string> = {
    PENDIENTE: UL.badgePendiente || '📋 PENDIENTE',
    ASIGNADO: UL.badgeAsignado || '🔄 ASIGNADO',
    EN_RUTA: UL.badgeEnRuta || '🏍️ EN RUTA',
    EN_RECOJO: UL.badgeEnRecojo || UL.badgeEnRuta || '🏍️ EN RUTA',
    RECOGIDO: UL.badgeRecogido || '🔵 RECOGIDO',
    EN_LABORATORIO: UL.badgeEnLaboratorio || '🧪 EN LAB',
    ENTREGADO: UL.badgeEntregado || '✅ ENTREGADO',
    CERRADO: UL.badgeCerrado || '🔒 CERRADO',
    CANCELADO: UL.badgeCancelado || '❌ CANCELADO',
    FALLIDO: UL.badgeFallido || '⚠️ FALLIDO',
  };
  const badgeLabel = estadoLabels[item.estado] || item.estado;
  const btnLabels: Record<string, string> = {
    pendiente: UL.btnTomarPedido || '📋 Tomar pedido',
    pending: UL.btnVoyAhora || '🏍️ Voy ahora',
    active: UL.btnYaRecogi || '🧪 Ya recogí',
  };
  const btnColors: Record<string, string> = {
    pendiente: C.blue,
    pending: C.orange,
    active: C.blue,
  };
  const fb = config?.flowButtons?.[item.estado];
  const btnLabel = fb?.label || btnLabels[uiStatus];
  const btnColor = fb?.color || btnColors[uiStatus];
  const cargando = loadingId === item.id;

  const fs = DT?.fontSizes || {};
  const sp = DT?.spacing || {};
  const esUrgente = item.tipo === 'URGENTE';

  return (
    <View style={[s.tcard, { borderLeftColor: esUrgente ? '#E74C3C' : borderColor, borderLeftWidth: esUrgente ? 6 : 4, padding: sp.cardPadding || 13, borderRadius: (DT?.borderRadius?.card ?? 12) }, (uiStatus === 'active' || uiStatus === 'pendiente') && s.tcardActive]}>
      <View style={s.tcTop}>
        <Text style={[s.tcId, { fontSize: fs.micro || 9 }]}>🕐 {new Date(item.createdAt).toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })}</Text>
        <View style={[s.badge, {
          backgroundColor: uiStatus === 'pendiente' ? C.blueLight : uiStatus === 'pending' ? C.orangeLight : uiStatus === 'active' ? C.blueLight : C.grayLight,
          borderColor: uiStatus === 'pendiente' ? C.blueBorder : uiStatus === 'pending' ? C.orange : uiStatus === 'active' ? C.blueBorder : C.gray,
          borderRadius: DT?.borderRadius?.badge ?? 6,
        }]}>
          <Text style={[s.badgeTxt, { fontSize: fs.badge || 11, color: uiStatus === 'pendiente' ? C.blue : uiStatus === 'pending' ? C.orange : uiStatus === 'active' ? C.blue : C.gray }]}>
            {badgeLabel}
          </Text>
        </View>
        {esUrgente && (
          <View style={{ backgroundColor: '#FDEDEC', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2, marginLeft: 4 }}>
            <Text style={{ color: '#E74C3C', fontSize: fs.micro || 9, fontWeight: '800' }}>🚨 {UL.badgeUrgente || 'URGENTE'}</Text>
          </View>
        )}
      </View>

      {item.referencia?.nombreComercial && (
        <Text style={[s.tcRef, { fontSize: fs.caption || 12 }]}>📍 {item.referencia.nombreComercial}</Text>
      )}

      <Text style={[s.tcType, { fontSize: fs.body || 14 }]}>{item.tipoMuestra || item.tipo || item.referencia?.nombreComercial || 'Muestra'}</Text>
      <Text style={[s.tcAddr, { fontSize: fs.small || 10 }]}>{item.referencia?.direccion ?? ''}</Text>
      {item.referencia?.telefono && (
        <Text style={[s.tcPhone, { fontSize: fs.micro || 9 }]}>📞 {item.referencia.telefono}</Text>
      )}

      {(screen.showTimeLimit !== false) && item.horaLimite && !isDone && (
        <View style={[s.ttime, new Date(item.horaLimite) < new Date() && s.ttimeUrgent]}>
          <Text style={[s.ttimeTxt, new Date(item.horaLimite) < new Date() && { color: C.red }, { fontSize: fs.micro || 9 }]}>
            ⏰ Límite: {new Date(item.horaLimite).toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })}
          </Text>
        </View>
      )}

      {(screen.showNotas !== false) && item.notas && !isDone && (
        <Text style={[s.notas, { fontSize: fs.small || 10 }]}>📝 {item.notas}</Text>
      )}

      {!isDone && btnLabel && (
        <TouchableOpacity
          style={[s.abtn, { backgroundColor: btnColor, padding: sp.buttonPadding || 10, minHeight: DT?.layout?.buttonMinHeight ?? 48, borderRadius: DT?.borderRadius?.button ?? 8 }, cargando && { opacity: 0.6 }]}
          onPress={() => onAvanzar(item)}
          disabled={cargando}
          activeOpacity={0.82}
        >
          <Text style={[s.abtnTxt, { fontSize: fs.body || 14 }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.7}>{cargando ? (UL.btnCargando || 'Actualizando...') : btnLabel}</Text>
        </TouchableOpacity>
      )}

      {isDone && (
        <Text style={[s.doneTag, { fontSize: fs.small || 10 }]}>✅ {badgeLabel}</Text>
      )}
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
  const [metodoPago, setMetodoPago] = useState<MetodoPago | null>(null);
  const [monto, setMonto] = useState('');
  const [subiendo, setSubiendo] = useState(false);

  const currentTicketId = useRef<string | null>(null);
  const { startTracking, stopTracking } = useTracking();

  // ─── Leer configuración SDUI desde VPS ───
  const C = config?.dashboard?.colors || C_FALLBACK;
  const DT = config?.designTokens || {}; // designTokens
  const UL = config?.uiLabels || {};     // uiLabels
  const SC = config?.screenConfig || {}; // screenConfig
  const screen = SC?.tickets || {};
  const sections = SC?.sections || {};

  const cargarTickets = useCallback(async () => {
    try {
      const data = await ticketsApi.getMisTickets();
      setTickets(data);
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
    const initSocket = async () => {
      const socket = await getSocket();
      socket.off('ticket:new');
      socket.off('ticket:update');

      socket.on('ticket:new', async (data: { ticketId: string }) => {
        try {
          const { data: t } = await api.get(`/tickets/${data.ticketId}`);
          setTickets(prev => {
            if (prev.some(x => x.id === t.id)) return prev;
            return [t, ...prev];
          });
        } catch {}
      });

      socket.on('ticket:update', (data: { ticketId: string; estado: EstadoTicket; motorizadoNombre?: string; timestamp?: string }) => {
        setTickets(prev =>
          prev.map(t => t.id === data.ticketId ? { ...t, estado: data.estado } : t)
        );
      });
    };
    initSocket();
    return () => {
      getSocket().then(s => {
        s.off('ticket:new');
        s.off('ticket:update');
      });
    };
  }, []);

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
    console.log('[LOGOUT] Botón presionado');
    Alert.alert('Cerrar sesión', '¿Seguro que quieres salir?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: async () => {
        console.log('[LOGOUT] Confirmó salida');
        try {
          if (turnoActivo) { console.log('[LOGOUT] Finalizando turno'); await finalizarTurno(); }
          console.log('[LOGOUT] Desconectando socket');
          disconnectSocket();
          console.log('[LOGOUT] Llamando authApi.logout()');
          try { await authApi.logout(); } catch (e) { console.error('[LOGOUT] Error en logout API:', e); log('ERROR', 'logout', String(e)); }
          console.log('[LOGOUT] Ejecutando clearUser()');
          clearUser();
          console.log('[LOGOUT] Redirigiendo a login');
          setTimeout(() => router.replace('/login'), 100);
        } catch (e) {
          console.error('[LOGOUT] Error INESPERADO en logout:', e);
          clearUser();
          router.replace('/login');
        }
      }},
    ]);
  };

  // Avanzar estado de ticket
  const avanzarEstado = async (ticket: Ticket) => {
    const flow = CLIENT_FLOW_MAP[ticket.estado];
    if (!flow) return; // RECOGIDO, ENTREGADO, CERRADO, etc. — sin botón

    if (flow.accion === 'tomarTicket') {
      setLoadingId(ticket.id);
      const prevTickets = tickets;
      setTickets(prev => prev.map(t => t.id === ticket.id ? { ...t, estado: 'ASIGNADO' as EstadoTicket } : t));
      try {
        const res = await ticketsApi.tomarTicket(ticket.id);
        setTickets(prev => prev.map(t => t.id === ticket.id ? (res ?? { ...t, estado: 'ASIGNADO' as EstadoTicket }) : t));
        if (!turnoActivo) await iniciarTurno();
      } catch (e: any) {
        setTickets(prevTickets); // revertir
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
      setTickets(prevTickets); // revertir
      const msg = e.response?.data?.message;
      log('ERROR', 'avanzarEstado', `${flow.accion}: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message || 'unknown'}`);
      Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'Error al actualizar');
    } finally { setLoadingId(null); }
  };

  const resetRegistroForm = () => {
    setRefNombre('');
    setObservaciones('');
    setFotoUri(null);
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

    let fotoBase64: string | undefined;
    if (fotoUri) {
      try {
        fotoBase64 = await FileSystem.readAsStringAsync(fotoUri, {
          encoding: FileSystem.EncodingType.Base64,
        });
      } catch (e) {
        console.error('[completarRecojo] Error leyendo foto:', e);
        log('ERROR', 'completarRecojo', `leerFoto: ${e instanceof Error ? e.message : String(e)}`);
        Alert.alert('Advertencia', 'No se pudo leer la foto. Se guardará el registro sin imagen.');
      }
    }

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
    });
    if (!result.canceled) setFotoUri(result.assets[0].uri);
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

  // Separar tickets por grupo
  const tf = config?.ticketFlow || {};
  const activos = tickets.filter(t => (tf[t.estado] || 'done') === 'active');
  const asignados = tickets.filter(t => (tf[t.estado] || 'done') === 'pending');
  const pendientes = tickets.filter(t => (tf[t.estado] || 'done') === 'pendiente');
  const hoy = new Date().toDateString();
  const completados = tickets.filter(t => (tf[t.estado] || 'done') === 'done' && new Date(t.createdAt).toDateString() === hoy);

  const eActual = config?.estadosMoto?.[estadoMoto] || {};

  // ─── Secciones dinámicas desde SDUI ───
  const listaCompleta = [
    ...((sections?.activos !== false && activos.length > 0) ? [{ _sep: UL.seccionEnCamino || '🔵 En camino', _color: C.blue }] : []),
    ...(sections?.activos !== false ? activos : []),
    ...((sections?.pendientes !== false && pendientes.length > 0) ? [{ _sep: UL.seccionPendientes || '📋 Pendientes', _color: C.blue }] : []),
    ...(sections?.pendientes !== false ? pendientes : []),
    ...((sections?.asignados !== false && asignados.length > 0) ? [{ _sep: UL.seccionAsignados || '⏳ Asignados', _color: C.orange }] : []),
    ...(sections?.asignados !== false ? asignados : []),
    ...((sections?.completados !== false && completados.length > 0) ? [{ _sep: UL.seccionCompletados || '✅ Recogidos', _color: C.green }] : []),
    ...(sections?.completados !== false ? completados : []),
  ] as any[];

  return (
    <SafeAreaView style={s.root} edges={['top']}>

      {/* ─── HEADER (controlable desde VPS) ─── */}
      {(screen.showHeader !== false) && (
      <View style={s.header}>
        <View style={s.hTop}>
          {(screen.showAvatar !== false) && (
          <View style={s.av}>
            <Text style={s.avTxt}>{user?.nombre?.[0]?.toUpperCase() ?? 'M'}</Text>
          </View>
          )}
          <View style={{ flex: 1 }}>
            <Text style={s.hName}>{user?.nombre ?? 'Motorizado'}</Text>
            {(screen.showGpsStatus !== false) && (
            <View style={s.gpsRow}>
              <View style={[s.gpsDot, { backgroundColor: eActual.gpsColor }]} />
              <Text style={[s.gpsTxt, { color: eActual.gpsColor }]}>{eActual.gpsTxt || 'GPS activo'}</Text>
            </View>
            )}
          </View>
          {(screen.showEstadoPill !== false) && (
          <TouchableOpacity
            style={[s.estadoPill, { backgroundColor: eActual.bg, borderColor: eActual.border }]}
            onPress={() => { setEstadoSel(estadoMoto); setEstadoModal(true); }}
            activeOpacity={0.82}
          >
            <Text style={s.estadoPillIc}>{eActual.ic}</Text>
            <Text style={[s.estadoPillTxt, { color: eActual.color }]}>{eActual.label}</Text>
          </TouchableOpacity>
          )}
        </View>

        {/* Stats header (controlable desde VPS) */}
        {(screen.showStats !== false) && (
        <View style={s.qsRow}>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.blue }]}>{pendientes.length}</Text>
            <Text style={s.qsLbl}>{UL.statsPendientes || 'Pendientes'}</Text>
          </View>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.orange }]}>{asignados.length}</Text>
            <Text style={s.qsLbl}>{UL.statsAsignados || 'Asignados'}</Text>
          </View>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.blue }]}>{activos.length}</Text>
            <Text style={s.qsLbl}>{UL.statsEnCamino || 'En ruta'}</Text>
          </View>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.green }]}>{completados.length}</Text>
            <Text style={s.qsLbl}>{UL.statsCompletados || 'Recogidos'}</Text>
          </View>
        </View>
        )}
      </View>
      )}

      {/* Banner de estado */}
      <View style={[s.banner, { backgroundColor: eActual.bg }]}>
        <Text style={s.bannerIc}>{eActual.bannerIc}</Text>
        <Text style={[s.bannerTxt, { color: eActual.color }]}>{eActual.bannerTxt}</Text>
      </View>

      {/* Lista tickets */}
      <FlatList
        data={listaCompleta}
        keyExtractor={(item, i) => item._sep ? 'sep-' + i : item.id}
        renderItem={({ item }) =>
          item._sep
            ? <Text style={[s.sep, { color: item._color, fontSize: DT?.fontSizes?.micro || 9 }]}>{item._sep}</Text>
            : <TicketCard item={item} config={config} loadingId={loadingId} onAvanzar={avanzarEstado} />
        }
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.blue} />}
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

// ─── Styles estáticos (estructura) ───
// Los valores dinámicos (fontSize, padding, borderRadius) se pasan inline desde SDUI
const s = StyleSheet.create({
  root: { flex:1, backgroundColor:'#F2F3F4' },
  header: { backgroundColor:'#FFFFFF', padding:14, borderBottomWidth:1, borderBottomColor:'#D5D8DC' },
  hTop: { flexDirection:'row', alignItems:'center', gap:10, marginBottom:12 },
  av: { width:40, height:40, borderRadius:11, backgroundColor:'#3498DB', alignItems:'center', justifyContent:'center' },
  avTxt: { fontSize:17, fontWeight:'800', color:'#fff' },
  hName: { fontSize:14, fontWeight:'700', color:'#1a1a2e' },
  gpsRow: { flexDirection:'row', alignItems:'center', gap:4, marginTop:2 },
  gpsDot: { width:6, height:6, borderRadius:3 },
  gpsTxt: { fontSize:10, fontWeight:'600' },
  estadoPill: { flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:10, paddingVertical:6, borderRadius:20, borderWidth:1.5 },
  estadoPillIc: { fontSize:13 },
  estadoPillTxt: { fontSize:10, fontWeight:'800' },
  qsRow: { flexDirection:'row', gap:8 },
  qs: { flex:1, backgroundColor:'#F2F3F4', borderRadius:9, padding:8, alignItems:'center' },
  qsVal: { fontSize:18, fontWeight:'800' },
  qsLbl: { fontSize:8, fontWeight:'600', color:'#7F8C8D', textTransform:'uppercase', letterSpacing:0.5, marginTop:1 },
  banner: { flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:14, paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#D5D8DC' },
  bannerIc: { fontSize:13 },
  bannerTxt: { fontSize:10, fontWeight:'700' },
  list: { padding:12, paddingBottom:32 },
  sep: { fontSize:9, fontWeight:'800', letterSpacing:1, textTransform:'uppercase', paddingVertical:6, paddingHorizontal:2 },
  tcard: { backgroundColor:'#fff', borderLeftWidth:4 },
  tcardActive: { backgroundColor:'#f0fafd' },
  tcTop: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  tcId: { color:'#7F8C8D', letterSpacing:0.5, fontFamily:'monospace' },
  badge: { paddingHorizontal:8, paddingVertical:3, borderWidth:1 },
  badgeTxt: { fontWeight:'800', letterSpacing:0.4 },
  tcRef: { fontWeight:'700', color:'#3498DB', marginBottom:2 },
  tcType: { fontWeight:'800', color:'#1a1a2e', marginBottom:3 },
  tcAddr: { color:'#7F8C8D', lineHeight:16 },
  tcPhone: { color:'#7F8C8D', marginTop:2 },
  ttime: { alignSelf:'flex-start', backgroundColor:'#FDF2E9', borderRadius:20, paddingHorizontal:9, paddingVertical:3, marginVertical:6 },
  ttimeUrgent: { backgroundColor:'#FDEDEC' },
  ttimeTxt: { fontWeight:'700', color:'#E67E22' },
  notas: { color:'#7F8C8D', fontStyle:'italic', marginBottom:6 },
  abtn: { alignItems:'center', marginTop:8 },
  abtnTxt: { fontWeight:'800', color:'#fff', letterSpacing:0.2 },
  doneTag: { fontWeight:'700', color:'#27AE60', marginTop:8 },
  empty: { alignItems:'center', paddingTop:60 },
  emptyIc: { fontSize:48, marginBottom:12 },
  emptyTxt: { color:'#7F8C8D', fontWeight:'700' },
  emptySub: { fontSize:11, color:'#BDC3C7', marginTop:4 },
  overlay: { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  sheet: { backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:18, paddingBottom:32 },
  handle: { width:36, height:3, backgroundColor:'#D5D8DC', borderRadius:2, alignSelf:'center', marginBottom:14 },
  sheetTitle: { fontWeight:'800', color:'#1a1a2e', marginBottom:3 },
  sheetSub: { color:'#7F8C8D', marginBottom:16 },
  msec: { fontWeight:'700', color:'#7F8C8D', textTransform:'uppercase', letterSpacing:0.8, marginTop:12, marginBottom:6 },
  optional: { color:'#BDC3C7', fontWeight:'400' },
  minp: { backgroundColor:'#F2F3F4', borderWidth:1.5, borderColor:'#D5D8DC', borderRadius:9, padding:10, fontSize:12, color:'#1a1a2e' },
  fotoBtn: { backgroundColor:'#F2F3F4', borderWidth:1.5, borderColor:'#D5D8DC', borderStyle:'dashed', borderRadius:10, padding:20, alignItems:'center' },
  fotoBtnLbl: { fontWeight:'700', color:'#7F8C8D' },
  fotoBtnSub: { color:'#BDC3C7', marginTop:2 },
  fotoPreview: { backgroundColor:'#EBF5FB', borderWidth:1.5, borderColor:'#AED6F1', borderRadius:10, padding:10, flexDirection:'row', alignItems:'center', gap:10 },
  fotoName: { fontWeight:'700', color:'#3498DB' },
  pagoGrid: { flexDirection:'row', flexWrap:'wrap', gap:8 },
  pagoOpt: { width:'47%', backgroundColor:'#F2F3F4', borderWidth:1.5, borderColor:'#D5D8DC', borderRadius:10, padding:12, alignItems:'center' },
  pagoLbl: { fontWeight:'700', color:'#7F8C8D' },
  montoRow: { flexDirection:'row', alignItems:'center', backgroundColor:'#F2F3F4', borderWidth:1.5, borderColor:'#D5D8DC', borderRadius:9, overflow:'hidden' },
  montoPre: { padding:10, backgroundColor:'#D5D8DC' },
  montoPreTxt: { fontWeight:'800', color:'#7F8C8D' },
  montoInp: { flex:1, padding:10, fontSize:16, fontWeight:'800', color:'#1a1a2e' },
  mActions: { flexDirection:'row', gap:8, marginTop:16 },
  mCancel: { flex:1, padding:12, borderRadius:10, borderWidth:1.5, borderColor:'#D5D8DC', alignItems:'center' },
  mCancelTxt: { fontWeight:'700', color:'#7F8C8D' },
  mConfirm: { flex:2, padding:12, borderRadius:10, alignItems:'center' },
  mConfirmTxt: { fontWeight:'800', color:'#fff' },
  eOpt: { flexDirection:'row', alignItems:'center', gap:12, padding:13, borderRadius:12, borderWidth:1.5, borderColor:'#D5D8DC', marginBottom:8 },
  eOptIc: { width:32, textAlign:'center' },
  eOptName: { fontWeight:'800', color:'#1a1a2e' },
  eOptDesc: { color:'#7F8C8D', marginTop:1 },
  eCheck: { width:20, height:20, borderRadius:10, borderWidth:2, borderColor:'#D5D8DC', alignItems:'center', justifyContent:'center' },
  confirmBtn: { borderRadius:12, padding:14, alignItems:'center', marginTop:8 },
  confirmBtnTxt: { fontSize:14, fontWeight:'800', color:'#fff' },
  cancelBtn: { padding:12, alignItems:'center' },
  cancelBtnTxt: { fontSize:13, fontWeight:'700', color:'#7F8C8D' },
  alertBox: { backgroundColor:'#fff', borderRadius:18, padding:24, margin:24, alignItems:'center' },
  alertIc: { fontSize:40, marginBottom:8 },
  alertTitle: { fontWeight:'800', color:'#1a1a2e', textAlign:'center', lineHeight:22, marginBottom:8 },
  alertBody: { color:'#7F8C8D', textAlign:'center', lineHeight:18 },
});
