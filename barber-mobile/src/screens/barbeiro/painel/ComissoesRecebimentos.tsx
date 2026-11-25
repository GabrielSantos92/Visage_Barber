import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { F, Theme } from '../../../lib/theme';
import { METODOS_COMISSAO, dataCurta, percentual } from '../../../lib/financeiro';
import type { MeuDesempenho, MeuFinanceiro } from '../../../lib/financeiro';
import { formatarReais } from '../../../lib/pagamentos';
import { mensagemDeErro } from '../../../lib/conexao';
import {
  LIMITE_LISTA, ROTULO_LANCAMENTO, TEXTOS_INDICADORES, TEXTOS_PAINEL, cartaoPercentual, notaSaldo, saldoAReceber,
} from '../../../lib/painelBarbeiro';
import { DivisaoFaturamento, Erro, ProgressoComissoes } from './graficos';

// Comissoes e recebimentos, iguais aos do site: valores de meu_financeiro, sem
// nenhuma conta nova alem do saldo (comissoes acumuladas menos o que ja foi
// pago). Lancamentos e pagamentos: os cinco mais recentes, com "ver todos".

function Cartao({ s, rotulo, valor, nota, largo, alerta }: {
  s: ReturnType<typeof estilos>; rotulo: string; valor: string; nota?: string; largo?: boolean; alerta?: boolean;
}) {
  return (
    <View style={[s.cartao, largo && s.largo]} accessible accessibilityLabel={`${rotulo}: ${valor}${nota ? `. ${nota}` : ''}`}>
      <Text style={s.cartaoRotulo}>{rotulo}</Text>
      <Text style={[s.cartaoValor, alerta && s.alerta]}>{valor}</Text>
      {!!nota && <Text style={s.cartaoNota}>{nota}</Text>}
    </View>
  );
}

function Cabecalho({ s, titulo, total, aberto, onAlternar }: {
  s: ReturnType<typeof estilos>; titulo: string; total: number; aberto: boolean; onAlternar: () => void;
}) {
  return (
    <View style={s.cabecalho}>
      <Text style={s.secao}>{titulo}</Text>
      {total > LIMITE_LISTA && (
        <TouchableOpacity
          onPress={onAlternar} accessibilityRole="button" accessibilityState={{ expanded: aberto }}
          accessibilityLabel={`${aberto ? TEXTOS_INDICADORES.verMenos : TEXTOS_INDICADORES.verTodos}: ${titulo}`}
        >
          <Text style={s.verTodos}>{(aberto ? TEXTOS_INDICADORES.verMenos : `${TEXTOS_INDICADORES.verTodos} (${total})`).toUpperCase()}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

export default function ComissoesRecebimentos({ C, fin, desempenho, erro }: {
  C: Theme; fin: MeuFinanceiro | null; desempenho: MeuDesempenho | null; erro: string | null;
}) {
  const s = useMemo(() => estilos(C), [C]);
  const [todosLancamentos, setTodosLancamentos] = useState(false);
  const [todosPagamentos, setTodosPagamentos] = useState(false);
  const pct = cartaoPercentual(desempenho);

  return (
    <View>
      <Text style={s.titulo}>{TEXTOS_PAINEL.comissoes}</Text>
      {!fin ? (
        <View style={{ paddingHorizontal: 24 }}>
          <Erro C={C} mensagem={mensagemDeErro({ message: erro }, erro ?? TEXTOS_PAINEL.erroFinanceiro)} />
        </View>
      ) : (
        <>
          <View style={s.grade}>
            <Cartao s={s} rotulo={TEXTOS_PAINEL.comissao} valor={formatarReais(fin.comissao)} nota={TEXTOS_PAINEL.comissaoNota} />
            <Cartao s={s} rotulo={TEXTOS_PAINEL.percentual} valor={pct.valor} nota={pct.nota} alerta={pct.pendente} />
            <Cartao s={s} rotulo={TEXTOS_PAINEL.servicosComissao} valor={String(fin.servicos)} />
            <Cartao s={s} rotulo={TEXTOS_PAINEL.recebido} valor={formatarReais(fin.recebido)} />
            <Cartao s={s} largo rotulo={TEXTOS_PAINEL.saldo} valor={formatarReais(saldoAReceber(fin))} nota={notaSaldo(fin)} />
          </View>

          {(Number(fin.faturamento) > 0 || Number(fin.comissao_total) > 0) && (
            <View style={s.bloco}>
              <DivisaoFaturamento C={C} faturamento={fin.faturamento} comissao={fin.comissao} />
              <ProgressoComissoes C={C} comissaoTotal={fin.comissao_total} recebidoTotal={fin.recebido_total} />
            </View>
          )}

          <Cabecalho s={s} titulo={TEXTOS_PAINEL.lancamentos} total={fin.lancamentos.length} aberto={todosLancamentos} onAlternar={() => setTodosLancamentos((v) => !v)} />
          {fin.lancamentos.length === 0 ? (
            <Text style={s.vazio}>{TEXTOS_PAINEL.lancamentosVazio}</Text>
          ) : (todosLancamentos ? fin.lancamentos : fin.lancamentos.slice(0, LIMITE_LISTA)).map((l) => (
            <View key={l.id} style={s.linha}>
              <View style={{ flex: 1 }}>
                <Text style={s.linhaTitulo}>
                  {l.servico}{l.tipo !== 'servico' ? `  ·  ${ROTULO_LANCAMENTO[l.tipo].toUpperCase()}` : ''}
                </Text>
                <Text style={s.legenda}>{dataCurta(l.competencia)} · {formatarReais(l.valor_pago)} · {percentual(l.percentual)}</Text>
              </View>
              <Text style={[s.linhaValor, Number(l.comissao) < 0 && { color: C.destructive }]}>{formatarReais(l.comissao)}</Text>
            </View>
          ))}

          <Cabecalho s={s} titulo={TEXTOS_PAINEL.pagamentos} total={fin.pagamentos.length} aberto={todosPagamentos} onAlternar={() => setTodosPagamentos((v) => !v)} />
          {fin.pagamentos.length === 0 ? (
            <Text style={s.vazio}>{TEXTOS_PAINEL.pagamentosVazio}</Text>
          ) : (todosPagamentos ? fin.pagamentos : fin.pagamentos.slice(0, LIMITE_LISTA)).map((p) => (
            <View key={p.id} style={s.linha}>
              <View style={{ flex: 1 }}>
                <Text style={s.linhaTitulo}>Semana de {dataCurta(p.semana_inicio, true)}</Text>
                <Text style={s.legenda}>
                  {new Date(p.pago_em).toLocaleDateString('pt-BR')} · {METODOS_COMISSAO.find((m) => m.valor === p.metodo)?.rotulo ?? p.metodo}
                  {p.comprovante ? ` · ${p.comprovante}` : ''}
                </Text>
              </View>
              <Text style={s.linhaValor}>{formatarReais(p.valor)}</Text>
            </View>
          ))}
        </>
      )}
    </View>
  );
}

function estilos(C: Theme) {
  return StyleSheet.create({
    titulo:       { fontFamily: F.sansLight, fontSize: 20, color: C.primary, paddingHorizontal: 24, marginTop: 28, marginBottom: 10, letterSpacing: -0.5 },
    grade:        { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24 },
    cartao:       { width: '48%', flexGrow: 1, flexShrink: 1, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 12 },
    largo:        { width: '100%' },
    cartaoRotulo: { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1.2, textTransform: 'uppercase' },
    cartaoValor:  { fontFamily: F.sansBold, fontSize: 18, color: C.primary, marginTop: 6 },
    alerta:       { color: C.warning },
    cartaoNota:   { fontFamily: F.sans, fontSize: 11, color: C.mutedFg, marginTop: 4, lineHeight: 15 },
    bloco:        { marginHorizontal: 24, marginTop: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 16, gap: 20 },
    cabecalho:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginTop: 24, marginBottom: 4 },
    secao:        { flex: 1, fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1.5, textTransform: 'uppercase' },
    verTodos:     { fontFamily: F.mono, fontSize: 9, color: C.primary, letterSpacing: 1.5, textDecorationLine: 'underline' },
    vazio:        { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingHorizontal: 24, paddingVertical: 8 },
    linha:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
    linhaTitulo:  { fontFamily: F.sans, fontSize: 14, color: C.primary, marginBottom: 2 },
    legenda:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    linhaValor:   { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
  });
}
