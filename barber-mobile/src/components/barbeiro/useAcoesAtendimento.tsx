import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { BarbeiroStackParamList } from '../../navigation/BarbeiroNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ConfirmarCancelamentoModal from '../ConfirmarCancelamentoModal';
import {
  AgendamentoPainel, StatusAgendamento, TEXTOS_ACAO, TEXTOS_CANCELAMENTO, acaoDoAgendamento, cancelarAgendamento,
  dataHoraCurta,
} from '../../lib/painelBarbeiro';

interface Opcoes {
  barbeiroId: string | null;
  // Depois de cancelar (ou de descobrir o status real no banco): a tela atualiza seus dados
  onAlterado: (id: string, status: StatusAgendamento | null) => void;
}

// Acoes do barbeiro nos atendimentos, as mesmas no Painel e na Agenda (e no
// site): cancelar ou registrar falta, sempre com confirmacao, e abrir o chat.
// A regra e a gravacao ficam em lib/painelBarbeiro.
export function useAcoesAtendimento({ barbeiroId, onAlterado }: Opcoes) {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const navigation = useNavigation<StackNavigationProp<BarbeiroStackParamList>>();
  // Agendamento aguardando confirmacao de cancelamento no modal
  const [cancelando, setCancelando] = useState<AgendamentoPainel | null>(null);
  const [processando, setProcessando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tipo: 'sucesso' | 'erro'; texto: string } | null>(null);

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 4000);
    return () => clearTimeout(t);
  }, [aviso]);

  const textos = TEXTOS_ACAO[(cancelando && acaoDoAgendamento(cancelando)) || 'cancelar'];

  async function confirmar() {
    if (!cancelando || processando) return;
    const alvo = cancelando;
    const sucesso = TEXTOS_ACAO[acaoDoAgendamento(alvo) || 'cancelar'].sucesso;
    setProcessando(true);
    setErro(null);
    const r = await cancelarAgendamento(alvo.id);
    setProcessando(false);
    // Em erro o modal fica aberto para tentar de novo ou voltar
    if (r.resultado === 'erro') {
      setErro(TEXTOS_CANCELAMENTO.erro);
      return;
    }
    setCancelando(null);
    setAviso(r.resultado === 'ok' ? { tipo: 'sucesso', texto: sucesso } : { tipo: 'erro', texto: TEXTOS_CANCELAMENTO.inalterado });
    onAlterado(alvo.id, r.status);
  }

  const modal = (
    <ConfirmarCancelamentoModal
      visible={!!cancelando}
      titulo={textos.titulo}
      mensagem={textos.mensagem}
      detalhe={cancelando ? [
        (cancelando.profiles?.nome ?? 'Cliente').toUpperCase(),
        `${dataHoraCurta(cancelando.data_hora)}${cancelando.servicos?.nome ? ` · ${cancelando.servicos.nome.toUpperCase()}` : ''}`,
      ].join('\n') : undefined}
      textoConfirmar={textos.confirmar}
      processando={processando}
      erro={erro}
      onVoltar={() => setCancelando(null)}
      onConfirmar={confirmar}
    />
  );

  const cor = aviso?.tipo === 'sucesso' ? C.success : C.destructive;
  const avisoNaTela = aviso ? (
    <View style={[s.aviso, { borderColor: cor }]} accessibilityLiveRegion="polite">
      <Feather name={aviso.tipo === 'sucesso' ? 'check' : 'alert-circle'} size={12} color={cor} />
      <Text style={[s.avisoTexto, { color: cor }]}>{aviso.texto.toUpperCase()}</Text>
    </View>
  ) : null;

  return {
    pedirCancelamento: (a: AgendamentoPainel) => { setErro(null); setCancelando(a); },
    abrirChat: (a: AgendamentoPainel) => {
      if (!barbeiroId) return;
      navigation.navigate('Chat', { outroNome: a.profiles?.nome ?? 'Cliente', barbeiroId, clienteId: a.cliente_id });
    },
    modal,
    aviso: avisoNaTela,
  };
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    aviso:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 24, marginTop: 12, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    avisoTexto: { flex: 1, fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
  });
}
