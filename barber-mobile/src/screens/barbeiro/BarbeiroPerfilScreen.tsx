import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, TextInput, TouchableOpacity, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

export default function BarbeiroPerfilScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user, signOut } = useAuth();
  const [nome, setNome]                   = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);

  useEffect(() => { fetchPerfil(); }, []);

  async function fetchPerfil() {
    if (!user) return;
    const { data } = await supabase.from('barbeiros').select('*').eq('user_id', user.id).single();
    setNome(data?.nome ?? '');
    setEspecialidade(data?.especialidade ?? '');
    setLoading(false);
  }

  async function salvar() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('barbeiros').update({ nome, especialidade }).eq('user_id', user.id);
    setSaving(false);
    if (error) Alert.alert('Erro', error.message);
    else Alert.alert('Salvo!', 'Perfil atualizado com sucesso.');
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>CONTA</Text>
        <Text style={s.pageTitle}>Meu Perfil</Text>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>INFORMAÇÕES</Text>
        <View style={s.sectionLine} />
      </View>

      <View style={s.form}>
        <Text style={s.label}>NOME</Text>
        <View style={s.inputRow}>
          <Feather name="user" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <TextInput style={s.input} value={nome} onChangeText={setNome}
            placeholder="Seu nome" placeholderTextColor={C.mutedFg} />
        </View>

        <Text style={s.label}>ESPECIALIDADE</Text>
        <View style={s.inputRow}>
          <Feather name="scissors" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <TextInput style={s.input} value={especialidade} onChangeText={setEspecialidade}
            placeholder="Ex: Degradê, Navalhado" placeholderTextColor={C.mutedFg} />
        </View>

        <Text style={s.label}>EMAIL</Text>
        <View style={[s.inputRow, { opacity: 0.5 }]}>
          <Feather name="mail" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <Text style={[s.input, { color: C.mutedFg }]}>{user?.email}</Text>
        </View>

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

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:           { flex: 1, backgroundColor: C.bg },
    pageHeader:       { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:        { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    section:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
    sectionLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 },
    sectionLine:      { flex: 1, height: 1, backgroundColor: C.border },
    form:             { paddingHorizontal: 24 },
    label:            { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
    inputRow:         { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card, marginBottom: 16 },
    input:            { flex: 1, color: C.primary, fontFamily: F.sans, fontSize: 14, paddingHorizontal: 12, paddingVertical: 14 },
    btnPrimary:       { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginBottom: 12, marginTop: 8 },
    btnPrimaryText:   { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    btnSecondary:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, paddingVertical: 16, marginBottom: 8 },
    btnSecondaryText: { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 2.5 },
  });
}
