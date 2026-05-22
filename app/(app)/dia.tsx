import { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Alert, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { useAuthStore } from '../../src/store/authStore';
import { authApi } from '../../src/api/auth';
import { ticketsApi } from '../../src/api/tickets';
import { api } from '../../src/api/client';
import { disconnectSocket } from '../../src/socket/socket';
import { deactivateKeepAwake } from 'expo-keep-awake';
import { send as log } from '../../src/lib/LogReporter';

// Colores por defecto (fallback si no carga config del VPS)
const FALLBACK = {
  blue:'#3498DB', gray:'#7F8C8D', green:'#27AE60', orange:'#E67E22', red:'#E74C3C', white:'#FFFFFF',
  text:'#1a1a2e', text2:'#7F8C8D', grayLight:'#F2F3F4', blueDark:'#2980B9', blueLight:'#EBF5FB',
  grayBorder:'#D5D8DC', greenLight:'#E8F8F0', orangeLight:'#FDF2E9', redLight:'#FDEDEC',
};

export default function DiaScreen() {
  const user = useAuthStore((s) => s.user);
  const clearUser = useAuthStore((s) => s.clearUser);
  const [motoData, setMotoData] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [C, setC] = useState(FALLBACK);
  const [dash, setDash] = useState<any>(null);
  const [designTokens, setDesignTokens] = useState<any>(null);
  const [uiLabels, setUiLabels] = useState<any>({});

  // Cargar config visual del VPS (SDUI)
  useEffect(() => {
    api.get('/motorizados/config')
      .then(r => {
        const cfg = r.data;
        const colors = cfg?.dashboard?.colors;
        if (colors) setC({ ...FALLBACK, ...colors });
        if (cfg?.dashboard) setDash(cfg.dashboard);
        if (cfg?.designTokens) setDesignTokens(cfg.designTokens);
        if (cfg?.uiLabels) setUiLabels(cfg.uiLabels);
      })
      .catch(() => {});
  }, []);

  const cargar = useCallback(async () => {
    try {
      const [moto, tks] = await Promise.all([
        api.get('/motorizados/me').then(r => r.data),
        ticketsApi.getMisTickets(),
      ]);
      setMotoData(moto);
      setTickets(tks);
    } catch (e) {
      log('ERROR', 'dia', `cargar inicial: ${e instanceof Error ? e.message : String(e)}`);
    }
  }, []);

  useEffect(() => { cargar(); }, []);

  const total = tickets.length;
  const done = tickets.filter(t => ['RECOGIDO','ENTREGADO','CERRADO'].includes(t.estado)).length;
  const pending = total - done;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const ringColor = pct === 100 ? (dash?.progresoColor100 || C.green) : (dash?.progresoColor || C.blue);

  const fecha = new Date().toLocaleDateString('es-PE', { weekday:'long', day:'numeric', month:'long' });
  const fechaFmt = fecha.charAt(0).toUpperCase() + fecha.slice(1);

  const completadoColor = dash?.completadoColor || C.green;
  const pendienteColor = dash?.pendienteColor || C.orange;
  const fs = designTokens?.fontSizes || {};

  const logout = () => {
    Alert.alert('Cerrar sesión', '¿Seguro que quieres cerrar sesión?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Salir', style: 'destructive', onPress: async () => {
        deactivateKeepAwake();
        disconnectSocket();
        try { await api.patch('/motorizados/me/estado', { estado: 'OFFLINE' }); } catch (e) { log('WARN', 'dia', 'Error estado OFFLOAD: ' + String(e)); }
        await authApi.logout();
        clearUser();
        router.replace('/login');
      }},
    ]);
  };

  return (
    <SafeAreaView style={d.root} edges={['top']}>

      {/* Header con mini logo */}
      <View style={d.header}>
        <View style={d.mlogo}>
          <View style={[d.mlogoIc, { backgroundColor: C.blue }]}><Text style={{ fontSize: fs.title || 16 }}>🔬</Text></View>
          <Text style={[d.mlogoTxt, { fontSize: fs.body || 14 }]}>
            <Text style={{ color: C.gray }}>{dash?.appName?.split(' ')[0] || 'SGLab'}</Text>
            <Text style={{ color: C.blue }}> {dash?.appName?.split(' ').slice(1).join(' ') || 'Moto'}</Text>
          </Text>
        </View>
        <Text style={[d.title, { fontSize: fs.title || 22 }]}>Mi día</Text>
        <Text style={[d.sub, { fontSize: fs.caption || 11 }]}>{fechaFmt}</Text>
      </View>

      <ScrollView contentContainerStyle={d.scroll} showsVerticalScrollIndicator={false}>

        {/* Card progreso */}
        <View style={d.card}>
          <Text style={[d.cardTitle, { fontSize: fs.micro || 10 }]}>{dash?.progresoTitle || '📈 Avance del día'}</Text>

          <View style={d.ringWrap}>
            <View style={d.ringOuter}>
              <View style={[d.ringInner, { borderColor: C.grayLight }]}>
                <View style={[d.ringFill, {
                  borderColor: ringColor,
                  transform: [{ rotate: `${(pct / 100) * 360}deg` }],
                }]} />
                <View style={d.ringCenter}>
                  <Text style={[d.ringPct, { color: ringColor, fontSize: fs.body || 16 }]}>{pct}%</Text>
                  <Text style={[d.ringLbl, { fontSize: fs.micro || 7 }]}>{uiLabels.hechoLabel || dash?.hechoLabel || 'listo'}</Text>
                </View>
              </View>
            </View>

            <View style={d.ringStats}>
              <View style={d.prow}>
                <Text style={[d.plbl, { fontSize: fs.caption || 11 }]}>{dash?.totalLabel || 'Total tickets'}</Text>
                <Text style={[d.pval, { fontSize: fs.body || 14 }]}>{total}</Text>
              </View>
              <View style={d.prow}>
                <Text style={[d.plbl, { color: completadoColor, fontSize: fs.caption || 11 }]}>{dash?.completadosLabel || '✅ Completados'}</Text>
                <Text style={[d.pval, { color: completadoColor, fontSize: fs.body || 14 }]}>{done}</Text>
              </View>
              <View style={d.prow}>
                <Text style={[d.plbl, { color: pendienteColor, fontSize: fs.caption || 11 }]}>{dash?.pendientesLabel || '⏳ Pendientes'}</Text>
                <Text style={[d.pval, { color: pendienteColor, fontSize: fs.body || 14 }]}>{pending}</Text>
              </View>
            </View>
          </View>

          {/* Barra progreso */}
          <View style={d.barWrap}>
            <View style={d.barLblRow}>
              <Text style={[d.barLbl, { fontSize: fs.micro || 9 }]}>{uiLabels.avanceLabel || dash?.avanceLabel || 'Avance'}</Text>
              <Text style={[d.barLbl, { fontSize: fs.micro || 9 }]}>{done} de {total} completados</Text>
            </View>
            <View style={d.barTrack}>
              <View style={[d.barFill, { width: `${pct}%` as any, backgroundColor: ringColor }]} />
            </View>
          </View>
        </View>

        {/* Datos del motorizado */}
        <View style={d.infoCard}>
          <Text style={[d.infoTitle, { fontSize: fs.micro || 9 }]}>Mis datos</Text>
          <View style={d.irow}>
            <Text style={[d.ilbl, { fontSize: fs.caption || 12 }]}>👤 Nombre</Text>
            <Text style={[d.ival, { fontSize: fs.caption || 12 }]}>{user?.nombre ?? '—'}</Text>
          </View>
          <View style={d.irow}>
            <Text style={[d.ilbl, { fontSize: fs.caption || 12 }]}>🏍️ Moto</Text>
            <Text style={[d.ival, { fontSize: fs.caption || 12 }]}>{motoData?.vehiculo ?? motoData?.moto ?? 'Sin registrar'}</Text>
          </View>
          <View style={d.irow}>
            <Text style={[d.ilbl, { fontSize: fs.caption || 12 }]}>📧 Correo</Text>
            <Text style={[d.ival, { fontSize: fs.small || 10 }]}>{user?.email ?? '—'}</Text>
          </View>
          <View style={d.irow}>
            <Text style={[d.ilbl, { fontSize: fs.caption || 12 }]}>🏥 Laboratorio</Text>
            <Text style={[d.ival, { color: C.blue, fontWeight: '800', fontSize: fs.caption || 12 }]}>{dash?.appName || "SGLab Moto"}</Text>
          </View>
          <View style={[d.irow, { borderBottomWidth: 0 }]}>
            <Text style={[d.ilbl, { fontSize: fs.caption || 12 }]}>🕐 Turno</Text>
            <Text style={[d.ival, { fontSize: fs.caption || 12 }]}>{dash?.turnoHoras || '08:00 – 17:00'}</Text>
          </View>
        </View>

        {/* Cerrar sesión */}
        <TouchableOpacity style={d.logoutBtn} onPress={logout} activeOpacity={0.85}>
          <Text style={[d.logoutTxt, { fontSize: fs.body || 13 }]}>{uiLabels.logoutLabel || dash?.logoutLabel || '🚪 Cerrar sesión'}</Text>
        </TouchableOpacity>

        {/* Footer solo con versión si tiene texto */}
        {dash?.appVersion ? (
          <Text style={[d.ver, { fontSize: fs.micro || 9 }]}>{dash?.appName || 'SGLab Moto'} v{dash?.appVersion || '1.0.0'}</Text>
        ) : null}

      </ScrollView>
    </SafeAreaView>
  );
}

const d = StyleSheet.create({
  root: { flex:1, backgroundColor:'#F2F3F4' },
  header: { backgroundColor:'#fff', padding:16, borderBottomWidth:1, borderBottomColor:'#D5D8DC' },
  mlogo: { flexDirection:'row', alignItems:'center', gap:7, marginBottom:10 },
  mlogoIc: { width:28, height:28, borderRadius:8, alignItems:'center', justifyContent:'center' },
  mlogoTxt: { fontWeight:'800' },
  title: { fontWeight:'800', color:'#1a1a2e' },
  sub: { color:'#7F8C8D', marginTop:2 },
  scroll: { padding:14, gap:12, paddingBottom:40 },
  card: { backgroundColor:'#fff', borderRadius:14, padding:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:4, elevation:2 },
  cardTitle: { fontWeight:'700', color:'#7F8C8D', textTransform:'uppercase', letterSpacing:0.8, marginBottom:14 },
  ringWrap: { flexDirection:'row', alignItems:'center', gap:16, marginBottom:14 },
  ringOuter: { width:80, height:80, borderRadius:40, alignItems:'center', justifyContent:'center', position:'relative' },
  ringInner: { width:80, height:80, borderRadius:40, borderWidth:7, alignItems:'center', justifyContent:'center' },
  ringFill: { position:'absolute', width:80, height:80, borderRadius:40, borderWidth:7, borderTopColor:'transparent', borderRightColor:'transparent' },
  ringCenter: { position:'absolute', alignItems:'center' },
  ringPct: { fontWeight:'800' },
  ringLbl: { color:'#7F8C8D', fontWeight:'600', textTransform:'uppercase' },
  ringStats: { flex:1, gap:8 },
  prow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
  plbl: { color:'#7F8C8D' },
  pval: { fontWeight:'700', color:'#1a1a2e' },
  barWrap: { marginTop:4 },
  barLblRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:5 },
  barLbl: { color:'#7F8C8D' },
  barTrack: { height:6, backgroundColor:'#F2F3F4', borderRadius:3, overflow:'hidden' },
  barFill: { height:'100%', borderRadius:3 },
  infoCard: { backgroundColor:'#fff', borderRadius:14, overflow:'hidden', shadowColor:'#000', shadowOpacity:0.04, shadowRadius:4, elevation:2 },
  infoTitle: { padding:12, paddingBottom:8, fontWeight:'700', color:'#7F8C8D', textTransform:'uppercase', letterSpacing:0.8, borderBottomWidth:1, borderBottomColor:'#F2F3F4' },
  irow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:11, paddingHorizontal:14, borderBottomWidth:1, borderBottomColor:'#F2F3F4' },
  ilbl: { color:'#7F8C8D' },
  ival: { fontWeight:'700', color:'#1a1a2e', textAlign:'right', maxWidth:'55%' },
  logoutBtn: { backgroundColor:'#FDEDEC', borderWidth:1.5, borderColor:'#fecdc9', borderRadius:14, padding:16, alignItems:'center' },
  logoutTxt: { fontWeight:'800', color:'#E74C3C' },
  ver: { textAlign:'center', color:'#BDC3C7', lineHeight:16 },
});
