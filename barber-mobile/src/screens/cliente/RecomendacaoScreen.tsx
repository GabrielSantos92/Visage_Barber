import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import { api } from '../../lib/api';

type Route = RouteProp<ClienteStackParamList, 'Recomendacao'>;

const DESCRICOES: Record<string, { titulo: string; descricao: string; dica: string }> = {
  oval:       { titulo: 'Oval',       descricao: 'Formato equilibrado e versátil.',            dica: 'Praticamente qualquer estilo funciona bem.' },
  redondo:    { titulo: 'Redondo',    descricao: 'Traços circulares e suaves.',               dica: 'Prefira cortes com volume no topo para alongar.' },
  quadrado:   { titulo: 'Quadrado',   descricao: 'Mandíbula angular e testa larga.',          dica: 'Texturas suaves equilibram os ângulos marcados.' },
  triangular: { titulo: 'Triangular', descricao: 'Testa larga, queixo mais estreito.',        dica: 'Volume no topo equilibra as proporções.' },
  losango:    { titulo: 'Losango',    descricao: 'Maçãs proeminentes, testa e queixo finos.', dica: 'Franja lateral e laterais estruturadas funcionam bem.' },
  oblongo:    { titulo: 'Oblongo',    descricao: 'Rosto comprido e estreito.',                dica: 'Evite cortes muito altos. Barba ajuda a equilibrar.' },
};

const RECOMENDACOES_LOCAL: Record<string, string[]> = {
  oval:       ['Undercut', 'Quiff', 'Pompadour', 'Slick Back', 'Crop Top', 'Textured Fringe'],
  redondo:    ['Fade Alto', 'Mohawk', 'Quiff com volume', 'Faux Hawk', 'Topknot', 'High and Tight'],
  quadrado:   ['Corte Texturizado', 'Quiff Lateral', 'Topknot', 'Undercut Suave', 'French Crop', 'Side Part'],
  triangular: ['Pompadour', 'Volume no Topo', 'Undercut Lateral', 'Quiff', 'Caesar Cut'],
  losango:    ['Franja Lateral', 'Ondas Naturais', 'Quiff Texturizado', 'Side Swept', 'Buzz Cut'],
  oblongo:    ['Fade Baixo', 'Lateral Sides', 'Textured Crop', 'Corte Clássico', 'Curly Top'],
};

export default function RecomendacaoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const route = useRoute<Route>();
  const navigation = useNavigation();
  const { formato } = route.params;
  const [cortes, setCortes]   = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchRecomendacoes(); }, [formato]);

  async function fetchRecomendacoes() {
    setLoading(true);
    try {
      const json = await api.post<{ cortes: string[] }>('/api/recommendation', { formato_rosto: formato });
      setCortes(json.cortes ?? []);
    } catch {
      setCortes(RECOMENDACOES_LOCAL[formato] ?? []);
    }
    setLoading(false);
  }

  const info = DESCRICOES[formato] ?? DESCRICOES['oval'];

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.resultadoCard}>
        <Text style={s.resultadoLabel}>FORMATO IDENTIFICADO</Text>
        <Text style={s.resultadoFormato}>{info.titulo.toUpperCase()}</Text>
        <Text style={s.resultadoDesc}>{info.descricao}</Text>
        <View style={s.dicaRow}>
          <Feather name="info" size={12} color={C.accent} />
          <Text style={s.dicaText}>{info.dica}</Text>
        </View>
      </View>

      <View style={s.sectionHeader}>
        <Text style={s.sectionLabel}>CORTES RECOMENDADOS</Text>
        <View style={s.sectionLine} />
      </View>

      {loading ? <ActivityIndicator color={C.accent} style={{ marginTop: 20 }} /> : (
        <View style={s.cortesContainer}>
          {cortes.map((corte, i) => (
            <View key={i} style={[s.corteItem, i < cortes.length - 1 && { borderBottomWidth: 1, borderBottomColor: C.border }]}>
              <Text style={s.corteNumero}>{String(i + 1).padStart(2, '0')}</Text>
              <Text style={s.corteNome}>{corte}</Text>
            </View>
          ))}
        </View>
      )}

      <TouchableOpacity onPress={() => navigation.goBack()} style={s.voltarBtn}>
        <Feather name="arrow-left" size={13} color={C.mutedFg} />
        <Text style={s.voltarText}>VOLTAR E AGENDAR</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:           { flex: 1, backgroundColor: C.bg },
    resultadoCard:    { borderBottomWidth: 1, borderBottomColor: C.border, padding: 24, paddingTop: 32 },
    resultadoLabel:   { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 },
    resultadoFormato: { fontFamily: F.mono, fontSize: 36, color: C.accent, letterSpacing: 3, marginBottom: 8 },
    resultadoDesc:    { fontFamily: F.sans, fontSize: 14, color: C.fg, lineHeight: 22, marginBottom: 16 },
    dicaRow:          { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
    dicaText:         { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, flex: 1, lineHeight: 20 },
    sectionHeader:    { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
    sectionLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 },
    sectionLine:      { flex: 1, height: 1, backgroundColor: C.border },
    cortesContainer:  { paddingHorizontal: 24 },
    corteItem:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 16 },
    corteNumero:      { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 1, marginRight: 20, width: 28 },
    corteNome:        { fontFamily: F.sansMedium, fontSize: 16, color: C.primary },
    voltarBtn:        { flexDirection: 'row', alignItems: 'center', gap: 8, margin: 24, marginTop: 16 },
    voltarText:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
  });
}
