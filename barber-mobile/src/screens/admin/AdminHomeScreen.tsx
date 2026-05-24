import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, RefreshControl, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

interface Metricas {
  totalAgendamentos: number;
  agendamentosDoMes: number;
  porStatus: Record<string, number>;
  barbeiroMaisRequisitado: string | null;
  totalBarbeiros: number;
  totalClientes: number;
}

export default function AdminHomeScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { signOut } = useAuth();
  const [metricas, setMetricas]     = useState<Metricas | null>(null);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useFocusEffect(useCallback(() => { fetchMetricas(); }, []));

  async function fetchMetricas() {
    try {
      const [agendamentosRes, barbRes, clientesRes] = await Promise.all([
        supabase.from('agendamentos').select('status, created_at, barbeiro_id'),
        supabase.from('barbeiros').select('id, nome').eq('ativo', true),
        supabase.from('profiles').select('id', { count: 'exact', head: true }),
      ]);

      const agendamentos = agendamentosRes.data ?? [];
      const barbeiros = barbRes.data ?? [];

      const porStatus = agendamentos.reduce<Record<string, number>>((acc, a) => {
        acc[a.status] = (acc[a.status] ?? 0) + 1;
        return acc;
      }, {});

      const inicioMes = new Date();
      inicioMes.setDate(1); inicioMes.setHours(0, 0, 0, 0);
      const agendamentosDoMes = agendamentos.filter(
        (a) => new Date(a.created_at) >= inicioMes,
      ).length;

      const contagemBarbeiro = agendamentos.reduce<Record<string, number>>((acc, a) => {
        acc[a.barbeiro_id] = (acc[a.barbeiro_id] ?? 0) + 1;
        return acc;
      }, {});

      const maxId = Object.entries(contagemBarbeiro).sort((a, b) => b[1] - a[1])[0]?.[0];
      const barbeiroMaisRequisitado = maxId
        ? (barbeiros.find((b) => b.id === maxId)?.nome ?? null)
        : null;

      setMetricas({
        totalAgendamentos: agendamentos.length,
        agendamentosDoMes,
        porStatus,
        barbeiroMaisRequisitado,
        totalBarbeiros: barbeiros.length,
        totalClientes: clientesRes.count ?? 0,
      });
    } catch { /* erro de rede */ }
    setLoading(false); setRefreshing(false);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <ScrollView style={s.screen}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchMetricas(); }} tintColor={C.accent} />}
      contentContainerStyle={{ paddingBottom: 40 }}>

      <View style={s.pageHeader}>
        <View>
          <Text style={s.pageLabel}>PAINEL ADMINISTRATIVO</Text>
          <Text style={s.pageTitle}>Dashboard</Text>
        </View>
        <TouchableOpacity onPress={signOut}>
          <Feather name="log-out" size={18} color={C.mutedFg} />
        </TouchableOpacity>
      </View>

      {!metricas ? (
        <>
          <View style={s.section}>
            <Text style={s.sectionLabel}>STATUS</Text>
            <View style={s.sectionLine} />
          </View>
          <View style={s.offlineCard}>
            <Feather name="wifi-off" size={20} color={C.warning} />
            <Text style={s.offlineTitle}>SEM DADOS</Text>
            <Text style={s.offlineText}>Verifique sua conexão e tente novamente.</Text>
          </View>
        </>
      ) : (
        <>
          <View style={s.section}>
            <Text style={s.sectionLabel}>MÉTRICAS</Text>
            <View style={s.sectionLine} />
          </View>

          <View style={s.grid}>
            <MetricCard label="TOTAL" valor={metricas.totalAgendamentos} cor={C.accent} icon="calendar" C={C} />
            <MetricCard label="ESTE MÊS" valor={metricas.agendamentosDoMes} cor={C.success} icon="trending-up" C={C} />
            <MetricCard label="BARBEIROS" valor={metricas.totalBarbeiros} cor={C.primary} icon="scissors" C={C} />
            <MetricCard label="CLIENTES" valor={metricas.totalClientes} cor={C.mutedFg} icon="users" C={C} />
          </View>

          <View style={s.section}>
            <Text style={s.sectionLabel}>POR STATUS</Text>
            <View style={s.sectionLine} />
          </View>

          <View style={{ paddingHorizontal: 24 }}>
            {Object.entries(metricas.porStatus).map(([status, qtd], i, arr) => (
              <View key={status} style={[s.statusRow, i < arr.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
                <Text style={s.statusLabel}>{status.toUpperCase()}</Text>
                <Text style={s.statusQtd}>{qtd}</Text>
              </View>
            ))}
          </View>

          {!!metricas.barbeiroMaisRequisitado && (
            <>
              <View style={s.section}>
                <Text style={s.sectionLabel}>DESTAQUE</Text>
                <View style={s.sectionLine} />
              </View>
              <View style={s.destaqueCard}>
                <Text style={s.destaqueLabel}>BARBEIRO MAIS REQUISITADO</Text>
                <Text style={s.destaqueNome}>{metricas.barbeiroMaisRequisitado}</Text>
              </View>
            </>
          )}
        </>
      )}
    </ScrollView>
  );
}

function MetricCard({ label, valor, cor, icon, C }: { label: string; valor: number; cor: string; icon: any; C: Theme }) {
  const s = React.useMemo(() => makeStyles(C), [C]);
  return (
    <View style={s.metricCard}>
      <Feather name={icon} size={16} color={cor} />
      <Text style={[s.metricValor, { color: cor }]}>{valor}</Text>
      <Text style={s.metricLabel}>{label}</Text>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:        { flex: 1, backgroundColor: C.bg },
    pageHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:     { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    section:       { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
    sectionLabel:  { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 },
    sectionLine:   { flex: 1, height: 1, backgroundColor: C.border },
    grid:          { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 24, gap: 12 },
    metricCard:    { width: '47%', borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 16, gap: 6 },
    metricValor:   { fontFamily: F.mono, fontSize: 28, letterSpacing: -1 },
    metricLabel:   { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5 },
    statusRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 14 },
    statusLabel:   { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 1.5 },
    statusQtd:     { fontFamily: F.mono, fontSize: 14, color: C.primary, letterSpacing: 1 },
    destaqueCard:  { marginHorizontal: 24, borderWidth: 1, borderColor: C.border, padding: 20, backgroundColor: C.card },
    destaqueLabel: { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 },
    destaqueNome:  { fontFamily: F.sansMedium, fontSize: 22, color: C.accent, letterSpacing: -0.5 },
    offlineCard:   { marginHorizontal: 24, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 24, alignItems: 'center', gap: 10 },
    offlineTitle:  { fontFamily: F.mono, fontSize: 12, color: C.warning, letterSpacing: 2 },
    offlineText:   { fontFamily: F.sans, fontSize: 13, color: C.mutedFg },
  });
}
