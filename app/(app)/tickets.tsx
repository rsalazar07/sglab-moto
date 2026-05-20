import { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, FlatList, TouchableOpacity, Alert, ActivityIndicator, Modal, RefreshControl } from 'react-native';
import { router } from 'expo-router';
import { ticketsApi } from '../../src/api/tickets';
import { useTracking } from '../../src/hooks/useTracking';
import { useAuthStore } from '../../src/store/authStore';
import { getSocket, disconnectSocket } from '../../src/socket/socket';
import { authApi } from '../../src/api/auth';
import type { Ticket, EstadoTicket } from '../../src/types';

const COLOR = { verde: '#22c55e', azul: '#00d4ff', naranja: '#f59e0b', rojo: '#ef4444', gris: '#555', fondo: '#0a0a0a', card: '#1a1a1a', texto: '#fff', texto2: '#aaa' };

const estadosPrevios: Record<EstadoTicket, EstadoTicket[]> = {
  PENDIENTE: [], ASIGNADO: ['PENDIENTE'], EN_RUTA: ['ASIGNADO'], EN_RECOJO: ['EN_RUTA'],
  RECOGIDO: ['EN_RECOJO'], ENTREGADO: ['RECOGIDO'], CERRADO: ['ENTREGADO', 'RECOGIDO'], CANCELADO: ['PENDIENTE', 'ASIGNADO'], FALLIDO: ['EN_RUTA', 'EN_RECOJO'],
};

const coloresEstado: Record<string, string> = {
  PENDIENTE: '#f59e0b', ASIGNADO: '#3b82f6', EN_RUTA: '#8b5cf6', EN_RECOJO: '#f97316',
  RECOGIDO: '#22c55e', ENTREGADO: '#22c55e', CERRADO: '#6b7280', CANCELADO: '#ef4444', FALLIDO: '#ef4444',
};

export default function TicketsScreen() {
  const { user, clearUser } = useAuthStore();
  const { startTracking, stopTracking } = useTracking();
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [turnoActivo, setTurnoActivo] = useState(false);
  const [turnoLoading, setTurnoLoading] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [ticketAccion, setTicketAccion] = useState<Ticket | null>(null);
  const [estadoDestino, setEstadoDestino] = useState<EstadoTicket | null>(null);
  const wsConnected = useRef(false);
  const accionLoading = useRef(false);

  const cargarTickets = useCallback(async () => {
    try {
      const data = await ticketsApi.getMisTickets();
      setTickets(Array.isArray(data) ? data : []);
    } catch (e) {
      console.log('Error cargando tickets');
    }
  }, []);

  useEffect(() => {
    cargarTickets().finally(() => setLoading(false));
    const intervalo = setInterval(cargarTickets, 10000);
    return () => clearInterval(intervalo);
  }, [cargarTickets]);

  useEffect(() => {
    (async () => {
      try {
        const socket = await getSocket();
        socket.on('ticket:updated', () => cargarTickets());
        socket.on('connect', () => { wsConnected.current = true; });
        socket.on('disconnect', () => { wsConnected.current = false; });
      } catch {}
    })();
    return () => { disconnectSocket(); };
  }, []);

  const handleLogout = () => {
    Alert.alert('Cerrar sesión', '¿Estás seguro?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: async () => {
        await stopTracking();
        await authApi.logout();
        clearUser();
        router.replace('/login');
      }},
    ]);
  };

  const iniciarTurno = async () => {
    setTurnoLoading(true);
    try {
      const ok = await startTracking();
      if (ok) {
        setTurnoActivo(true);
      } else {
        Alert.alert('⚠️', 'No se pudo obtener permisos GPS. Revisa la configuración del dispositivo.');
      }
    } catch (e) {
      Alert.alert('Error', 'No se pudo iniciar el turno');
    } finally {
      setTurnoLoading(false);
    }
  };

  const finalizarTurno = () => {
    Alert.alert('Finalizar turno', '¿Seguro que deseas finalizar el turno? Se desactivará el GPS.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Finalizar', style: 'destructive', onPress: async () => {
        await stopTracking();
        setTurnoActivo(false);
      }},
    ]);
  };

  const avanzarEstado = async (ticket: Ticket, nuevoEstado: EstadoTicket) => {
    if (accionLoading.current) return;
    accionLoading.current = true;

    // Si no hay turno activo, iniciarlo automáticamente
    if (!turnoActivo) await iniciarTurno();

    try {
      // Si es PENDIENTE → ASIGNADO, usar tomarTicket
      if (ticket.estado === 'PENDIENTE' && nuevoEstado === 'ASIGNADO') {
        await ticketsApi.tomarTicket(ticket.id);
      } else {
        await ticketsApi.updateEstado(ticket.id, nuevoEstado);
      }
      await cargarTickets();
      Alert.alert('✅ Listo', `Ticket actualizado a "${nuevoEstado.replace(/_/g, ' ')}"`);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'No se pudo actualizar');
    } finally {
      accionLoading.current = false;
      setModalVisible(false);
    }
  };

  const confirmarAccion = (ticket: Ticket, estado: EstadoTicket) => {
    setTicketAccion(ticket);
    setEstadoDestino(estado);
    setModalVisible(true);
  };

  const renderTicket = ({ item }: { item: Ticket }) => {
    const accionesDisponibles = Object.entries(estadosPrevios).find(([, previos]) => previos.includes(item.estado));
    const siguienteEstado = accionesDisponibles?.[0] as EstadoTicket | undefined;

    return (
      <TouchableOpacity onLongPress={() => {}}
        style={{ backgroundColor: COLOR.card, borderRadius: 16, padding: 16, marginBottom: 12, borderLeftWidth: 4, borderLeftColor: coloresEstado[item.estado] || COLOR.gris }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: COLOR.texto, fontSize: 16, fontWeight: 'bold' }}>{item.referencia?.nombre || 'Sin referencia'}</Text>
          </View>
          <Text style={{ color: coloresEstado[item.estado], fontSize: 11, fontWeight: 'bold', backgroundColor: '#111', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: 'hidden' }}>
            {item.estado.replace(/_/g, ' ')}
          </Text>
        </View>

        <Text style={{ color: COLOR.texto2, fontSize: 13 }}>{item.referencia?.direccion || 'Sin dirección'}</Text>

        {item.horaLimite && (
          <Text style={{ color: '#f59e0b', fontSize: 12, marginTop: 4 }}>
            ⏰ Límite: {new Date(item.horaLimite).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        )}

        {siguienteEstado && (
          <TouchableOpacity onPress={() => confirmarAccion(item, siguienteEstado)}
            style={{ backgroundColor: COLOR.azul, borderRadius: 10, padding: 12, alignItems: 'center', marginTop: 12 }}>
            <Text style={{ color: '#000', fontWeight: 'bold', fontSize: 14 }}>
              {siguienteEstado === 'ASIGNADO' ? '📌 Tomar pedido' :
               siguienteEstado === 'EN_RUTA' ? '🏍️ Ir al recojo' :
               siguienteEstado === 'EN_RECOJO' ? '📍 Llegué al punto' :
               siguienteEstado === 'RECOGIDO' ? '📦 Recogí muestra' :
               siguienteEstado === 'ENTREGADO' ? '✅ Entregar' :
               siguienteEstado === 'FALLIDO' ? '⚠️ Marcar fallido' :
               `➡️ ${siguienteEstado.replace(/_/g, ' ')}`}
            </Text>
          </TouchableOpacity>
        )}

        {item.notas && <Text style={{ color: COLOR.gris, fontSize: 11, marginTop: 6, fontStyle: 'italic' }}>📝 {item.notas}</Text>}
      </TouchableOpacity>
    );
  };

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: COLOR.fondo, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color={COLOR.azul} />
      </View>
    );
  }

  const pendientes = tickets.filter(t => t.estado === 'PENDIENTE');
  const activos = tickets.filter(t => !['ENTREGADO', 'CERRADO', 'CANCELADO', 'PENDIENTE'].includes(t.estado));
  const completados = tickets.filter(t => ['ENTREGADO', 'CERRADO'].includes(t.estado));

  return (
    <View style={{ flex: 1, backgroundColor: COLOR.fondo }}>
      {/* Header */}
      <View style={{ backgroundColor: '#111', paddingTop: 50, paddingBottom: 16, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#222' }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <View>
            <Text style={{ color: COLOR.texto, fontSize: 14 }}>👋 Hola, {user?.nombre || 'Motorizado'}</Text>
            <Text style={{ color: COLOR.azul, fontSize: 12 }}>📍 GPS: {turnoActivo ? 'ACTIVO' : 'INACTIVO'}</Text>
          </View>
          <TouchableOpacity onPress={handleLogout} style={{ backgroundColor: '#222', borderRadius: 8, padding: 8 }}>
            <Text style={{ color: COLOR.rojo, fontSize: 12 }}>🔒 Salir</Text>
          </TouchableOpacity>
        </View>

        {/* Turno button */}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          {!turnoActivo ? (
            <TouchableOpacity onPress={iniciarTurno} disabled={turnoLoading}
              style={{ flex: 1, backgroundColor: COLOR.verde, borderRadius: 12, padding: 14, alignItems: 'center', opacity: turnoLoading ? 0.7 : 1 }}>
              {turnoLoading ? <ActivityIndicator color="#000" /> : <Text style={{ color: '#000', fontWeight: 'bold' }}>▶️ Iniciar turno</Text>}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={finalizarTurno}
              style={{ flex: 1, backgroundColor: COLOR.rojo, borderRadius: 12, padding: 14, alignItems: 'center' }}>
              <Text style={{ color: '#fff', fontWeight: 'bold' }}>⏹️ Fin turno</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Stats */}
      <View style={{ flexDirection: 'row', padding: 12, gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, alignItems: 'center' }}>
          <Text style={{ color: COLOR.naranja, fontSize: 22, fontWeight: 'bold' }}>{pendientes.length}</Text>
          <Text style={{ color: COLOR.texto2, fontSize: 11 }}>Pendientes</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, alignItems: 'center' }}>
          <Text style={{ color: COLOR.azul, fontSize: 22, fontWeight: 'bold' }}>{activos.length}</Text>
          <Text style={{ color: COLOR.texto2, fontSize: 11 }}>Activos</Text>
        </View>
        <View style={{ flex: 1, backgroundColor: '#1a1a1a', borderRadius: 12, padding: 12, alignItems: 'center' }}>
          <Text style={{ color: COLOR.verde, fontSize: 22, fontWeight: 'bold' }}>{completados.length}</Text>
          <Text style={{ color: COLOR.texto2, fontSize: 11 }}>Hoy</Text>
        </View>
      </View>

      {/* Tickets list */}
      <FlatList
        data={tickets}
        keyExtractor={(item) => item.id}
        renderItem={renderTicket}
        contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await cargarTickets(); setRefreshing(false); }} tintColor={COLOR.azul} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingTop: 60 }}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>🏍️</Text>
            <Text style={{ color: COLOR.texto2, fontSize: 16 }}>No hay tickets disponibles</Text>
            <Text style={{ color: COLOR.gris, fontSize: 13, marginTop: 4 }}>Espera nuevos pedidos...</Text>
          </View>
        }
      />

      {/* Modal de confirmación */}
      <Modal transparent visible={modalVisible} animationType="fade" onRequestClose={() => setModalVisible(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#1a1a1a', borderRadius: 20, padding: 24 }}>
            <Text style={{ color: COLOR.texto, fontSize: 18, fontWeight: 'bold', marginBottom: 8 }}>Confirmar acción</Text>
            <Text style={{ color: COLOR.texto2, fontSize: 14, marginBottom: 4 }}>Ticket: {ticketAccion?.referencia?.nombre}</Text>
            <Text style={{ color: coloresEstado[estadoDestino || ''], fontSize: 14, fontWeight: 'bold', marginBottom: 20 }}>
              {estadoDestino?.replace(/_/g, ' ')}
            </Text>

            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity onPress={() => setModalVisible(false)}
                style={{ flex: 1, backgroundColor: '#222', borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ color: COLOR.texto2 }}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => ticketAccion && estadoDestino && avanzarEstado(ticketAccion, estadoDestino)}
                style={{ flex: 1, backgroundColor: COLOR.azul, borderRadius: 12, padding: 14, alignItems: 'center' }}>
                <Text style={{ color: '#000', fontWeight: 'bold' }}>✅ Confirmar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
