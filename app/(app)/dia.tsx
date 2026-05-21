import { useState, useEffect, useCallback, useMemo } from 'react';
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

// ═══════════════════════════════════════════════════════════════
// Colores por defecto (fallback si no carga config del VPS)
// Se sobreescriben al cargar GET /motorizados/config
// ═══════════════════════════════════════════════════════════════

function makeStyles(C: any) {
  return StyleSheet.create({
    root: { flex:1, backgroundColor: C.grayLight || '#F5F6F8' },
    header: { backgroundColor: C.white || '#fff', padding:16, borderBottomWidth:1, borderBottomColor: C.grayBorder || '#E8E8E8' },
    mlogo: { flexDirection:'row', alignItems:'center', gap:7, marginBottom:10 },
    mlogoIc: { width:28, height:28, borderRadius:8, alignItems:'center', justifyContent:'center' },
    mlogoTxt: { fontSize:14, fontWeight:'800' },
    title: { fontSize:22, fontWeight:'800', color: C.text || '#1a1a2e' },
    sub: { fontSize:11, color: C.gray || '#8C8C8C', marginTop:2 },
    scroll: { padding:14, gap:12, paddingBottom:40 },
    card: { backgroundColor: C.white || '#fff', borderRadius:14, padding:16, shadowColor:'#000', shadowOpacity:0.04, shadowRadius:4, elevation:2 },
    cardTitle: { fontSize:10, fontWeight:'700', color: C.gray || '#8C8C8C', textTransform:'uppercase', letterSpacing:0.8, marginBottom:14 },
    ringWrap: { flexDirection:'row', alignItems:'center', gap:16, marginBottom:14 },
    ringOuter: { width:80, height:80, borderRadius:40, alignItems:'center', justifyContent:'center', position:'relative' },
    ringInner: { width:80, height:80, borderRadius:40, borderWidth:7, alignItems:'center', justifyContent:'center' },
    ringFill: { position:'absolute', width:80, height:80, borderRadius:40, borderWidth:7, borderTopColor:'transparent', borderRightColor:'transparent' },
    ringCenter: { position:'absolute', alignItems:'center' },
    ringPct: { fontSize:16, fontWeight:'800' },
    ringLbl: { fontSize:7, color: C.gray || '#8C8C8C', fontWeight:'600', textTransform:'uppercase' },
    ringStats: { flex:1, gap:8 },
    prow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center' },
    plbl: { fontSize:11, color: C.text2 || '#6b7280' },
    pval: { fontSize:14, fontWeight:'700', color: C.text || '#1a1a2e' },
    barWrap: { marginTop:4 },
    barLblRow: { flexDirection:'row', justifyContent:'space-between', marginBottom:5 },
    barLbl: { fontSize:9, color: C.gray || '#8C8C8C' },
    barTrack: { height:6, backgroundColor: C.grayLight || '#F5F6F8', borderRadius:3, overflow:'hidden' },
    barFill: { height:'100%', borderRadius:3 },
    infoCard: { backgroundColor: C.white || '#fff', borderRadius:14, overflow:'hidden', shadowColor:'#000', shadowOpacity:0.04, shadowRadius:4, elevation:2 },
    infoTitle: { padding:12, paddingBottom:8, fontSize:9, fontWeight:'700', color: C.gray || '#8C8C8C', textTransform:'uppercase', letterSpacing:0.8, borderBottomWidth:1, borderBottomColor: C.grayLight || '#F5F6F8' },
    irow: { flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:11, paddingHorizontal:14, borderBottomWidth:1, borderBottomColor: C.grayLight || '#F5F6F8' },
    ilbl: { fontSize:12, color: C.text2 || '#6b7280' },
    ival: { fontSize:12, fontWeight:'700', color: C.text || '#1a1a2e', textAlign:'right', maxWidth:'55%' },
    logoutBtn: { backgroundColor: C.redLight || '#FEF0EF', borderWidth:1.5, borderColor:'#fecdc9', borderRadius:14, padding:16, alignItems:'center' },
    logoutTxt: { fontSize:13, fontWeight:'800', color: C.red || '#E74C3C' },
    ver: { textAlign:'center', fontSize:10, color: C.grayLight2 || '#ccc', lineHeight:16 },
  });
}

export default function DiaScreen() {
  const user = useAuthStore((s) => s.user);
  const clearUser = useAuthStore((s) => s.clearUser);
  const [motoData, setMotoData] = useState<any>(null);
  const [tickets, setTickets] = useState<any[]>([]);
  const [C, setC] = useState<any>({
    blue:'#4BBFE0', gray:'#8C8C8C', green:'#2ECC71', orange:'#F39C12', red:'#E74C3C', white:'#FFFFFF',
    text:'#1a1a2e', text2:'#6b7280', grayLight:'#F5F6F8', blueDark:'#2fa8cc', blueLight:'#EBF7FC',
    grayBorder:'#E8E8E8', greenLight:'#EAFAF1', orangeLight:'#FEF9EC', redLight:'#FEF0EF',
  });
  const [dash, setDash] = useState<any>(null);

  const d = useMemo(() => makeStyles(C), [C]);

  // Cargar config visual del VPS
  useEffect(() => {
    api.get('/motorizados/config')
      .then(r => {
        const cfg = r.data;
        if (cfg?.dashboard?.colors) {
          setC(prev => ({ ...prev, ...cfg.dashboard.colors }));
        }
        if (cfg?.dashboard) {
          setDash(cfg.dashboard);
        }
      })
      .catch(() => { /* usa fallback */ });
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
  const circumference = 182;
  const offset = circumference - (circumference * pct / 100);
  const ringColor = pct === 100 ? (dash?.progresoColor100 || C.green) : (dash?.progresoColor || C.blue);

  const fecha = new Date().toLocaleDateString('es-PE', { weekday:'long', day:'numeric', month:'long' });
  const fechaFmt = fecha.charAt(0).toUpperCase() + fecha.slice(1);

  const completadoColor = dash?.completadoColor || C.green;
  const pendienteColor = dash?.pendienteColor || C.orange;

  const logout = () => {
    Alert.alert('Cerrar sesión', '¿Seguro que quieres cerrar sesión?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Cerrar sesión', style: 'destructive', onPress: async () => {
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
          <View style={[d.mlogoIc, { backgroundColor: C.blue }]}><Text style={{ fontSize: 14 }}>🔬</Text></View>
          <Text style={d.mlogoTxt}>
            <Text style={{ color: C.gray }}>SG</Text>
            <Text style={{ color: C.blue }}>Lab's</Text>
          </Text>
        </View>
        <Text style={d.title}>Mi día</Text>
        <Text style={d.sub}>{fechaFmt}</Text>
      </View>

      <ScrollView contentContainerStyle={d.scroll} showsVerticalScrollIndicator={false}>

        {/* Card progreso */}
        <View style={d.card}>
          <Text style={d.cardTitle}>{dash?.progresoTitle || '📈 Progreso del turno'}</Text>

          <View style={d.ringWrap}>
            {/* Anillo SVG simulado con View */}
            <View style={d.ringOuter}>
              <View style={[d.ringInner, { borderColor: C.grayLight }]}>
                <View style={[d.ringFill, {
                  borderColor: ringColor,
                  transform: [{ rotate: `${(pct / 100) * 360}deg` }],
                }]} />
                <View style={d.ringCenter}>
                  <Text style={[d.ringPct, { color: ringColor }]}>{pct}%</Text>
                  <Text style={d.ringLbl}>{dash?.hechoLabel || "hecho"}</Text>
                </View>
              </View>
            </View>

            <View style={d.ringStats}>
              <View style={d.prow}>
                <Text style={d.plbl}>{dash?.totalLabel || 'Total tickets'}</Text>
                <Text style={d.pval}>{total}</Text>
              </View>
              <View style={d.prow}>
                <Text style={[d.plbl, { color: completadoColor }]}>{dash?.completadosLabel || '✅ Completados'}</Text>
                <Text style={[d.pval, { color: completadoColor }]}>{done}</Text>
              </View>
              <View style={d.prow}>
                <Text style={[d.plbl, { color: pendienteColor }]}>{dash?.pendientesLabel || '⏳ Pendientes'}</Text>
                <Text style={[d.pval, { color: pendienteColor }]}>{pending}</Text>
              </View>
            </View>
          </View>

          {/* Barra progreso */}
          <View style={d.barWrap}>
            <View style={d.barLblRow}>
              <Text style={d.barLbl}>{dash?.avanceLabel || "Avance"}</Text>
              <Text style={d.barLbl}>{done} de {total} completados</Text>
            </View>
            <View style={d.barTrack}>
              <View style={[d.barFill, { width: `${pct}%` as any, backgroundColor: ringColor }]} />
            </View>
          </View>
        </View>

        {/* Datos del motorizado */}
        <View style={d.infoCard}>
          <Text style={d.infoTitle}>Mis datos</Text>
          <View style={d.irow}>
            <Text style={d.ilbl}>👤 Nombre</Text>
            <Text style={d.ival}>{user?.nombre ?? '—'}</Text>
          </View>
          <View style={d.irow}>
            <Text style={d.ilbl}>🏍️ Moto</Text>
            <Text style={d.ival}>{motoData?.vehiculo ?? motoData?.moto ?? 'Sin registrar'}</Text>
          </View>
          <View style={d.irow}>
            <Text style={d.ilbl}>📧 Correo</Text>
            <Text style={[d.ival, { fontSize: 10 }]}>{user?.email ?? '—'}</Text>
          </View>
          <View style={d.irow}>
            <Text style={d.ilbl}>🏥 Laboratorio</Text>
            <Text style={[d.ival, { color: C.blue, fontWeight: '800' }]}>{dash?.appName || "SG Lab's"}</Text>
          </View>
          <View style={[d.irow, { borderBottomWidth: 0 }]}>
            <Text style={d.ilbl}>🕐 Turno</Text>
            <Text style={d.ival}>{dash?.turnoHoras || "08:00 – 17:00"}</Text>
          </View>
        </View>

        {/* Cerrar sesión */}
        <TouchableOpacity style={d.logoutBtn} onPress={logout} activeOpacity={0.85}>
          <Text style={d.logoutTxt}>{dash?.logoutLabel || "🚪 Cerrar sesión / Fin de turno"}</Text>
        </TouchableOpacity>

        <Text style={d.ver}>{dash?.appVersion || "SG Lab's Moto v1.0.0"}{'\n'}{dash?.footerText || "Desarrollado por Raúl Salazar"}</Text>

      </ScrollView>
    </SafeAreaView>
  );
}
