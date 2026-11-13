import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, Theme } from '../../lib/theme';
import { etapasDoAgendamento, pausaQueContem, ROTULO_ETAPA } from '../../lib/etapas';
import { formatarReais } from '../../lib/pagamentos';
import { exibirTelefone } from '../../lib/telefone';
import {
  AgendamentoPainel, ROTULO_STATUS_AGENDAMENTO, StatusAgendamento, TEXTOS_ACAO, TEXTOS_CANCELAMENTO, acaoDoAgendamento,
  duracaoDoAgendamento, horaDoAgendamento, precoDoAgendamento, presencaDoAgendamento, quandoDoAgendamento,
} from '../../lib/painelBarbeiro';

interface Props {
  item: AgendamentoPainel;
  // Os demais atendimentos, para mostrar quando este cai na pausa de outro
  todos: AgendamentoPainel[];
  naoLidas: number;
  // Varios dias (Painel, Proximos, Historico) mostram a data; o modo Por dia, so o horario
  mostrarData: boolean;
  C: Theme;
  onAcao: (a: AgendamentoPainel) => void;
  onChat: (a: AgendamentoPainel) => void;
}

const duracaoServico = (a: AgendamentoPainel) => a.servicos?.duracao_min;
const hora = (d: Date) => horaDoAgendamento(d.toISOString());

// Cartao de um atendimento do barbeiro, o mesmo no Painel e na Agenda (como no
// site): status, cliente, servico, pausas e as acoes cancelar / registrar falta
// (com confirmacao, ver useAcoesAtendimento) e chat com as nao lidas
export default function CartaoAtendimento({ item, todos, naoLidas, mostrarData, C, onAcao, onChat }: Props) {
  const s = useMemo(() => makeStyles(C), [C]);
  const cor: Record<StatusAgendamento, string> = { confirmado: C.success, concluido: C.primary, cancelado: C.destructive };
  const etapas = etapasDoAgendamento(item, duracaoServico(item));
  const naPausa = item.status !== 'cancelado' ? pausaQueContem(item, todos, duracaoServico) : null;
  const acao = acaoDoAgendamento(item);
  const preco = precoDoAgendamento(item);
  const duracao = duracaoDoAgendamento(item);
  const presenca = presencaDoAgendamento(item);
  const corPresenca = presenca?.tom === 'alerta' ? C.destructive : presenca?.tom === 'ok' ? C.primary : C.mutedFg;

  return (
    <View style={[s.card, item.status === 'cancelado' && { opacity: 0.6 }]}>
      <View style={s.cardTop}>
        <Text style={s.cardDate}>
          {mostrarData ? quandoDoAgendamento(item.data_hora).toUpperCase() : horaDoAgendamento(item.data_hora)}
        </Text>
        <View style={[s.badge, { borderColor: cor[item.status] }]}>
          <Text style={[s.badgeText, { color: cor[item.status] }]}>{ROTULO_STATUS_AGENDAMENTO[item.status].toUpperCase()}</Text>
        </View>
      </View>
      <View style={s.divider} />
      <Text style={s.clienteNome}>{item.profiles?.nome ?? 'Cliente'}</Text>
      {!!item.profiles?.telefone && <Text style={s.telefone}>{exibirTelefone(item.profiles.telefone)}</Text>}
      <Text style={s.servicoNome}>
        {[item.servicos?.nome, duracao != null ? `${duracao}min` : null, preco != null ? formatarReais(preco) : null].filter(Boolean).join('  ·  ')}
      </Text>
      {/* Coloracao e afins: quando o barbeiro esta com o cliente e quando pode atender outro */}
      {etapas.length > 1 && (
        <View style={s.etapas}>
          {etapas.map((e) => (
            <View key={e.tipo} style={[s.etapa, e.tipo === 'pausa' ? s.etapaPausa : e.tipo === 'finalizacao' ? s.etapaFinal : s.etapaAtiva]}>
              <Text style={s.etapaRotulo}>{ROTULO_ETAPA[e.tipo].toUpperCase()}</Text>
              <Text style={s.etapaHora}>{hora(e.inicio)}–{hora(e.fim)}</Text>
              <Text style={s.etapaRotulo}>
                {e.tipo === 'pausa' ? 'LIVRE P/ OUTRO' : e.tipo === 'finalizacao' ? `RETORNAR ${hora(e.inicio)}` : 'COM O CLIENTE'}
              </Text>
            </View>
          ))}
        </View>
      )}
      {naPausa && (
        <View style={s.naPausa}>
          <Feather name="clock" size={11} color={C.accent} />
          <Text style={[s.acaoText, { color: C.accent, flex: 1 }]}>
            NA PAUSA DE {(naPausa.agendamento.profiles?.nome ?? 'OUTRO CLIENTE').toUpperCase()} · RETORNAR ÀS {hora(naPausa.pausa.fim)}
          </Text>
        </View>
      )}
      {/* Resposta do cliente ao pedido de confirmacao de presenca (WhatsApp) */}
      {presenca && (
        <View style={s.naPausa}>
          <Feather name="message-square" size={11} color={corPresenca} />
          <Text style={[s.acaoText, { flex: 1, color: corPresenca }]}>{presenca.texto.toUpperCase()}</Text>
        </View>
      )}
      {/* Concluido acontece sozinho; o barbeiro so cancela ou registra a falta */}
      {acao && (
        <View style={s.acoes}>
          <TouchableOpacity style={s.acaoCancel} onPress={() => onAcao(item)}>
            <Feather name={acao === 'falta' ? 'user-x' : 'x'} size={12} color={C.destructive} />
            <Text style={[s.acaoText, { color: C.destructive }]}>{TEXTOS_ACAO[acao].botao.toUpperCase()}</Text>
          </TouchableOpacity>
        </View>
      )}
      <TouchableOpacity style={s.acaoChat} onPress={() => onChat(item)}>
        <Feather name="message-circle" size={12} color={C.accent} />
        <Text style={[s.acaoText, { color: C.accent }]}>{TEXTOS_CANCELAMENTO.chat.toUpperCase()}</Text>
        {naoLidas > 0 && (
          <View style={s.unreadBadge}>
            <Text style={s.unreadBadgeText}>{naoLidas}</Text>
          </View>
        )}
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    card:            { padding: 20 },
    cardTop:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
    cardDate:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1 },
    badge:           { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 2 },
    badgeText:       { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5 },
    divider:         { height: 1, backgroundColor: C.border, marginBottom: 12 },
    clienteNome:     { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginBottom: 2 },
    telefone:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, marginBottom: 2 },
    servicoNome:     { fontFamily: F.sans, fontSize: 13, color: C.mutedFg },
    etapas:          { flexDirection: 'row', borderWidth: 1, borderColor: C.border, marginTop: 12 },
    etapa:           { flex: 1, padding: 8 },
    etapaAtiva:      { backgroundColor: C.muted },
    etapaPausa:      { borderLeftWidth: 1, borderRightWidth: 1, borderStyle: 'dashed', borderColor: C.border },
    etapaFinal:      { backgroundColor: C.card },
    etapaRotulo:     { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1 },
    etapaHora:       { fontFamily: F.mono, fontSize: 11, color: C.primary, marginVertical: 2 },
    naPausa:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    acoes:           { flexDirection: 'row', gap: 16, marginTop: 14 },
    acaoCancel:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
    acaoChat:        { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 14 },
    acaoText:        { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
    unreadBadge:     { backgroundColor: C.destructive, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 },
    unreadBadgeText: { fontFamily: F.mono, fontSize: 9, color: '#fff' },
  });
}
