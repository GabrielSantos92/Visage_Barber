import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Alert } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { BarbeiroStackParamList } from '../../navigation/BarbeiroNavigator';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';

type Nav = StackNavigationProp<BarbeiroStackParamList>;

interface Agendamento {
  id: string; data_hora: string; status: string; cliente_id: string;
  profiles: { nome: string } | null;
  servicos: { nome: string; preco: number } | null;
}

type Filtro = 'ativo' | 'historico';

function getStatus(C: Theme): Record<string, { label: string; color: string }> {
  return {
    pendente:   { label: 'PENDENTE',   color: C.warning },
    confirmado: { label: 'CONFIRMADO', color: C.success },
    cancelado:  { label: 'CANCELADO',  color: C.destructive },
    concluido:  { label: 'CONCLUÍDO',  color: C.primary },
  };
}

export default function BarbeiroHomeScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const STATUS = React.useMemo(() => getStatus(C), [C]);

  const { user, signOut } = useAuth();
  const navigation = useNavigation<Nav>();
  const [todos, setTodos]             = useState<Agendamento[]>([]);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [barbeiroId, setBarbeiroId]   = useState<string | null>(null);
  const [filtro, setFiltro]           = useState<Filtro>('ativo');
  const [erro, setErro]               = useState<string | null>(null);

  useFocusEffect(useCallback(() => { fetchDados(); }, []));

  const agendamentos = todos.filter((a) =>
    filtro === 'ativo'
      ? a.status === 'pendente' || a.status === 'confirmado'
      : a.status === 'concluido' || a.status === 'cancelado',
  );

  async function fetchDados() {
    if (!user) return;
    try {
      const { data: b, error: errB } = await supabase.from('barbeiros').select('id').eq('user_id', user.id).single();
      if (errB) throw errB;
      if (!b) { setLoading(false); return; }
      setBarbeiroId(b.id);

      const { data: agData, error } = await supabase
        .from('agendamentos')
        .select('*, servicos(nome, preco)')
        .eq('barbeiro_id', b.id)
        .order('data_hora', { ascending: false });
      if (error) throw error;

      // cliente_id aponta para auth.users, não profiles — buscar separado
      const ids = [...new Set((agData ?? []).map((a: any) => a.cliente_id).filter(Boolean))];
      const profileMap: Record<string, { nome: string }> = {};
      if (ids.length > 0) {
        const { data: profs } = await supabase.from('profiles').select('id, nome').in('id', ids);
        (profs ?? []).forEach((p: any) => { profileMap[p.id] = { nome: p.nome }; });
      }

      const merged = (agData ?? []).map((a: any) => ({ ...a, profiles: profileMap[a.cliente_id] ?? null }));
      setTodos(merged as Agendamento[]);
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar agendamentos.');
    }
    setLoading(false); setRefreshing(false);
  }

  async function atualizar(id: string, status: string) {
    const { error } = await supabase.from('agendamentos').update({ status: status as any }).eq('id', id);
    if (error) Alert.alert('Erro', error.message);
    else fetchDados();
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  if (!barbeiroId) return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>PAINEL</Text>
        <Text style={s.pageTitle}>Barbeiro</Text>
      </View>
      <View style={{ padding: 24 }}>
        <Text style={{ fontFamily: F.sans, color: C.mutedFg, fontSize: 14, lineHeight: 22 }}>
          Sua conta ainda não está vinculada a um barbeiro. Peça ao administrador para configurar seu perfil.
        </Text>
        <TouchableOpacity style={s.btnPrimary} onPress={signOut}>
          <Text style={s.btnPrimaryText}>SAIR DA CONTA</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <View>
          <Text style={s.pageLabel}>PAINEL DO BARBEIRO</Text>
          <Text style={s.pageTitle}>Agendamentos</Text>
        </View>
        <TouchableOpacity onPress={signOut}>
          <Feather name="log-out" size={18} color={C.mutedFg} />
        </TouchableOpacity>
      </View>

      <View style={s.toggleRow}>
        <TouchableOpacity
          style={[s.toggleBtn, filtro === 'ativo' && s.toggleBtnAtivo]}
          onPress={() => setFiltro('ativo')}>
          <Text style={[s.toggleText, filtro === 'ativo' && { color: C.primaryFg }]}>ATIVOS</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.toggleBtn, filtro === 'historico' && s.toggleBtnAtivo]}
          onPress={() => setFiltro('historico')}>
          <Text style={[s.toggleText, filtro === 'historico' && { color: C.primaryFg }]}>HISTÓRICO</Text>
        </TouchableOpacity>
      </View>

      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); fetchDados(); }} />}

      <FlatList
        data={agendamentos}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchDados(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const d = new Date(item.data_hora);
          const st = STATUS[item.status] ?? { label: item.status.toUpperCase(), color: C.fg };
          return (
            <View style={s.card}>
              <View style={s.cardTop}>
                <Text style={s.cardDate}>{d.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' }).toUpperCase()}  {d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</Text>
                <View style={[s.badge, { borderColor: st.color }]}>
                  <Text style={[s.badgeText, { color: st.color }]}>{st.label}</Text>
                </View>
              </View>
              <View style={s.divider} />
              <Text style={s.clienteNome}>{item.profiles?.nome ?? 'Cliente'}</Text>
              <Text style={s.servicoNome}>{item.servicos?.nome}  ·  R$ {item.servicos?.preco?.toFixed(2)}</Text>
              {filtro === 'ativo' && item.status === 'pendente' && (
                <View style={s.acoes}>
                  <TouchableOpacity style={s.acaoConfirm} onPress={() => atualizar(item.id, 'confirmado')}>
                    <Feather name="check" size={12} color={C.success} />
                    <Text style={[s.acaoText, { color: C.success }]}>CONFIRMAR</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={s.acaoCancel} onPress={() => atualizar(item.id, 'cancelado')}>
                    <Feather name="x" size={12} color={C.destructive} />
                    <Text style={[s.acaoText, { color: C.destructive }]}>CANCELAR</Text>
                  </TouchableOpacity>
                </View>
              )}
              {filtro === 'ativo' && item.status === 'confirmado' && (
                <TouchableOpacity style={s.acaoConcluir} onPress={() => atualizar(item.id, 'concluido')}>
                  <Feather name="check-circle" size={12} color={C.primary} />
                  <Text style={[s.acaoText, { color: C.primary }]}>MARCAR CONCLUÍDO</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={s.acaoChat}
                onPress={() => navigation.navigate('Chat', {
                  outroNome: item.profiles?.nome ?? 'Cliente',
                  barbeiroId: barbeiroId!,
                  clienteId: item.cliente_id,
                })}>
                <Feather name="message-circle" size={12} color={C.accent} />
                <Text style={[s.acaoText, { color: C.accent }]}>CHAT</Text>
              </TouchableOpacity>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
        ListEmptyComponent={
          <Text style={{ fontFamily: F.sans, color: C.mutedFg, textAlign: 'center', marginTop: 60, paddingHorizontal: 24 }}>
            {filtro === 'ativo' ? 'Nenhum agendamento pendente no momento.' : 'Nenhum atendimento concluído ou cancelado.'}
          </Text>
        }
      />
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:        { flex: 1, backgroundColor: C.bg },
    pageHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:     { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    toggleRow:     { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
    toggleBtn:     { flex: 1, paddingVertical: 12, alignItems: 'center' },
    toggleBtnAtivo:{ backgroundColor: C.primary },
    toggleText:    { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    card:          { padding: 20 },
    cardTop:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    cardDate:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1 },
    badge:         { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText:     { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5 },
    divider:       { height: 1, backgroundColor: C.border, marginBottom: 12 },
    clienteNome:   { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginBottom: 2 },
    servicoNome:   { fontFamily: F.sans, fontSize: 13, color: C.mutedFg },
    acoes:         { flexDirection: 'row', gap: 16, marginTop: 14 },
    acaoConfirm:   { flexDirection: 'row', alignItems: 'center', gap: 6 },
    acaoCancel:    { flexDirection: 'row', alignItems: 'center', gap: 6 },
    acaoConcluir:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
    acaoChat:      { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
    acaoText:      { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
    btnPrimary:    { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
    btnPrimaryText:{ fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
