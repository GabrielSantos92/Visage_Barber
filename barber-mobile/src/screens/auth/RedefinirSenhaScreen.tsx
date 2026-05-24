import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

export default function RedefinirSenhaScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { signOut } = useAuth();

  const [senha, setSenha]             = useState('');
  const [confirmar, setConfirmar]     = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loading, setLoading]         = useState(false);
  const [concluido, setConcluido]     = useState(false);

  async function handleRedefinir() {
    if (senha.length < 6) { Alert.alert('Erro', 'A senha deve ter no mínimo 6 caracteres.'); return; }
    if (senha !== confirmar) { Alert.alert('Erro', 'As senhas não coincidem.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password: senha });
    setLoading(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    setConcluido(true);
  }

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        <View style={s.logoRow}>
          <View style={s.logoSquare}><View style={s.logoInner} /></View>
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
                <Text style={s.subheading}>Sua senha foi atualizada com sucesso.</Text>
                <TouchableOpacity style={s.btnPrimary} onPress={signOut}>
                  <Text style={s.btnPrimaryText}>IR PARA O LOGIN</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.heading}>Redefina sua senha</Text>
                <Text style={s.subheading}>Escolha uma nova senha para sua conta.</Text>

                <Text style={s.label}>NOVA SENHA</Text>
                <View style={s.inputRow}>
                  <Feather name="lock" size={15} color={C.mutedFg} style={s.inputIcon} />
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={senha}
                    onChangeText={setSenha}
                    placeholder="Mínimo 6 caracteres"
                    placeholderTextColor={C.mutedFg}
                    secureTextEntry={!mostrarSenha}
                  />
                  <TouchableOpacity onPress={() => setMostrarSenha(!mostrarSenha)} style={s.eyeBtn}>
                    <Feather name={mostrarSenha ? 'eye-off' : 'eye'} size={15} color={C.mutedFg} />
                  </TouchableOpacity>
                </View>

                <Text style={s.label}>CONFIRMAR SENHA</Text>
                <View style={s.inputRow}>
                  <Feather name="lock" size={15} color={C.mutedFg} style={s.inputIcon} />
                  <TextInput
                    style={[s.input, { flex: 1 }]}
                    value={confirmar}
                    onChangeText={setConfirmar}
                    placeholder="Repita a senha"
                    placeholderTextColor={C.mutedFg}
                    secureTextEntry={!mostrarSenha}
                  />
                </View>

                <TouchableOpacity style={s.btnPrimary} onPress={handleRedefinir} disabled={loading}>
                  {loading
                    ? <ActivityIndicator color={C.primaryFg} size="small" />
                    : <Text style={s.btnPrimaryText}>SALVAR NOVA SENHA</Text>}
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
    logoSquare:     { width: 28, height: 28, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    logoInner:      { width: 14, height: 14, backgroundColor: C.bg },
    logoText:       { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1.5 },
    card:           { borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
    cardHeader:     { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    cardLabel:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    cardBody:       { padding: 24 },
    heading:        { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 4 },
    subheading:     { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, marginBottom: 28, lineHeight: 20 },
    label:          { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6 },
    inputRow:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, marginBottom: 16 },
    inputIcon:      { paddingLeft: 14 },
    input:          { flex: 1, color: C.primary, fontSize: 14, fontFamily: F.sans, paddingHorizontal: 12, paddingVertical: 14 },
    eyeBtn:         { paddingRight: 14, paddingLeft: 8 },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
