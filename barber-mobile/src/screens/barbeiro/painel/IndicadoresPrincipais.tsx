import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, Theme } from '../../../lib/theme';
import { formatarReais } from '../../../lib/pagamentos';
import type { MeuDesempenho, MeuFinanceiro } from '../../../lib/financeiro';
import { TEXTOS_INDICADORES, TEXTOS_PAINEL, notaAvaliacoes, notaComVirgula, ticketMedio, variacao } from '../../../lib/painelBarbeiro';
import type { ResumoAtendimentos, ResumoAvaliacoes, Variacao } from '../../../lib/painelBarbeiro';

// Indicadores principais do periodo, com a variacao contra o periodo anterior,
// iguais aos do site. Cada cartao mostra o proprio carregamento: o faturamento
// aparece assim que meu_financeiro responde, sem esperar as contagens.

type Icone = React.ComponentProps<typeof Feather>['name'];

function Cartao({ C, s, rotulo, valor, nota, icone, variacao: v, maisEhMelhor = true, largo, alerta }: {
  C: Theme; s: ReturnType<typeof estilos>; rotulo: string;
  // null: carregando
  valor: string | null; nota?: string; icone: Icone;
  // undefined: comparacao carregando; null: sem comparacao
  variacao?: Variacao | null; maisEhMelhor?: boolean; largo?: boolean; alerta?: boolean;
}) {
  const bom = v ? (v.tendencia === 'alta') === maisEhMelhor : false;
  const cor = !v || v.tendencia === 'estavel' ? C.mutedFg : bom ? C.success : C.destructive;
  const seta: Icone = !v || v.tendencia === 'estavel' ? 'minus' : v.tendencia === 'alta' ? 'arrow-up-right' : 'arrow-down-right';
  const textoVariacao = v === undefined ? '' : v === null ? TEXTOS_INDICADORES.semComparacao : v.texto;
  return (
    <View
      style={[s.cartao, largo && s.largo]} accessible
      accessibilityLabel={`${rotulo}: ${valor ?? 'carregando'}${textoVariacao ? `. ${textoVariacao}` : ''}${nota ? `. ${nota}` : ''}`}
    >
      <View style={s.topo}>
        <Text style={s.rotulo}>{rotulo.toUpperCase()}</Text>
        <Feather name={icone} size={14} color={C.mutedFg} />
      </View>
      {valor === null ? <View style={s.carregando} /> : <Text style={[s.valor, alerta && { color: C.warning }]}>{valor}</Text>}
      {v === undefined ? <View style={s.carregandoLinha} /> : (
        <View style={s.variacao}>
          {v !== null && <Feather name={seta} size={12} color={cor} />}
          <Text style={[s.variacaoTexto, { color: cor }]}>{textoVariacao}</Text>
        </View>
      )}
      {!!nota && <Text style={s.nota}>{nota}</Text>}
    </View>
  );
}

interface Props {
  C: Theme;
  fin: MeuFinanceiro | null;
  finAnterior: MeuFinanceiro | null | undefined;
  desempenho: MeuDesempenho | null;
  atendimentos: { atual: ResumoAtendimentos; anterior: ResumoAtendimentos } | null;
  erroAtendimentos: boolean;
  avaliacoes: { atual: ResumoAvaliacoes; anterior: ResumoAvaliacoes; geral: ResumoAvaliacoes } | null;
  erroAvaliacoes: boolean;
}

export default function IndicadoresPrincipais({ C, fin, finAnterior, desempenho, atendimentos, erroAtendimentos, avaliacoes, erroAvaliacoes }: Props) {
  const s = useMemo(() => estilos(C), [C]);
  const ticket = ticketMedio(fin);
  const ticketAnterior = finAnterior === undefined ? undefined : ticketMedio(finAnterior);
  const concluidos = desempenho ? desempenho.dias_semana.reduce((t, n) => t + n, 0) : null;

  return (
    <View style={s.grade} accessibilityLabel={TEXTOS_INDICADORES.titulo}>
      <Cartao
        C={C} s={s} largo icone="dollar-sign"
        rotulo={TEXTOS_PAINEL.faturamento}
        valor={fin ? formatarReais(fin.faturamento) : '—'}
        nota={TEXTOS_PAINEL.faturamentoNota}
        variacao={!fin ? null : finAnterior === undefined ? undefined : finAnterior ? variacao(Number(fin.faturamento), Number(finAnterior.faturamento)) : null}
      />
      <Cartao
        C={C} s={s} icone="scissors"
        rotulo={TEXTOS_INDICADORES.atendimentos}
        valor={concluidos == null ? '—' : String(concluidos)}
        nota={desempenho ? TEXTOS_INDICADORES.atendimentosNota : TEXTOS_INDICADORES.indisponivel}
        variacao={concluidos == null || erroAtendimentos ? null : atendimentos ? variacao(atendimentos.atual.concluidos, atendimentos.anterior.concluidos) : undefined}
      />
      <Cartao
        C={C} s={s} icone="tag"
        rotulo={TEXTOS_INDICADORES.ticket}
        valor={ticket == null ? '—' : formatarReais(ticket)}
        nota={fin ? TEXTOS_INDICADORES.ticketNota : TEXTOS_INDICADORES.indisponivel}
        variacao={ticket == null ? null : ticketAnterior === undefined ? undefined : variacao(ticket, ticketAnterior)}
      />
      <Cartao
        C={C} s={s} icone="star"
        rotulo={TEXTOS_INDICADORES.avaliacao}
        valor={erroAvaliacoes ? '—' : !avaliacoes ? null : avaliacoes.atual.media == null ? '—' : `${notaComVirgula(avaliacoes.atual.media)} ★`}
        nota={erroAvaliacoes ? TEXTOS_INDICADORES.indisponivel : avaliacoes ? notaAvaliacoes(avaliacoes.atual, avaliacoes.geral) : undefined}
        variacao={erroAvaliacoes ? null : avaliacoes ? variacao(avaliacoes.atual.media, avaliacoes.anterior.media, 'pontos') : undefined}
      />
      <Cartao
        C={C} s={s} icone="x-circle" maisEhMelhor={false}
        rotulo={TEXTOS_INDICADORES.cancelamentos}
        valor={erroAtendimentos ? '—' : atendimentos ? String(atendimentos.atual.cancelados) : null}
        nota={erroAtendimentos ? TEXTOS_INDICADORES.indisponivel : TEXTOS_INDICADORES.cancelamentosNota}
        variacao={erroAtendimentos ? null : atendimentos ? variacao(atendimentos.atual.cancelados, atendimentos.anterior.cancelados) : undefined}
      />
    </View>
  );
}

function estilos(C: Theme) {
  return StyleSheet.create({
    grade:           { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, marginTop: 8 },
    cartao:          { width: '48%', flexGrow: 1, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 12 },
    largo:           { width: '100%' },
    topo:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 6 },
    rotulo:          { flex: 1, fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1.2 },
    valor:           { fontFamily: F.sansBold, fontSize: 22, color: C.primary, marginTop: 6, letterSpacing: -0.5 },
    carregando:      { height: 24, width: 96, marginTop: 8, borderRadius: 3, backgroundColor: C.muted },
    carregandoLinha: { height: 10, width: 80, marginTop: 6, borderRadius: 2, backgroundColor: C.muted },
    variacao:        { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4 },
    variacaoTexto:   { fontFamily: F.sans, fontSize: 11 },
    nota:            { fontFamily: F.sans, fontSize: 11, color: C.mutedFg, marginTop: 6, lineHeight: 15 },
  });
}
