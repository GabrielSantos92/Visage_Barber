import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl, Alert, Linking } from 'react-native';
import { Feather, FontAwesome } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import ConfirmarCancelamentoModal from '../../components/ConfirmarCancelamentoModal';
import { linkWhatsAppAgendamento } from '../../lib/whatsapp';

type Nav = StackNavigationProp<ClienteStackParamList>;

const WHATSAPP_COLOR = '#25D366';

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
  const [unreadMap, setUnreadMap] = useState<Record<string, number>>({});
  const [telefones, setTelefones] = useState<Record<string, string>>({});
  // Agendamento aguardando confirmacao de cancelamento no modal
  const [cancelando, setCancelando] = useState<Agendamento | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erroCancelamento, setErroCancelamento] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  useFocusEffect(useCallback(() => { fetchAgendamentos(); }, []));

  async function fetchUnread() {
    if (!user) return;
    const db = supabase as any;
    const { data: conversas } = await db.from('conversas').select('id, barbeiro_id').eq('cliente_id', user.id);
    if (!conversas?.length) return;
    const ids = conversas.map((c: any) => c.id);
    const { data: msgs } = await db.from('mensagens').select('conversa_id').in('conversa_id', ids).eq('lida', false).neq('remetente_id', user.id);
    const map: Record<string, number> = {};
    (msgs ?? []).forEach((m: any) => {
      const c = conversas.find((c: any) => c.id === m.conversa_id);
      if (c) map[c.barbeiro_id] = (map[c.barbeiro_id] ?? 0) + 1;
    });
    setUnreadMap(map);
  }

  // Telefone do barbeiro (cadastrado pelo admin em profiles.telefone), por barbeiro_id
  async function fetchTelefones() {
    const { data, error } = await (supabase as any).rpc('telefones_barbeiros_do_cliente');
    if (error) return;
    const map: Record<string, string> = {};
    (data ?? []).forEach((t: any) => { map[t.barbeiro_id] = t.telefone; });
    setTelefones(map);
  }

  async function fetchAgendamentos() {
    if (!user) return;
    try {
      // Conclui automaticamente os agendamentos cujo horario ja terminou
      await supabase.rpc('concluir_agendamentos_passados');
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
    fetchUnread();
    fetchTelefones();
  }

  // "ok" so quando o banco confirma a alteracao. O .select() revela o caso em
  // que nada mudou (RLS ou status ja alterado), que nao gera erro.
  async function cancelar(id: string): Promise<'ok' | 'erro' | 'inalterado'> {
    const { data, error } = await supabase.from('agendamentos')
      .update({ status: 'cancelado' as any }).eq('id', id).neq('status', 'cancelado' as any).select('id');
    if (error) return 'erro';
    await fetchAgendamentos();
    return data?.length ? 'ok' : 'inalterado';
  }

  function pedirCancelamento(item: Agendamento) {
    setErroCancelamento(null);
    setCancelando(item);
  }

  async function confirmarCancelamento() {
    if (!cancelando || processando) return;
    setProcessando(true);
    setErroCancelamento(null);
    const resultado = await cancelar(cancelando.id);
    setProcessando(false);
    // Em erro o modal fica aberto para tentar de novo ou voltar
    if (resultado === 'erro') {
      setErroCancelamento('Não foi possível cancelar o agendamento. Verifique sua conexão e tente novamente.');
      return;
    }
    setCancelando(null);
    setAviso(resultado === 'ok'
      ? { tipo: 'sucesso', texto: 'AGENDAMENTO CANCELADO COM SUCESSO' }
      : { tipo: 'erro', texto: 'NÃO FOI POSSÍVEL CANCELAR: O AGENDAMENTO PODE JÁ TER SIDO CANCELADO' });
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>HISTÓRICO</Text>
        <Text style={s.pageTitle}>Meus Agendamentos</Text>
      </View>

      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); fetchAgendamentos(); }} />}

      {aviso && (
        <View style={[s.aviso, { borderColor: aviso.tipo === 'sucesso' ? C.success : C.destructive }]} accessibilityLiveRegion="polite">
          <Feather name={aviso.tipo === 'sucesso' ? 'check' : 'alert-circle'} size={12} color={aviso.tipo === 'sucesso' ? C.success : C.destructive} />
          <Text style={[s.avisoTexto, { color: aviso.tipo === 'sucesso' ? C.success : C.destructive }]}>{aviso.texto}</Text>
        </View>
      )}

      <FlatList
        data={agendamentos}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchAgendamentos(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => {
          const st = STATUS[item.status] ?? { label: item.status.toUpperCase(), color: C.fg };
          const d = new Date(item.data_hora);
          const whatsapp = linkWhatsAppAgendamento({
            telefone: telefones[item.barbeiro_id],
            barbeiroNome: item.barbeiros?.nome,
            servicoNome: item.servicos?.nome,
            dataHora: item.data_hora,
          });
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
                {item.status === 'confirmado' && d > new Date() && (
                  <TouchableOpacity style={s.actionBtn} onPress={() => pedirCancelamento(item)}>
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
                    {(unreadMap[item.barbeiro_id] ?? 0) > 0 && (
                      <View style={s.unreadBadge}>
                        <Text style={s.unreadBadgeText}>{unreadMap[item.barbeiro_id]}</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                )}
                {item.status !== 'cancelado' && whatsapp && (
                  <TouchableOpacity
                    style={s.actionBtn}
                    onPress={() => Linking.openURL(whatsapp).catch(() => Alert.alert('Erro', 'Não foi possível abrir o WhatsApp.'))}>
                    <FontAwesome name="whatsapp" size={13} color={WHATSAPP_COLOR} />
                    <Text style={[s.actionText, { color: WHATSAPP_COLOR }]}>WHATSAPP</Text>
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

      {/* Confirmacao antes de cancelar: nada muda sem o toque em confirmar */}
      <ConfirmarCancelamentoModal
        visible={!!cancelando}
        titulo="Cancelar agendamento?"
        mensagem="Tem certeza de que deseja cancelar este agendamento? O horário será liberado e poderá ser reservado por outro cliente."
        detalhe={cancelando ? [
          (cancelando.servicos?.nome ?? 'Serviço').toUpperCase(),
          `${new Date(cancelando.data_hora).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} · ${new Date(cancelando.data_hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}${cancelando.barbeiros?.nome ? ` · ${cancelando.barbeiros.nome.toUpperCase()}` : ''}`,
        ].join('\n') : undefined}
        textoConfirmar="Confirmar cancelamento"
        processando={processando}
        erro={erroCancelamento}
        onVoltar={() => setCancelando(null)}
        onConfirmar={confirmarCancelamento}
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
    actions:         { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, gap: 12 },
    actionBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText:      { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
    unreadBadge:     { backgroundColor: C.destructive, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
    unreadBadgeText: { fontFamily: F.mono, fontSize: 9, color: '#fff' },
    aviso:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    avisoTexto:      { flex: 1, fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
  });
}
