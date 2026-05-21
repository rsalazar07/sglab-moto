import { useEffect, useState, useCallback, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  RefreshControl, Alert, Modal, TextInput, ScrollView,
  ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import * as ImagePicker from 'expo-image-picker';
import { ticketsApi } from '../../src/api/tickets';
import { useTracking } from '../../src/hooks/useTracking';
import { useAuthStore } from '../../src/store/authStore';
import { getSocket, disconnectSocket } from '../../src/socket/socket';
import { authApi } from '../../src/api/auth';
import { api } from '../../src/api/client';
import { router } from 'expo-router';
import { send as log } from '../../src/lib/LogReporter';
import type { Ticket, EstadoTicket } from '../../src/types';

const C = {
  blue:'#4BBFE0', blueDark:'#2fa8cc', blueLight:'#EBF7FC', blueBorder:'#c8ebf7',
  gray:'#8C8C8C', grayLight:'#F5F6F8', grayBorder:'#E8E8E8',
  text:'#1a1a2e', text2:'#6b7280',
  green:'#2ECC71', greenLight:'#EAFAF1',
  orange:'#F39C12', orangeLight:'#FEF9EC',
  red:'#E74C3C', redLight:'#FEF0EF',
  white:'#FFFFFF',
};

type MetodoPago = 'EFECTIVO' | 'YAPE' | 'TRANSFERENCIA' | 'SIN_PAGO';

export default function TicketsScreen() {
  const user = useAuthStore((s) => s.user);
  const clearUser = useAuthStore((s) => s.clearUser);
  const [config, setConfig] = useState<any>(null);
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [turnoActivo, setTurnoActivo] = useState(false);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [estadoMoto, setEstadoMoto] = useState<string>('DISPONIBLE');

  // Modales
  const [estadoModal, setEstadoModal] = useState(false);
  const [estadoSel, setEstadoSel] = useState<string>('DISPONIBLE');
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
      // Limpiar listeners previos antes de agregar nuevos (evita duplicados)
      socket.off('ticket:new', cargarTickets);
      socket.off('ticket:update', cargarTickets);
      socket.on('ticket:new', cargarTickets);
      socket.on('ticket:update', cargarTickets);
    };
    initSocket();
    return () => {
      // Solo remover nuestros listeners, no desconectar todo el socket
      getSocket().then((s) => {
        s.off('ticket:new', cargarTickets);
        s.off('ticket:update', cargarTickets);
      });
    };
  }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await cargarTickets();
    setRefreshing(false);
  };

  const iniciarTurno = async () => {
    await activateKeepAwakeAsync();
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
      { text: 'Salir', style: 'destructive', onPress: async () => {
        if (turnoActivo) await finalizarTurno();
        disconnectSocket();
        await authApi.logout();
        clearUser();
        router.replace('/login');
      }},
    ]);
  };

  // Avanzar estado de ticket
  const avanzarEstado = async (ticket: Ticket) => {
    const tf = config?.ticketFlow || {};
    const uiStatus = tf[ticket.estado] || 'done';
    if (uiStatus === 'done') return;

    try {
      // Obtener flow del backend
      const flowRes = await api.get(`/tickets/${ticket.id}/flow`);
      const flow = flowRes.data;
      const btn = flow.boton;

      if (!btn) return;

      if (btn.accion === 'tomarTicket') {
        setLoadingId(ticket.id);
        try {
          await ticketsApi.tomarTicket(ticket.id);
          if (!turnoActivo) await iniciarTurno();
          await cargarTickets();
        } catch (e: any) {
          const msg = e.response?.data?.message;
          log('ERROR', 'avanzarEstado', `tomarTicket: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message || 'unknown'}`);
          Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo tomar el pedido');
        } finally { setLoadingId(null); }
        return;
      }

      if (btn.abreModal) {
        // EN_RUTA o EN_RECOJO → abrir modal de registro
        if (ticket.estado === 'EN_RUTA' && btn.body) {
          await api.post(btn.endpoint!, btn.body);
        }
        currentTicketId.current = ticket.id;
        resetRegistroForm();
        setRegistroModal(true);
        return;
      }

      // Cualquier otra acción: llamar endpoint con body si existe
      setLoadingId(ticket.id);
      try {
        await (btn.body
          ? api.post(btn.endpoint!, btn.body)
          : api.post(btn.endpoint!));
        if (!turnoActivo) await iniciarTurno();
        await cargarTickets();
      } catch (e: any) {
        const msg = e.response?.data?.message;
        log('ERROR', 'avanzarEstado', `${btn.accion}: ${e?.response?.data ? JSON.stringify(e.response.data) : e?.message || 'unknown'}`);
        Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'Error al actualizar');
      } finally { setLoadingId(null); }
    } catch (e: any) {
      // Fallback: comportamiento antiguo
      log('WARN', 'avanzarEstado', `Flow API error, using fallback: ${e?.message}`);
      if (uiStatus === 'active') {
        setLoadingId(ticket.id);
        try {
          if (ticket.estado === 'EN_RUTA') {
            await ticketsApi.updateEstado(ticket.id, 'EN_RECOJO');
          }
          currentTicketId.current = ticket.id;
          resetRegistroForm();
          setRegistroModal(true);
        } catch (err: any) {
          const msg = err.response?.data?.message;
          Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'Error al actualizar');
        } finally { setLoadingId(null); }
        return;
      }
      if (uiStatus === 'pendiente') {
        setLoadingId(ticket.id);
        try {
          await ticketsApi.tomarTicket(ticket.id);
          if (!turnoActivo) await iniciarTurno();
          await cargarTickets();
        } catch (err: any) {
          const msg = err.response?.data?.message;
          Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo tomar el pedido');
        } finally { setLoadingId(null); }
        return;
      }
      setLoadingId(ticket.id);
      try {
        await ticketsApi.updateEstado(ticket.id, 'EN_RUTA');
        if (!turnoActivo) await iniciarTurno();
        await cargarTickets();
      } catch (err: any) {
        const msg = err.response?.data?.message;
        Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg ?? 'No se pudo actualizar');
      } finally { setLoadingId(null); }
    }
  };

  const resetRegistroForm = () => {
    setRefNombre('');
    setObservaciones('');
    setFotoUri(null);
    setMetodoPago(null);
    setMonto('');
  };

  // Al presionar "Confirmar recojo" en el formulario
  // Si no hay datos, pregunta si quiere continuar sin registrar
  const intentarConfirmar = () => {
    const tieneData = fotoUri || refNombre.trim() || observaciones.trim();
    if (!tieneData) {
      setConfirmModal(true);
    } else {
      setRegistroModal(false);
      completarRecojo(false);
    }
  };

  // Presionó "Sí" en el alert → confirmar sin datos
  const confirmarSinEventualidades = async () => {
    setConfirmModal(false);
    setRegistroModal(false);
    await completarRecojo(true);  // sinInfo = true
  };

  // Presionó "No" → volver al formulario
  const volverAlFormulario = () => {
    setConfirmModal(false);
  };

  const completarRecojo = async (sinInfo: boolean = false) => {
    const id = currentTicketId.current;
    if (!id) return;
    setSubiendo(true);

    // 1. Subir foto si hay
    let fotoUrl: string | undefined;
    if (fotoUri) {
      try {
        const { url } = await ticketsApi.subirEvidencia(id, fotoUri);
        fotoUrl = url;
      } catch (e) {
        console.error('[completarRecojo] Error subiendo evidencia:', e);
        log('ERROR', 'completarRecojo', `subirEvidencia: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 2. Registrar cobro si hay pago real
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

    // 3. Guardar registro
    if (sinInfo) {
      // Guardar registro vacío con flag para que el admin sepa
      try {
        await ticketsApi.guardarRegistro(id, {
          sinInfo: true,
        });
      } catch (e) {
        console.error('[completarRecojo] Error guardando registro vacío:', e);
        log('ERROR', 'completarRecojo', `guardarRegistro(sinInfo): ${e instanceof Error ? e.message : String(e)}`);
      }
    } else if (refNombre || observaciones || fotoUrl) {
      try {
        await ticketsApi.guardarRegistro(id, {
          refNombre,
          observaciones,
          fotoUrl,
        });
      } catch (e) {
        console.error('[completarRecojo] Error guardando registro:', e);
        log('ERROR', 'completarRecojo', `guardarRegistro: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    // 4. Cambiar estado a RECOGIDO — siempre ejecutar
    try {
      await ticketsApi.updateEstado(id, 'RECOGIDO');
      await cargarTickets();
      // Mostrar mensaje de éxito según el caso
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
  const completados = tickets.filter(t => (tf[t.estado] || 'done') === 'done');

  const eActual = config?.estadosMoto?.[estadoMoto] || {};

  const renderTicket = ({ item }: { item: Ticket }) => {
    const tf2 = config?.ticketFlow || {};
    const uiStatus = tf2[item.estado] || 'done';
    const isDone = uiStatus === 'done';
    // Labels y colores desde el config del VPS
    const CC = config?.dashboard?.colors || C;
    const UI_LABELS: Record<string, string> = {
      pendiente: '📋  Tomar pedido',
      pending: '🏍️  Voy ahora',
      active:  '🧪  Ya recogí la muestra',
    };
    const UI_COLORS: Record<string, string> = {
      pendiente: CC.blue,
      pending:   CC.orange,
      active:    CC.blue,
    };
    const btnLabel = UI_LABELS[uiStatus];
    const btnColor = UI_COLORS[uiStatus];
    const cargando = loadingId === item.id;
    const borderColor = uiStatus === 'pendiente' ? CC.blue : uiStatus === 'pending' ? CC.orange : uiStatus === 'active' ? CC.blue : CC.green;

    return (
      <View style={[s.tcard, { borderLeftColor: borderColor }, (uiStatus === 'active' || uiStatus === 'pendiente') && s.tcardActive]}>
        <View style={s.tcTop}>
          <Text style={s.tcId}>#{item.id.slice(-6).toUpperCase()}</Text>
          <View style={[s.badge, {
            backgroundColor: uiStatus === 'pendiente' ? CC.blueLight : uiStatus === 'pending' ? CC.orangeLight : uiStatus === 'active' ? CC.blueLight : CC.greenLight,
            borderColor: uiStatus === 'pendiente' ? CC.blue || C.blueBorder : uiStatus === 'pending' ? CC.orange || '#fde8a0' : uiStatus === 'active' ? CC.blue || C.blueBorder : '#a8e6c4',
          }]}>
            <Text style={[s.badgeTxt, { color: uiStatus === 'pendiente' ? CC.blue : uiStatus === 'pending' ? CC.orange : uiStatus === 'active' ? CC.blue : CC.green }]}>
              {uiStatus === 'pendiente' ? 'PENDIENTE' : uiStatus === 'pending' ? 'ASIGNADO' : uiStatus === 'active' ? 'EN CAMINO' : 'COMPLETADO ✓'}
            </Text>
          </View>
        </View>

        {/* Nombre referencia */}
        {item.referencia?.nombre && (
          <Text style={s.tcRef}>📍 {item.referencia.nombre}</Text>
        )}

        <Text style={s.tcType}>{item.referencia?.nombre ?? 'Muestra'}</Text>
        <Text style={s.tcAddr}>{item.referencia?.direccion ?? ''}</Text>
        {item.referencia?.telefono && (
          <Text style={s.tcPhone}>📞 {item.referencia.telefono}</Text>
        )}

        {item.horaLimite && !isDone && (
          <View style={[s.ttime, new Date(item.horaLimite) < new Date() && s.ttimeUrgent]}>
            <Text style={[s.ttimeTxt, new Date(item.horaLimite) < new Date() && { color: C.red }]}>
              ⏰ Límite: {new Date(item.horaLimite).toLocaleTimeString('es-PE', { hour:'2-digit', minute:'2-digit' })}
            </Text>
          </View>
        )}

        {item.notas && !isDone && (
          <Text style={s.notas}>📝 {item.notas}</Text>
        )}

        {!isDone && btnLabel && (
          <TouchableOpacity
            style={[s.abtn, { backgroundColor: btnColor }, cargando && { opacity: 0.6 }]}
            onPress={() => avanzarEstado(item)}
            disabled={cargando}
            activeOpacity={0.82}
          >
            <Text style={s.abtnTxt}>{cargando ? 'Actualizando...' : btnLabel}</Text>
          </TouchableOpacity>
        )}

        {isDone && (
          <Text style={s.doneTag}>✅ Completado · {item.horaLimite ? new Date(item.horaLimite).toLocaleTimeString('es-PE',{hour:'2-digit',minute:'2-digit'}) : ''}</Text>
        )}
      </View>
    );
  };

  const listaCompleta = [
    ...(activos.length > 0 ? [{ _sep: '🔵 En camino', _color: C.blue }] : []),
    ...activos,
    ...(pendientes.length > 0 ? [{ _sep: '📋 Pendientes', _color: C.blue }] : []),
    ...pendientes,
    ...(asignados.length > 0 ? [{ _sep: '⏳ Asignados', _color: C.orange }] : []),
    ...asignados,
    ...(completados.length > 0 ? [{ _sep: '✅ Completados', _color: C.green }] : []),
    ...completados,
  ] as any[];

  return (
    <SafeAreaView style={s.root} edges={['top']}>

      {/* HEADER */}
      <View style={s.header}>
        <View style={s.hTop}>
          <View style={s.av}>
            <Text style={s.avTxt}>{user?.nombre?.[0]?.toUpperCase() ?? 'M'}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={s.hName}>{user?.nombre ?? 'Motorizado'}</Text>
            <View style={s.gpsRow}>
              <View style={[s.gpsDot, { backgroundColor: eActual.gpsColor }]} />
              <Text style={[s.gpsTxt, { color: eActual.gpsColor }]}>{eActual.gpsTxt}</Text>
            </View>
          </View>
          {/* Pill de estado — toca para cambiar */}
          <TouchableOpacity
            style={[s.estadoPill, { backgroundColor: eActual.bg, borderColor: eActual.border }]}
            onPress={() => { setEstadoSel(estadoMoto); setEstadoModal(true); }}
            activeOpacity={0.82}
          >
            <Text style={s.estadoPillIc}>{eActual.ic}</Text>
            <Text style={[s.estadoPillTxt, { color: eActual.color }]}>{eActual.label}</Text>
          </TouchableOpacity>
        </View>

        {/* Stats */}
        <View style={s.qsRow}>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.blue }]}>{pendientes.length}</Text>
            <Text style={s.qsLbl}>Pendientes</Text>
          </View>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.orange }]}>{asignados.length}</Text>
            <Text style={s.qsLbl}>Asignados</Text>
          </View>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.blue }]}>{activos.length}</Text>
            <Text style={s.qsLbl}>En camino</Text>
          </View>
          <View style={s.qs}>
            <Text style={[s.qsVal, { color: C.green }]}>{completados.length}</Text>
            <Text style={s.qsLbl}>Listas</Text>
          </View>
        </View>
      </View>

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
            ? <Text style={[s.sep, { color: item._color }]}>{item._sep}</Text>
            : renderTicket({ item })
        }
        contentContainerStyle={s.list}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={C.blue} />}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={s.emptyIc}>📭</Text>
            <Text style={s.emptyTxt}>Sin tickets asignados</Text>
            <Text style={s.emptySub}>Jala hacia abajo para actualizar</Text>
          </View>
        }
        ItemSeparatorComponent={() => <View style={{ height: 8 }} />}
      />

      {/* ══ MODAL ESTADO MOTO ══ */}
      <Modal visible={estadoModal} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={s.sheet}>
            <View style={s.handle} />
            <Text style={s.sheetTitle}>¿Cuál es tu estado?</Text>
            <Text style={s.sheetSub}>La administradora verá esto en tiempo real</Text>

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
                  <Text style={s.eOptIc}>{e.ic}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.eOptName}>{e.label || key}</Text>
                    <Text style={s.eOptDesc}>
                      {key === 'DISPONIBLE' ? 'En turno, listo para recojos' : key === 'OCUPADO' ? 'En pausa · vuelvo en unos minutos' : key === 'OFF_LINE' ? 'Terminé mi jornada del día' : ''}
                    </Text>
                  </View>
                  <View style={[s.eCheck, isSel && { backgroundColor: e.color, borderColor: e.color }]}>
                    {isSel && <Text style={{ color: C.white, fontSize: 10, fontWeight: '800' }}>✓</Text>}
                  </View>
                </TouchableOpacity>
              );
            })}

            <TouchableOpacity style={[s.confirmBtn, { backgroundColor: C.blue }]} onPress={confirmarEstadoMoto}>
              <Text style={s.confirmBtnTxt}>Confirmar estado</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.cancelBtn} onPress={() => setEstadoModal(false)}>
              <Text style={s.cancelBtnTxt}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ══ MODAL REGISTRO DE RECOJO ══ */}
      <Modal visible={registroModal} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={[s.sheet, { maxHeight: '90%' }]}>
            <ScrollView showsVerticalScrollIndicator={false}>
              <View style={s.handle} />
              <Text style={s.sheetTitle}>Registrar recojo</Text>
              <Text style={s.sheetSub}>Opcional — completa lo que aplique</Text>

              {/* Nombre referencia */}
              <Text style={s.msec}>Nombre de referencia</Text>
              <TextInput
                style={s.minp}
                value={refNombre}
                onChangeText={setRefNombre}
                placeholder="Ej. María López"
                placeholderTextColor={C.grayBorder}
              />

              {/* Foto */}
              <Text style={s.msec}>Foto de evidencia <Text style={s.optional}>(opcional)</Text></Text>
              {!fotoUri ? (
                <TouchableOpacity style={s.fotoBtn} onPress={tomarFoto}>
                  <Text style={s.fotoBtnLbl}>📷 Tomar foto</Text>
                  <Text style={s.fotoBtnSub}>Toca para abrir la cámara</Text>
                </TouchableOpacity>
              ) : (
                <View style={s.fotoPreview}>
                  <Text style={{ fontSize: 22 }}>🖼️</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={s.fotoName}>evidencia_foto.jpg</Text>
                    <Text style={{ fontSize: 10, color: C.gray }}>Lista para subir</Text>
                  </View>
                  <TouchableOpacity onPress={() => setFotoUri(null)}>
                    <Text style={{ fontSize: 11, color: C.red, fontWeight: '700' }}>Quitar</Text>
                  </TouchableOpacity>
                </View>
              )}

              {/* Observaciones */}
              <Text style={s.msec}>Observaciones <Text style={s.optional}>(opcional)</Text></Text>
              <TextInput
                style={[s.minp, { height: 72, textAlignVertical: 'top' }]}
                value={observaciones}
                onChangeText={setObservaciones}
                placeholder="Ej. Muestra en buen estado, sin incidencias"
                placeholderTextColor={C.grayBorder}
                multiline
              />

              {/* Pago */}
              <Text style={s.msec}>Pago recibido <Text style={s.optional}>(opcional)</Text></Text>
              <View style={s.pagoGrid}>
                {([
                  { key: 'EFECTIVO', ic: '💵', lbl: 'Efectivo' },
                  { key: 'YAPE', ic: '📱', lbl: 'Yape' },
                  { key: 'TRANSFERENCIA', ic: '🏦', lbl: 'Transferencia' },
                  { key: 'SIN_PAGO', ic: '🚫', lbl: 'Sin pago' },
                ] as { key: MetodoPago; ic: string; lbl: string }[]).map(p => (
                  <TouchableOpacity
                    key={p.key}
                    style={[s.pagoOpt, metodoPago === p.key && { backgroundColor: C.blueLight, borderColor: C.blue }]}
                    onPress={() => setMetodoPago(p.key)}
                    activeOpacity={0.82}
                  >
                    <Text style={{ fontSize: 22, marginBottom: 3 }}>{p.ic}</Text>
                    <Text style={[s.pagoLbl, metodoPago === p.key && { color: C.blue }]}>{p.lbl}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Monto */}
              {metodoPago && metodoPago !== 'SIN_PAGO' && (
                <View>
                  <Text style={s.msec}>Monto recibido</Text>
                  <View style={s.montoRow}>
                    <View style={s.montoPre}><Text style={s.montoPreTxt}>S/</Text></View>
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
                  <Text style={s.mCancelTxt}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.mConfirm, { backgroundColor: C.blue }, subiendo && { opacity: 0.6 }]}
                  onPress={intentarConfirmar}
                  disabled={subiendo}
                >
                  {subiendo
                    ? <ActivityIndicator color={C.white} />
                    : <Text style={s.mConfirmTxt}>Confirmar recojo ✓</Text>
                  }
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ══ ALERT CONFIRMACIÓN SIN EVENTUALIDADES ══ */}
      <Modal visible={confirmModal} transparent animationType="fade">
        <View style={[s.overlay, { alignItems: 'center', justifyContent: 'center' }]}>
          <View style={s.alertBox}>
            <Text style={s.alertIc}>📋</Text>
            <Text style={s.alertTitle}>¿Deseas continuar sin registrar información?</Text>
            <Text style={s.alertBody}>
              Si tienes foto, nombre o notas que agregar, puedes volver al formulario y completarlos.
            </Text>
            <TouchableOpacity style={[s.confirmBtn, { backgroundColor: C.blue, marginTop: 16 }]} onPress={confirmarSinEventualidades}>
              <Text style={s.confirmBtnTxt}>Sí, confirmar recojo</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.cancelBtn, { marginTop: 8 }]} onPress={volverAlFormulario}>
              <Text style={[s.cancelBtnTxt, { color: C.text }]}>No, volver a registrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex:1, backgroundColor:'#F5F6F8' },
  header: { backgroundColor:'#FFFFFF', padding:14, borderBottomWidth:1, borderBottomColor:'#E8E8E8' },
  hTop: { flexDirection:'row', alignItems:'center', gap:10, marginBottom:12 },
  av: { width:40, height:40, borderRadius:11, backgroundColor:'#4BBFE0', alignItems:'center', justifyContent:'center' },
  avTxt: { fontSize:17, fontWeight:'800', color:'#fff' },
  hName: { fontSize:14, fontWeight:'700', color:'#1a1a2e' },
  gpsRow: { flexDirection:'row', alignItems:'center', gap:4, marginTop:2 },
  gpsDot: { width:6, height:6, borderRadius:3 },
  gpsTxt: { fontSize:10, fontWeight:'600' },
  estadoPill: { flexDirection:'row', alignItems:'center', gap:4, paddingHorizontal:10, paddingVertical:6, borderRadius:20, borderWidth:1.5 },
  estadoPillIc: { fontSize:13 },
  estadoPillTxt: { fontSize:10, fontWeight:'800' },
  qsRow: { flexDirection:'row', gap:8 },
  qs: { flex:1, backgroundColor:'#F5F6F8', borderRadius:9, padding:8, alignItems:'center' },
  qsVal: { fontSize:18, fontWeight:'800' },
  qsLbl: { fontSize:8, fontWeight:'600', color:'#8C8C8C', textTransform:'uppercase', letterSpacing:0.5, marginTop:1 },
  banner: { flexDirection:'row', alignItems:'center', gap:6, paddingHorizontal:14, paddingVertical:8, borderBottomWidth:1, borderBottomColor:'#E8E8E8' },
  bannerIc: { fontSize:13 },
  bannerTxt: { fontSize:10, fontWeight:'700' },
  list: { padding:12, paddingBottom:32 },
  sep: { fontSize:9, fontWeight:'800', letterSpacing:1, textTransform:'uppercase', paddingVertical:6, paddingHorizontal:2 },
  tcard: { backgroundColor:'#fff', borderRadius:14, padding:13, borderLeftWidth:4 },
  tcardActive: { backgroundColor:'#f0fafd' },
  tcTop: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', marginBottom:8 },
  tcId: { fontSize:9, color:'#8C8C8C', letterSpacing:0.5, fontFamily:'monospace' },
  badge: { paddingHorizontal:8, paddingVertical:3, borderRadius:20, borderWidth:1 },
  badgeTxt: { fontSize:8, fontWeight:'800', letterSpacing:0.4 },
  tcRef: { fontSize:10, fontWeight:'700', color:'#4BBFE0', marginBottom:2 },
  tcType: { fontSize:13, fontWeight:'800', color:'#1a1a2e', marginBottom:3 },
  tcAddr: { fontSize:10, color:'#6b7280', lineHeight:16 },
  tcPhone: { fontSize:9, color:'#8C8C8C', marginTop:2 },
  ttime: { alignSelf:'flex-start', backgroundColor:'#FEF9EC', borderRadius:20, paddingHorizontal:9, paddingVertical:3, marginVertical:6 },
  ttimeUrgent: { backgroundColor:'#FEF0EF' },
  ttimeTxt: { fontSize:9, fontWeight:'700', color:'#F39C12' },
  notas: { fontSize:10, color:'#8C8C8C', fontStyle:'italic', marginBottom:6 },
  abtn: { borderRadius:10, padding:12, alignItems:'center', marginTop:8 },
  abtnTxt: { fontSize:12, fontWeight:'800', color:'#fff', letterSpacing:0.2 },
  doneTag: { fontSize:10, fontWeight:'700', color:'#2ECC71', marginTop:8 },
  empty: { alignItems:'center', paddingTop:60 },
  emptyIc: { fontSize:48, marginBottom:12 },
  emptyTxt: { fontSize:15, color:'#8C8C8C', fontWeight:'700' },
  emptySub: { fontSize:11, color:'#ccc', marginTop:4 },
  overlay: { flex:1, backgroundColor:'rgba(0,0,0,0.5)', justifyContent:'flex-end' },
  sheet: { backgroundColor:'#fff', borderTopLeftRadius:20, borderTopRightRadius:20, padding:18, paddingBottom:32 },
  handle: { width:36, height:3, backgroundColor:'#E8E8E8', borderRadius:2, alignSelf:'center', marginBottom:14 },
  sheetTitle: { fontSize:16, fontWeight:'800', color:'#1a1a2e', marginBottom:3 },
  sheetSub: { fontSize:11, color:'#8C8C8C', marginBottom:16 },
  msec: { fontSize:9, fontWeight:'700', color:'#8C8C8C', textTransform:'uppercase', letterSpacing:0.8, marginTop:12, marginBottom:6 },
  optional: { color:'#ccc', fontWeight:'400' },
  minp: { backgroundColor:'#F5F6F8', borderWidth:1.5, borderColor:'#E8E8E8', borderRadius:9, padding:10, fontSize:12, color:'#1a1a2e' },
  fotoBtn: { backgroundColor:'#F5F6F8', borderWidth:1.5, borderColor:'#E8E8E8', borderStyle:'dashed', borderRadius:10, padding:20, alignItems:'center' },
  fotoBtnLbl: { fontSize:12, fontWeight:'700', color:'#8C8C8C' },
  fotoBtnSub: { fontSize:9, color:'#ccc', marginTop:2 },
  fotoPreview: { backgroundColor:'#EBF7FC', borderWidth:1.5, borderColor:'#c8ebf7', borderRadius:10, padding:10, flexDirection:'row', alignItems:'center', gap:10 },
  fotoName: { fontSize:11, fontWeight:'700', color:'#4BBFE0' },
  pagoGrid: { flexDirection:'row', flexWrap:'wrap', gap:8 },
  pagoOpt: { width:'47%', backgroundColor:'#F5F6F8', borderWidth:1.5, borderColor:'#E8E8E8', borderRadius:10, padding:12, alignItems:'center' },
  pagoLbl: { fontSize:10, fontWeight:'700', color:'#6b7280' },
  montoRow: { flexDirection:'row', alignItems:'center', backgroundColor:'#F5F6F8', borderWidth:1.5, borderColor:'#E8E8E8', borderRadius:9, overflow:'hidden' },
  montoPre: { padding:10, backgroundColor:'#E8E8E8' },
  montoPreTxt: { fontSize:14, fontWeight:'800', color:'#8C8C8C' },
  montoInp: { flex:1, padding:10, fontSize:16, fontWeight:'800', color:'#1a1a2e' },
  mActions: { flexDirection:'row', gap:8, marginTop:16 },
  mCancel: { flex:1, padding:12, borderRadius:10, borderWidth:1.5, borderColor:'#E8E8E8', alignItems:'center' },
  mCancelTxt: { fontSize:12, fontWeight:'700', color:'#8C8C8C' },
  mConfirm: { flex:2, padding:12, borderRadius:10, alignItems:'center' },
  mConfirmTxt: { fontSize:12, fontWeight:'800', color:'#fff' },
  eOpt: { flexDirection:'row', alignItems:'center', gap:12, padding:13, borderRadius:12, borderWidth:1.5, borderColor:'#E8E8E8', marginBottom:8 },
  eOptIc: { fontSize:24, width:32, textAlign:'center' },
  eOptName: { fontSize:13, fontWeight:'800', color:'#1a1a2e' },
  eOptDesc: { fontSize:10, color:'#8C8C8C', marginTop:1 },
  eCheck: { width:20, height:20, borderRadius:10, borderWidth:2, borderColor:'#E8E8E8', alignItems:'center', justifyContent:'center' },
  confirmBtn: { borderRadius:12, padding:14, alignItems:'center', marginTop:8 },
  confirmBtnTxt: { fontSize:14, fontWeight:'800', color:'#fff' },
  cancelBtn: { padding:12, alignItems:'center' },
  cancelBtnTxt: { fontSize:13, fontWeight:'700', color:'#8C8C8C' },
  alertBox: { backgroundColor:'#fff', borderRadius:18, padding:24, margin:24, alignItems:'center' },
  alertIc: { fontSize:40, marginBottom:8 },
  alertTitle: { fontSize:16, fontWeight:'800', color:'#1a1a2e', textAlign:'center', lineHeight:22, marginBottom:8 },
  alertBody: { fontSize:12, color:'#6b7280', textAlign:'center', lineHeight:18 },
});