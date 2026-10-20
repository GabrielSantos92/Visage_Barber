import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ActivityIndicator, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ExpoLinking from 'expo-linking';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import LogoMark from '../../components/LogoMark';
import { mensagemDeErro, solicitarRecuperacaoEmail } from '../../lib/recuperacaoSenha';

type Props = { navigation: StackNavigationProp<AuthStackParamList, 'EsqueciSenha'> };

type Etapa = 'email' | 'emailEnviado';

export default function EsqueciSenhaScreen({ navigation }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [etapa, setEtapa]     = useState<Etapa>('email');
  const [email, setEmail]     = useState('');
  const [aviso, setAviso]     = useState('');
  const [loading, setLoading] = useState(false);
  const [erro, setErro]       = useState('');

  const irPara = (e: Etapa) => { setErro(''); setEtapa(e); };

  async function executar(acao: () => Promise<void>) {
    setLoading(true);
    try { await acao(); }
    catch (err) { setErro(mensagemDeErro(err)); }
    finally { setLoading(false); }
  }

  function handleEmail() {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErro('Informe um email válido.'); return; }
    executar(async () => {
      // O link do e-mail volta para o app (AuthContext trata o deep link)
      const r = await solicitarRecuperacaoEmail(email, ExpoLinking.createURL('auth/callback'));
      setAviso(r.message);
      irPara('emailEnviado');
    });
  }

  const ErroLinha = () => !erro ? null : (
    <View style={s.erroRow}>
      <Feather name="alert-circle" size={12} color={C.destructive} />
      <Text style={s.erroText}>{erro}</Text>
    </View>
  );

  const BotaoPrimario = ({ texto, onPress }: { texto: string; onPress: () => void }) => (
    <TouchableOpacity style={s.btnPrimary} onPress={onPress} disabled={loading}>
      {loading ? <ActivityIndicator color={C.primaryFg} size="small" /> : <Text style={s.btnPrimaryText}>{texto}</Text>}
    </TouchableOpacity>
  );

  return (
    <KeyboardAvoidingView style={s.screen} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

        <View style={s.logoRow}>
          <View style={s.logoMark}><LogoMark size={32} color={C.primary} bg={C.bg} line={C.border} /></View>
          <Text style={s.logoText}>VISAGE BARBER</Text>
        </View>

        <View style={s.card}>
          <View style={s.cardHeader}>
            <Text style={s.cardLabel}>RECUPERAÇÃO DE CONTA</Text>
          </View>

          <View style={s.cardBody}>
            {etapa === 'email' && (
              <>
                <Text style={s.heading}>Esqueceu a senha?</Text>
                <Text style={s.subheading}>Informe o email cadastrado na sua conta.</Text>
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
                    autoComplete="email"
                    keyboardType="email-address"
                  />
                </View>
                <ErroLinha />
                <BotaoPrimario texto="ENVIAR LINK" onPress={handleEmail} />

                <TouchableOpacity style={s.backBtn} onPress={() => navigation.goBack()}>
                  <Feather name="arrow-left" size={13} color={C.mutedFg} />
                  <Text style={s.backText}>VOLTAR AO LOGIN</Text>
                </TouchableOpacity>
              </>
            )}

            {etapa === 'emailEnviado' && (
              <>
                <Feather name="mail" size={28} color={C.success} style={{ marginBottom: 16 }} />
                <Text style={s.heading}>Verifique seu email</Text>
                <Text style={s.subheading}>{aviso}</Text>
                <Text style={s.nota}>
                  Abra o link neste aparelho para criar a nova senha. Ele vale por tempo limitado e só pode ser usado
                  uma vez. Confira também a caixa de spam.
                </Text>
                <BotaoPrimario texto="VOLTAR AO LOGIN" onPress={() => navigation.navigate('Login')} />
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
    screen:          { flex: 1, backgroundColor: C.bg },
    scroll:          { flexGrow: 1, justifyContent: 'center', padding: 24 },
    logoRow:         { flexDirection: 'row', alignItems: 'center', marginBottom: 32 },
    logoMark:        { marginRight: 10 },
    logoText:        { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1.5 },
    card:            { borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
    cardHeader:      { padding: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    cardLabel:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    cardBody:        { padding: 24 },
    heading:         { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 4 },
    subheading:      { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, marginBottom: 20, lineHeight: 20 },
    nota:            { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, marginBottom: 20, lineHeight: 18 },
    label:           { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6 },
    inputRow:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, marginBottom: 16 },
    inputIcon:       { paddingLeft: 14 },
    input:           { flex: 1, color: C.primary, fontSize: 14, fontFamily: F.sans, paddingHorizontal: 12, paddingVertical: 14 },
    erroRow:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    erroText:        { flex: 1, fontFamily: F.sans, fontSize: 12, color: C.destructive },
    btnPrimary:      { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnPrimaryText:  { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    backBtn:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 },
    backText:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
  });
}
