import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';
import { AVISO_VISAGISMO, concederConsentimentoVisagismo, SituacaoConsentimento } from '../lib/privacidade';

interface Props {
  onConcordou: (situacao: SituacaoConsentimento) => void;
  onConsultarAviso: () => void;
  onVoltar: () => void;
}

// Aviso exibido no lugar do envio de foto ate o cliente concordar. Fica dentro
// do ScrollView da tela (e nao em um modal) para nao ser cortado em telas
// pequenas. A caixa comeca desmarcada e so "Concordar e continuar" registra.
export default function AvisoPrivacidadeVisagismo({ onConcordou, onConsultarAviso, onVoltar }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const [marcado, setMarcado]   = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro]         = useState<string | null>(null);

  async function concordar() {
    if (!marcado || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      onConcordou(await concederConsentimentoVisagismo());
    } catch (e: any) {
      setErro(e?.message ?? 'Não foi possível registrar sua concordância. Tente novamente.');
      setEnviando(false);
    }
  }

  return (
    <View style={s.caixa}>
      <View style={s.cabecalho}>
        <Feather name="shield" size={18} color={C.accent} />
        <Text style={s.titulo} accessibilityRole="header">{AVISO_VISAGISMO.titulo}</Text>
      </View>
      <Text style={s.texto}>{AVISO_VISAGISMO.introducao}</Text>

      <Text style={s.secao}>COMO UTILIZAREMOS SUA FOTO?</Text>
      {AVISO_VISAGISMO.usos.map((u) => (
        <View key={u} style={s.item}>
          <View style={s.marcador} />
          <Text style={[s.texto, { flex: 1 }]}>{u}</Text>
        </View>
      ))}

      <Text style={s.secao}>PROCESSAMENTO POR INTELIGÊNCIA ARTIFICIAL</Text>
      <Text style={s.texto}>{AVISO_VISAGISMO.ia}</Text>

      <Text style={s.secao}>SEUS DIREITOS</Text>
      <Text style={s.texto}>{AVISO_VISAGISMO.direitos}</Text>

      <TouchableOpacity style={s.link} onPress={onConsultarAviso} accessibilityRole="link">
        <Feather name="file-text" size={12} color={C.accent} />
        <Text style={s.linkTexto}>CONSULTAR AVISO DE PRIVACIDADE</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={s.checkboxLinha}
        onPress={() => { setMarcado((m) => !m); setErro(null); }}
        disabled={enviando}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: marcado, disabled: enviando }}
        accessibilityLabel={AVISO_VISAGISMO.concordancia}
      >
        <View style={[s.checkbox, marcado && { backgroundColor: C.accent, borderColor: C.accent }]}>
          {marcado && <Feather name="check" size={12} color={C.accentFg} />}
        </View>
        <Text style={s.checkboxTexto}>{AVISO_VISAGISMO.concordancia}</Text>
      </TouchableOpacity>

      {erro ? <Text style={s.erro} accessibilityRole="alert">{erro}</Text> : null}

      <TouchableOpacity
        style={[s.btnConcordar, (!marcado || enviando) && { opacity: 0.4 }]}
        onPress={concordar}
        disabled={!marcado || enviando}
        accessibilityRole="button"
        accessibilityState={{ disabled: !marcado || enviando, busy: enviando }}
      >
        {enviando
          ? <ActivityIndicator color={C.primaryFg} size="small" />
          : <Text style={s.btnConcordarTexto}>CONCORDAR E CONTINUAR</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={s.btnVoltar} onPress={onVoltar} disabled={enviando} accessibilityRole="button">
        <Text style={s.btnVoltarTexto}>VOLTAR</Text>
      </TouchableOpacity>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    caixa:             { marginHorizontal: 24, marginTop: 20, borderWidth: 1, borderColor: C.accent, backgroundColor: C.card, padding: 20 },
    cabecalho:         { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 10 },
    titulo:            { flex: 1, fontFamily: F.sansMedium, fontSize: 18, color: C.primary, lineHeight: 24 },
    texto:             { fontFamily: F.sans, fontSize: 13, color: C.fg, lineHeight: 20 },
    secao:             { fontFamily: F.mono, fontSize: 9, color: C.accent, letterSpacing: 1.5, marginTop: 18, marginBottom: 8 },
    item:              { flexDirection: 'row', gap: 10, marginBottom: 6 },
    marcador:          { width: 5, height: 5, backgroundColor: C.accent, marginTop: 8 },
    link:              { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 18, paddingVertical: 6, alignSelf: 'flex-start' },
    linkTexto:         { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5 },
    checkboxLinha:     { flexDirection: 'row', alignItems: 'flex-start', gap: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginTop: 14 },
    checkbox:          { width: 20, height: 20, borderWidth: 1, borderColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    checkboxTexto:     { flex: 1, fontFamily: F.sans, fontSize: 13, color: C.primary, lineHeight: 20 },
    erro:              { fontFamily: F.sans, fontSize: 12, color: C.destructive, lineHeight: 18, marginTop: 12 },
    btnConcordar:      { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 18, minHeight: 50 },
    btnConcordarTexto: { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2 },
    btnVoltar:         { borderWidth: 1, borderColor: C.border, paddingVertical: 15, alignItems: 'center', marginTop: 10, minHeight: 48, justifyContent: 'center' },
    btnVoltarTexto:    { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 2 },
  });
}
