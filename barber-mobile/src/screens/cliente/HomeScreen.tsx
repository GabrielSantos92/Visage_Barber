import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Tables } from '../../types/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import { ClienteTabParamList } from '../../navigation/ClienteNavigator';

type Barbeiro = Tables<'barbeiros'>;

export default function HomeScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const navigation = useNavigation<BottomTabNavigationProp<ClienteTabParamList>>();
  const { user, signOut } = useAuth();
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  const [loading, setLoading] = useState(true);
  const [nomeUsuario, setNomeUsuario] = useState('');
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => { fetchBarbeiros(); fetchPerfil(); }, []);

  async function fetchBarbeiros() {
    try {
      const { data, error } = await supabase.from('barbeiros').select('*').eq('ativo', true);
      if (error) throw error;
      setBarbeiros(data ?? []);
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar barbeiros.');
    }
    setLoading(false);
  }

  async function fetchPerfil() {
    if (!user) return;
    const { data } = await supabase.from('profiles').select('nome').eq('user_id', user.id).single();
    setNomeUsuario(data?.nome ?? '');
  }

  return (
    <View style={s.screen}>
      <View style={s.header}>
        <View style={s.logoRow}>
          <View style={s.logoSquare}><View style={s.logoInner} /></View>
          <Text style={s.logoText}>VISAGE BARBER</Text>
        </View>
        <TouchableOpacity onPress={signOut}>
          <Feather name="log-out" size={18} color={C.mutedFg} />
        </TouchableOpacity>
      </View>

      <View style={s.welcome}>
        <Text style={s.welcomeLabel}>BEM-VINDO</Text>
        <Text style={s.welcomeName}>{nomeUsuario || user?.email?.split('@')[0]}</Text>
      </View>

      <View style={s.sectionHeader}>
        <Text style={s.sectionLabel}>BARBEIROS DISPONÍVEIS</Text>
        <View style={s.sectionLine} />
      </View>

      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); setLoading(true); fetchBarbeiros(); }} />}

      {loading ? (
        <ActivityIndicator color={C.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={barbeiros}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}
          renderItem={({ item }) => (
            <TouchableOpacity style={s.card} onPress={() => navigation.navigate('Agendar', { initialBarbeiroId: item.id })}>
              <View style={s.cardLeft}>
                <View style={s.avatar}>
                  <Text style={s.avatarText}>{item.nome[0].toUpperCase()}</Text>
                </View>
                <View>
                  <Text style={s.cardName}>{item.nome}</Text>
                  <Text style={s.cardEsp}>{item.especialidade ?? 'Especialista em cortes'}</Text>
                </View>
              </View>
              <Feather name="chevron-right" size={16} color={C.mutedFg} />
            </TouchableOpacity>
          )}
          ItemSeparatorComponent={() => <View style={s.separator} />}
          ListEmptyComponent={<Text style={s.empty}>Nenhum barbeiro cadastrado.</Text>}
        />
      )}
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:       { flex: 1, backgroundColor: C.bg },
    header:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    logoRow:      { flexDirection: 'row', alignItems: 'center' },
    logoSquare:   { width: 24, height: 24, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginRight: 8 },
    logoInner:    { width: 12, height: 12, backgroundColor: C.bg },
    logoText:     { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 },
    welcome:      { paddingHorizontal: 24, paddingVertical: 20 },
    welcomeLabel: { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    welcomeName:  { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    sectionHeader:{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginBottom: 16 },
    sectionLabel: { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 },
    sectionLine:  { flex: 1, height: 1, backgroundColor: C.border },
    card:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 16 },
    cardLeft:     { flexDirection: 'row', alignItems: 'center' },
    avatar:       { width: 44, height: 44, backgroundColor: C.muted, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
    avatarText:   { fontFamily: F.mono, fontSize: 16, color: C.primary },
    cardName:     { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    cardEsp:      { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    statusBadge:  { borderWidth: 1, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 3 },
    statusText:   { fontFamily: F.mono, fontSize: 9, color: C.accent, letterSpacing: 1.5 },
    separator:    { height: 1, backgroundColor: C.border },
    empty:        { fontFamily: F.sans, color: C.mutedFg, textAlign: 'center', marginTop: 60 },
  });
}
