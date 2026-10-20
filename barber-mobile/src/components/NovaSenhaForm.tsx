import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';
import { SENHA_MIN, validarNovaSenha } from '../lib/recuperacaoSenha';

type Props = {
  // Devolve a mensagem de erro, ou null se a senha foi alterada
  onSalvar: (senha: string) => Promise<string | null>;
};

// Formulario de nova senha usado pelo link do e-mail
export default function NovaSenhaForm({ onSalvar }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [senha, setSenha]               = useState('');
  const [confirmar, setConfirmar]       = useState('');
  const [mostrarSenha, setMostrarSenha] = useState(false);
  const [loading, setLoading]           = useState(false);
  const [erro, setErro]                 = useState('');

  async function handleSalvar() {
    const invalida = validarNovaSenha(senha, confirmar);
    if (invalida) { setErro(invalida); return; }
    setLoading(true);
    const falha = await onSalvar(senha);
    setLoading(false);
    if (falha) setErro(falha);
  }

  return (
    <>
      <Text style={s.label}>NOVA SENHA</Text>
      <View style={s.inputRow}>
        <Feather name="lock" size={15} color={C.mutedFg} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={senha}
          onChangeText={(v) => { setSenha(v); setErro(''); }}
          placeholder={`Mínimo ${SENHA_MIN} caracteres`}
          placeholderTextColor={C.mutedFg}
          secureTextEntry={!mostrarSenha}
          autoCapitalize="none"
          textContentType="newPassword"
          autoComplete="new-password"
        />
        <TouchableOpacity
          onPress={() => setMostrarSenha(!mostrarSenha)}
          style={s.eyeBtn}
          accessibilityLabel={mostrarSenha ? 'Ocultar senha' : 'Mostrar senha'}
        >
          <Feather name={mostrarSenha ? 'eye-off' : 'eye'} size={15} color={C.mutedFg} />
        </TouchableOpacity>
      </View>

      <Text style={s.label}>CONFIRMAR SENHA</Text>
      <View style={s.inputRow}>
        <Feather name="lock" size={15} color={C.mutedFg} style={s.inputIcon} />
        <TextInput
          style={s.input}
          value={confirmar}
          onChangeText={(v) => { setConfirmar(v); setErro(''); }}
          placeholder="Digite a senha novamente"
          placeholderTextColor={C.mutedFg}
          secureTextEntry={!mostrarSenha}
          autoCapitalize="none"
          textContentType="newPassword"
          autoComplete="new-password"
        />
      </View>

      {!!erro && (
        <View style={s.erroRow}>
          <Feather name="alert-circle" size={12} color={C.destructive} />
          <Text style={s.erroText}>{erro}</Text>
        </View>
      )}

      <TouchableOpacity style={s.btnPrimary} onPress={handleSalvar} disabled={loading}>
        {loading
          ? <ActivityIndicator color={C.primaryFg} size="small" />
          : <Text style={s.btnPrimaryText}>SALVAR NOVA SENHA</Text>}
      </TouchableOpacity>
    </>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    label:          { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6 },
    inputRow:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, marginBottom: 16 },
    inputIcon:      { paddingLeft: 14 },
    input:          { flex: 1, color: C.primary, fontSize: 14, fontFamily: F.sans, paddingHorizontal: 12, paddingVertical: 14 },
    eyeBtn:         { paddingRight: 14, paddingLeft: 8 },
    erroRow:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 },
    erroText:       { flex: 1, fontFamily: F.sans, fontSize: 12, color: C.destructive },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 4 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
