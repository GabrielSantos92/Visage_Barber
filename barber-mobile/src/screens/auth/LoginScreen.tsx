import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../../lib/supabase';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

type Props = { navigation: StackNavigationProp<AuthStackParamList, 'Login'> };

export default function LoginScreen({ navigation }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState('');

  async function handleLogin() {
    setErro('');
    if (!email || !senha) { setErro('Preencha email e senha.'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password: senha });
    setLoading(false);
    if (error) setErro(error.message === 'Invalid login credentials' ? 'Email ou senha incorretos.' : error.message);
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
            <Text style={s.cardLabel}>AUTENTICAÇÃO</Text>
          </View>

          <View style={s.cardBody}>
            <Text style={s.heading}>Entrar</Text>
            <Text style={s.subheading}>Acesse sua conta para continuar</Text>

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

            <Text style={s.label}>SENHA</Text>
            <View style={s.inputRow}>
              <Feather name="lock" size={15} color={C.mutedFg} style={s.inputIcon} />
              <TextInput
                style={[s.input, { flex: 1 }]}
                value={senha}
                onChangeText={(v) => { setSenha(v); setErro(''); }}
                placeholder="••••••••"
                placeholderTextColor={C.mutedFg}
                secureTextEntry={!mostrarSenha}
              />
              <TouchableOpacity onPress={() => setMostrarSenha(!mostrarSenha)} style={s.eyeBtn}>
                <Feather name={mostrarSenha ? 'eye-off' : 'eye'} size={15} color={C.mutedFg} />
              </TouchableOpacity>
            </View>

            {!!erro && (
              <View style={s.erroRow}>
                <Feather name="alert-circle" size={12} color={C.destructive} />
                <Text style={s.erroText}>{erro}</Text>
              </View>
            )}

            <TouchableOpacity style={s.btnPrimary} onPress={handleLogin} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.primaryFg} size="small" />
                : <Text style={s.btnPrimaryText}>ENTRAR</Text>}
            </TouchableOpacity>

            <View style={s.divider}>
              <View style={s.dividerLine} />
              <Text style={s.dividerText}>OU</Text>
              <View style={s.dividerLine} />
            </View>

            <TouchableOpacity style={s.btnSecondary} onPress={() => navigation.navigate('Register')}>
              <Text style={s.btnSecondaryText}>CRIAR CONTA</Text>
            </TouchableOpacity>

            <TouchableOpacity style={s.forgotBtn} onPress={() => navigation.navigate('EsqueciSenha')}>
              <Text style={s.forgotText}>ESQUECEU A SENHA?</Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:           { flex: 1, backgroundColor: C.bg },
    scroll:           { flexGrow: 1, justifyContent: 'center', padding: 24 },
    logoRow:          { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
    logoSquare:       { width: 28, height: 28, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    logoInner:        { width: 14, height: 14, backgroundColor: C.bg },
    logoText:         { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1.5 },
    card:             { borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
    cardHeader:       { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    cardLabel:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    cardBody:         { padding: 24 },
    heading:          { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 4 },
    subheading:       { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, marginBottom: 28 },
    label:            { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6 },
    inputRow:         { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, marginBottom: 16 },
    inputIcon:        { paddingLeft: 14 },
    input:            { flex: 1, color: C.primary, fontSize: 14, fontFamily: F.sans, paddingHorizontal: 12, paddingVertical: 14 },
    eyeBtn:           { paddingRight: 14, paddingLeft: 8 },
    erroRow:          { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    erroText:         { fontFamily: F.sans, fontSize: 12, color: C.destructive },
    btnPrimary:       { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnPrimaryText:   { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    divider:          { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
    dividerLine:      { flex: 1, height: 1, backgroundColor: C.border },
    dividerText:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, marginHorizontal: 12, letterSpacing: 1.5 },
    btnSecondary:     { borderWidth: 1, borderColor: C.border, paddingVertical: 16, alignItems: 'center' },
    btnSecondaryText: { fontFamily: F.mono, fontSize: 11, color: C.fg, letterSpacing: 2.5 },
    forgotBtn:        { alignItems: 'center', paddingVertical: 14 },
    forgotText:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
  });
}
