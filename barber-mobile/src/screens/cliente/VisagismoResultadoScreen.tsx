import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useRoute } from '@react-navigation/native';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

type Route = RouteProp<ClienteStackParamList, 'VisagismoResultado'>;

export default function VisagismoResultadoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { params: { resultado } } = useRoute<Route>();

  const formatoLabel: Record<string, string> = {
    oval: 'Oval', redondo: 'Redondo', quadrado: 'Quadrado',
    triangular: 'Triangular', losango: 'Losango', oblongo: 'Oblongo',
  };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 48 }}>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerLabel}>ANÁLISE DE VISAGISMO</Text>
        <Text style={s.headerTitle}>Seu Resultado</Text>
      </View>

      {/* Formato do rosto */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Feather name="user" size={14} color={C.accent} />
          <Text style={s.cardLabel}>FORMATO DO ROSTO</Text>
        </View>
        <Text style={s.formatoNome}>{formatoLabel[resultado.formato_rosto] ?? resultado.formato_rosto}</Text>
        <Text style={s.tracos}>{resultado.tracos}</Text>
      </View>

      {/* Corte principal */}
      <View style={s.card}>
        <View style={s.cardHeader}>
          <Feather name="scissors" size={14} color={C.accent} />
          <Text style={s.cardLabel}>CORTE IDEAL</Text>
        </View>
        <Text style={s.cortePrincipalNome}>{resultado.corte_principal?.nome}</Text>
        <Text style={s.corteDesc}>{resultado.corte_principal?.descricao}</Text>
        <View style={s.caracteristicasList}>
          {(resultado.corte_principal?.caracteristicas ?? []).map((c: string, i: number) => (
            <View key={i} style={s.caracteristicaItem}>
              <Feather name="check" size={12} color={C.success} />
              <Text style={s.caracteristicaText}>{c}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* Cortes alternativos */}
      {resultado.cortes_alternativos?.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="list" size={14} color={C.accent} />
            <Text style={s.cardLabel}>OUTROS CORTES QUE COMBINAM</Text>
          </View>
          <View style={s.tagsRow}>
            {resultado.cortes_alternativos.map((c: string, i: number) => (
              <View key={i} style={s.tag}>
                <Text style={s.tagText}>{c}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* Barba */}
      {resultado.barba && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="zap" size={14} color={C.accent} />
            <Text style={s.cardLabel}>BARBA IDEAL</Text>
          </View>
          <Text style={s.cortePrincipalNome}>{resultado.barba.estilo}</Text>
          <Text style={s.corteDesc}>{resultado.barba.motivo}</Text>
        </View>
      )}

      {/* Cores ideais */}
      {resultado.cores_ideais?.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="droplet" size={14} color={C.accent} />
            <Text style={s.cardLabel}>CORES QUE TE VALORIZAM</Text>
          </View>
          <View style={s.tagsRow}>
            {resultado.cores_ideais.map((c: string, i: number) => (
              <View key={i} style={[s.tag, { borderColor: C.accent }]}>
                <Text style={[s.tagText, { color: C.accent }]}>{c}</Text>
              </View>
            ))}
          </View>
        </View>
      )}

      {/* O que evitar */}
      {resultado.o_que_evitar?.length > 0 && (
        <View style={s.card}>
          <View style={s.cardHeader}>
            <Feather name="x-circle" size={14} color={C.destructive} />
            <Text style={[s.cardLabel, { color: C.destructive }]}>O QUE EVITAR</Text>
          </View>
          {resultado.o_que_evitar.map((e: string, i: number) => (
            <View key={i} style={s.evitarItem}>
              <Feather name="minus" size={12} color={C.destructive} />
              <Text style={s.evitarText}>{e}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Resumo */}
      {resultado.resumo && (
        <View style={[s.card, { borderColor: C.accent }]}>
          <View style={s.cardHeader}>
            <Feather name="star" size={14} color={C.accent} />
            <Text style={s.cardLabel}>RESUMO</Text>
          </View>
          <Text style={s.resumoText}>{resultado.resumo}</Text>
        </View>
      )}

    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:              { flex: 1, backgroundColor: C.bg },
    header:              { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    headerLabel:         { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, marginBottom: 4 },
    headerTitle:         { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    card:                { marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.border, padding: 20 },
    cardHeader:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    cardLabel:           { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    formatoNome:         { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 6 },
    tracos:              { fontFamily: F.sans, fontSize: 14, color: C.mutedFg, lineHeight: 22 },
    cortePrincipalNome:  { fontFamily: F.sansMedium, fontSize: 18, color: C.primary, marginBottom: 8 },
    corteDesc:           { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, lineHeight: 20, marginBottom: 14 },
    caracteristicasList: { gap: 8 },
    caracteristicaItem:  { flexDirection: 'row', alignItems: 'center', gap: 8 },
    caracteristicaText:  { fontFamily: F.sans, fontSize: 13, color: C.fg, flex: 1 },
    tagsRow:             { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tag:                 { borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 6 },
    tagText:             { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1 },
    evitarItem:          { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    evitarText:          { fontFamily: F.sans, fontSize: 13, color: C.fg, flex: 1 },
    resumoText:          { fontFamily: F.sans, fontSize: 14, color: C.fg, lineHeight: 22 },
  });
}
