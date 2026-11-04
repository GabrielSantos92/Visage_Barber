import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';
import {
  buscarConsentimentoVisagismo, revogarConsentimentoVisagismo, SituacaoConsentimento,
} from '../lib/privacidade';
import ConfirmarCancelamentoModal from './ConfirmarCancelamentoModal';

// Secao "Privacidade" do perfil: mostra a autorizacao para a analise por foto
// e permite revoga-la (art. 8, par. 5 da LGPD), com confirmacao antes.
export default function PrivacidadePerfil({ onConsultarAviso }: { onConsultarAviso: () => void }) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const [situacao, setSituacao]       = useState<SituacaoConsentimento | null>(null);
  const [erroCarregar, setErroCarregar] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [revogando, setRevogando]     = useState(false);
  const [erroRevogar, setErroRevogar] = useState<string | null>(null);
  const [aviso, setAviso]             = useState<string | null>(null);

  function carregar() {
    setErroCarregar(false);
    buscarConsentimentoVisagismo().then(setSituacao).catch(() => setErroCarregar(true));
  }

  // Recarrega ao abrir o perfil: a autorizacao pode ter mudado no visagismo
  useFocusEffect(useCallback(() => { carregar(); }, []));

  async function revogar() {
    if (revogando) return;
    setRevogando(true);
    setErroRevogar(null);
    try {
      setSituacao(await revogarConsentimentoVisagismo());
      setConfirmando(false);
      setAviso('AUTORIZAÇÃO REVOGADA');
    } catch {
      setErroRevogar('Não foi possível revogar a autorização. Verifique sua conexão e tente novamente.');
    }
    setRevogando(false);
  }

  const data = situacao?.concedido_em ? new Date(situacao.concedido_em) : null;

  return (
    <View style={s.caixa}>
      <View style={s.cabecalho}>
        <Feather name="shield" size={12} color={C.accent} />
        <Text style={s.label}>PRIVACIDADE</Text>
      </View>
      <Text style={s.titulo}>Análise de visagismo por foto</Text>

      {erroCarregar ? (
        <TouchableOpacity onPress={carregar}>
          <Text style={s.texto}>Não foi possível carregar sua autorização. <Text style={{ color: C.accent }}>Tentar novamente</Text></Text>
        </TouchableOpacity>
      ) : !situacao ? (
        <ActivityIndicator color={C.accent} style={{ alignSelf: 'flex-start' }} />
      ) : situacao.consentido ? (
        <Text style={s.texto}>
          Você autorizou o uso da sua foto
          {data ? ` em ${data.toLocaleDateString('pt-BR')} às ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
          {situacao.origem ? ` pelo ${situacao.origem === 'web' ? 'site' : 'aplicativo'}` : ''}.
        </Text>
      ) : (
        <Text style={s.texto}>Não autorizado. O aviso de privacidade será exibido quando você usar a análise por foto.</Text>
      )}

      {aviso ? (
        <View style={s.aviso}>
          <Feather name="check" size={12} color={C.success} />
          <Text style={s.avisoTexto}>{aviso}</Text>
        </View>
      ) : null}

      <View style={s.acoes}>
        <TouchableOpacity onPress={onConsultarAviso} accessibilityRole="link">
          <Text style={s.link}>AVISO DE PRIVACIDADE</Text>
        </TouchableOpacity>
        {situacao?.consentido && (
          <TouchableOpacity
            style={s.btnRevogar}
            onPress={() => { setErroRevogar(null); setAviso(null); setConfirmando(true); }}
            accessibilityRole="button"
          >
            <Text style={s.btnRevogarTexto}>REVOGAR AUTORIZAÇÃO</Text>
          </TouchableOpacity>
        )}
      </View>

      <ConfirmarCancelamentoModal
        visible={confirmando}
        titulo="Revogar autorização?"
        mensagem={'Ao revogar, nenhuma nova foto será enviada para a análise de visagismo até que você concorde novamente.\n\nAnálises já realizadas não são desfeitas. Análises salvas continuam disponíveis até que você as exclua em "Análises salvas". O registro da sua concordância e desta revogação é mantido como histórico.'}
        textoConfirmar="Revogar autorização"
        processando={revogando}
        erro={erroRevogar}
        onVoltar={() => setConfirmando(false)}
        onConfirmar={revogar}
      />
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    caixa:           { borderWidth: 1, borderColor: C.border, padding: 16, marginTop: 8, marginBottom: 20 },
    cabecalho:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    label:           { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5 },
    titulo:          { fontFamily: F.sansMedium, fontSize: 14, color: C.primary, marginBottom: 6 },
    texto:           { fontFamily: F.sans, fontSize: 13, color: C.fg, lineHeight: 20 },
    aviso:           { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
    avisoTexto:      { fontFamily: F.mono, fontSize: 10, color: C.success, letterSpacing: 1.5 },
    acoes:           { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
    link:            { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, paddingVertical: 8 },
    btnRevogar:      { borderWidth: 1, borderColor: C.destructive, paddingHorizontal: 12, paddingVertical: 10 },
    btnRevogarTexto: { fontFamily: F.mono, fontSize: 10, color: C.destructive, letterSpacing: 1.5 },
  });
}
