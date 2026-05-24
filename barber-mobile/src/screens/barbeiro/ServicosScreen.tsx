import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';

interface Servico {
  id: string;
  nome: string;
  preco: number;
  duracao_min: number;
  descricao: string | null;
}

export default function ServicosScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user } = useAuth();
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro]         = useState<string | null>(null);

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
    </View>
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
  });
}
