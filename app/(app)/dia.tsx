import { useState, useEffect, useCallback } from 'react';
import { View, Text, FlatList, RefreshControl, ActivityIndicator } from 'react-native';
import { ticketsApi } from '../../src/api/tickets';
import type { Ticket } from '../../src/types';

const COLOR = { verde: '#22c55e', azul: '#00d4ff', naranja: '#f59e0b', rojo: '#ef4444', gris: '#555', fondo: '#0a0a0a', card: '#1a1a1a', texto: '#fff', texto2: '#aaa' };

const coloresEstado: Record<string, string> = {
  PENDIENTE: '#f59e0b', ASIGNADO: '#3b82f6', EN_RUTA: '#8b5cf6', EN_RECOJO: '#f97316',
  RECOGIDO: '#22c55e', ENTREGADO: '#22c55e', CERRADO: '#6b7280', CANCELADO: '#ef4444', FALLIDO: '#ef4444',
};

export default function DiaScreen() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const cargar = useCallback(async () => {
    try {
      const data = await ticketsApi.getMisTickets();
      setTickets(Array.isArray(data) ? data : []);
    } catch {}
  }, []);

  useEffect(() => {
    cargar().finally(() => setLoading(false));
  }, []);

  const pendientes = tickets.filter(t => t.estado === 'PENDIENTE').length;
  const enProgreso = tickets.filter(t => !['ENTREGADO', 'CERRADO', 'CANCELADO', 'PENDIENTE'].includes(t.estado)).length;
  const completados = tickets.filter(t => ['ENTREGADO', 'CERRADO'].includes(t.estado)).length;
  const total = tickets.length;
  const eficiencia = total > 0 ? Math.round((completados / total) * 100) : 0;

  const hoy = new Date().toLocaleDateString('es-PE', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <View style={{ flex: 1, backgroundColor: COLOR.fondo }}>
      {/* Header */}
      <View style={{ backgroundColor: '#111', paddingTop: 50, paddingBottom: 16, paddingHorizontal: 16 }}>
        <Text style={{ color: COLOR.texto, fontSize: 20, fontWeight: 'bold' }}>📊 Mi día</Text>
        <Text style={{ color: COLOR.texto2, fontSize: 13, marginTop: 4, textTransform: 'capitalize' }}>{hoy}</Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={COLOR.azul} />
        </View>
      ) : (
        <>
          {/* Stats */}
          <View style={{ flexDirection: 'row', padding: 12, gap: 8, flexWrap: 'wrap' }}>
            <View style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16 }}>
              <Text style={{ color: COLOR.azul, fontSize: 32, fontWeight: 'bold' }}>{total}</Text>
              <Text style={{ color: COLOR.texto2, fontSize: 12 }}>Total Tickets</Text>
            </View>
            <View style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16 }}>
              <Text style={{ color: COLOR.verde, fontSize: 32, fontWeight: 'bold' }}>{completados}</Text>
              <Text style={{ color: COLOR.texto2, fontSize: 12 }}>Completados</Text>
            </View>
            <View style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16 }}>
              <Text style={{ color: COLOR.naranja, fontSize: 32, fontWeight: 'bold' }}>{pendientes}</Text>
              <Text style={{ color: COLOR.texto2, fontSize: 12 }}>Pendientes</Text>
            </View>
            <View style={{ flex: 1, minWidth: '45%', backgroundColor: '#1a1a1a', borderRadius: 16, padding: 16 }}>
              <Text style={{ color: '#8b5cf6', fontSize: 32, fontWeight: 'bold' }}>{enProgreso}</Text>
              <Text style={{ color: COLOR.texto2, fontSize: 12 }}>En progreso</Text>
            </View>
          </View>

          {/* Eficiencia */}
          <View style={{ margin: 12, backgroundColor: '#1a1a1a', borderRadius: 16, padding: 20 }}>
            <Text style={{ color: COLOR.texto, fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>Rendimiento</Text>
            <View style={{ height: 8, backgroundColor: '#333', borderRadius: 4, overflow: 'hidden' }}>
              <View style={{ width: `${eficiencia}%`, height: '100%', backgroundColor: COLOR.azul, borderRadius: 4 }} />
            </View>
            <Text style={{ color: COLOR.texto2, fontSize: 12, marginTop: 8 }}>{eficiencia}% completado</Text>
          </View>

          {/* Tickets del día */}
          <FlatList
            data={tickets}
            keyExtractor={(item) => item.id}
            contentContainerStyle={{ padding: 12, paddingBottom: 100 }}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={async () => { setRefreshing(true); await cargar(); setRefreshing(false); }} tintColor={COLOR.azul} />}
            ListHeaderComponent={<Text style={{ color: COLOR.texto, fontSize: 16, fontWeight: 'bold', marginBottom: 12 }}>Actividad del día</Text>}
            renderItem={({ item }) => (
              <View style={{ backgroundColor: COLOR.card, borderRadius: 12, padding: 14, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: coloresEstado[item.estado] || COLOR.gris }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Text style={{ color: COLOR.texto, fontWeight: 'bold', fontSize: 14, flex: 1 }}>{item.referencia?.nombre || '?'}</Text>
                  <Text style={{ color: coloresEstado[item.estado], fontSize: 11, fontWeight: 'bold' }}>{item.estado.replace(/_/g, ' ')}</Text>
                </View>
                <Text style={{ color: COLOR.texto2, fontSize: 12, marginTop: 4 }}>{item.referencia?.direccion || ''}</Text>
                <Text style={{ color: COLOR.gris, fontSize: 11, marginTop: 4 }}>
                  🕐 {new Date(item.createdAt).toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            )}
            ListEmptyComponent={
              <View style={{ alignItems: 'center', paddingTop: 40 }}>
                <Text style={{ fontSize: 48 }}>📭</Text>
                <Text style={{ color: COLOR.texto2, fontSize: 16, marginTop: 12 }}>Sin actividad hoy</Text>
              </View>
            }
          />
        </>
      )}
    </View>
  );
}
