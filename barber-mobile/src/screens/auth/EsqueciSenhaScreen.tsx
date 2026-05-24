import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ExpoLinking from 'expo-linking';
import { supabase } from '../../lib/supabase';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

type Props = { navigation: StackNavigationProp<AuthStackParamList, 'EsqueciSenha'> };

export default function EsqueciSenhaScreen({ navigation }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [email, setEmail]     = useState('');
  const [loading, setLoading] = useState(false);
  const [enviado, setEnviado] = useState(false);
  const [erro, setErro]       = useState('');

  async function handleEnviar() {
    setErro('');
    if (!email.trim()) { setErro('Informe seu email.'); return; }
    setLoading(true);
    const redirectTo = ExpoLinking.createURL('auth/callback');
    console.log('[EsqueciSenha] redirectTo =', redirectTo);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
    setLoading(false);
    if (error) setErro(error.message);
    else setEnviado(true);
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
            <Text style={s.cardLabel}>RECUPERAÇÃO DE CONTA</Text>
          </View>

          <View style={s.cardBody}>
            {enviado ? (
              <>
                <Feather name="check-circle" size={28} color={C.success} style={{ marginBottom: 16 }} />
                <Text style={s.heading}>Email enviado</Text>
                <Text style={s.subheading}>
                  Verifique sua caixa de entrada e siga o link para redefinir sua senha.
                </Text>
                <TouchableOpacity style={s.btnPrimary} onPress={() => navigation.navigate('Login')}>
                  <Text style={s.btnPrimaryText}>VOLTAR AO LOGIN</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={s.heading}>Esqueceu a senha?</Text>
                <Text style={s.subheading}>
                  Informe seu email e enviaremos um link para redefinir sua senha.
                </Text>

                <Text style={s.label}>EMAIL</Text>
                <View style={s.inputRow}>
                  <Feather name="mail" size={15} color={C.mutedFg} style={s.inputIcon} />
                  <TextInput
                    style={s.input}
                    value={email}
                    onChangeText={(v) => { setEmail(v); setErro(''); }}
                    placeholder="seu@email.com"
                    placeholderTextColor={C.mutedFg}
                    autoCapitalize="none"
                    keyboardType="email-address"
                  />
                </View>

                {!!erro && (
                  <View style={s.erroRow}>
                    <Feather name="alert-circle" size={12} color={C.destructive} />
                    <Text style={s.erroText}>{erro}</Text>
                  </View>
                )}

                <TouchableOpacity style={s.btnPrimary} onPress={handleEnviar} disabled={loading}>
                  {loading
                    ? <ActivityIndicator color={C.primaryFg} size="small" />
                    : <Text style={s.btnPrimaryText}>ENVIAR LINK</Text>}
                </TouchableOpacity>

                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                  <Feather name="arrow-left" size={13} color={C.mutedFg} />
                  <Text style={s.backText}>VOLTAR AO LOGIN</Text>
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
    erroRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    erroText:       { fontFamily: F.sans, fontSize: 12, color: C.destructive },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    backBtn:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
    backText:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
  });
}
