import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, TextInput, ActivityIndicator, Alert, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

const DIAS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface Horario { id: string; dia_semana: number; hora_inicio: string; hora_fim: string }

export default function AgendaScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user } = useAuth();
  const [barbeiroId, setBarbeiroId]   = useState<string | null>(null);
  const [horarios, setHorarios]       = useState<Horario[]>([]);
  const [loading, setLoading]         = useState(true);
  const [saving, setSaving]           = useState(false);
  const [novoHorario, setNovoHorario] = useState({ dia_semana: 1, hora_inicio: '09:00', hora_fim: '18:00' });

  useFocusEffect(useCallback(() => { fetchDados(); }, []));

  async function fetchDados() {
    if (!user) return;
    const { data: b } = await supabase.from('barbeiros').select('id').eq('user_id', user.id).single();
    if (!b) { setLoading(false); return; }
    setBarbeiroId(b.id);
    const { data } = await supabase.from('horarios_disponiveis').select('*').eq('barbeiro_id', b.id).order('dia_semana');
    setHorarios(data ?? []);
    setLoading(false);
  }

  async function adicionar() {
    if (!barbeiroId) return;
    if (novoHorario.hora_inicio >= novoHorario.hora_fim) { Alert.alert('Erro', 'Início deve ser antes do fim.'); return; }
    setSaving(true);
    const { error } = await supabase.from('horarios_disponiveis').insert({ ...novoHorario, barbeiro_id: barbeiroId });
    setSaving(false);
    if (error) Alert.alert('Erro', error.message);
    else fetchDados();
  }

  async function remover(id: string) {
    const { error } = await supabase.from('horarios_disponiveis').delete().eq('id', id);
    if (error) Alert.alert('Erro', error.message);
    else fetchDados();
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={saving} onRefresh={fetchDados} tintColor={C.accent} />}
    >
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>DISPONIBILIDADE</Text>
        <Text style={s.pageTitle}>Minha Agenda</Text>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>HORÁRIOS CADASTRADOS</Text>
        <View style={s.sectionLine} />
      </View>

      {horarios.length === 0 && (
        <Text style={{ fontFamily: F.sans, color: C.mutedFg, paddingHorizontal: 24, fontSize: 13 }}>Nenhum horário cadastrado.</Text>
      )}
      {horarios.map((h, i) => (
        <View key={h.id} style={[s.horarioItem, i < horarios.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
          <View>
            <Text style={s.horarioDia}>{DIAS[h.dia_semana]}</Text>
            <Text style={s.horarioHora}>{h.hora_inicio} – {h.hora_fim}</Text>
          </View>
          <TouchableOpacity onPress={() => remover(h.id)} style={s.removeBtn}>
            <Feather name="trash-2" size={14} color={C.destructive} />
            <Text style={s.removeText}>REMOVER</Text>
          </TouchableOpacity>
        </View>
      ))}

      <View style={s.section}>
        <Text style={s.sectionLabel}>ADICIONAR HORÁRIO</Text>
        <View style={s.sectionLine} />
      </View>

      <View style={{ paddingHorizontal: 24 }}>
        <Text style={s.label}>DIA DA SEMANA</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 16 }}>
          {DIAS.map((dia, i) => i !== 0 && (
            <TouchableOpacity key={i} style={[s.diaBtn, novoHorario.dia_semana === i && s.diaBtnAtivo]}
              onPress={() => setNovoHorario({ ...novoHorario, dia_semana: i })}>
              <Text style={[s.diaBtnText, novoHorario.dia_semana === i && { color: C.primaryFg }]}>{dia}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        <Text style={s.label}>INÍCIO</Text>
        <View style={s.inputRow}>
          <Feather name="clock" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <TextInput style={s.input} value={novoHorario.hora_inicio}
            onChangeText={(v) => setNovoHorario({ ...novoHorario, hora_inicio: v })}
            placeholder="09:00" placeholderTextColor={C.mutedFg} />
        </View>

        <Text style={s.label}>FIM</Text>
        <View style={s.inputRow}>
          <Feather name="clock" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <TextInput style={s.input} value={novoHorario.hora_fim}
            onChangeText={(v) => setNovoHorario({ ...novoHorario, hora_fim: v })}
            placeholder="18:00" placeholderTextColor={C.mutedFg} />
        </View>

        <TouchableOpacity style={s.btnPrimary} onPress={adicionar} disabled={saving}>
          <Text style={s.btnPrimaryText}>{saving ? 'SALVANDO...' : 'ADICIONAR HORÁRIO'}</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:        { flex: 1, backgroundColor: C.bg },
    pageHeader:    { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:     { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    section:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
    sectionLabel:  { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 },
    sectionLine:   { flex: 1, height: 1, backgroundColor: C.border },
    horarioItem:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
    horarioDia:    { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    horarioHora:   { fontFamily: F.mono, fontSize: 12, color: C.mutedFg, letterSpacing: 1 },
    removeBtn:     { flexDirection: 'row', alignItems: 'center', gap: 6 },
    removeText:    { fontFamily: F.mono, fontSize: 9, color: C.destructive, letterSpacing: 1.5 },
    label:         { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 },
    inputRow:      { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card, marginBottom: 16 },
    input:         { flex: 1, color: C.primary, fontFamily: F.sans, fontSize: 14, paddingHorizontal: 12, paddingVertical: 14 },
    diaBtn:        { borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10, marginRight: 8 },
    diaBtnAtivo:   { backgroundColor: C.primary, borderColor: C.primary },
    diaBtnText:    { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 1 },
    btnPrimary:    { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center' },
    btnPrimaryText:{ fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
