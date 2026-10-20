import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import LogoMark from '../../components/LogoMark';
import NovaSenhaForm from '../../components/NovaSenhaForm';

export default function RedefinirSenhaScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { signOut } = useAuth();

  const [concluido, setConcluido] = useState(false);

  async function salvar(senha: string) {
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      if (error.code === 'same_password') return 'A nova senha deve ser diferente da anterior.';
      if (error.code === 'weak_password') return 'Senha recusada: escolha uma senha mais forte.';
      if (error.status === 401 || error.code === 'session_not_found' || error.code === 'session_expired') {
        return 'Este link expirou. Solicite um novo.';
      }
      return 'Não foi possível alterar a senha. Tente novamente.';
    }
    // Encerra as sessoes de outros aparelhos; esta sai no botao "IR PARA O LOGIN"
    await supabase.auth.signOut({ scope: 'others' });
    setConcluido(true);
    return null;
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        <View style={s.logoRow}>
          <View style={s.logoMark}><LogoMark size={32} color={C.primary} bg={C.bg} line={C.border} /></View>
          <Text style={s.logoText}>VISAGE BARBER</Text>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>NOVA SENHA</Text>
          </View>

          <View style={s.cardBody}>
            {concluido ? (
              <>
                <Feather name="check-circle" size={28} color={C.success} style={{ marginBottom: 16 }} />
                <Text style={s.heading}>Senha redefinida</Text>
                <Text style={s.subheading}>
                  Sua senha foi atualizada e as sessões em outros aparelhos foram encerradas. Entre novamente com a nova senha.
                </Text>
                <TouchableOpacity style={s.btnPrimary} onPress={() => signOut()}>
                  <Text style={s.btnPrimaryText}>IR PARA O LOGIN</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.heading}>Redefina sua senha</Text>
                <Text style={s.subheading}>Escolha uma nova senha para sua conta.</Text>
                <NovaSenhaForm onSalvar={salvar} />
                <TouchableOpacity style={s.cancelBtn} onPress={() => supabase.auth.signOut({ scope: 'local' })}>
                  <Text style={s.cancelText}>CANCELAR</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    scroll:         { flexGrow: 1, justifyContent: 'center', padding: 24 },
    logoRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
    logoMark:     { marginRight: 10 },
    logoText:       { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1.5 },
    card:           { borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
    cardHeader:     { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    cardLabel:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    cardBody:       { padding: 24 },
    heading:        { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 4 },
    subheading:     { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, marginBottom: 28, lineHeight: 20 },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    cancelBtn:      { alignItems: 'center', paddingVertical: 14 },
    cancelText:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
