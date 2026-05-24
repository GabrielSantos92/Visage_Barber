import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView, Alert,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StackNavigationProp } from '@react-navigation/stack';
import { supabase } from '../../lib/supabase';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

type Props = { navigation: StackNavigationProp<AuthStackParamList, 'Register'> };

function senhaForca(s: string, C: Theme): { label: string; color: string } {
  if (s.length === 0) return { label: '', color: 'transparent' };
  if (s.length < 6)   return { label: 'FRACA', color: C.destructive };
  if (s.length < 10)  return { label: 'MÉDIA', color: C.warning };
  return { label: 'FORTE', color: C.success };
}

export default function RegisterScreen({ navigation }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [nome, setNome]           = useState('');
  const [email, setEmail]         = useState('');
  const [telefone, setTelefone]   = useState('');
  const [senha, setSenha]         = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [mostrar, setMostrar]     = useState(false);
  const [loading, setLoading]     = useState(false);
  const [erros, setErros]         = useState<Record<string, string>>({});

  const forca = senhaForca(senha, C);

  function validar() {
    const e: Record<string, string> = {};
    if (!nome.trim())        e.nome = 'Nome é obrigatório.';
    if (!email.trim())       e.email = 'Email é obrigatório.';
    if (senha.length < 6)    e.senha = 'Mínimo 6 caracteres.';
    if (senha !== confirmar) e.confirmar = 'As senhas não coincidem.';
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function handleRegister() {
    if (!validar()) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password: senha,
        options: { data: { nome: nome.trim(), telefone: telefone.trim() } },
      });
      if (error) {
        setLoading(false);
        const msg = error.message.includes('already registered')
          ? 'Este email já está cadastrado.'
          : error.message;
        Alert.alert('Erro ao cadastrar', msg);
        return;
      }
      setLoading(false);
      if (!data.session) {
        Alert.alert(
          'Confirme seu email',
          `Enviamos um link de confirmação para ${email.trim()}. Verifique sua caixa de entrada e clique no link para ativar sua conta.`,
          [{ text: 'Ir para login', onPress: () => navigation.navigate('Login') }],
        );
      }
    } catch {
      setLoading(false);
      Alert.alert('Erro inesperado', 'Tente novamente em instantes.');
    }
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
            <Text style={s.cardLabel}>NOVA CONTA</Text>
          </View>
          <View style={s.cardBody}>
            <Text style={s.heading}>Cadastrar</Text>
            <Text style={s.subheading}>Crie sua conta gratuitamente</Text>

            <Field label="NOME COMPLETO" erro={erros.nome} C={C}>
              <Feather name="user" size={15} color={C.mutedFg} style={s.icon} />
              <TextInput style={s.input} value={nome}
                onChangeText={(v) => { setNome(v); setErros(e => ({ ...e, nome: '' })); }}
                placeholder="Seu nome" placeholderTextColor={C.mutedFg} />
            </Field>

            <Field label="EMAIL" erro={erros.email} C={C}>
              <Feather name="mail" size={15} color={C.mutedFg} style={s.icon} />
              <TextInput style={s.input} value={email}
                onChangeText={(v) => { setEmail(v); setErros(e => ({ ...e, email: '' })); }}
                placeholder="seu@email.com" placeholderTextColor={C.mutedFg}
                autoCapitalize="none" keyboardType="email-address" />
            </Field>

            <Field label="TELEFONE (OPCIONAL)" C={C}>
              <Feather name="phone" size={15} color={C.mutedFg} style={s.icon} />
              <TextInput style={s.input} value={telefone} onChangeText={setTelefone}
                placeholder="(11) 99999-9999" placeholderTextColor={C.mutedFg} keyboardType="phone-pad" />
            </Field>

            <Field label="SENHA" erro={erros.senha} C={C}>
              <Feather name="lock" size={15} color={C.mutedFg} style={s.icon} />
              <TextInput style={[s.input, { flex: 1 }]} value={senha}
                onChangeText={(v) => { setSenha(v); setErros(e => ({ ...e, senha: '' })); }}
                placeholder="••••••••" placeholderTextColor={C.mutedFg} secureTextEntry={!mostrar} />
              <TouchableOpacity onPress={() => setMostrar(!mostrar)} style={s.eye}>
                <Feather name={mostrar ? 'eye-off' : 'eye'} size={15} color={C.mutedFg} />
              </TouchableOpacity>
            </Field>

            {senha.length > 0 && (
              <View style={s.forcaRow}>
                <Feather name="check-circle" size={12} color={forca.color} />
                <Text style={[s.forcaText, { color: forca.color }]}>{forca.label}</Text>
              </View>
            )}

            <Field label="CONFIRMAR SENHA" erro={erros.confirmar} C={C}>
              <Feather name="lock" size={15} color={C.mutedFg} style={s.icon} />
              <TextInput style={s.input} value={confirmar}
                onChangeText={(v) => { setConfirmar(v); setErros(e => ({ ...e, confirmar: '' })); }}
                placeholder="••••••••" placeholderTextColor={C.mutedFg} secureTextEntry />
            </Field>

            <TouchableOpacity style={s.btnPrimary} onPress={handleRegister} disabled={loading}>
              {loading
                ? <ActivityIndicator color={C.primaryFg} size="small" />
                : <Text style={s.btnPrimaryText}>CRIAR CONTA</Text>}
            </TouchableOpacity>

            <TouchableOpacity onPress={() => navigation.navigate('Login')} style={{ marginTop: 20, alignItems: 'center' }}>
              <Text style={s.link}>JÁ TEM CONTA? <Text style={{ color: C.primary }}>ENTRAR</Text></Text>
            </TouchableOpacity>
          </View>
        </View>

      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Field({ label, erro, C, children }: { label: string; erro?: string; C: Theme; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 16 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6 }}>{label}</Text>
      <View style={{ flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: erro ? C.destructive : C.border, backgroundColor: C.bg }}>
        {children}
      </View>
      {!!erro && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
          <Feather name="alert-circle" size={11} color={C.destructive} />
          <Text style={{ fontFamily: F.sans, fontSize: 11, color: C.destructive }}>{erro}</Text>
        </View>
      )}
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    scroll:         { flexGrow: 1, padding: 24, paddingTop: 60 },
    logoRow:        { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
    logoSquare:     { width: 28, height: 28, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    logoInner:      { width: 14, height: 14, backgroundColor: C.bg },
    logoText:       { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1.5 },
    card:           { borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
    cardHeader:     { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    cardLabel:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    cardBody:       { padding: 24 },
    heading:        { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 4 },
    subheading:     { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, marginBottom: 24 },
    icon:           { paddingLeft: 14 },
    input:          { flex: 1, color: C.primary, fontSize: 14, fontFamily: F.sans, paddingHorizontal: 12, paddingVertical: 14 },
    eye:            { paddingRight: 14, paddingLeft: 8 },
    forcaRow:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -8, marginBottom: 12 },
    forcaText:      { fontFamily: F.mono, fontSize: 10, letterSpacing: 1 },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 8 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    link:           { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
  });
}
