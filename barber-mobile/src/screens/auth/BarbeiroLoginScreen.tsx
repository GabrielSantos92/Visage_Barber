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

type Props = { navigation: StackNavigationProp<AuthStackParamList, 'BarbeiroLogin'> };

export default function BarbeiroLoginScreen({ navigation }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [email, setEmail]           = useState('');
  const [senha, setSenha]           = useState('');
  const [mostrarSenha, setMostrar]  = useState(false);
  const [loading, setLoading]       = useState(false);
  const [erro, setErro]             = useState('');

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

        <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
          <Feather name="arrow-left" size={16} color={C.mutedFg} />
          <Text style={s.backText}>VOLTAR</Text>
        </TouchableOpacity>

        <View style={s.logoRow}>
          <View style={s.logoSquare}><View style={s.logoInner} /></View>
          <Text style={s.logoText}>VISAGE BARBER</Text>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>ÁREA DO BARBEIRO</Text>
          </View>

          <View style={s.cardBody}>
            <Text style={s.heading}>Entrar</Text>
            <Text style={s.subheading}>Acesse sua conta profissional</Text>

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
              <TouchableOpacity onPress={() => setMostrar(!mostrarSenha)} style={s.eyeBtn}>
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

            <TouchableOpacity style={s.forgotBtn} onPress={() => navigation.navigate('EsqueciSenha')}>
              <Text style={s.forgotText}>ESQUECEU A SENHA?</Text>
            </TouchableOpacity>

            <View style={s.infoBox}>
              <Feather name="info" size={12} color={C.mutedFg} />
              <Text style={s.infoText}>
                Contas de barbeiro são criadas pelo administrador da barbearia.
              </Text>
            </View>
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    scroll:         { flexGrow: 1, padding: 24 },
    backBtn:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 24, paddingTop: 16 },
    backText:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    logoRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
    logoSquare:     { width: 28, height: 28, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    logoInner:      { width: 14, height: 14, backgroundColor: C.bg },
    logoText:       { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1.5 },
    card:           { borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
    cardHeader:     { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    cardLabel:      { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5 },
    cardBody:       { padding: 24 },
    heading:        { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 4 },
    subheading:     { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, marginBottom: 28 },
    label:          { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6 },
    inputRow:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, marginBottom: 16 },
    inputIcon:      { paddingLeft: 14 },
    input:          { flex: 1, color: C.primary, fontSize: 14, fontFamily: F.sans, paddingHorizontal: 12, paddingVertical: 14 },
    eyeBtn:         { paddingRight: 14, paddingLeft: 8 },
    erroRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    erroText:       { fontFamily: F.sans, fontSize: 12, color: C.destructive },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    forgotBtn:      { alignItems: 'center', paddingVertical: 14 },
    forgotText:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    infoBox:        { flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderWidth: 1, borderColor: C.border, padding: 12, marginTop: 8 },
    infoText:       { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, flex: 1, lineHeight: 18 },
  });
}
