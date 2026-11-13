import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';
import {
  AVISO_WHATSAPP_CONCORDANCIA, AVISO_WHATSAPP_RESUMO, buscarConsentimentoWhatsapp, celularParaWhatsapp,
  concederConsentimentoWhatsapp, revogarConsentimentoWhatsapp, SituacaoConsentimento,
} from '../lib/privacidade';

// Secao "Mensagens pelo WhatsApp" do perfil (igual a do site): o usuario
// autoriza, ou deixa de autorizar, a confirmacao de presenca enviada 2 horas
// antes do atendimento. `telefone` e o numero SALVO no cadastro.
export default function WhatsappPerfil({ telefone, onConsultarAviso }: { telefone: string | null | undefined; onConsultarAviso: () => void }) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const [situacao, setSituacao] = useState<SituacaoConsentimento | null>(null);
  const [erroCarregar, setErroCarregar] = useState(false);
  const [aceito, setAceito] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const temCelular = celularParaWhatsapp(telefone);

  function carregar() {
    setErroCarregar(false);
    buscarConsentimentoWhatsapp().then(setSituacao).catch(() => setErroCarregar(true));
  }

  useFocusEffect(useCallback(() => { carregar(); }, []));

  async function mudar(acao: () => Promise<SituacaoConsentimento>, falha: string) {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      setSituacao(await acao());
      setAceito(false);
    } catch {
      setErro(falha);
    }
    setSalvando(false);
  }

  const data = situacao?.concedido_em ? new Date(situacao.concedido_em) : null;

  return (
    <View style={s.caixa}>
      <View style={s.cabecalho}>
        <Feather name="message-square" size={12} color={C.accent} />
        <Text style={s.label}>WHATSAPP</Text>
      </View>
      <Text style={s.titulo}>Mensagens pelo WhatsApp</Text>
      <Text style={[s.texto, { marginBottom: 8 }]}>{AVISO_WHATSAPP_RESUMO}</Text>

      {erroCarregar ? (
        <TouchableOpacity onPress={carregar}>
          <Text style={s.texto}>Não foi possível carregar sua autorização. <Text style={{ color: C.accent }}>Tentar novamente</Text></Text>
        </TouchableOpacity>
      ) : !situacao ? (
        <ActivityIndicator color={C.accent} style={{ alignSelf: 'flex-start' }} />
      ) : situacao.consentido ? (
        <>
          <Text style={s.texto}>
            Ativadas
            {data ? ` em ${data.toLocaleDateString('pt-BR')} às ${data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : ''}
            {situacao.origem ? ` pelo ${situacao.origem === 'web' ? 'site' : 'aplicativo'}` : ''}. Para parar, desative aqui ou responda PARAR no WhatsApp.
          </Text>
          {!temCelular && (
            <Text style={[s.texto, { color: C.destructive, marginTop: 6 }]}>
              Seu cadastro está sem um celular válido: salve um celular com DDD para receber as mensagens.
            </Text>
          )}
        </>
      ) : (
        <>
          <Text style={s.texto}>Desativadas. Nenhuma mensagem é enviada.</Text>
          {temCelular ? (
            <TouchableOpacity
              style={s.concordar}
              onPress={() => setAceito((v) => !v)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: aceito }}
            >
              <View style={[s.caixinha, aceito && { backgroundColor: C.primary }]}>
                {aceito && <Feather name="check" size={12} color={C.primaryFg} />}
              </View>
              <Text style={[s.texto, { flex: 1 }]}>{AVISO_WHATSAPP_CONCORDANCIA}</Text>
            </TouchableOpacity>
          ) : (
            <Text style={[s.texto, { color: C.mutedFg, marginTop: 6 }]}>Para ativar, salve antes um celular com DDD no seu perfil.</Text>
          )}
        </>
      )}

      {erro ? <Text style={[s.texto, { color: C.destructive, marginTop: 8 }]}>{erro}</Text> : null}

      <View style={s.acoes}>
        <TouchableOpacity onPress={onConsultarAviso} accessibilityRole="link">
          <Text style={s.link}>AVISO DE PRIVACIDADE</Text>
        </TouchableOpacity>
        {situacao && !erroCarregar && (situacao.consentido ? (
          <TouchableOpacity
            style={[s.btn, { borderColor: C.destructive }]}
            disabled={salvando}
            onPress={() => mudar(revogarConsentimentoWhatsapp, 'Não foi possível desativar. Verifique sua conexão e tente novamente.')}
            accessibilityRole="button"
          >
            {salvando
              ? <ActivityIndicator color={C.destructive} size="small" />
              : <Text style={[s.btnTexto, { color: C.destructive }]}>DESATIVAR MENSAGENS</Text>}
          </TouchableOpacity>
        ) : temCelular ? (
          <TouchableOpacity
            style={[s.btn, { borderColor: C.primary, opacity: aceito ? 1 : 0.5 }]}
            disabled={salvando || !aceito}
            onPress={() => mudar(concederConsentimentoWhatsapp, 'Não foi possível ativar. Verifique sua conexão e tente novamente.')}
            accessibilityRole="button"
          >
            {salvando
              ? <ActivityIndicator color={C.primary} size="small" />
              : <Text style={[s.btnTexto, { color: C.primary }]}>ATIVAR MENSAGENS</Text>}
          </TouchableOpacity>
        ) : null)}
      </View>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    caixa:     { borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 20 },
    cabecalho: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
    label:     { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5 },
    titulo:    { fontFamily: F.sansMedium, fontSize: 14, color: C.primary, marginBottom: 6 },
    texto:     { fontFamily: F.sans, fontSize: 13, color: C.fg, lineHeight: 20 },
    concordar: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10 },
    caixinha:  { width: 18, height: 18, borderWidth: 1, borderColor: C.primary, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
    acoes:     { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 14 },
    link:      { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, paddingVertical: 8 },
    btn:       { borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
    btnTexto:  { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5 },
  });
}
