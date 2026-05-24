import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';

type Nav = StackNavigationProp<ClienteStackParamList>;

interface Agendamento {
  id: string;
  data_hora: string;
  status: string;
  barbeiro_id: string;
  barbeiros: { nome: string } | null;
  servicos: { nome: string; preco: number } | null;
  avaliado?: boolean;
}

function getStatus(C: Theme): Record<string, { label: string; color: string }> {
  return {
    pendente:   { label: 'PENDENTE',   color: C.warning },
    confirmado: { label: 'CONFIRMADO', color: C.success },
    cancelado:  { label: 'CANCELADO',  color: C.destructive },
    concluido:  { label: 'CONCLUÍDO',  color: C.primary },
  };
}

export default function AgendamentosScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const STATUS = React.useMemo(() => getStatus(C), [C]);

  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useFocusEffect(useCallback(() => { fetchAgendamentos(); }, []));

  async function fetchAgendamentos() {
    if (!user) return;
    try {
      const { data, error } = await supabase
        .from('agendamentos')
        .select('*, barbeiros(nome), servicos(nome, preco)')
        .eq('cliente_id', user.id)
        .order('data_hora', { ascending: false });

      if (error) throw error;

      const ids = (data ?? []).map((a) => a.id);
      let avaliadosSet = new Set<string>();
      if (ids.length > 0) {
        const { data: avals } = await supabase.from('avaliacoes').select('agendamento_id').in('agendamento_id', ids);
        avaliadosSet = new Set((avals ?? []).map((a) => a.agendamento_id));
      }
      setAgendamentos((data ?? []).map((a) => ({ ...a, avaliado: avaliadosSet.has(a.id) })) as unknown as Agendamento[]);
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar agendamentos.');
    }
    setLoading(false);
    setRefreshing(false);
  }

  async function cancelar(id: string) {
    const { error } = await supabase.from('agendamentos').update({ status: 'cancelado' as any }).eq('id', id);
    if (error) Alert.alert('Erro', error.message);
    else fetchAgendamentos();
  }

  function confirmarCancelamento(id: string) {
    Alert.alert('Cancelar agendamento', 'Deseja mesmo cancelar este agendamento?', [
      { text: 'Não', style: 'cancel' },
      { text: 'Sim, cancelar', style: 'destructive', onPress: () => cancelar(id) },
    ]);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>HISTÓRICO</Text>
        <Text style={s.pageTitle}>Meus Agendamentos</Text>
      </View>

      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); fetchAgendamentos(); }} />}

      <FlatList
        data={agendamentos}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAgendamentos(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const st = STATUS[item.status] ?? { label: item.status.toUpperCase(), color: C.fg };
          const d = new Date(item.data_hora);
          return (
            <View style={s.card}>
              <View style={s.cardHeader}>
                <Text style={s.cardDate}>
                  {d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
                  {'  '}
                  {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
                <View style={[s.badge, { borderColor: st.color }]}>
                  <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>

              <View style={s.cardDivider} />

              <Text style={s.barbeiro}>{item.barbeiros?.nome ?? '—'}</Text>
              <Text style={s.servico}>{item.servicos?.nome}  ·  R$ {item.servicos?.preco?.toFixed(2)}</Text>

              <View style={s.actions}>
                {item.status === 'pendente' && (
                  <TouchableOpacity style={s.actionBtn} onPress={() => confirmarCancelamento(item.id)}>
                    <Feather name="x" size={12} color={C.destructive} />
                    <Text style={[s.actionText, { color: C.destructive }]}>CANCELAR</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'concluido' && !item.avaliado && (
                  <TouchableOpacity style={s.actionBtn}
                    onPress={() => navigation.navigate('Avaliacao', { agendamentoId: item.id, barbeiroId: item.barbeiro_id })}>
                    <Feather name="star" size={12} color={C.accent} />
                    <Text style={[s.actionText, { color: C.accent }]}>AVALIAR</Text>
                  </TouchableOpacity>
                )}
                {item.status === 'concluido' && item.avaliado && (
                  <View style={s.actionBtn}>
                    <Feather name="check" size={12} color={C.success} />
                    <Text style={[s.actionText, { color: C.success }]}>AVALIADO</Text>
                  </View>
                )}
                {item.status !== 'cancelado' && (
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => navigation.navigate('Chat', {
                      outroNome: item.barbeiros?.nome ?? 'Barbeiro',
                      barbeiroId: item.barbeiro_id,
                      clienteId: user!.id,
                    })}>
                    <Feather name="message-circle" size={12} color={C.primary} />
                    <Text style={[s.actionText, { color: C.primary }]}>CHAT</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', marginTop: 60, paddingHorizontal: 24 }}>
            <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 }}>NENHUM AGENDAMENTO</Text>
            <Text style={{ fontFamily: F.sans, fontSize: 13, color: C.mutedFg, textAlign: 'center' }}>
              Você ainda não fez nenhum agendamento.
            </Text>
          </View>
        }
      />
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:      { flex: 1, backgroundColor: C.bg },
    pageHeader:  { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:   { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:   { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    card:        { padding: 20 },
    cardHeader:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    cardDate:    { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1 },
    badge:       { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText:   { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5 },
    cardDivider: { height: 1, backgroundColor: C.border, marginBottom: 12 },
    barbeiro:    { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginBottom: 2 },
    servico:     { fontFamily: F.sans, fontSize: 13, color: C.mutedFg },
    actions:     { flexDirection: 'row', marginTop: 14, gap: 12 },
    actionBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText:  { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
  });
}
