import React, { useState } from 'react';
import { View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F } from '../lib/theme';
import { MENSAGEM_SEM_CONEXAO } from '../lib/conexao';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import AuthNavigator from './AuthNavigator';
import ClienteNavigator from './ClienteNavigator';
import BarbeiroNavigator from './BarbeiroNavigator';
import AdminNavigator from './AdminNavigator';
import RedefinirSenhaScreen from '../screens/auth/RedefinirSenhaScreen';

export default function RootNavigator() {
  const { session, loading, userRole, recoveryMode, reconectando, tentarReconectar } = useAuth();
  const { C } = useTheme();
  const [tentando, setTentando] = useState(false);

  const carregando = (
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg }}>
      <ActivityIndicator size="large" color={C.accent} />
    </View>
  );

  if (loading) return carregando;

  if (recoveryMode) return <RedefinirSenhaScreen />;
  // Sessao salva precisa ser renovada e nao ha internet: em vez do login (que
  // tambem nao funcionaria), espera a conexao. Volta sozinho quando renovar.
  if (!session && reconectando) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: C.bg, padding: 32, gap: 14 }}>
        <Feather name="wifi-off" size={28} color={C.warning} />
        <Text style={{ fontFamily: F.sans, fontSize: 14, color: C.primary, textAlign: 'center', lineHeight: 21 }}>
          {MENSAGEM_SEM_CONEXAO}
        </Text>
        <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.mutedFg, textAlign: 'center', lineHeight: 18 }}>
          Sua sessão precisa ser confirmada pelo servidor. O app continua sozinho quando a conexão voltar.
        </Text>
        <TouchableOpacity
          style={{ borderWidth: 1, borderColor: C.primary, paddingHorizontal: 18, paddingVertical: 12, marginTop: 6 }}
          disabled={tentando}
          onPress={async () => { setTentando(true); await tentarReconectar(); setTentando(false); }}
          accessibilityRole="button"
        >
          {tentando
            ? <ActivityIndicator color={C.primary} />
            : <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 2 }}>TENTAR DE NOVO</Text>}
        </TouchableOpacity>
      </View>
    );
  }
  if (!session) return <AuthNavigator />;
  // Papel ainda nao conhecido: espera, em vez de montar a area do cliente (e
  // disparar as consultas dela) para depois trocar pela do barbeiro ou do admin
  if (!userRole) return carregando;
  if (userRole === 'admin') return <AdminNavigator />;
  if (userRole === 'barbeiro') return <BarbeiroNavigator />;
  return <ClienteNavigator />;
}
