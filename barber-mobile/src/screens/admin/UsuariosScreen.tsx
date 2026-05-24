import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, RefreshControl } from 'react-native';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';

interface Usuario {
  id: string;
  nome: string;
  telefone: string | null;
  created_at: string;
  user_id: string;
}

export default function UsuariosScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const [usuarios, setUsuarios]     = useState<Usuario[]>([]);
  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [erro, setErro]             = useState<string | null>(null);

  useEffect(() => { fetchUsuarios(); }, []);

  async function fetchUsuarios() {
    try {
      const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      setUsuarios(data ?? []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar usuários.');
    }
    setLoading(false); setRefreshing(false);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>GESTÃO</Text>
        <Text style={s.pageTitle}>Usuários</Text>
      </View>

      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); fetchUsuarios(); }} />}

      <FlatList
        data={usuarios}
        keyExtractor={(item) => item.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); fetchUsuarios(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 40 }}
        renderItem={({ item, index }) => {
          const inicial = (item.nome || 'U')[0].toUpperCase();
          const desde = new Date(item.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).toUpperCase();
          return (
            <View style={[s.item, index < usuarios.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
              <View style={s.avatar}>
                <Text style={s.avatarText}>{inicial}</Text>
              </View>
              <View style={s.info}>
                <Text style={s.nome}>{item.nome || '(sem nome)'}</Text>
                <Text style={s.detalhe}>{item.telefone ?? 'Sem telefone'}</Text>
              </View>
              <Text style={s.desde}>{desde}</Text>
            </View>
          );
        }}
        ListHeaderComponent={
          <View style={s.listHeader}>
            <Text style={s.listHeaderLabel}>TOTAL</Text>
            <Text style={s.listHeaderCount}>{usuarios.length}</Text>
          </View>
        }
        ListEmptyComponent={<Text style={{ fontFamily: F.sans, color: C.mutedFg, textAlign: 'center', marginTop: 40, paddingHorizontal: 24 }}>Nenhum usuário cadastrado.</Text>}
      />
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:           { flex: 1, backgroundColor: C.bg },
    pageHeader:       { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:        { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    listHeader:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: C.border },
    listHeaderLabel:  { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    listHeaderCount:  { fontFamily: F.mono, fontSize: 14, color: C.primary },
    item:             { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 16 },
    avatar:           { width: 36, height: 36, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    avatarText:       { fontFamily: F.mono, fontSize: 14, color: C.accent },
    info:             { flex: 1 },
    nome:             { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    detalhe:          { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    desde:            { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
  });
}
