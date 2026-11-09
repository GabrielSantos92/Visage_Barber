import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, RefreshControl, TextInput } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import {
  METODOS_COMISSAO, MeuFinanceiro, Periodo, buscarMeuFinanceiro, dataCurta, intervaloDoPeriodo, percentual,
} from '../../lib/financeiro';
import { formatarReais } from '../../lib/pagamentos';

// So os dados do proprio barbeiro: o banco (meu_financeiro) identifica quem
// chama e nao aceita outro barbeiro
const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: 'semana', rotulo: 'SEMANA' },
  { valor: 'mes', rotulo: 'MÊS' },
  { valor: 'personalizado', rotulo: 'PERÍODO' },
];
const ROTULO_TIPO = { servico: '', reembolso: 'REEMBOLSO', cancelamento: 'CANCELADO' };
const DATA_RX = /^\d{4}-\d{2}-\d{2}$/;

export default function FinanceiroScreen() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  // Periodo personalizado digitado como AAAA-MM-DD
  const [inicio, setInicio] = useState(() => intervaloDoPeriodo('mes').inicio);
  const [fim, setFim] = useState(() => intervaloDoPeriodo('mes').fim);
  const [dados, setDados] = useState<MeuFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const personalizado = DATA_RX.test(inicio) && DATA_RX.test(fim) ? { inicio, fim } : undefined;
  const intervalo = intervaloDoPeriodo(periodo, new Date(), personalizado);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setDados(await buscarMeuFinanceiro(intervalo.inicio, intervalo.fim));
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível carregar seu financeiro.');
    }
    setCarregando(false);
    setAtualizando(false);
  }, [intervalo.inicio, intervalo.fim]);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  const saldo = dados ? Number(dados.comissao_total) - Number(dados.recebido_total) : 0;

  return (
    <ScrollView
      style={s.screen}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => { setAtualizando(true); carregar(); }} tintColor={C.accent} />}
    >
      <View style={s.header}>
        <Text style={s.headerLabel}>BARBEIRO</Text>
        <Text style={s.headerTitle}>Meu Financeiro</Text>
      </View>

      <View style={s.filtros} accessibilityRole="radiogroup" accessibilityLabel="Período">
        {PERIODOS.map((p) => (
          <TouchableOpacity
            key={p.valor} style={[s.chip, periodo === p.valor && s.chipAtivo]} onPress={() => setPeriodo(p.valor)}
            accessibilityRole="radio" accessibilityState={{ checked: periodo === p.valor }}
          >
            <Text style={[s.chipText, periodo === p.valor && { color: C.primaryFg }]}>{p.rotulo}</Text>
          </TouchableOpacity>
        ))}
      </View>
      {periodo === 'personalizado' && (
        <View style={s.datas}>
          <TextInput style={s.data} value={inicio} onChangeText={setInicio} placeholder="AAAA-MM-DD" placeholderTextColor={C.mutedFg} accessibilityLabel="Data inicial" />
          <Text style={s.legenda}>até</Text>
          <TextInput style={s.data} value={fim} onChangeText={setFim} placeholder="AAAA-MM-DD" placeholderTextColor={C.mutedFg} accessibilityLabel="Data final" />
        </View>
      )}
      <Text style={[s.legenda, { paddingHorizontal: 24 }]}>{dataCurta(intervalo.inicio, true)} a {dataCurta(intervalo.fim, true)}</Text>

      {!!erro && <Text style={s.erro} accessibilityRole="alert">{erro}</Text>}

      {carregando ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 40 }} />
      ) : dados && (
        <>
          <View style={s.grid}>
            <Cartao s={s} rotulo="SERVIÇOS CONCLUÍDOS" valor={String(dados.servicos)} />
            <Cartao s={s} rotulo="FATURAMENTO GERADO" valor={formatarReais(dados.faturamento)} />
            <Cartao s={s} rotulo="SUA COMISSÃO" valor={dados.percentual == null ? 'A definir' : percentual(dados.percentual)} />
            <Cartao s={s} rotulo="COMISSÃO NO PERÍODO" valor={formatarReais(dados.comissao)} />
            <Cartao s={s} rotulo="RECEBIDO NO PERÍODO" valor={formatarReais(dados.recebido)} />
            <Cartao s={s} rotulo="SALDO A RECEBER" valor={formatarReais(saldo)} />
          </View>

          <Text style={s.secao}>SERVIÇOS QUE GERARAM COMISSÃO</Text>
          {dados.lancamentos.length === 0 ? (
            <Text style={s.vazio}>Nenhum serviço concluído e pago no período.</Text>
          ) : dados.lancamentos.map((l) => (
            <View key={l.id} style={s.linha}>
              <View style={{ flex: 1 }}>
                <Text style={s.linhaTitulo}>{l.servico}{l.tipo !== 'servico' ? `  ·  ${ROTULO_TIPO[l.tipo]}` : ''}</Text>
                <Text style={s.legenda}>{dataCurta(l.competencia)} · {formatarReais(l.valor_pago)} · {percentual(l.percentual)}</Text>
              </View>
              <Text style={[s.linhaValor, Number(l.comissao) < 0 && { color: C.destructive }]}>{formatarReais(l.comissao)}</Text>
            </View>
          ))}

          <Text style={s.secao}>PAGAMENTOS RECEBIDOS</Text>
          {dados.pagamentos.length === 0 ? (
            <Text style={s.vazio}>Nenhum pagamento de comissão registrado ainda.</Text>
          ) : dados.pagamentos.map((p) => (
            <View key={p.id} style={s.linha}>
              <View style={{ flex: 1 }}>
                <Text style={s.linhaTitulo}>Semana de {dataCurta(p.semana_inicio, true)}</Text>
                <Text style={s.legenda}>
                  {new Date(p.pago_em).toLocaleDateString('pt-BR')} · {METODOS_COMISSAO.find((m) => m.valor === p.metodo)?.rotulo ?? p.metodo}
                </Text>
              </View>
              <Text style={s.linhaValor}>{formatarReais(p.valor)}</Text>
            </View>
          ))}
        </>
      )}
    </ScrollView>
  );
}

function Cartao({ s, rotulo, valor }: { s: ReturnType<typeof makeStyles>; rotulo: string; valor: string }) {
  return (
    <View style={s.cartao}>
      <Text style={s.cartaoRotulo}>{rotulo}</Text>
      <Text style={s.cartaoValor}>{valor}</Text>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:       { flex: 1, backgroundColor: C.bg },
    header:       { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    headerLabel:  { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    headerTitle:  { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    filtros:      { flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 },
    chip:         { borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 },
    chipAtivo:    { backgroundColor: C.primary, borderColor: C.primary },
    chipText:     { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1 },
    datas:        { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 8 },
    data:         { flex: 1, borderWidth: 1, borderColor: C.border, color: C.primary, fontFamily: F.mono, fontSize: 12, paddingHorizontal: 10, paddingVertical: 10 },
    legenda:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    erro:         { marginHorizontal: 24, marginTop: 12, borderWidth: 1, borderColor: C.destructive, color: C.destructive, padding: 12, fontFamily: F.sans, fontSize: 13 },
    grid:         { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingTop: 16 },
    cartao:       { width: '48%', flexGrow: 1, borderWidth: 1, borderColor: C.border, padding: 12 },
    cartaoRotulo: { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1.2 },
    cartaoValor:  { fontFamily: F.sansMedium, fontSize: 18, color: C.primary, marginTop: 6 },
    secao:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, paddingHorizontal: 24, marginTop: 24, marginBottom: 8 },
    vazio:        { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingHorizontal: 24 },
    linha:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
    linhaTitulo:  { fontFamily: F.sans, fontSize: 14, color: C.primary, marginBottom: 2 },
    linhaValor:   { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
  });
}
