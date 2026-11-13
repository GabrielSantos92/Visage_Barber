import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { RouteProp, useRoute } from '@react-navigation/native';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import {
  AVISO_COMPLETO, AVISO_PAGAMENTOS, AVISO_WHATSAPP, VERSAO_AVISO_PAGAMENTOS, VERSAO_AVISO_VISAGISMO, VERSAO_AVISO_WHATSAPP,
} from '../../lib/privacidade';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';

type Secao = { titulo: string; paragrafos: string[]; itens?: string[] };
const dataDaVersao = (versao: string) => new Date(`${versao}T12:00:00`).toLocaleDateString('pt-BR');

// Aviso de Privacidade completo, aberto a partir do aviso do visagismo, do
// perfil e da tela de pagamento (que abre direto na parte de pagamentos)
export default function AvisoPrivacidadeScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const route = useRoute<RouteProp<ClienteStackParamList, 'AvisoPrivacidade'>>();
  const rolagem = useRef<ScrollView>(null);
  const [yPagamentos, setYPagamentos] = useState<number | null>(null);

  useEffect(() => {
    if (route.params?.parte === 'pagamentos' && yPagamentos != null) {
      rolagem.current?.scrollTo({ y: yPagamentos, animated: false });
    }
  }, [route.params?.parte, yPagamentos]);

  const renderSecao = (secao: Secao) => (
    <View key={secao.titulo} style={s.secao}>
      <Text style={s.secaoTitulo} accessibilityRole="header">{secao.titulo}</Text>
      {secao.paragrafos.map((p) => <Text key={p} style={s.paragrafo}>{p}</Text>)}
      {secao.itens?.map((i) => (
        <View key={i} style={s.item}>
          <View style={s.marcador} />
          <Text style={[s.paragrafo, { flex: 1, marginBottom: 0 }]}>{i}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <ScrollView ref={rolagem} style={s.screen} contentContainerStyle={s.conteudo}>
      <Text style={s.label}>PRIVACIDADE // LGPD</Text>
      <Text style={s.titulo}>Aviso de Privacidade</Text>
      <Text style={s.paragrafo}>Este aviso tem três partes: análise de visagismo por foto, pagamentos online e mensagens pelo WhatsApp.</Text>
      <Text style={s.versao}>ANÁLISE DE VISAGISMO POR FOTO · VERSÃO DE {dataDaVersao(VERSAO_AVISO_VISAGISMO)}</Text>

      {AVISO_COMPLETO.map(renderSecao)}

      <View style={s.parte} onLayout={(e) => setYPagamentos(e.nativeEvent.layout.y)}>
        <Text style={s.label}>PARTE 2</Text>
        <Text style={[s.titulo, { fontSize: 22 }]} accessibilityRole="header">Pagamentos online</Text>
        <Text style={s.versao}>PIX E CARTÃO PELO MERCADO PAGO · VERSÃO DE {dataDaVersao(VERSAO_AVISO_PAGAMENTOS)}</Text>
        {AVISO_PAGAMENTOS.map(renderSecao)}
      </View>

      <View style={s.parte}>
        <Text style={s.label}>PARTE 3</Text>
        <Text style={[s.titulo, { fontSize: 22 }]} accessibilityRole="header">Mensagens pelo WhatsApp</Text>
        <Text style={s.versao}>CONFIRMAÇÃO DE PRESENÇA · VERSÃO DE {dataDaVersao(VERSAO_AVISO_WHATSAPP)}</Text>
        {AVISO_WHATSAPP.map(renderSecao)}
      </View>
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
    parte:       { marginTop: 36, paddingTop: 24, borderTopWidth: 1, borderTopColor: C.border },
    secao:       { marginTop: 20 },
    secaoTitulo: { fontFamily: F.sansMedium, fontSize: 16, color: C.primary, marginBottom: 10 },
    paragrafo:   { fontFamily: F.sans, fontSize: 14, color: C.fg, lineHeight: 22, marginBottom: 10 },
    item:        { flexDirection: 'row', gap: 10, marginBottom: 8 },
    marcador:    { width: 5, height: 5, backgroundColor: C.accent, marginTop: 9 },
  });
}
