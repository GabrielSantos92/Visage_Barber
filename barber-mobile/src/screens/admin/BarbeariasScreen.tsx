import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, FlatList, ActivityIndicator,
  TouchableOpacity, Alert, TextInput, Modal, ScrollView, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { supabase } from '../../lib/supabase';
import { Tables } from '../../types/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import { api } from '../../lib/api';

type Barbeiro = Tables<'barbeiros'>;

interface Servico { id: string; nome: string; preco: number; duracao_min: number }

const DIAS_NOMES = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

interface DiaConfig {
  ativo: boolean;
  inicio: string;
  fim: string;
  almoco: boolean;
  almocoInicio: string;
  almocoFim: string;
}

function defaultAgenda(): DiaConfig[] {
  return DIAS_NOMES.map((_, i) => ({
    ativo: i >= 1 && i <= 6,
    inicio: '09:00',
    fim: '18:00',
    almoco: false,
    almocoInicio: '12:00',
    almocoFim: '13:00',
  }));
}

export default function BarbeariasScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [barbeiros, setBarbeiros]             = useState<Barbeiro[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [erro, setErro]                       = useState<string | null>(null);

  // Modal criar/editar
  const [modoModal, setModoModal]             = useState<'criar' | 'editar'>('criar');
  const [modalVisible, setModalVisible]       = useState(false);
  const [editando, setEditando]               = useState<Barbeiro | null>(null);
  const [nome, setNome]                       = useState('');
  const [especialidade, setEspecialidade]     = useState('');
  const [email, setEmail]                     = useState('');
  const [senha, setSenha]                     = useState('');
  const [telefone, setTelefone]               = useState('');
  const [mostrarSenha, setMostrarSenha]       = useState(false);
  const [saving, setSaving]                   = useState(false);

  // Modal serviços
  const [gerenciando, setGerenciando]         = useState<Barbeiro | null>(null);
  const [todosServicos, setTodosServicos]     = useState<Servico[]>([]);
  const [vinculados, setVinculados]           = useState<Set<string>>(new Set());
  const [loadingServicos, setLoadingServicos] = useState(false);
  const [togglendoId, setTogglendoId]         = useState<string | null>(null);

  // Modal agenda
  const [agendando, setAgendando]             = useState<Barbeiro | null>(null);
  const [agenda, setAgenda]                   = useState<DiaConfig[]>(defaultAgenda());
  const [loadingAgenda, setLoadingAgenda]     = useState(false);
  const [savingAgenda, setSavingAgenda]       = useState(false);

  useEffect(() => { fetchBarbeiros(); }, []);

  async function fetchBarbeiros() {
    try {
      const { data, error } = await supabase.from('barbeiros').select('*').order('nome');
      if (error) throw error;
setBarbeiros(data ?? []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar barbeiros.');
    }
    setLoading(false);
  }

  function abrirCriar() {
    setModoModal('criar'); setEditando(null);
    setNome(''); setEspecialidade(''); setEmail(''); setSenha(''); setTelefone('');
    setModalVisible(true);
  }

  function abrirEditar(b: Barbeiro) {
    setModoModal('editar'); setEditando(b);
    setNome(b.nome); setEspecialidade(b.especialidade ?? '');
    setEmail(''); setSenha(''); setTelefone('');
    setModalVisible(true);
  }

  async function salvarBarbeiro() {
    if (!nome.trim()) { Alert.alert('Erro', 'Nome é obrigatório.'); return; }

    if (modoModal === 'criar') {
      if (!email.trim()) { Alert.alert('Erro', 'Email é obrigatório.'); return; }
      if (senha.length < 6) { Alert.alert('Erro', 'Senha deve ter no mínimo 6 caracteres.'); return; }
      setSaving(true);
      try {
        await api.post('/api/admin/create-barbeiro', {
          email: email.trim(),
          password: senha,
          nome: nome.trim(),
          telefone: telefone.trim() || undefined,
          especialidade: especialidade.trim() || undefined,
        });
      } catch (e: any) {
        setSaving(false);
        const msg = e?.message ?? 'Erro ao criar barbeiro.';
        Alert.alert('Erro', msg.includes('409') ? 'Este email já está cadastrado.' : msg);
        return;
      }
    } else if (editando) {
      setSaving(true);
      const { error } = await supabase.from('barbeiros')
        .update({ nome: nome.trim(), especialidade: especialidade.trim() || null })
        .eq('id', editando.id);
      setSaving(false);
      if (error) { Alert.alert('Erro', error.message); return; }
    }

    setSaving(false);
    setModalVisible(false);
    setNome(''); setEspecialidade(''); setEmail(''); setSenha(''); setTelefone('');
    fetchBarbeiros();
  }

  async function alternarAtivo(b: Barbeiro) {
    if (b.ativo) {
      const { data: abertos } = await supabase
        .from('agendamentos')
        .select('id')
        .eq('barbeiro_id', b.id)
        .in('status', ['pendente', 'confirmado']);

      if (abertos && abertos.length > 0) {
        Alert.alert(
          'Não é possível inativar',
          `${b.nome} tem ${abertos.length} agendamento(s) em aberto. Cancele-os antes de inativar.`,
        );
        return;
      }

      Alert.alert('Inativar barbeiro', `Deseja inativar ${b.nome}?`, [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Inativar', style: 'destructive', onPress: async () => {
          await supabase.from('barbeiros').update({ ativo: false }).eq('id', b.id);
          fetchBarbeiros();
        }},
      ]);
    } else {
      await supabase.from('barbeiros').update({ ativo: true }).eq('id', b.id);
      fetchBarbeiros();
    }
  }

  async function abrirServicos(b: Barbeiro) {
    setGerenciando(b); setLoadingServicos(true);
    const [svRes, bsRes] = await Promise.all([
      supabase.from('servicos').select('id, nome, preco, duracao_min').order('nome'),
      supabase.from('barbeiro_servicos').select('servico_id').eq('barbeiro_id', b.id),
    ]);
    setTodosServicos((svRes.data ?? []) as Servico[]);
    setVinculados(new Set((bsRes.data ?? []).map((r: any) => r.servico_id)));
    setLoadingServicos(false);
  }

  async function toggleServico(servicoId: string) {
    if (!gerenciando || togglendoId) return;
    setTogglendoId(servicoId);
    const jaVinculado = vinculados.has(servicoId);
    setVinculados((prev) => {
      const next = new Set(prev);
      jaVinculado ? next.delete(servicoId) : next.add(servicoId);
      return next;
    });
    if (jaVinculado) {
      await supabase.from('barbeiro_servicos').delete().eq('barbeiro_id', gerenciando.id).eq('servico_id', servicoId);
    } else {
      await supabase.from('barbeiro_servicos').insert({ barbeiro_id: gerenciando.id, servico_id: servicoId });
    }
    setTogglendoId(null);
  }

  async function abrirAgenda(b: Barbeiro) {
    setAgendando(b);
    setLoadingAgenda(true);
    const { data } = await supabase.from('horarios_disponiveis').select('*').eq('barbeiro_id', b.id);
    const config = defaultAgenda();

    // Supabase returns time columns as "HH:MM:SS" — keep only "HH:MM"
    const t5 = (v: string) => (v ?? '').substring(0, 5);

    const byDia: Record<number, { hora_inicio: string; hora_fim: string }[]> = {};
    for (const h of (data ?? [])) {
      if (!byDia[h.dia_semana]) byDia[h.dia_semana] = [];
      byDia[h.dia_semana].push({ hora_inicio: t5(h.hora_inicio), hora_fim: t5(h.hora_fim) });
    }

    for (const [diaStr, periodos] of Object.entries(byDia)) {
      const dia = Number(diaStr);
      periodos.sort((a, b) => a.hora_inicio.localeCompare(b.hora_inicio));
      config[dia].ativo = true;
      if (periodos.length === 1) {
        config[dia].inicio       = periodos[0].hora_inicio;
        config[dia].fim          = periodos[0].hora_fim;
        config[dia].almoco       = false;
      } else {
        config[dia].inicio       = periodos[0].hora_inicio;
        config[dia].almocoInicio = periodos[0].hora_fim;
        config[dia].almocoFim    = periodos[1].hora_inicio;
        config[dia].fim          = periodos[1].hora_fim;
        config[dia].almoco       = true;
      }
    }

    setAgenda(config);
    setLoadingAgenda(false);
  }

  function updateDia(i: number, patch: Partial<DiaConfig>) {
    setAgenda((prev) => prev.map((d, idx) => idx === i ? { ...d, ...patch } : d));
  }

  async function salvarAgenda() {
    if (!agendando) return;
    const timeRx = /^\d{2}:\d{2}$/;
    for (let i = 0; i < agenda.length; i++) {
      const d = agenda[i];
      if (!d.ativo) continue;
      if (!timeRx.test(d.inicio) || !timeRx.test(d.fim)) {
        Alert.alert('Erro', `Horário inválido em ${DIAS_NOMES[i]}. Use HH:MM.`); return;
      }
      if (d.inicio >= d.fim) {
        Alert.alert('Erro', `Em ${DIAS_NOMES[i]}, o início deve ser anterior ao fim.`); return;
      }
      if (d.almoco) {
        if (!timeRx.test(d.almocoInicio) || !timeRx.test(d.almocoFim)) {
          Alert.alert('Erro', `Horário de almoço inválido em ${DIAS_NOMES[i]}.`); return;
        }
        if (d.almocoInicio <= d.inicio || d.almocoFim >= d.fim || d.almocoInicio >= d.almocoFim) {
          Alert.alert('Erro', `Pausa de almoço inválida em ${DIAS_NOMES[i]}.`); return;
        }
      }
    }

    setSavingAgenda(true);
    await supabase.from('horarios_disponiveis').delete().eq('barbeiro_id', agendando.id);

    const inserts: any[] = [];
    agenda.forEach((d, i) => {
      if (!d.ativo) return;
      if (!d.almoco) {
        inserts.push({ barbeiro_id: agendando.id, dia_semana: i, hora_inicio: d.inicio, hora_fim: d.fim });
      } else {
        inserts.push({ barbeiro_id: agendando.id, dia_semana: i, hora_inicio: d.inicio, hora_fim: d.almocoInicio });
        inserts.push({ barbeiro_id: agendando.id, dia_semana: i, hora_inicio: d.almocoFim, hora_fim: d.fim });
      }
    });

    if (inserts.length > 0) {
      const { error } = await supabase.from('horarios_disponiveis').insert(inserts);
      if (error) { setSavingAgenda(false); Alert.alert('Erro', error.message); return; }
    }

    setSavingAgenda(false);
    setAgendando(null);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <View>
          <Text style={s.pageLabel}>GESTÃO</Text>
          <Text style={s.pageTitle}>Barbeiros</Text>
        </View>
        <TouchableOpacity style={s.addBtn} onPress={abrirCriar}>
          <Feather name="plus" size={14} color={C.primaryFg} />
          <Text style={s.addBtnText}>NOVO</Text>
        </TouchableOpacity>
      </View>

      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); fetchBarbeiros(); }} />}

      <FlatList
        data={barbeiros}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item, index }) => (
          <View style={[s.item, index < barbeiros.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
            <View style={s.avatar}>
              {(item as any).foto_url
                ? <Image source={{ uri: (item as any).foto_url }} style={{ width: 36, height: 36 }} />
                : <Text style={s.avatarText}>{item.nome[0].toUpperCase()}</Text>
              }
            </View>
            <View style={s.itemInfo}>
              <Text style={s.itemNome}>{item.nome}</Text>
              <Text style={s.itemEsp}>{item.especialidade ?? 'Sem especialidade'}</Text>
            </View>
            <View style={s.itemActions}>
              <TouchableOpacity onPress={() => abrirAgenda(item)} style={s.iconBtn}>
                <Feather name="calendar" size={14} color={C.mutedFg} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => abrirServicos(item)} style={s.iconBtn}>
                <Feather name="list" size={14} color={C.mutedFg} />
              </TouchableOpacity>
              <TouchableOpacity onPress={() => abrirEditar(item)} style={s.iconBtn}>
                <Feather name="edit-2" size={14} color={C.mutedFg} />
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.statusBtn, { borderColor: item.ativo ? C.success : C.border }]}
                onPress={() => alternarAtivo(item)}>
                <Text style={[s.statusText, { color: item.ativo ? C.success : C.mutedFg }]}>
                  {item.ativo ? 'ATIVO' : 'INATIVO'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
        ListEmptyComponent={
          <Text style={{ fontFamily: F.sans, color: C.mutedFg, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>
            Nenhum barbeiro cadastrado.
          </Text>
        }
      />

      {/* ── Modal criar / editar ── */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <View style={s.overlay}>
          <ScrollView style={s.modal} contentContainerStyle={{ padding: 24 }} keyboardShouldPersistTaps="handled">
            <View style={s.modalHeader}>
              <Text style={s.modalLabel}>{modoModal === 'criar' ? 'NOVO BARBEIRO' : 'EDITAR BARBEIRO'}</Text>
              <TouchableOpacity onPress={() => setModalVisible(false)}>
                <Feather name="x" size={18} color={C.mutedFg} />
              </TouchableOpacity>
            </View>

            <Text style={s.fieldLabel}>NOME *</Text>
            <View style={s.inputRow}>
              <Feather name="user" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
              <TextInput style={s.input} value={nome} onChangeText={setNome}
                placeholder="Nome do barbeiro" placeholderTextColor={C.mutedFg} />
            </View>

            <Text style={s.fieldLabel}>ESPECIALIDADE</Text>
            <View style={s.inputRow}>
              <Feather name="scissors" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
              <TextInput style={s.input} value={especialidade} onChangeText={setEspecialidade}
                placeholder="Ex: Degradê, Navalhado" placeholderTextColor={C.mutedFg} />
            </View>

            {modoModal === 'criar' && (
              <>
                <Text style={s.fieldLabel}>TELEFONE</Text>
                <View style={s.inputRow}>
                  <Feather name="phone" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
                  <TextInput style={s.input} value={telefone} onChangeText={setTelefone}
                    placeholder="(11) 99999-9999" placeholderTextColor={C.mutedFg}
                    keyboardType="phone-pad" />
                </View>

                <Text style={s.fieldLabel}>EMAIL DE ACESSO *</Text>
                <View style={s.inputRow}>
                  <Feather name="mail" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
                  <TextInput style={s.input} value={email} onChangeText={setEmail}
                    placeholder="barbeiro@email.com" placeholderTextColor={C.mutedFg}
                    autoCapitalize="none" keyboardType="email-address" />
                </View>

                <Text style={s.fieldLabel}>SENHA *</Text>
                <View style={s.inputRow}>
                  <Feather name="lock" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
                  <TextInput style={[s.input, { flex: 1 }]} value={senha} onChangeText={setSenha}
                    placeholder="Mínimo 6 caracteres" placeholderTextColor={C.mutedFg}
                    secureTextEntry={!mostrarSenha} />
                  <TouchableOpacity onPress={() => setMostrarSenha(!mostrarSenha)} style={{ paddingRight: 14, paddingLeft: 8 }}>
                    <Feather name={mostrarSenha ? 'eye-off' : 'eye'} size={14} color={C.mutedFg} />
                  </TouchableOpacity>
                </View>
              </>
            )}

            <TouchableOpacity style={s.btnPrimary} onPress={salvarBarbeiro} disabled={saving}>
              <Text style={s.btnPrimaryText}>
                {saving ? 'SALVANDO...' : modoModal === 'criar' ? 'CRIAR BARBEIRO' : 'SALVAR ALTERAÇÕES'}
              </Text>
            </TouchableOpacity>
          </ScrollView>
        </View>
      </Modal>

      {/* ── Modal serviços ── */}
      <Modal visible={!!gerenciando} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={[s.modal, { maxHeight: '80%' }]}>
            <View style={{ padding: 24, paddingBottom: 16 }}>
              <View style={s.modalHeader}>
                <Text style={s.modalLabel}>SERVIÇOS — {gerenciando?.nome?.toUpperCase()}</Text>
                <TouchableOpacity onPress={() => setGerenciando(null)}>
                  <Feather name="x" size={18} color={C.mutedFg} />
                </TouchableOpacity>
              </View>
            </View>
            {loadingServicos ? (
              <ActivityIndicator color={C.accent} style={{ margin: 24 }} />
            ) : (
              <>
                <ScrollView contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}>
                  {todosServicos.map((sv, i) => {
                    const ativo = vinculados.has(sv.id);
                    return (
                      <TouchableOpacity key={sv.id}
                        style={[s.servicoItem, i < todosServicos.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}
                        onPress={() => toggleServico(sv.id)}
                        disabled={togglendoId === sv.id}>
                        <Feather name={ativo ? 'check-square' : 'square'} size={18} color={ativo ? C.accent : C.mutedFg} />
                        <View style={{ flex: 1, marginLeft: 14 }}>
                          <Text style={s.servicoNome}>{sv.nome}</Text>
                          <Text style={s.servicoMeta}>R$ {sv.preco.toFixed(2)}  ·  {sv.duracao_min} min</Text>
                        </View>
                      </TouchableOpacity>
                    );
                  })}
                  {todosServicos.length === 0 && (
                    <Text style={{ fontFamily: F.sans, color: C.mutedFg, fontSize: 13 }}>
                      Nenhum serviço cadastrado no sistema.
                    </Text>
                  )}
                </ScrollView>
                <View style={{ padding: 24, paddingTop: 12 }}>
                  <TouchableOpacity style={s.btnPrimary} onPress={() => setGerenciando(null)}>
                    <Text style={s.btnPrimaryText}>CONFIRMAR</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>

      {/* ── Modal agenda ── */}
      <Modal visible={!!agendando} transparent animationType="slide">
        <View style={s.overlay}>
          <View style={[s.modal, { maxHeight: '92%' }]}>
            <View style={{ padding: 24, paddingBottom: 12 }}>
              <View style={[s.modalHeader, { marginBottom: 4 }]}>
                <View>
                  <Text style={s.modalLabel}>AGENDA</Text>
                  <Text style={{ fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginTop: 2 }}>
                    {agendando?.nome}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => setAgendando(null)}>
                  <Feather name="x" size={18} color={C.mutedFg} />
                </TouchableOpacity>
              </View>
              <Text style={{ fontFamily: F.sans, fontSize: 12, color: C.mutedFg, lineHeight: 18 }}>
                Ative os dias e defina o horário de trabalho. Toque em ☕ para adicionar pausa de almoço.
              </Text>
            </View>

            {loadingAgenda ? (
              <ActivityIndicator color={C.accent} style={{ margin: 24 }} />
            ) : (
              <>
                <ScrollView
                  contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}
                  keyboardShouldPersistTaps="handled">
                  {DIAS_NOMES.map((diaNome, i) => {
                    const d = agenda[i];
                    return (
                      <View key={i} style={[s.diaContainer, i < DIAS_NOMES.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                        <View style={s.diaRow}>
                          <TouchableOpacity onPress={() => updateDia(i, { ativo: !d.ativo })}>
                            <View style={[s.toggleTrack, d.ativo && { backgroundColor: C.accent, justifyContent: 'flex-end' }]}>
                              <View style={s.toggleThumb} />
                            </View>
                          </TouchableOpacity>

                          <Text style={[s.diaNome, !d.ativo && { color: C.mutedFg }]}>{diaNome}</Text>

                          {d.ativo ? (
                            <>
                              <TimeInput value={d.inicio} onChange={(v) => updateDia(i, { inicio: v })} C={C} s={s} />
                              <Text style={s.timeArrow}>→</Text>
                              <TimeInput value={d.fim} onChange={(v) => updateDia(i, { fim: v })} C={C} s={s} />
                              <TouchableOpacity
                                onPress={() => updateDia(i, { almoco: !d.almoco })}
                                style={[s.almocoBtn, d.almoco && { borderColor: C.accent }]}>
                                <Text style={{ fontSize: 13, color: d.almoco ? C.accent : C.mutedFg }}>☕</Text>
                              </TouchableOpacity>
                            </>
                          ) : (
                            <Text style={s.folga}>FOLGA</Text>
                          )}
                        </View>

                        {d.ativo && d.almoco && (
                          <View style={s.almocoRow}>
                            <Text style={s.almocoLabel}>ALMOÇO</Text>
                            <TimeInput value={d.almocoInicio} onChange={(v) => updateDia(i, { almocoInicio: v })} C={C} s={s} />
                            <Text style={s.timeArrow}>→</Text>
                            <TimeInput value={d.almocoFim} onChange={(v) => updateDia(i, { almocoFim: v })} C={C} s={s} />
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
                <View style={{ padding: 24, paddingTop: 12 }}>
                  <TouchableOpacity style={s.btnPrimary} onPress={salvarAgenda} disabled={savingAgenda}>
                    <Text style={s.btnPrimaryText}>{savingAgenda ? 'SALVANDO...' : 'SALVAR AGENDA'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

function TimeInput({ value, onChange, C, s }: { value: string; onChange: (v: string) => void; C: Theme; s: any }) {
  return (
    <TextInput
      style={s.timeInput}
      value={value}
      onChangeText={onChange}
      placeholder="09:00"
      placeholderTextColor={C.mutedFg}
      maxLength={5}
    />
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    pageHeader:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:      { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    addBtn:         { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.primary, paddingHorizontal: 14, paddingVertical: 10 },
    addBtnText:     { fontFamily: F.mono, fontSize: 10, color: C.primaryFg, letterSpacing: 1.5 },
    item:           { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
    avatar:         { width: 36, height: 36, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    avatarText:     { fontFamily: F.mono, fontSize: 14, color: C.accent },
    itemInfo:       { flex: 1 },
    itemNome:       { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    itemEsp:        { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    itemActions:    { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn:        { padding: 4 },
    statusBtn:      { borderWidth: 1, paddingHorizontal: 8, paddingVertical: 6 },
    statusText:     { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5 },
    overlay:        { flex: 1, backgroundColor: '#000000cc', justifyContent: 'flex-end' },
    modal:          { backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border },
    modalHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 },
    modalLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 2 },
    fieldLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
    inputRow:       { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card, marginBottom: 16 },
    input:          { flex: 1, color: C.primary, fontFamily: F.sans, fontSize: 14, paddingHorizontal: 12, paddingVertical: 14 },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginTop: 8, marginBottom: 20 },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    servicoItem:    { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
    servicoNome:    { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    servicoMeta:    { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 0.5 },
    // Agenda styles
    diaContainer:   { paddingVertical: 14 },
    diaRow:         { flexDirection: 'row', alignItems: 'center', gap: 10 },
    toggleTrack:    { width: 36, height: 20, borderRadius: 10, backgroundColor: C.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 2 },
    toggleThumb:    { width: 16, height: 16, borderRadius: 8, backgroundColor: '#ffffff' },
    diaNome:        { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1, width: 30 },
    timeArrow:      { fontFamily: F.mono, fontSize: 11, color: C.mutedFg },
    almocoBtn:      { borderWidth: 1, borderColor: C.border, paddingHorizontal: 7, paddingVertical: 5 },
    folga:          { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5 },
    almocoRow:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8, paddingLeft: 46 },
    almocoLabel:    { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1, width: 46 },
    timeInput:      { fontFamily: F.mono, fontSize: 13, color: C.primary, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, width: 52, paddingHorizontal: 4, paddingVertical: 8, textAlign: 'center' },
  });
}
