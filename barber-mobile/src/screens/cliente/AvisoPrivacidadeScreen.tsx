import React from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import { AVISO_COMPLETO, VERSAO_AVISO_VISAGISMO } from '../../lib/privacidade';

// Aviso de Privacidade completo, aberto a partir do aviso do visagismo e do perfil
export default function AvisoPrivacidadeScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const data = new Date(`${VERSAO_AVISO_VISAGISMO}T12:00:00`).toLocaleDateString('pt-BR');

  return (
    <ScrollView style={s.screen} contentContainerStyle={s.conteudo}>
      <Text style={s.label}>PRIVACIDADE // LGPD</Text>
      <Text style={s.titulo}>Aviso de Privacidade</Text>
      <Text style={s.versao}>ANÁLISE DE VISAGISMO POR FOTO · VERSÃO DE {data}</Text>

      {AVISO_COMPLETO.map((secao) => (
        <View key={secao.titulo} style={s.secao}>
          <Text style={s.secaoTitulo}>{secao.titulo}</Text>
          {secao.paragrafos.map((p) => <Text key={p} style={s.paragrafo}>{p}</Text>)}
          {secao.itens?.map((i) => (
            <View key={i} style={s.item}>
              <View style={s.marcador} />
              <Text style={[s.paragrafo, { flex: 1, marginBottom: 0 }]}>{i}</Text>
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:      { flex: 1, backgroundColor: C.bg },
    conteudo:    { paddingHorizontal: 24, paddingTop: 20, paddingBottom: 48 },
    label:       { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, marginBottom: 6 },
    titulo:      { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5, marginBottom: 6 },
    versao:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.2, paddingBottom: 20, marginBottom: 8, borderBottomWidth: 1, borderBottomColor: C.border },
    secao:       { marginTop: 20 },
    secaoTitulo: { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginBottom: 10 },
    paragrafo:   { fontFamily: F.sans, fontSize: 14, color: C.fg, lineHeight: 22, marginBottom: 10 },
    item:        { flexDirection: 'row', gap: 10, marginBottom: 8 },
    marcador:    { width: 5, height: 5, backgroundColor: C.accent, marginTop: 9 },
  });
}
