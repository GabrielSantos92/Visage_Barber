import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../../contexts/AuthContext';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import { AnaliseSalva, listarAnalises } from '../../lib/visagismoSalvos';
import ImagemVisagismo from '../../components/ImagemVisagismo';
import ErroFetch from '../../components/ErroFetch';

type Nav = StackNavigationProp<ClienteStackParamList>;

export default function VisagismoSalvosScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();

  const [analises, setAnalises] = useState<AnaliseSalva[]>([]);
  const [loading, setLoading]   = useState(true);
  const [erro, setErro]         = useState<string | null>(null);

  useFocusEffect(useCallback(() => { carregar(); }, []));

  async function carregar() {
    if (!user) return;
    try {
      setAnalises(await listarAnalises(user.id));
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar suas análises.');
    }
    setLoading(false);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <View style={s.screen}>
      {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); carregar(); }} />}

      <FlatList
        data={analises}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingBottom: 24 }}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={s.card}
            onPress={() => navigation.navigate('VisagismoResultado', { resultado: item.resultado, salvo: item })}
          >
            <View style={s.thumb}>
              <ImagemVisagismo path={item.imagem_path} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.data}>
                {new Date(item.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase()}
              </Text>
              <Text style={s.corte}>{item.resultado?.corte_principal?.nome ?? 'Análise de visagismo'}</Text>
              {item.resultado?.barba?.estilo ? <Text style={s.barba}>Barba: {item.resultado.barba.estilo}</Text> : null}
            </View>
            <Feather name="chevron-right" size={14} color={C.mutedFg} />
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={{ height: 1, backgroundColor: C.border }} />}
        ListEmptyComponent={erro ? null : (
          <View style={{ alignItems: 'center', marginTop: 60, paddingHorizontal: 24 }}>
            <Text style={s.vazioLabel}>NENHUMA ANÁLISE SALVA</Text>
            <Text style={s.vazioText}>
              Faça uma análise com IA e toque em "Salvar no app" para guardar a comparação aqui.
            </Text>
          </View>
        )}
      />
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:     { flex: 1, backgroundColor: C.bg },
    card:       { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 20 },
    thumb:      { width: 110 },
    data:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1, marginBottom: 6 },
    corte:      { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginBottom: 2 },
    barba:      { fontFamily: F.sans, fontSize: 13, color: C.mutedFg },
    vazioLabel: { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 },
    vazioText:  { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, textAlign: 'center', lineHeight: 20 },
  });
}
