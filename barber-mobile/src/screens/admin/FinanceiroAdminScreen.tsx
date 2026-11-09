import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, TouchableOpacity, RefreshControl, TextInput } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { supabase } from '../../lib/supabase';
import { Periodo, dataCurta, intervaloDoPeriodo } from '../../lib/financeiro';
import { Chips, FiltrosFinanceiro, makeStyles } from './financeiro/comum';
import VisaoGeral from './financeiro/VisaoGeral';
import PagamentosAba from './financeiro/PagamentosAba';
import ComissoesAba from './financeiro/ComissoesAba';

// Financeiro do dono no celular, com as mesmas funcoes do site (Admin >
// Financeiro e Comissoes) em tres abas. Os valores e as regras vem do banco.
type Aba = 'geral' | 'pagamentos' | 'comissoes';
const ABAS: { valor: Aba; rotulo: string }[] = [
  { valor: 'geral', rotulo: 'VISÃO GERAL' },
  { valor: 'pagamentos', rotulo: 'PAGAMENTOS' },
  { valor: 'comissoes', rotulo: 'COMISSÕES' },
];
const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: 'hoje', rotulo: 'HOJE' },
  { valor: 'semana', rotulo: 'SEMANA' },
  { valor: 'mes', rotulo: 'MÊS' },
  { valor: '30dias', rotulo: '30 DIAS' },
  { valor: 'ano', rotulo: 'ANO' },
  { valor: 'personalizado', rotulo: 'PERÍODO' },
];
const DATA_RX = /^\d{4}-\d{2}-\d{2}$/;

export default function FinanceiroAdminScreen() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const [aba, setAba] = useState<Aba>('geral');
  const [periodo, setPeriodo] = useState<Periodo>('mes');
  // Periodo personalizado digitado como AAAA-MM-DD
  const [inicio, setInicio] = useState(() => intervaloDoPeriodo('mes').inicio);
  const [fim, setFim] = useState(() => intervaloDoPeriodo('mes').fim);
  const [barbeiroId, setBarbeiroId] = useState('');
  const [servicoId, setServicoId] = useState('');
  const [catalogo, setCatalogo] = useState<{ barbeiros: { id: string; nome: string }[]; servicos: { id: string; nome: string }[] }>({ barbeiros: [], servicos: [] });
  const [recarga, setRecarga] = useState(0);
  const [atualizando, setAtualizando] = useState(false);

  useEffect(() => {
    Promise.all([
      supabase.from('barbeiros').select('id, nome').order('nome'),
      supabase.from('servicos').select('id, nome').order('nome'),
    ]).then(([b, sv]) => setCatalogo({ barbeiros: b.data ?? [], servicos: sv.data ?? [] }));
  }, []);

  const personalizado = DATA_RX.test(inicio) && DATA_RX.test(fim) ? { inicio, fim } : undefined;
  const intervalo = intervaloDoPeriodo(periodo, new Date(), personalizado);
  // Novo objeto quando um filtro muda ou ao puxar para atualizar: as abas recarregam
  const filtros = useMemo<FiltrosFinanceiro>(
    () => ({ inicio: intervalo.inicio, fim: intervalo.fim, barbeiroId: barbeiroId || null, servicoId: servicoId || null }),
    [intervalo.inicio, intervalo.fim, barbeiroId, servicoId, recarga],
  );
  const fimDaCarga = useCallback(() => setAtualizando(false), []);

  const opcoesBarbeiro = [{ valor: '', rotulo: 'TODOS OS BARBEIROS' }, ...catalogo.barbeiros.map((b) => ({ valor: b.id, rotulo: b.nome.toUpperCase() }))];
  const opcoesServico = [{ valor: '', rotulo: 'TODOS OS SERVIÇOS' }, ...catalogo.servicos.map((sv) => ({ valor: sv.id, rotulo: sv.nome.toUpperCase() }))];

  return (
    <ScrollView
      style={s.screen} contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => { setAtualizando(true); setRecarga((n) => n + 1); }} tintColor={C.accent} />}
    >
      <View style={s.header}>
        <Text style={s.headerLabel}>ADMIN</Text>
        <Text style={s.headerTitle}>Financeiro</Text>
      </View>

      <View style={s.segmentos} accessibilityRole="tablist">
        {ABAS.map((a) => (
          <TouchableOpacity
            key={a.valor} style={[s.segmento, aba === a.valor && s.segmentoAtivo]} onPress={() => setAba(a.valor)}
            accessibilityRole="tab" accessibilityState={{ selected: aba === a.valor }}
          >
            <Text style={[s.segmentoText, aba === a.valor && { color: C.primaryFg }]}>{a.rotulo}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {aba !== 'comissoes' && (
        <>
          <Chips s={s} C={C} opcoes={PERIODOS} valor={periodo} onChange={setPeriodo} rotulo="Período" />
          {periodo === 'personalizado' && (
            <View style={s.datas}>
              <TextInput style={s.data} value={inicio} onChangeText={setInicio} placeholder="AAAA-MM-DD" placeholderTextColor={C.mutedFg} accessibilityLabel="Data inicial" />
              <Text style={s.legenda}>até</Text>
              <TextInput style={s.data} value={fim} onChangeText={setFim} placeholder="AAAA-MM-DD" placeholderTextColor={C.mutedFg} accessibilityLabel="Data final" />
            </View>
          )}
          <Chips s={s} C={C} opcoes={opcoesBarbeiro} valor={barbeiroId} onChange={setBarbeiroId} rotulo="Barbeiro" />
          <Chips s={s} C={C} opcoes={opcoesServico} valor={servicoId} onChange={setServicoId} rotulo="Serviço" />
          <Text style={[s.legenda, { paddingHorizontal: 24, paddingTop: 8 }]}>{dataCurta(intervalo.inicio, true)} a {dataCurta(intervalo.fim, true)}</Text>
        </>
      )}

      {aba === 'geral' && <VisaoGeral s={s} C={C} filtros={filtros} onCarregado={fimDaCarga} irParaPagamentos={() => setAba('pagamentos')} />}
      {aba === 'pagamentos' && <PagamentosAba s={s} C={C} filtros={filtros} onCarregado={fimDaCarga} />}
      {aba === 'comissoes' && <ComissoesAba s={s} C={C} recarga={recarga} onCarregado={fimDaCarga} />}
    </ScrollView>
  );
}
