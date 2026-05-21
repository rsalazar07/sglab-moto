import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert, ActivityIndicator, KeyboardAvoidingView, Platform } from 'react-native';
import { router } from 'expo-router';
import { authApi } from '../src/api/auth';
import { useAuthStore } from '../src/store/authStore';

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { setUser } = useAuthStore();

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      Alert.alert('Error', 'Ingresa tu correo y contraseña');
      return;
    }
    setLoading(true);
    try {
      const res = await authApi.login(email.trim(), password);
      setUser(res.user);
      router.replace('/(app)/tickets');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.message || 'Credenciales inválidas');
    } finally {
      setLoading(false);
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: '#0a0a0a', justifyContent: 'center', padding: 24 }}>
      <View style={{ marginBottom: 40, alignItems: 'center' }}>
        <Text style={{ fontSize: 40, marginBottom: 8 }}>🏍️</Text>
        <Text style={{ fontSize: 28, fontWeight: 'bold', color: '#fff' }}>SGLab Moto</Text>
        <Text style={{ color: '#666', marginTop: 4 }}>Plataforma de recolección</Text>
      </View>

      <TextInput placeholder="Correo electrónico" placeholderTextColor="#555" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address"
        style={{ backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 12, borderWidth: 1, borderColor: '#333' }} />

      <TextInput placeholder="Contraseña" placeholderTextColor="#555" value={password} onChangeText={setPassword} secureTextEntry
        style={{ backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 12, padding: 16, fontSize: 16, marginBottom: 24, borderWidth: 1, borderColor: '#333' }} />

      <TouchableOpacity onPress={handleLogin} disabled={loading}
        style={{ backgroundColor: '#00d4ff', borderRadius: 12, padding: 16, alignItems: 'center', opacity: loading ? 0.7 : 1 }}>
        {loading ? <ActivityIndicator color="#000" /> : <Text style={{ fontSize: 16, fontWeight: 'bold', color: '#000' }}>Iniciar sesión</Text>}
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
}
