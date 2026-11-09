import React, { useCallback, useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CompositeNavigationProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { BarbeiroStackParamList, BarbeiroTabParamList } from '../../navigation/BarbeiroNavigator';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import CartaoAtendimento from '../../components/barbeiro/CartaoAtendimento';
import { useAcoesAtendimento } from '../../components/barbeiro/useAcoesAtendimento';
import {
  AgendaDoBarbeiro, ITENS_SITUACAO, StatusAgendamento, TEXTOS_PAINEL, buscarAgendaDoBarbeiro, buscarNaoLidas, dataDeHoje,
  situacaoDe,
} from '../../lib/painelBarbeiro';
import DesempenhoFinanceiro from './painel/DesempenhoFinanceiro';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<BarbeiroTabParamList, 'BarbeiroHome'>,
  StackNavigationProp<BarbeiroStackParamList>
>;

// Painel do Barbeiro: a tela principal do barbeiro, igual ao /dashboard do
// site. A. Resumo do dia (situacao e atendimentos de hoje, com as acoes);
// B. Meu desempenho; C. Atendimentos realizados; D. Comissoes e recebimentos.
// A agenda completa (por dia, proximos, historico) fica na aba Agenda.
export default function BarbeiroHomeScreen() {
  const { C } = useTheme();
  const s = useMemo(() => makeStyles(C), [C]);
  const cor: Record<StatusAgendamento, string> = { confirmado: C.success, concluido: C.primary, cancelado: C.destructive };

  const { user, signOut } = useAuth();
  const userId = user?.id;
  const navigation = useNavigation<Nav>();
  const [agenda, setAgenda]         = useState<AgendaDoBarbeiro | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro]             = useState<string | null>(null);
  const [naoLidas, setNaoLidas]     = useState<Record<string, number>>({});
  // Muda para o bloco financeiro recarregar
  const [versao, setVersao]         = useState(0);

  const carregar = useCallback(async () => {
    if (!userId) return;
    try {
      // So os atendimentos de hoje: o resto fica na Agenda
      const dados = await buscarAgendaDoBarbeiro(userId, new Date());
      setAgenda(dados);
      setErro(null);
      if (dados.barbeiroId) buscarNaoLidas(dados.barbeiroId, userId).then(setNaoLidas).catch(() => {});
    } catch (e: any) {
      setErro(e?.message ?? TEXTOS_PAINEL.erroAgenda);
    }
    setLoading(false);
    setRefreshing(false);
  }, [userId]);

  // A cada volta para o Painel: atendimentos, mensagens e financeiro atualizados
  const recarregarTudo = useCallback(() => {
    carregar();
    setVersao((v) => v + 1);
  }, [carregar]);

  useFocusEffect(recarregarTudo);

  const { pedirCancelamento, abrirChat, modal, aviso } = useAcoesAtendimento({
    barbeiroId: agenda?.barbeiroId ?? null,
    // Cancelar ou registrar falta muda o resumo e, se o atendimento ja estava
    // concluido e pago, tambem o financeiro (estorno): recarrega os dois
    onAlterado: () => recarregarTudo(),
  });

  const hoje = agenda?.agendamentos ?? [];
  const situacao = situacaoDe(hoje);

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  const cabecalhoDaPagina = (
    <View style={s.pageHeader}>
      <View>
        <Text style={s.pageLabel}>{TEXTOS_PAINEL.rotulo.toUpperCase()}</Text>
        <Text style={s.pageTitle}>{TEXTOS_PAINEL.titulo}</Text>
      </View>
      <TouchableOpacity onPress={signOut} accessibilityLabel="Sair da conta">
        <Feather name="log-out" size={18} color={C.mutedFg} />
      </TouchableOpacity>
    </View>
  );

  if (!agenda?.barbeiroId) return (
    <View style={s.screen}>
      {cabecalhoDaPagina}
      {erro ? (
        <ErroFetch message={erro} onRetry={() => { setErro(null); carregar(); }} />
      ) : (
        <View style={{ padding: 24 }}>
          <Text style={{ fontFamily: F.sans, color: C.mutedFg, fontSize: 14, lineHeight: 22 }}>{TEXTOS_PAINEL.semVinculo}</Text>
          <TouchableOpacity style={s.btnPrimary} onPress={signOut}>
            <Text style={s.btnPrimaryText}>SAIR DA CONTA</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );

  // A. Resumo do dia
  const resumoDoDia = (
    <View>
      {aviso}
      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); carregar(); }} />}

      <View style={s.secaoTopo}>
        <View style={{ flex: 1 }}>
          <Text style={s.secaoTitulo}>{TEXTOS_PAINEL.visaoDoDia}</Text>
          <Text style={s.secaoData}>{dataDeHoje().toUpperCase()}</Text>
        </View>
        <TouchableOpacity style={s.abrirAgenda} onPress={() => navigation.navigate('Agendamentos')} accessibilityRole="button">
          <Feather name="calendar" size={12} color={C.primary} />
          <Text style={s.abrirAgendaTexto}>{TEXTOS_PAINEL.abrirAgenda.toUpperCase()}</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.rotuloPequeno}>{TEXTOS_PAINEL.situacao.toUpperCase()}</Text>
      <View style={s.situacao}>
        {ITENS_SITUACAO.map(({ chave, rotulo, status }) => (
          <View key={chave} style={s.situacaoItem} accessible accessibilityLabel={`${rotulo}: ${situacao[chave]}`}>
            <Text style={[s.situacaoRotulo, { color: cor[status] }]}>{rotulo.toUpperCase()}</Text>
            <Text style={s.situacaoValor}>{situacao[chave]}</Text>
          </View>
        ))}
      </View>

      <Text style={[s.rotuloPequeno, s.rotuloLista]}>{TEXTOS_PAINEL.hoje.toUpperCase()}</Text>
    </View>
  );

  return (
    <View style={s.screen}>
      {cabecalhoDaPagina}

      <FlatList
        data={hoje}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); recarregarTudo(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={resumoDoDia}
        renderItem={({ item }) => (
          <CartaoAtendimento
            item={item}
            todos={hoje}
            naoLidas={naoLidas[item.cliente_id] ?? 0}
            mostrarData
            C={C}
            onAcao={pedirCancelamento}
            onChat={abrirChat}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
        ListEmptyComponent={<Text style={s.vazio}>{TEXTOS_PAINEL.hojeVazio}</Text>}
        ListFooterComponent={<DesempenhoFinanceiro C={C} versao={versao} />}
      />

      {modal}
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:           { flex: 1, backgroundColor: C.bg },
    pageHeader:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:        { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    secaoTopo:        { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 20, gap: 12 },
    secaoTitulo:      { fontFamily: F.sansLight, fontSize: 22, color: C.primary, letterSpacing: -0.5 },
    secaoData:        { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1, marginTop: 4 },
    abrirAgenda:      { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: C.primary, paddingHorizontal: 12, paddingVertical: 8 },
    abrirAgendaTexto: { fontFamily: F.mono, fontSize: 9, color: C.primary, letterSpacing: 1.5 },
    rotuloPequeno:    { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, paddingHorizontal: 24, marginTop: 16, marginBottom: 8 },
    rotuloLista:      { marginTop: 20, marginBottom: 0 },
    situacao:         { flexDirection: 'row', gap: 8, paddingHorizontal: 24 },
    situacaoItem:     { flex: 1, borderWidth: 1, borderColor: C.border, paddingVertical: 10, alignItems: 'center' },
    situacaoRotulo:   { fontFamily: F.mono, fontSize: 8, letterSpacing: 1.2 },
    situacaoValor:    { fontFamily: F.sansMedium, fontSize: 20, color: C.primary, marginTop: 4 },
    vazio:            { fontFamily: F.sans, color: C.mutedFg, textAlign: 'center', marginTop: 24, marginBottom: 8, paddingHorizontal: 24 },
    btnPrimary:       { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 20 },
    btnPrimaryText:   { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
