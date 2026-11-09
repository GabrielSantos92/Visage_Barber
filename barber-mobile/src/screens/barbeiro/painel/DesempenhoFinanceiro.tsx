import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { F, Theme } from '../../../lib/theme';
import { METODOS_COMISSAO, Periodo, dataCurta, intervaloDoPeriodo, percentual } from '../../../lib/financeiro';
import { formatarReais } from '../../../lib/pagamentos';
import {
  PERIODOS_PAINEL, PainelFinanceiro, ROTULO_LANCAMENTO, TEXTOS_PAINEL, buscarPainelFinanceiro, cartaoPercentual,
  notaSaldo, saldoAReceber,
} from '../../../lib/painelBarbeiro';
import GraficoDiasSemana from './GraficoDiasSemana';

const DATA_RX = /^\d{4}-\d{2}-\d{2}$/;

// Blocos B, C e D do Painel do Barbeiro: Meu desempenho, Atendimentos
// realizados e Comissoes e recebimentos, iguais aos do site. Valores so do
// banco (meu_financeiro e meu_desempenho), pelo periodo escolhido. `versao`
// muda quando o painel pede recarga (foco, puxar para atualizar, ou depois de
// cancelar um atendimento, que pode gerar estorno).
export default function DesempenhoFinanceiro({ C, versao }: { C: Theme; versao: number }) {
  const s = useMemo(() => makeStyles(C), [C]);
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  // Periodo personalizado digitado como AAAA-MM-DD
  const [inicio, setInicio] = useState(() => intervaloDoPeriodo('mes').inicio);
  const [fim, setFim] = useState(() => intervaloDoPeriodo('mes').fim);
  const [dados, setDados] = useState<PainelFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const pedido = useRef(0);

  const personalizado = DATA_RX.test(inicio) && DATA_RX.test(fim) ? { inicio, fim } : undefined;
  const intervalo = intervaloDoPeriodo(periodo, new Date(), personalizado);

  useEffect(() => {
    const atual = ++pedido.current;
    setCarregando(true);
    buscarPainelFinanceiro(intervalo.inicio, intervalo.fim).then((d) => {
      // Resposta de um periodo que ja foi trocado: descarta
      if (atual !== pedido.current) return;
      setDados(d);
      setCarregando(false);
    });
  }, [intervalo.inicio, intervalo.fim, versao]);

  const fin = dados?.financeiro ?? null;
  const pct = cartaoPercentual(dados?.desempenho ?? null);

  return (
    <View>
      <Text style={s.titulo}>{TEXTOS_PAINEL.desempenho}</Text>

      <ScrollView
        horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtros}
        accessibilityRole="radiogroup" accessibilityLabel="Período"
      >
        {PERIODOS_PAINEL.map((p) => (
          <TouchableOpacity
            key={p.valor} style={[s.chip, periodo === p.valor && s.chipAtivo]} onPress={() => setPeriodo(p.valor)}
            accessibilityRole="radio" accessibilityState={{ checked: periodo === p.valor }}
          >
            <Text style={[s.chipText, periodo === p.valor && { color: C.primaryFg }]}>{p.rotulo.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
      {periodo === 'personalizado' && (
        <View style={s.datas}>
          <TextInput style={s.data} value={inicio} onChangeText={setInicio} placeholder="AAAA-MM-DD" placeholderTextColor={C.mutedFg} accessibilityLabel="Data inicial" />
          <Text style={s.legenda}>até</Text>
          <TextInput style={s.data} value={fim} onChangeText={setFim} placeholder="AAAA-MM-DD" placeholderTextColor={C.mutedFg} accessibilityLabel="Data final" />
        </View>
      )}
      <Text style={[s.legenda, s.margem]}>{dataCurta(intervalo.inicio, true)} a {dataCurta(intervalo.fim, true)}</Text>
      <Text style={[s.nota, s.margem]}>{TEXTOS_PAINEL.periodoNota}</Text>

      {carregando && !dados ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />
      ) : dados && (
        <>
          {/* B. Resultado financeiro: lancamentos oficiais (concluidos e pagos) */}
          <View style={s.bloco}>
            <Text style={s.blocoRotulo}>{TEXTOS_PAINEL.resultado}</Text>
            <Text style={s.blocoNota}>{TEXTOS_PAINEL.resultadoNota}</Text>
            {fin ? (
              <>
                <Cartao s={s} largo rotulo={TEXTOS_PAINEL.faturamento} valor={formatarReais(fin.faturamento)} nota={TEXTOS_PAINEL.faturamentoNota} />
                <View style={s.linhaCartoes}>
                  <Cartao s={s} rotulo={TEXTOS_PAINEL.comissao} valor={formatarReais(fin.comissao)} nota={TEXTOS_PAINEL.comissaoNota} />
                  <Cartao s={s} rotulo={TEXTOS_PAINEL.percentual} valor={pct.valor} nota={pct.nota} alerta={pct.pendente} />
                </View>
              </>
            ) : (
              <Text style={s.erroBloco} accessibilityRole="alert">{dados.erroFinanceiro}</Text>
            )}
          </View>

          {/* C. Atendimentos realizados: contagem, independe do pagamento */}
          <View style={s.bloco}>
            <Text style={s.blocoRotulo}>{TEXTOS_PAINEL.atendimentos}</Text>
            <Text style={s.blocoNota}>{TEXTOS_PAINEL.atendimentosNota}</Text>
            {dados.desempenho ? (
              <GraficoDiasSemana dias={dados.desempenho.dias_semana} C={C} />
            ) : (
              <Text style={s.erroBloco} accessibilityRole="alert">{dados.erroDesempenho}</Text>
            )}
          </View>

          {/* D. Comissoes e recebimentos */}
          {fin && (
            <>
              <Text style={s.secao}>{TEXTOS_PAINEL.comissoes}</Text>
              <View style={s.grid}>
                <Cartao s={s} rotulo={TEXTOS_PAINEL.servicosComissao} valor={String(fin.servicos)} />
                <Cartao s={s} rotulo={TEXTOS_PAINEL.recebido} valor={formatarReais(fin.recebido)} />
                <Cartao s={s} largo rotulo={TEXTOS_PAINEL.saldo} valor={formatarReais(saldoAReceber(fin))} nota={notaSaldo(fin)} />
              </View>

              <Text style={s.secao}>{TEXTOS_PAINEL.lancamentos}</Text>
              {fin.lancamentos.length === 0 ? (
                <Text style={s.vazio}>{TEXTOS_PAINEL.lancamentosVazio}</Text>
              ) : fin.lancamentos.map((l) => (
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

              <Text style={s.secao}>{TEXTOS_PAINEL.pagamentos}</Text>
              {fin.pagamentos.length === 0 ? (
                <Text style={s.vazio}>{TEXTOS_PAINEL.pagamentosVazio}</Text>
              ) : fin.pagamentos.map((p) => (
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
        </>
      )}
    </View>
  );
}

function Cartao({ s, rotulo, valor, nota, largo, alerta }: {
  s: ReturnType<typeof makeStyles>; rotulo: string; valor: string; nota?: string; largo?: boolean; alerta?: boolean;
}) {
  return (
    <View style={[s.cartao, largo && s.cartaoLargo]} accessible accessibilityLabel={`${rotulo}: ${valor}${nota ? `. ${nota}` : ''}`}>
      <Text style={s.cartaoRotulo}>{rotulo}</Text>
      <Text style={[s.cartaoValor, alerta && s.cartaoAlerta]}>{valor}</Text>
      {!!nota && <Text style={s.cartaoNota}>{nota}</Text>}
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    titulo:       { fontFamily: F.sansLight, fontSize: 22, color: C.primary, paddingHorizontal: 24, marginTop: 32, letterSpacing: -0.5 },
    filtros:      { flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
    chip:         { borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 },
    chipAtivo:    { backgroundColor: C.primary, borderColor: C.primary },
    chipText:     { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1 },
    datas:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 8 },
    data:         { flex: 1, borderWidth: 1, borderColor: C.border, color: C.primary, fontFamily: F.mono, fontSize: 12, paddingHorizontal: 10, paddingVertical: 10 },
    margem:       { paddingHorizontal: 24 },
    legenda:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    nota:         { fontFamily: F.sans, fontSize: 11, color: C.mutedFg, marginTop: 4 },
    bloco:        { marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 16, gap: 8 },
    blocoRotulo:  { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, textTransform: 'uppercase' },
    blocoNota:    { fontFamily: F.sans, fontSize: 12, color: C.fg, marginBottom: 4 },
    linhaCartoes: { flexDirection: 'row', gap: 8 },
    erroBloco:    { color: C.destructive, fontFamily: F.sans, fontSize: 13, paddingVertical: 12 },
    grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24 },
    cartao:       { width: '48%', flexGrow: 1, flexShrink: 1, borderWidth: 1, borderColor: C.border, backgroundColor: C.bg, padding: 12 },
    cartaoLargo:  { width: '100%' },
    cartaoRotulo: { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1.2, textTransform: 'uppercase' },
    cartaoValor:  { fontFamily: F.sansMedium, fontSize: 18, color: C.primary, marginTop: 6 },
    cartaoAlerta: { color: C.warning },
    cartaoNota:   { fontFamily: F.sans, fontSize: 11, color: C.mutedFg, marginTop: 4 },
    secao:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, paddingHorizontal: 24, marginTop: 24, marginBottom: 8, textTransform: 'uppercase' },
    vazio:        { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingHorizontal: 24 },
    linha:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
    linhaTitulo:  { fontFamily: F.sans, fontSize: 14, color: C.primary, marginBottom: 2 },
    linhaValor:   { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
  });
}
