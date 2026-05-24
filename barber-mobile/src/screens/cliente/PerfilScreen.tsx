import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

export default function PerfilScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user, signOut } = useAuth();
  const [nome, setNome]         = useState('');
  const [telefone, setTelefone] = useState('');
  const [formatoRosto, setFormatoRosto] = useState('');
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);

  useEffect(() => { fetchPerfil(); }, []);

  async function fetchPerfil() {
    if (!user) return;
    const { data } = await supabase.from('profiles').select('*').eq('user_id', user.id).single();
    setNome(data?.nome ?? '');
    setTelefone(data?.telefone ?? '');
    setFormatoRosto(data?.formato_rosto ?? '');
    setLoading(false);
  }

  async function salvar() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('profiles')
      .update({ nome, telefone, formato_rosto: formatoRosto || null })
      .eq('user_id', user.id);
    setSaving(false);
    if (error) Alert.alert('Erro', error.message);
    else Alert.alert('Salvo!', 'Perfil atualizado.');
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>CONTA</Text>
        <Text style={s.pageTitle}>Meu Perfil</Text>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>INFORMAÇÕES PESSOAIS</Text>
        <View style={s.sectionLine} />
      </View>

      <View style={s.form}>
        <Label C={C}>NOME</Label>
        <View style={s.inputRow}>
          <Feather name="user" size={14} color={C.mutedFg} style={s.icon} />
          <TextInput style={s.input} value={nome} onChangeText={setNome} placeholder="Seu nome" placeholderTextColor={C.mutedFg} />
        </View>

        <Label C={C}>TELEFONE</Label>
        <View style={s.inputRow}>
          <Feather name="phone" size={14} color={C.mutedFg} style={s.icon} />
          <TextInput style={s.input} value={telefone} onChangeText={setTelefone} placeholder="(11) 99999-9999" placeholderTextColor={C.mutedFg} keyboardType="phone-pad" />
        </View>

        <Label C={C}>EMAIL</Label>
        <View style={[s.inputRow, { opacity: 0.5 }]}>
          <Feather name="mail" size={14} color={C.mutedFg} style={s.icon} />
          <Text style={[s.input, { color: C.mutedFg }]}>{user?.email}</Text>
        </View>

        {!!formatoRosto && (
          <View style={s.infoBox}>
            <Text style={s.infoLabel}>FORMATO DO ROSTO IDENTIFICADO</Text>
            <Text style={s.infoValue}>{formatoRosto.toUpperCase()}</Text>
          </View>
        )}

        <TouchableOpacity style={s.btnPrimary} onPress={salvar} disabled={saving}>
          {saving
            ? <ActivityIndicator color={C.primaryFg} size="small" />
            : <Text style={s.btnPrimaryText}>SALVAR ALTERAÇÕES</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.btnSecondary} onPress={signOut}>
          <Feather name="log-out" size={14} color={C.mutedFg} />
          <Text style={s.btnSecondaryText}>SAIR DA CONTA</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function Label({ C, children }: { C: Theme; children: string }) {
  return (
    <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6, marginTop: 4 }}>
      {children}
    </Text>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:          { flex: 1, backgroundColor: C.bg },
    pageHeader:      { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:       { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    section:         { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
    sectionLabel:    { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 },
    sectionLine:     { flex: 1, height: 1, backgroundColor: C.border },
    form:            { paddingHorizontal: 24 },
    inputRow:        { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card, marginBottom: 16 },
    icon:            { paddingLeft: 14 },
    input:           { flex: 1, color: C.primary, fontSize: 14, fontFamily: F.sans, paddingHorizontal: 12, paddingVertical: 14 },
    infoBox:         { borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 20 },
    infoLabel:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    infoValue:       { fontFamily: F.mono, fontSize: 16, color: C.accent, letterSpacing: 2 },
    btnPrimary:      { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginBottom: 12 },
    btnPrimaryText:  { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    btnSecondary:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, paddingVertical: 16, marginBottom: 8 },
    btnSecondaryText:{ fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 2.5 },
  });
}
