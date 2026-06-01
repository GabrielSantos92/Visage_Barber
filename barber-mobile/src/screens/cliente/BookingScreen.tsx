import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, ScrollView, ActivityIndicator, Alert, Image } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Tables } from '../../types/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import { ClienteTabParamList } from '../../navigation/ClienteNavigator';

type Barbeiro = Tables<'barbeiros'>;
type Servico  = Tables<'servicos'>;

const STEPS = ['BARBEIRO', 'SERVIÇO', 'DATA', 'HORÁRIO', 'CONFIRMAR'];

export default function BookingScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const route = useRoute<RouteProp<ClienteTabParamList, 'Agendar'>>();
  const navigation = useNavigation<BottomTabNavigationProp<ClienteTabParamList>>();
  const { user } = useAuth();
  const [step, setStep]                     = useState(0);
  const [barbeiros, setBarbeiros]           = useState<Barbeiro[]>([]);
  const [servicos, setServicos]             = useState<Servico[]>([]);
  const [horarios, setHorarios]             = useState<string[]>([]);
  const [selectedBarbeiro, setSelectedBarbeiro] = useState<Barbeiro | null>(null);
  const [selectedServico, setSelectedServico]   = useState<Servico | null>(null);
  const [selectedData, setSelectedData]         = useState<Date | null>(null);
  const [selectedHorario, setSelectedHorario]   = useState<string | null>(null);
  const [loading, setLoading]               = useState(false);
  const [loadingBarbeiros, setLoadingBarbeiros] = useState(true);
  const [submitting, setSubmitting]         = useState(false);
  const [erroBarbeiros, setErroBarbeiros]   = useState<string | null>(null);

  useEffect(() => { fetchBarbeiros(); }, []);

  useEffect(() => {
    const id = route.params?.initialBarbeiroId;
    if (!id || barbeiros.length === 0) return;
    const match = barbeiros.find((b) => b.id === id);
    if (match) {
      setSelectedBarbeiro(match);
      setStep(1);
      navigation.setParams({ initialBarbeiroId: undefined });
    }
  }, [route.params?.initialBarbeiroId, barbeiros]);

  async function fetchBarbeiros() {
    setLoadingBarbeiros(true);
    try {
      const { data, error } = await supabase.from('barbeiros').select('*').eq('ativo', true);
      if (error) throw error;
setBarbeiros(data ?? []);
      setErroBarbeiros(null);
    } catch (e: any) {
      setErroBarbeiros(e.message ?? 'Erro ao carregar barbeiros.');
    }
    setLoadingBarbeiros(false);
  }

  useEffect(() => {
    if (!selectedBarbeiro) return;
    setSelectedServico(null); setSelectedData(null); setSelectedHorario(null);
    supabase.from('barbeiro_servicos').select('servico_id, servicos(*)').eq('barbeiro_id', selectedBarbeiro.id)
      .then(({ data }) => setServicos((data ?? []).map((bs: any) => bs.servicos).filter(Boolean)));
  }, [selectedBarbeiro]);

  useEffect(() => {
    if (!selectedBarbeiro || !selectedServico || !selectedData) return;
    fetchHorarios(selectedBarbeiro.id, selectedServico.duracao_min, selectedData);
  }, [selectedData]);

  async function fetchHorarios(barbeiroId: string, duracao: number, data: Date) {
    setLoading(true);
    const { data: periodos } = await supabase.from('horarios_disponiveis').select('*')
      .eq('barbeiro_id', barbeiroId).eq('dia_semana', data.getDay());
    if (!periodos?.length) { setHorarios([]); setLoading(false); return; }

    const ini = new Date(data); ini.setHours(0, 0, 0, 0);
    const fim = new Date(data); fim.setHours(23, 59, 59, 999);
    const { data: agendados } = await supabase.from('agendamentos')
      .select('data_hora, servicos(duracao_min)')
      .eq('barbeiro_id', barbeiroId).gte('data_hora', ini.toISOString()).lte('data_hora', fim.toISOString())
      .in('status', ['pendente', 'confirmado']);

    // Build real intervals so a 60-min booking at 09:00 blocks 09:30 too
    const reservas = (agendados ?? []).map((a: any) => {
      const inicio = new Date(a.data_hora).getTime();
      return { inicio, fim: inicio + (a.servicos?.duracao_min ?? 30) * 60000 };
    });

    const agora = new Date();
    const slots: string[] = [];
    for (const p of periodos) {
      const [hI, mI] = p.hora_inicio.split(':').map(Number);
      const [hF, mF] = p.hora_fim.split(':').map(Number);
      let atual = new Date(data); atual.setHours(hI, mI, 0, 0);
      const fimP = new Date(data); fimP.setHours(hF, mF, 0, 0);
      while (atual < fimP) {
        const fimSrv = new Date(atual.getTime() + duracao * 60000);
        const str = `${atual.getHours().toString().padStart(2, '0')}:${atual.getMinutes().toString().padStart(2, '0')}`;
        const conflito = reservas.some(r => atual.getTime() < r.fim && fimSrv.getTime() > r.inicio);
        if (atual > agora && fimSrv <= fimP && !conflito) slots.push(str);
        atual = new Date(atual.getTime() + 30 * 60000);
      }
    }
    setHorarios(slots);
    setLoading(false);
  }

  async function confirmar() {
    if (!user || !selectedBarbeiro || !selectedServico || !selectedData || !selectedHorario) return;
    setSubmitting(true);
    const [h, m] = selectedHorario.split(':').map(Number);
    const dataHora = new Date(selectedData); dataHora.setHours(h, m, 0, 0);
    const { error } = await supabase.from('agendamentos').insert({
      cliente_id: user.id, barbeiro_id: selectedBarbeiro.id,
      servico_id: selectedServico.id, data_hora: dataHora.toISOString(),
    });
    setSubmitting(false);
    if (error) Alert.alert('Erro', error.message);
    else Alert.alert('Agendado!', 'Seu horário foi reservado.', [{ text: 'OK', onPress: reset }]);
  }

  function reset() {
    setStep(0); setSelectedBarbeiro(null); setSelectedServico(null);
    setSelectedData(null); setSelectedHorario(null); setHorarios([]);
  }

  const dias = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() + i + 1); return d;
  }).filter(d => d.getDay() !== 0);

  const DIAS_SEMANA = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>NOVO AGENDAMENTO</Text>
        <Text style={s.pageTitle}>Agendar Horário</Text>
      </View>

      <View style={s.stepsRow}>
        {STEPS.map((label, i) => (
          <React.Fragment key={label}>
            <TouchableOpacity onPress={() => i < step && setStep(i)} disabled={i >= step}>
              <View style={[s.stepDot, i === step && s.stepDotActive, i < step && s.stepDotDone]}>
                {i < step
                  ? <Feather name="check" size={10} color={C.primaryFg} />
                  : <Text style={[s.stepNum, i === step && s.stepNumActive]}>{i + 1}</Text>}
              </View>
            </TouchableOpacity>
            {i < STEPS.length - 1 && <View style={[s.stepLine, i < step && s.stepLineDone]} />}
          </React.Fragment>
        ))}
      </View>
      <Text style={s.stepLabel}>{STEPS[step]}</Text>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>

        {step === 0 && (
          <>
            {erroBarbeiros && <ErroFetch message={erroBarbeiros} onRetry={() => { setErroBarbeiros(null); fetchBarbeiros(); }} />}
            {loadingBarbeiros && <ActivityIndicator color={C.accent} style={{ marginTop: 24 }} />}
            {!loadingBarbeiros && !erroBarbeiros && barbeiros.length === 0 && (
              <View style={{ alignItems: 'center', marginTop: 40 }}>
                <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 }}>SEM BARBEIROS</Text>
                <Text style={{ fontFamily: F.sans, fontSize: 13, color: C.mutedFg, textAlign: 'center' }}>
                  Nenhum barbeiro disponível no momento.{'\n'}Tente novamente mais tarde.
                </Text>
              </View>
            )}
            {!loadingBarbeiros && barbeiros.map((b, i) => (
              <TouchableOpacity key={b.id} style={[s.option, i < barbeiros.length - 1 && s.optionBorder]}
                onPress={() => { setSelectedBarbeiro(b); setStep(1); }}>
                <View style={s.optionLeft}>
                  <View style={s.avatar}>
                    {(b as any).foto_url
                      ? <Image source={{ uri: (b as any).foto_url }} style={{ width: 40, height: 40 }} />
                      : <Text style={s.avatarText}>{b.nome[0]}</Text>
                    }
                  </View>
                  <View>
                    <Text style={s.optionName}>{b.nome}</Text>
                    <Text style={s.optionSub}>{b.especialidade ?? 'Especialista'}</Text>
                  </View>
                </View>
                <Feather name="chevron-right" size={16} color={C.mutedFg} />
              </TouchableOpacity>
            ))}
          </>
        )}

        {step === 1 && (
          <>
            {servicos.length === 0 && <Text style={s.empty}>Nenhum serviço disponível.</Text>}
            {servicos.map((sv, i) => (
              <TouchableOpacity key={sv.id} style={[s.option, i < servicos.length - 1 && s.optionBorder]}
                onPress={() => { setSelectedServico(sv); setStep(2); }}>
                <View>
                  <Text style={s.optionName}>{sv.nome}</Text>
                  <Text style={s.optionSub}>{sv.duracao_min} min</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={s.preco}>R$ {sv.preco.toFixed(2)}</Text>
                  <Feather name="chevron-right" size={14} color={C.mutedFg} />
                </View>
              </TouchableOpacity>
            ))}
            <BackBtn onPress={() => setStep(0)} C={C} />
          </>
        )}

        {step === 2 && (
          <>
            <View style={s.diasGrid}>
              {dias.map((d) => {
                const ativo = selectedData?.toDateString() === d.toDateString();
                return (
                  <TouchableOpacity key={d.toISOString()} style={[s.diaBtn, ativo && s.diaBtnAtivo]}
                    onPress={() => { setSelectedData(d); setStep(3); }}>
                    <Text style={[s.diaSemana, ativo && { color: C.primaryFg }]}>{DIAS_SEMANA[d.getDay()]}</Text>
                    <Text style={[s.diaDia, ativo && { color: C.primaryFg }]}>{d.getDate()}</Text>
                    <Text style={[s.diaMes, ativo && { color: C.primaryFg }]}>{MESES[d.getMonth()]}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
            <BackBtn onPress={() => setStep(1)} C={C} />
          </>
        )}

        {step === 3 && (
          <>
            {loading ? <ActivityIndicator color={C.accent} /> : (
              <>
                {horarios.length === 0 && <Text style={s.empty}>Sem horários disponíveis neste dia.</Text>}
                <View style={s.horariosGrid}>
                  {horarios.map((h) => {
                    const ativo = selectedHorario === h;
                    return (
                      <TouchableOpacity key={h} style={[s.horarioBtn, ativo && s.horarioBtnAtivo]}
                        onPress={() => { setSelectedHorario(h); setStep(4); }}>
                        <Text style={[s.horarioText, ativo && { color: C.primaryFg }]}>{h}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              </>
            )}
            <BackBtn onPress={() => setStep(2)} C={C} />
          </>
        )}

        {step === 4 && selectedBarbeiro && selectedServico && selectedData && selectedHorario && (
          <>
            <View style={s.resumo}>
              <ResumoRow label="BARBEIRO" value={selectedBarbeiro.nome} C={C} />
              <ResumoRow label="SERVIÇO"  value={selectedServico.nome} C={C} />
              <ResumoRow label="DATA"     value={selectedData.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })} C={C} />
              <ResumoRow label="HORÁRIO"  value={selectedHorario} C={C} />
              <ResumoRow label="DURAÇÃO"  value={`${selectedServico.duracao_min} min`} C={C} />
              <ResumoRow label="VALOR"    value={`R$ ${selectedServico.preco.toFixed(2)}`} accent C={C} />
            </View>

            <TouchableOpacity style={s.btnPrimary} onPress={confirmar} disabled={submitting}>
              {submitting
                ? <ActivityIndicator color={C.primaryFg} size="small" />
                : <Text style={s.btnPrimaryText}>CONFIRMAR AGENDAMENTO</Text>}
            </TouchableOpacity>

            <BackBtn onPress={() => setStep(3)} C={C} />
          </>
        )}

      </ScrollView>
    </View>
  );
}

function BackBtn({ onPress, C }: { onPress: () => void; C: Theme }) {
  return (
    <TouchableOpacity onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20 }}>
      <Feather name="arrow-left" size={13} color={C.mutedFg} />
      <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.mutedFg, marginLeft: 6, letterSpacing: 1.5 }}>VOLTAR</Text>
    </TouchableOpacity>
  );
}

function ResumoRow({ label, value, accent, C }: { label: string; value: string; accent?: boolean; C: Theme }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 }}>{label}</Text>
      <Text style={{ fontFamily: F.sansMedium, fontSize: 14, color: accent ? C.accent : C.primary, flex: 1, textAlign: 'right' }}>{value}</Text>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    pageHeader:     { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:      { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    stepsRow:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
    stepDot:        { width: 24, height: 24, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
    stepDotActive:  { borderColor: C.primary, backgroundColor: C.primary },
    stepDotDone:    { borderColor: C.muted, backgroundColor: C.muted },
    stepNum:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg },
    stepNumActive:  { color: C.primaryFg },
    stepLine:       { flex: 1, height: 1, backgroundColor: C.border, marginHorizontal: 4 },
    stepLineDone:   { backgroundColor: C.muted },
    stepLabel:      { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, paddingHorizontal: 24, marginBottom: 4 },
    option:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
    optionBorder:   { borderBottomWidth: 1, borderBottomColor: C.border },
    optionLeft:     { flexDirection: 'row', alignItems: 'center' },
    avatar:         { width: 40, height: 40, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    avatarText:     { fontFamily: F.mono, fontSize: 15, color: C.primary },
    optionName:     { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    optionSub:      { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    preco:          { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    diasGrid:       { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    diaBtn:         { borderWidth: 1, borderColor: C.border, padding: 10, alignItems: 'center', width: '22%' },
    diaBtnAtivo:    { backgroundColor: C.primary, borderColor: C.primary },
    diaSemana:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    diaDia:         { fontFamily: F.sansMedium, fontSize: 18, color: C.primary, marginVertical: 2 },
    diaMes:         { fontFamily: F.mono, fontSize: 9, color: C.mutedFg },
    horariosGrid:   { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    horarioBtn:     { borderWidth: 1, borderColor: C.border, paddingVertical: 10, paddingHorizontal: 14 },
    horarioBtnAtivo:{ backgroundColor: C.primary, borderColor: C.primary },
    horarioText:    { fontFamily: F.mono, fontSize: 13, color: C.primary },
    resumo:         { borderWidth: 1, borderColor: C.border, marginBottom: 24 },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center' },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    empty:          { fontFamily: F.sans, color: C.mutedFg, textAlign: 'center', marginTop: 20 },
  });
}
