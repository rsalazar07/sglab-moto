import { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router, useSegments } from 'expo-router';
import { useAuthStore } from '../src/store/authStore';
import { authApi } from '../src/api/auth';
import { api } from '../src/api/client';

const COLORS_DARK = {
  bg: '#0a0a0a', title: '#fff', subtitle: '#aaa',
  inputBg: '#1a1a1a', inputBorder: '#444', inputPlaceholder: '#999',
  btnColor: '#00d4ff', btnText: '#fff', error: '#E74C3C',
};

export default function LoginScreen() {
  const setUser = useAuthStore((s) => s.setUser);
  const [email, setEmail] = useState('');
  const [pass, setPass] = useState('');
  const [loading, setLoading] = useState(false);
  const [colors, setColors] = useState(COLORS_DARK);
  const [loginText, setLoginText] = useState({ title: 'SGLab Moto', subtitle: 'Plataforma de recolección de muestras', btn: 'Ingresar', errorMsg: 'Credenciales inválidas' });

  // Cargar config visual del VPS (SDUI)
  useEffect(() => {
    api.get('/motorizados/config')
      .then(r => {
        const dash = r.data?.dashboard;
        if (dash) {
          setColors({
            bg: dash.loginBg || COLORS_DARK.bg,
            title: dash.loginTitleColor || COLORS_DARK.title,
            subtitle: dash.loginSubtitleColor || COLORS_DARK.subtitle,
            inputBg: dash.loginInputBg || COLORS_DARK.inputBg,
            inputBorder: dash.loginInputBorder || COLORS_DARK.inputBorder,
            inputPlaceholder: dash.loginInputPlaceholder || COLORS_DARK.inputPlaceholder,
            btnColor: dash.loginBtnColor || COLORS_DARK.btnColor,
            btnText: dash.loginBtnTextColor || COLORS_DARK.btnText,
            error: '#E74C3C',
          });
          setLoginText({
            title: dash.loginTitle || 'SGLab Moto',
            subtitle: dash.loginSubtitle || 'Plataforma de recolección de muestras',
            btn: dash.loginBtnText || 'Ingresar',
            errorMsg: dash.loginErrorMsg || 'Credenciales inválidas',
          });
        }
      })
      .catch(() => {});
  }, []);

  const login = async () => {
    if (!email.trim() || !pass.trim()) {
      return Alert.alert('Error', 'Ingresa tu correo y contraseña');
    }
    setLoading(true);
    try {
      const res = await authApi.login(email.trim(), pass);
      setUser(res.user, res.token);
      router.replace('/(app)/tickets');
    } catch (e: any) {
      const msg = e.response?.data?.message || loginText.errorMsg;
      Alert.alert('Error', Array.isArray(msg) ? msg[0] : msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={{ flex:1, backgroundColor: colors.bg, justifyContent:'center', padding:28 }}>
      <View style={{ alignItems:'center', marginBottom:32 }}>
        <Text style={{ fontSize:44, marginBottom:12 }}>🏍️</Text>
        <Text style={{ fontSize:22, fontWeight:'800', color: colors.title, marginBottom:4 }}>{loginText.title}</Text>
        <Text style={{ fontSize:13, color: colors.subtitle }}>{loginText.subtitle}</Text>
      </View>

      <TextInput
        style={{
          backgroundColor: colors.inputBg, borderWidth:1.5, borderColor: colors.inputBorder,
          borderRadius:10, padding:16, fontSize:15, color: colors.title, marginBottom:12,
        }}
        value={email}
        onChangeText={setEmail}
        placeholder="Correo electrónico"
        placeholderTextColor={colors.inputPlaceholder}
        autoCapitalize="none"
        keyboardType="email-address"
        autoCorrect={false}
      />
      <TextInput
        style={{
          backgroundColor: colors.inputBg, borderWidth:1.5, borderColor: colors.inputBorder,
          borderRadius:10, padding:16, fontSize:15, color: colors.title, marginBottom:20,
        }}
        value={pass}
        onChangeText={setPass}
        placeholder="Contraseña"
        placeholderTextColor={colors.inputPlaceholder}
        secureTextEntry
      />

      <TouchableOpacity
        style={{
          backgroundColor: colors.btnColor, borderRadius:12, padding:16, alignItems:'center',
          opacity: loading ? 0.6 : 1, minHeight: 52, justifyContent:'center',
        }}
        onPress={login}
        disabled={loading}
        activeOpacity={0.85}
      >
        {loading ? (
          <ActivityIndicator color={colors.btnText} />
        ) : (
          <Text style={{ fontSize:16, fontWeight:'800', color: colors.btnText }}>{loginText.btn}</Text>
        )}
      </TouchableOpacity>
    </SafeAreaView>
  );
}
