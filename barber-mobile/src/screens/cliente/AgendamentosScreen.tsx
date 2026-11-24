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
import { Pagamento, ROTULO_STATUS, buscarPagamentos, pagamentoAtual, pago } from '../../lib/pagamentos';
import { buscarSituacoesWhatsapp, idsComSituacao, whatsappParaCliente, SituacaoPresenca } from '../../lib/whatsappAgendamentos';
import { WHATSAPP_NAS_AGENDAS } from '../../lib/privacidade';
import AvisoDadosSalvos from '../../components/AvisoDadosSalvos';
import { useCacheDaTela } from '../../hooks/useCacheDaTela';
import { VALIDADE, invalidarCache } from '../../lib/cacheLocal';
import { mensagemDeErro } from '../../lib/conexao';

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

// O que a tela guarda no aparelho (lib/cacheLocal). Pagar, cancelar e avaliar
// continuam dependendo do banco: com dado salvo antigo, o banco recusa ou a
// tela de pagamento mostra a situacao real.
interface AgendamentosSalvos {
  agendamentos: Agendamento[];
  pagamentos: Record<string, Pagamento>;
  situacoes: Record<string, SituacaoPresenca>;
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
  // Pagamento que vale para cada agendamento (status proprio, separado do agendamento)
  const [pagamentos, setPagamentos] = useState<Record<string, Pagamento>>({});
  // Situacao no WhatsApp (cancelamento pedido ou feito por la), por agendamento
  const [situacoesWhatsapp, setSituacoesWhatsapp] = useState<Record<string, SituacaoPresenca>>({});
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

  // Dados salvos da ultima carga (desta conta): a lista aparece na hora e o
  // banco atualiza em seguida
  const cache = useCacheDaTela<AgendamentosSalvos>(user ? 'cliente:agendamentos' : null, VALIDADE.agenda);
  useEffect(() => {
    cache.restaurar((d) => {
      setAgendamentos(d.agendamentos); setPagamentos(d.pagamentos); setSituacoesWhatsapp(d.situacoes);
      setLoading(false);
    });
  }, [cache.restaurar]);

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
    // Selos do chat e telefones dos barbeiros nao dependem da lista: comecam
    // junto com ela (antes, so depois de a lista carregar)
    fetchUnread();
    fetchTelefones();
    try {
      // A conclusao dos horarios que ja terminaram fica com o pg_cron (a cada 5 minutos)
      const { data, error } = await supabase
        .from('agendamentos')
        .select('*, barbeiros(nome), servicos(nome, preco)')
        .eq('cliente_id', user.id)
        .order('data_hora', { ascending: false });

      if (error) throw error;

      const lista = data ?? [];
      const ids = lista.map((a) => a.id);
      // Avaliacoes, pagamentos e situacao do WhatsApp dependem so da lista: em
      // paralelo. Como antes, falha nas avaliacoes conta como "nao avaliado" e
      // falha nos pagamentos mantem os anteriores, sem derrubar a lista.
      const [avals, pagamentosLista, situacoes] = await Promise.all([
        ids.length > 0
          // null: a consulta falhou (a lista mostra "nao avaliado", como antes, mas nao e guardada)
          ? supabase.from('avaliacoes').select('agendamento_id').in('agendamento_id', ids).then(({ data: d, error: e }) => (e ? null : d ?? []))
          : Promise.resolve([] as { agendamento_id: string }[]),
        // Sem o modulo financeiro no banco: a lista segue sem pagamentos
        buscarPagamentos(ids).catch(() => null),
        WHATSAPP_NAS_AGENDAS
          ? buscarSituacoesWhatsapp(idsComSituacao(lista as { id: string; status: string }[]))
          : Promise.resolve({} as Record<string, SituacaoPresenca>),
      ]);
      const avaliadosSet = new Set((avals ?? []).map((a) => a.agendamento_id));
      const comAvaliacao = lista.map((a) => ({ ...a, avaliado: avaliadosSet.has(a.id) })) as unknown as Agendamento[];
      setAgendamentos(comAvaliacao);
      setErro(null);
      if (pagamentosLista) {
        const porAgendamento: Record<string, Pagamento[]> = {};
        pagamentosLista.forEach((p) => { (porAgendamento[p.agendamento_id] ??= []).push(p); });
        const atuais = Object.fromEntries(Object.entries(porAgendamento).map(([id, ps]) => [id, pagamentoAtual(ps)!]));
        setPagamentos(atuais);
        // So guarda uma carga completa (lista, avaliacoes e pagamentos)
        if (avals) cache.salvar({ agendamentos: comAvaliacao, pagamentos: atuais, situacoes });
      }
      setSituacoesWhatsapp(situacoes);
    } catch (e: any) {
      // Com dados salvos na tela, o aviso de dados salvos cuida da falha
      if (!cache.falhou(e)) setErro(mensagemDeErro(e, 'Erro ao carregar agendamentos.'));
    }
    setLoading(false);
    setRefreshing(false);
  }

  // "ok" so quando o banco confirma a alteracao. O .select() revela o caso em
  // que nada mudou (RLS ou status ja alterado), que nao gera erro.
  async function cancelar(id: string): Promise<'ok' | 'erro' | 'inalterado'> {
    const { data, error } = await supabase.from('agendamentos')
      .update({ status: 'cancelado' as any }).eq('id', id).neq('status', 'cancelado' as any).select('id');
    if (error) return 'erro';
    const ok = !!data?.length;
    // O banco confirmou: a tela mostra o cancelamento na hora. O resto (status
    // real quando nada mudou, pagamentos, avaliacao) chega pela recarga em
    // segundo plano, sem prender o modal.
    if (ok) setAgendamentos((prev) => prev.map((a) => (a.id === id ? { ...a, status: 'cancelado' } : a)));
    // O "proximo horario" salvo da Inicio pode ser este: ela busca de novo no banco
    if (ok && user) invalidarCache(user.id, ['cliente:inicio']);
    fetchAgendamentos();
    return ok ? 'ok' : 'inalterado';
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
      <AvisoDadosSalvos salvoEm={cache.salvoEm} falha={cache.falha} onTentar={fetchAgendamentos} />

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
          const pagamento = pagamentos[item.id];
          const pagarPendente = item.status !== 'cancelado' && !pago(pagamento) && pagamento?.status !== 'refunded';
          const avisoWhatsapp = whatsappParaCliente({ status: item.status, presenca: situacoesWhatsapp[item.id], data_hora: item.data_hora });
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
              {!!pagamento && (
                <Text style={[s.pagamentoStatus, { color: pago(pagamento) ? C.success : C.mutedFg }]}>
                  {pagamento.metodo === 'presencial' && pagamento.status === 'pending' ? 'PAGAR NA BARBEARIA' : ROTULO_STATUS[pagamento.status].toUpperCase()}
                </Text>
              )}
              {!!avisoWhatsapp && (
                <View style={s.whatsappAviso}>
                  <Feather name="message-square" size={11} color={C.accent} />
                  <Text style={[s.pagamentoStatus, { color: C.accent, marginTop: 0, flex: 1 }]}>{avisoWhatsapp.toUpperCase()}</Text>
                </View>
              )}

              <View style={s.actions}>
                {pagarPendente && (
                  <TouchableOpacity style={s.actionBtn} onPress={() => navigation.navigate('Pagamento', { agendamentoId: item.id })}>
                    <Feather name="credit-card" size={12} color={C.accent} />
                    <Text style={[s.actionText, { color: C.accent }]}>{pagamento?.status === 'pending' ? 'PAGAMENTO' : 'PAGAR'}</Text>
                  </TouchableOpacity>
                )}
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
    pagamentoStatus: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.2, marginTop: 6 },
    whatsappAviso:   { flexDirection: 'row', alignItems: 'flex-start', gap: 6, marginTop: 8 },
    actions:         { flexDirection: 'row', flexWrap: 'wrap', marginTop: 14, gap: 12 },
    actionBtn:       { flexDirection: 'row', alignItems: 'center', gap: 6 },
    actionText:      { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
    unreadBadge:     { backgroundColor: C.destructive, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
    unreadBadgeText: { fontFamily: F.mono, fontSize: 9, color: '#fff' },
    aviso:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    avisoTexto:      { flex: 1, fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
  });
}
