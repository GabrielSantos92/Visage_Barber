import React, { useCallback, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl, TouchableOpacity, Modal, TextInput, Switch, Alert, ScrollView,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import { duracaoTotal, pausaAproveitavel, validarEtapas } from '../../lib/etapas';

interface Servico {
  id: string;
  nome: string;
  preco: number;
  duracao_min: number;
  descricao: string | null;
  com_pausa: boolean;
  ativo_inicial_min: number | null;
  pausa_min: number | null;
  ativo_final_min: number | null;
  margem_min: number;
}

// "" = nao informado; qualquer outro texto vira numero (NaN se invalido)
const numero = (v: string) => (v.trim() === '' ? null : Number(v));
const texto = (v: number | null | undefined) => (v == null ? '' : String(v));

export default function ServicosScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user } = useAuth();
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro]         = useState<string | null>(null);
  const [configurando, setConfigurando] = useState<Servico | null>(null);

  useFocusEffect(useCallback(() => { fetchServicos(); }, []));

  async function fetchServicos() {
    if (!user) return;
    try {
      const { data: b, error: errB } = await supabase.from('barbeiros').select('id').eq('user_id', user.id).single();
      if (errB) throw errB;
      if (!b) { setLoading(false); setRefreshing(false); return; }
      const { data, error } = await supabase.from('barbeiro_servicos').select('servico_id, servicos(*)').eq('barbeiro_id', b.id);
      if (error) throw error;
      const srvs = (data ?? []).map((bs: any) => bs.servicos).filter(Boolean);
      setServicos(srvs);
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar serviços.');
    }
    setLoading(false); setRefreshing(false);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>CATÁLOGO</Text>
        <Text style={s.pageTitle}>Meus Serviços</Text>
      </View>

      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); fetchServicos(); }} />}

      <FlatList
        data={servicos}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchServicos(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item, index }) => (
          <View style={[s.item, index < servicos.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
            <View style={s.itemLeft}>
              <Text style={s.itemNome}>{item.nome}</Text>
              {item.descricao ? <Text style={s.itemDesc}>{item.descricao}</Text> : null}
              <View style={s.itemMeta}>
                <Feather name="clock" size={11} color={C.mutedFg} />
                <Text style={s.itemDuracao}>{item.duracao_min} min</Text>
              </View>
              {item.com_pausa && (
                item.pausa_min == null ? (
                  <Text style={[s.itemDuracao, { color: C.warning, marginTop: 4 }]}>TEMPOS PENDENTES · FORA DO AGENDAMENTO</Text>
                ) : (
                  <Text style={[s.itemDuracao, { marginTop: 4 }]}>
                    {item.ativo_inicial_min} APLICAÇÃO · {item.pausa_min} PAUSA · {item.ativo_final_min} FINALIZAÇÃO
                    {item.margem_min > 0 ? ` · MARGEM ${item.margem_min}` : ''}
                  </Text>
                )
              )}
              <TouchableOpacity style={s.configBtn} onPress={() => setConfigurando(item)}>
                <Feather name="sliders" size={11} color={C.accent} />
                <Text style={s.configText}>CONFIGURAR TEMPOS</Text>
              </TouchableOpacity>
            </View>
            <View style={s.precoBox}>
              <Text style={s.precoLabel}>R$</Text>
              <Text style={s.preco}>{item.preco.toFixed(2)}</Text>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <View style={{ padding: 24, paddingTop: 40 }}>
            <Text style={s.empty}>Nenhum serviço associado ao seu perfil.</Text>
            <Text style={[s.empty, { fontSize: 12, marginTop: 8 }]}>Peça ao administrador para vincular serviços.</Text>
          </View>
        }
      />

      {configurando && (
        <ConfigurarTempos
          servico={configurando}
          onClose={() => setConfigurando(null)}
          onSaved={() => { setConfigurando(null); fetchServicos(); }}
          C={C}
        />
      )}
    </View>
  );
}

function ConfigurarTempos({ servico, onClose, onSaved, C }: { servico: Servico; onClose: () => void; onSaved: () => void; C: Theme }) {
  const s = React.useMemo(() => makeStyles(C), [C]);
  const [comPausa, setComPausa]         = useState(servico.com_pausa);
  const [ativoInicial, setAtivoInicial] = useState(texto(servico.ativo_inicial_min));
  const [pausa, setPausa]               = useState(texto(servico.pausa_min));
  const [ativoFinal, setAtivoFinal]     = useState(texto(servico.ativo_final_min));
  const [margem, setMargem]             = useState(texto(servico.margem_min));
  const [saving, setSaving]             = useState(false);

  const etapas = { ativoInicial: numero(ativoInicial), pausa: numero(pausa), ativoFinal: numero(ativoFinal), margem: numero(margem) };
  const pendente = comPausa && etapas.ativoInicial == null && etapas.pausa == null && etapas.ativoFinal == null;
  const erro = comPausa && !pendente ? validarEtapas(etapas) : null;
  const total = comPausa && !pendente && !erro ? duracaoTotal(etapas.ativoInicial!, etapas.pausa!, etapas.ativoFinal!) : null;

  async function salvar() {
    if (erro) { Alert.alert('Tempos inválidos', erro); return; }
    setSaving(true);
    const { data: futuros, error } = await supabase.rpc('configurar_etapas_servico', {
      p_servico_id: servico.id,
      p_com_pausa: comPausa,
      p_ativo_inicial: comPausa ? etapas.ativoInicial : null,
      p_pausa: comPausa ? etapas.pausa : null,
      p_ativo_final: comPausa ? etapas.ativoFinal : null,
      p_margem: comPausa ? etapas.margem ?? 0 : 0,
    });
    setSaving(false);
    if (error) { Alert.alert('Erro', error.message); return; }
    if (futuros && futuros > 0) {
      Alert.alert('Tempos salvos', `${futuros} agendamento(s) futuro(s) deste serviço mantêm os tempos com que foram marcados.`);
    }
    onSaved();
  }

  const campo = (label: string, ajuda: string, valor: string, set: (v: string) => void, tracejado = false) => (
    <View style={{ marginBottom: 14 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput
        style={[s.input, tracejado && { borderStyle: 'dashed' }]} value={valor} onChangeText={set}
        keyboardType="number-pad" placeholder="min" placeholderTextColor={C.mutedFg}
      />
      <Text style={s.ajuda}>{ajuda}</Text>
    </View>
  );

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={s.modalFundo}>
        <ScrollView style={s.modal} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
          <Text style={s.pageLabel}>TEMPOS DO SERVIÇO</Text>
          <Text style={[s.itemNome, { fontSize: 20, marginBottom: 16 }]}>{servico.nome}</Text>

          <View style={s.switchRow}>
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text style={s.itemNome}>Tem pausa para ação do produto</Text>
              <Text style={s.ajuda}>Só ative se você puder atender outro cliente enquanto o produto age.</Text>
            </View>
            <Switch value={comPausa} onValueChange={setComPausa} trackColor={{ true: C.accent, false: C.border }} />
          </View>

          {comPausa ? (
            <>
              {campo('ATENDIMENTO INICIAL', 'Preparação e aplicação · com o cliente', ativoInicial, setAtivoInicial)}
              {campo('PAUSA', 'Ação do produto · você fica livre', pausa, setPausa, true)}
              {campo('ATENDIMENTO FINAL', 'Enxágue e finalização · com o cliente', ativoFinal, setAtivoFinal)}
              {campo('MARGEM DE SEGURANÇA', 'Folga no início e no fim da pausa', margem, setMargem)}
              <Text style={s.ajuda}>Use os tempos indicados pelo fabricante do produto.</Text>
              {pendente && <Text style={[s.resumo, { color: C.warning }]}>Sem os tempos, o serviço fica fora do agendamento.</Text>}
              {erro && <Text style={[s.resumo, { color: C.destructive }]}>{erro}</Text>}
              {total != null && (
                <Text style={s.resumo}>
                  TOTAL {total} MIN · {etapas.ativoInicial! + etapas.ativoFinal!} COM O CLIENTE · {pausaAproveitavel(etapas.pausa!, etapas.margem ?? 0)} LIVRES NA PAUSA
                </Text>
              )}
            </>
          ) : (
            <Text style={s.ajuda}>Atendimento contínuo de {servico.duracao_min} min: você fica com o cliente o tempo todo.</Text>
          )}

          <TouchableOpacity style={[s.btnPrimary, (saving || !!erro) && { opacity: 0.5 }]} onPress={salvar} disabled={saving || !!erro}>
            {saving ? <ActivityIndicator color={C.primaryFg} size="small" /> : <Text style={s.btnPrimaryText}>SALVAR</Text>}
          </TouchableOpacity>
          <TouchableOpacity onPress={onClose} disabled={saving} style={{ alignItems: 'center', marginTop: 16 }}>
            <Text style={s.configText}>CANCELAR</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>
    </Modal>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:      { flex: 1, backgroundColor: C.bg },
    pageHeader:  { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:   { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:   { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    item:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
    itemLeft:    { flex: 1, marginRight: 16 },
    itemNome:    { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginBottom: 4 },
    itemDesc:    { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, lineHeight: 18, marginBottom: 6 },
    itemMeta:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
    itemDuracao: { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 0.5 },
    precoBox:    { alignItems: 'flex-end' },
    precoLabel:  { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1 },
    preco:       { fontFamily: F.mono, fontSize: 18, color: C.accent, letterSpacing: 1 },
    empty:       { fontFamily: F.sans, color: C.mutedFg, fontSize: 14, lineHeight: 22 },
    configBtn:   { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    configText:  { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5 },
    modalFundo:  { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.6)' },
    modal:       { maxHeight: '90%', backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border },
    switchRow:   { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 18 },
    label:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 },
    input:       { borderWidth: 1, borderColor: C.border, backgroundColor: C.card, color: C.primary, fontFamily: F.sans, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
    ajuda:       { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 0.5, marginTop: 4 },
    resumo:      { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1, marginTop: 14 },
    btnPrimary:  { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 24 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
