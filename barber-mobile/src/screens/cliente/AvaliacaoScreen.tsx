import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, TextInput, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

type Route = RouteProp<ClienteStackParamList, 'Avaliacao'>;

const NOTAS = [
  { valor: 1, label: 'PÉSSIMO' },
  { valor: 2, label: 'RUIM' },
  { valor: 3, label: 'REGULAR' },
  { valor: 4, label: 'BOM' },
  { valor: 5, label: 'EXCELENTE' },
];

export default function AvaliacaoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user } = useAuth();
  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { agendamentoId } = route.params;

  const [nota, setNota]           = useState(0);
  const [comentario, setComentario] = useState('');
  const [loading, setLoading]     = useState(false);

  async function enviar() {
    if (nota === 0) { Alert.alert('Atenção', 'Selecione uma nota.'); return; }
    if (!user) return;
    setLoading(true);
    const { data: agendamento } = await supabase.from('agendamentos').select('barbeiro_id').eq('id', agendamentoId).single();
    const { error } = await supabase.from('avaliacoes').insert({
      agendamento_id: agendamentoId,
      cliente_id: user.id,
      barbeiro_id: agendamento?.barbeiro_id ?? '',
      nota,
      comentario: comentario || null,
    });
    setLoading(false);
    if (error) Alert.alert('Erro', error.message);
    else Alert.alert('Obrigado!', 'Avaliação enviada.', [{ text: 'OK', onPress: () => navigation.goBack() }]);
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
      <Text style={s.sectionLabel}>SELECIONE UMA NOTA</Text>

      <View style={s.notasRow}>
        {NOTAS.map((n) => {
          const ativo = nota >= n.valor;
          return (
            <TouchableOpacity key={n.valor} onPress={() => setNota(n.valor)} style={[s.notaBtn, ativo && s.notaBtnAtivo]}>
              <Feather name="star" size={22} color={ativo ? C.primaryFg : C.border} />
            </TouchableOpacity>
          );
        })}
      </View>

      {nota > 0 && (
        <Text style={s.notaLabel}>{NOTAS[nota - 1].label}</Text>
      )}

      <Text style={[s.sectionLabel, { marginTop: 28 }]}>COMENTÁRIO (OPCIONAL)</Text>
      <TextInput
        style={s.textarea}
        value={comentario}
        onChangeText={setComentario}
        placeholder="Conte como foi sua experiência..."
        placeholderTextColor={C.mutedFg}
        multiline
        numberOfLines={4}
      />

      <TouchableOpacity style={s.btnPrimary} onPress={enviar} disabled={loading}>
        {loading
          ? <ActivityIndicator color={C.primaryFg} size="small" />
          : <Text style={s.btnPrimaryText}>ENVIAR AVALIAÇÃO</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    sectionLabel:   { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 16 },
    notasRow:       { flexDirection: 'row', gap: 8, marginBottom: 12 },
    notaBtn:        { flex: 1, borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center' },
    notaBtnAtivo:   { backgroundColor: C.primary, borderColor: C.primary },
    notaLabel:      { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 2, textAlign: 'center', marginBottom: 8 },
    textarea:       { borderWidth: 1, borderColor: C.border, backgroundColor: C.card, color: C.primary, fontFamily: F.sans, fontSize: 14, padding: 16, textAlignVertical: 'top', minHeight: 110, marginBottom: 24 },
    btnPrimary:     { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center' },
    btnPrimaryText: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
