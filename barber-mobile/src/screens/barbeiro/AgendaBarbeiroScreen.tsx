import React, { useCallback, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import CartaoAtendimento from '../../components/barbeiro/CartaoAtendimento';
import { useAcoesAtendimento } from '../../components/barbeiro/useAcoesAtendimento';
import {
  AgendamentoPainel, ITENS_SITUACAO, MODOS_AGENDA, ModoAgenda, StatusAgendamento, TEXTOS_AGENDA, TEXTOS_PAINEL, VAZIO_MODO,
  buscarAgendaDoBarbeiro, buscarNaoLidas, inicioDoDia, listaDoModo, rotuloDoDia, situacaoDe, somarDias,
} from '../../lib/painelBarbeiro';

// Agenda do barbeiro: o gerenciamento completo dos agendamentos, igual a
// Agenda do site. Por dia (navegacao por datas), Proximos (lista completa) e
// Historico, com cancelar, registrar falta e chat em cada atendimento.
// O financeiro fica so no Painel.
export default function AgendaBarbeiroScreen() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const cor: Record<StatusAgendamento, string> = { confirmado: C.success, concluido: C.primary, cancelado: C.destructive };

  const { user } = useAuth();
  const userId = user?.id;
  const [modo, setModo]                 = useState<ModoAgenda>('dia');
  const [dia, setDia]                   = useState(() => inicioDoDia(new Date()));
  const [agendamentos, setAgendamentos] = useState<AgendamentoPainel[]>([]);
  const [barbeiroId, setBarbeiroId]     = useState<string | null>(null);
  const [semVinculo, setSemVinculo]     = useState(false);
  const [carregando, setCarregando]     = useState(true);
  const [refreshing, setRefreshing]     = useState(false);
  const [erro, setErro]                 = useState<string | null>(null);
  const [naoLidas, setNaoLidas]         = useState<Record<string, number>>({});
  const pedido = useRef(0);

  // Por dia: so o dia escolhido; Proximos e Historico: todos os agendamentos.
  // A busca conclui antes os horarios que ja terminaram.
  const carregar = useCallback(async () => {
    if (!userId) return;
    const atual = ++pedido.current;
    try {
      const dados = await buscarAgendaDoBarbeiro(userId, modo === 'dia' ? dia : undefined);
      // Resposta de um modo ou dia que ja foi trocado: descarta
      if (atual !== pedido.current) return;
      setSemVinculo(!dados.barbeiroId);
      setBarbeiroId(dados.barbeiroId);
      setAgendamentos(dados.agendamentos);
      setErro(null);
      if (dados.barbeiroId) buscarNaoLidas(dados.barbeiroId, userId).then(setNaoLidas).catch(() => {});
    } catch (e: any) {
      if (atual !== pedido.current) return;
      setErro(e?.message ?? TEXTOS_AGENDA.erro);
    }
    setCarregando(false);
    setRefreshing(false);
  }, [userId, modo, dia]);

  // Ao abrir a aba e a cada troca de modo ou de dia
  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));

  const { pedirCancelamento, abrirChat, modal, aviso } = useAcoesAtendimento({
    barbeiroId,
    // Mostra o status gravado (ou o real, se ja tinha sido cancelado em outro aparelho)
    onAlterado: (id, status) => {
      if (status) setAgendamentos((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    },
  });

  const lista = useMemo(() => listaDoModo(modo, agendamentos), [modo, agendamentos]);
  const situacao = situacaoDe(lista);
  const rotulo = rotuloDoDia(dia);
  const ehHoje = rotulo.titulo === 'Hoje';

  const trocarModo = (m: ModoAgenda) => { if (m !== modo) { setCarregando(true); setModo(m); } };
  const trocarDia = (d: Date) => { setCarregando(true); setDia(d); };

  const topo = (
    <View>
      {aviso}
      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); carregar(); }} />}

      <View style={s.modos} accessibilityRole="tablist">
        {MODOS_AGENDA.map((m) => (
          <TouchableOpacity
            key={m.valor} style={[s.modo, modo === m.valor && s.modoAtivo]} onPress={() => trocarModo(m.valor)}
            accessibilityRole="tab" accessibilityState={{ selected: modo === m.valor }}
          >
            <Text style={[s.modoTexto, modo === m.valor && { color: C.primaryFg }]}>{m.rotulo.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Navegacao por datas (modo Por dia) */}
      {modo === 'dia' && (
        <View style={s.navegador}>
          <TouchableOpacity onPress={() => trocarDia(somarDias(dia, -1))} accessibilityLabel={TEXTOS_AGENDA.diaAnterior} style={s.seta}>
            <Feather name="chevron-left" size={20} color={C.primary} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center', flex: 1 }}>
            <Text style={s.diaTitulo}>{rotulo.titulo.toUpperCase()}</Text>
            <Text style={s.diaData}>{rotulo.data}</Text>
            {!ehHoje && (
              <TouchableOpacity onPress={() => trocarDia(inicioDoDia(new Date()))}>
                <Text style={s.irHoje}>{TEXTOS_AGENDA.irParaHoje.toUpperCase()}</Text>
              </TouchableOpacity>
            )}
          </View>
          <TouchableOpacity onPress={() => trocarDia(somarDias(dia, 1))} accessibilityLabel={TEXTOS_AGENDA.diaSeguinte} style={s.seta}>
            <Feather name="chevron-right" size={20} color={C.primary} />
          </TouchableOpacity>
        </View>
      )}

      {/* Resumo do dia escolhido */}
      {modo === 'dia' && !carregando && lista.length > 0 && (
        <View style={s.situacao}>
          {ITENS_SITUACAO.map(({ chave, rotulo: nome, status }) => (
            <View key={chave} style={s.situacaoItem} accessible accessibilityLabel={`${nome}: ${situacao[chave]}`}>
              <Text style={[s.situacaoRotulo, { color: cor[status] }]}>{nome.toUpperCase()}</Text>
              <Text style={s.situacaoValor}>{situacao[chave]}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>{TEXTOS_AGENDA.rotulo.toUpperCase()}</Text>
        <Text style={s.pageTitle}>{TEXTOS_AGENDA.titulo}</Text>
      </View>

      <FlatList
        data={carregando || semVinculo ? [] : lista}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); carregar(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        ListHeaderComponent={topo}
        renderItem={({ item }) => (
          <CartaoAtendimento
            item={item}
            todos={agendamentos}
            naoLidas={naoLidas[item.cliente_id] ?? 0}
            mostrarData={modo !== 'dia'}
            C={C}
            onAcao={pedirCancelamento}
            onChat={abrirChat}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
        ListEmptyComponent={
          carregando ? <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
            : <Text style={s.vazio}>{semVinculo ? TEXTOS_PAINEL.semVinculo : VAZIO_MODO[modo]}</Text>
        }
      />

      {modal}
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    pageHeader:     { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:      { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    modos:          { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: C.border },
    modo:           { flex: 1, paddingVertical: 12, alignItems: 'center' },
    modoAtivo:      { backgroundColor: C.primary },
    modoTexto:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    navegador:      { flexDirection: 'row', alignItems: 'center', marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.border, paddingVertical: 12 },
    seta:           { paddingHorizontal: 14, paddingVertical: 8 },
    diaTitulo:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5 },
    diaData:        { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginTop: 2, textAlign: 'center' },
    irHoje:         { fontFamily: F.mono, fontSize: 9, color: C.accent, letterSpacing: 1.5, marginTop: 6 },
    situacao:       { flexDirection: 'row', gap: 8, paddingHorizontal: 24, marginTop: 16, marginBottom: 8 },
    situacaoItem:   { flex: 1, borderWidth: 1, borderColor: C.border, paddingVertical: 10, alignItems: 'center' },
    situacaoRotulo: { fontFamily: F.mono, fontSize: 8, letterSpacing: 1.2 },
    situacaoValor:  { fontFamily: F.sansMedium, fontSize: 20, color: C.primary, marginTop: 4 },
    vazio:          { fontFamily: F.sans, color: C.mutedFg, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 },
  });
}
