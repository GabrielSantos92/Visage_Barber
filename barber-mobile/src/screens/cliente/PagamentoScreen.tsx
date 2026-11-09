import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, ActivityIndicator, Linking, AppState,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { Feather } from '@expo/vector-icons';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { AVISO_PAGAMENTO_RESUMO } from '../../lib/privacidade';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import {
  MetodoPagamento, Pagamento, TipoMensagem, buscarPagamentos, criarPagamento, formatarReais,
  mensagemDoPagamento, pagamentoAtual, pago, pixVencido, sincronizarPagamento,
} from '../../lib/pagamentos';

type Route = RouteProp<ClienteStackParamList, 'Pagamento'>;
type Nav = StackNavigationProp<ClienteStackParamList>;

type Agendamento = {
  id: string;
  data_hora: string;
  status: string;
  preco: number | null;
  servicos: { nome: string; preco: number } | null;
  barbeiros: { nome: string } | null;
};

const OPCOES: { metodo: MetodoPagamento; titulo: string; texto: string; icone: keyof typeof Feather.glyphMap }[] = [
  { metodo: 'pix', titulo: 'PIX', texto: 'QR Code ou código copia e cola. A confirmação chega em instantes.', icone: 'zap' },
  { metodo: 'cartao', titulo: 'Cartão de crédito', texto: 'Na página segura do Mercado Pago. O número do cartão não passa pelo app.', icone: 'credit-card' },
  { metodo: 'presencial', titulo: 'Na barbearia', texto: 'Pague no dia do atendimento, direto na barbearia.', icone: 'home' },
];

// Banco a cada 5 s (o webhook atualiza) e provedor a cada 30 s (se o webhook nao chegar)
const INTERVALO_BANCO_MS = 5000;
const INTERVALO_PROVEDOR_MS = 30000;

const restante = (expira: string, agora: number) => {
  const s = Math.max(0, Math.floor((new Date(expira).getTime() - agora) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

const dataHora = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')} · ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function PagamentoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const navigation = useNavigation<Nav>();
  const { params: { agendamentoId } } = useRoute<Route>();

  const [agendamento, setAgendamento] = useState<Agendamento | null>(null);
  const [pagamento, setPagamento]     = useState<Pagamento | null>(null);
  const [carregando, setCarregando]   = useState(true);
  const [escolha, setEscolha]         = useState<MetodoPagamento>('pix');
  // O cliente quer trocar a forma de uma cobranca ainda em aberto
  const [trocando, setTrocando]       = useState(false);
  const [enviando, setEnviando]       = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro]               = useState<string | null>(null);
  const [copiado, setCopiado]         = useState(false);
  const [agora, setAgora]             = useState(Date.now());

  const carregarPagamento = useCallback(async () => {
    setPagamento(pagamentoAtual(await buscarPagamentos([agendamentoId])));
  }, [agendamentoId]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data } = await supabase
        .from('agendamentos')
        .select('id, data_hora, status, preco, servicos(nome, preco), barbeiros(nome)')
        .eq('id', agendamentoId)
        .maybeSingle();
      if (!ativo) return;
      setAgendamento((data as unknown as Agendamento) ?? null);
      try { await carregarPagamento(); } catch { /* sem pagamento ainda */ }
      if (ativo) setCarregando(false);
    })();
    return () => { ativo = false; };
  }, [agendamentoId, carregarPagamento]);

  // Depende so do id: recarregar o pagamento nao reinicia os relogios
  const pagamentoId = pagamento?.id;
  const sincronizar = useCallback(async (silencioso: boolean) => {
    if (!pagamentoId) return;
    setVerificando(true);
    try {
      setPagamento(await sincronizarPagamento(pagamentoId));
      if (!silencioso) setErro(null);
    } catch (e: any) {
      if (!silencioso) setErro(e.message ?? 'Não foi possível verificar o pagamento.');
    }
    setVerificando(false);
  }, [pagamentoId]);

  const emAberto = !!pagamento && pagamento.status === 'pending' && !pixVencido(pagamento, agora);
  const online = emAberto && pagamento!.metodo !== 'presencial';

  // Cobranca online em aberto: acompanha ate o provedor confirmar
  useEffect(() => {
    if (!online || trocando) return;
    const banco = setInterval(() => { carregarPagamento().catch(() => {}); }, INTERVALO_BANCO_MS);
    const provedor = setInterval(() => sincronizar(true), INTERVALO_PROVEDOR_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => { clearInterval(banco); clearInterval(provedor); clearInterval(relogio); };
  }, [online, trocando, carregarPagamento, sincronizar]);

  // Voltou do Mercado Pago (navegador) ou do app do banco: confere na hora
  useEffect(() => {
    if (!online) return;
    const sub = AppState.addEventListener('change', (estado) => { if (estado === 'active') sincronizar(true); });
    return () => sub.remove();
  }, [online, sincronizar]);

  async function pagar() {
    setEnviando(true);
    setErro(null);
    try {
      const novo = await criarPagamento(agendamentoId, escolha);
      setPagamento(novo);
      setTrocando(false);
      setAgora(Date.now());
      if (escolha === 'cartao' && novo.link_pagamento) await Linking.openURL(novo.link_pagamento);
    } catch (e: any) {
      setErro(e.message ?? 'Não foi possível gerar a cobrança.');
    }
    setEnviando(false);
  }

  async function copiar(texto: string) {
    try {
      await Clipboard.setStringAsync(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro('Não foi possível copiar. Toque e segure o código para copiar.');
    }
  }

  if (carregando) {
    return <View style={[s.screen, s.centro]}><ActivityIndicator color={C.primary} /></View>;
  }
  if (!agendamento) {
    return <View style={[s.screen, s.centro]}><Text style={s.texto}>Agendamento não encontrado.</Text></View>;
  }

  const valor = pagamento?.valor ?? Number(agendamento.preco ?? agendamento.servicos?.preco ?? 0);
  const cancelado = agendamento.status === 'cancelado';
  const mostrarOpcoes = !cancelado && !pago(pagamento) && pagamento?.status !== 'refunded' && (!emAberto || trocando);
  const msg = pagamento && !(trocando && emAberto) ? mensagemDoPagamento(pagamento, agora) : null;
  const corMsg: Record<TipoMensagem, string> = { sucesso: C.success, aviso: C.warning, erro: C.destructive, info: C.fg };

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ padding: 24, paddingBottom: 48 }}>
      {/* Resumo */}
      <View style={s.card}>
        <Text style={s.servico}>{agendamento.servicos?.nome ?? 'Serviço'}</Text>
        <Text style={s.detalhe}>
          {agendamento.barbeiros?.nome?.toUpperCase()} · {dataHora(agendamento.data_hora)}
        </Text>
        {!!pagamento?.desconto && (
          <View style={s.linhaValor}>
            <Text style={s.rotulo}>DESCONTO</Text>
            <Text style={s.detalhe}>- {formatarReais(pagamento.desconto)}</Text>
          </View>
        )}
        <View style={[s.linhaValor, s.total]}>
          <Text style={s.rotulo}>TOTAL</Text>
          <Text style={s.valor}>{formatarReais(valor)}</Text>
        </View>
      </View>

      {cancelado && !pago(pagamento) && (
        <Text style={[s.aviso, { borderColor: C.destructive, color: C.destructive }]}>
          Este agendamento foi cancelado e não pode ser pago.
        </Text>
      )}

      {msg && (
        <View style={[s.mensagem, { borderColor: corMsg[msg.tipo] }]} accessibilityLiveRegion="polite">
          <Feather name={msg.tipo === 'sucesso' ? 'check-circle' : msg.tipo === 'info' ? 'info' : 'alert-circle'} size={18} color={corMsg[msg.tipo]} />
          <View style={{ flex: 1 }}>
            <Text style={[s.mensagemTitulo, { color: corMsg[msg.tipo] }]}>{msg.titulo.toUpperCase()}</Text>
            <Text style={s.texto}>{msg.texto}</Text>
          </View>
        </View>
      )}

      {/* PIX em aberto */}
      {emAberto && !trocando && pagamento!.metodo === 'pix' && (
        <View style={[s.card, { alignItems: 'center' }]}>
          {!!pagamento!.pix_qr_base64 && (
            <Image
              source={{ uri: `data:image/png;base64,${pagamento!.pix_qr_base64}` }}
              style={s.qr} accessibilityLabel="QR Code do PIX"
            />
          )}
          {!!pagamento!.expira_em && <Text style={s.rotulo}>EXPIRA EM {restante(pagamento!.expira_em, agora)}</Text>}
          {!!pagamento!.pix_copia_cola && (
            <>
              <Text style={[s.rotulo, { alignSelf: 'flex-start', marginTop: 16 }]}>PIX COPIA E COLA</Text>
              <Text style={s.codigo} selectable>{pagamento!.pix_copia_cola}</Text>
              <TouchableOpacity style={s.btnSecundario} onPress={() => copiar(pagamento!.pix_copia_cola!)}>
                <Feather name={copiado ? 'check' : 'copy'} size={14} color={C.primary} />
                <Text style={s.btnSecundarioText}>{copiado ? 'CÓDIGO COPIADO' : 'COPIAR CÓDIGO'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Cartao em aberto */}
      {emAberto && !trocando && pagamento!.metodo === 'cartao' && !!pagamento!.link_pagamento && (
        <TouchableOpacity style={s.btnPrimario} onPress={() => Linking.openURL(pagamento!.link_pagamento!)}>
          <Feather name="credit-card" size={14} color={C.primaryFg} />
          <Text style={s.btnPrimarioText}>CONTINUAR NO MERCADO PAGO</Text>
        </TouchableOpacity>
      )}

      {emAberto && !trocando && (
        <View style={{ gap: 10, marginBottom: 16 }}>
          {pagamento!.metodo !== 'presencial' && (
            <TouchableOpacity style={s.btnSecundario} onPress={() => sincronizar(false)} disabled={verificando}>
              {verificando ? <ActivityIndicator color={C.primary} size="small" /> : <Feather name="refresh-cw" size={14} color={C.primary} />}
              <Text style={s.btnSecundarioText}>{verificando ? 'VERIFICANDO...' : 'JÁ PAGUEI'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={s.btnSecundario}
            onPress={() => { setTrocando(true); setErro(null); setEscolha(pagamento!.metodo === 'pix' ? 'cartao' : 'pix'); }}
          >
            <Text style={s.btnSecundarioText}>{pagamento!.metodo === 'presencial' ? 'PREFIRO PAGAR AGORA' : 'TROCAR FORMA DE PAGAMENTO'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Escolha da forma de pagamento */}
      {mostrarOpcoes && (
        <View accessibilityRole="radiogroup" accessibilityLabel="Como você quer pagar?">
          <Text style={[s.rotulo, { marginBottom: 10 }]}>COMO VOCÊ QUER PAGAR?</Text>
          {OPCOES.map((o) => {
            const marcada = escolha === o.metodo;
            return (
              <TouchableOpacity
                key={o.metodo} style={[s.opcao, marcada && { borderColor: C.primary, backgroundColor: C.card }]}
                onPress={() => setEscolha(o.metodo)}
                accessibilityRole="radio" accessibilityState={{ checked: marcada }} accessibilityLabel={o.titulo}
              >
                <Feather name={o.icone} size={18} color={C.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={s.opcaoTitulo}>{o.titulo}</Text>
                  <Text style={s.opcaoTexto}>{o.texto}</Text>
                </View>
                <Feather name={marcada ? 'check-circle' : 'circle'} size={16} color={marcada ? C.primary : C.mutedFg} />
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity style={[s.btnPrimario, { marginTop: 8 }]} onPress={pagar} disabled={enviando}>
            {enviando ? <ActivityIndicator color={C.primaryFg} size="small" /> : (
              <Text style={s.btnPrimarioText}>
                {escolha === 'presencial' ? 'CONFIRMAR PAGAMENTO NA BARBEARIA' : escolha === 'pix' ? 'GERAR PIX' : 'PAGAR COM CARTÃO'}
              </Text>
            )}
          </TouchableOpacity>
          {trocando && (
            <TouchableOpacity style={s.btnSecundario} onPress={() => setTrocando(false)} disabled={enviando}>
              <Text style={s.btnSecundarioText}>VOLTAR</Text>
            </TouchableOpacity>
          )}
          <Text style={[s.opcaoTexto, { marginTop: 12 }]}>
            {AVISO_PAGAMENTO_RESUMO}{' '}
            <Text
              style={{ color: C.accent }} onPress={() => navigation.navigate('AvisoPrivacidade', { parte: 'pagamentos' })}
              accessibilityRole="link"
            >
              Aviso de Privacidade
            </Text>
          </Text>
        </View>
      )}

      {!!erro && (
        <Text style={[s.aviso, { borderColor: C.destructive, color: C.destructive }]} accessibilityRole="alert">{erro}</Text>
      )}

      {(pago(pagamento) || pagamento?.metodo === 'presencial') && !trocando && (
        <TouchableOpacity style={s.btnSecundario} onPress={() => navigation.navigate('ClienteTabs', { screen: 'MeusAgendamentos' } as never)}>
          <Text style={s.btnSecundarioText}>VER MEUS AGENDAMENTOS</Text>
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:            { flex: 1, backgroundColor: C.bg },
    centro:            { justifyContent: 'center', alignItems: 'center' },
    card:              { borderWidth: 1, borderColor: C.border, padding: 16, marginBottom: 16 },
    servico:           { fontFamily: F.sansMedium, fontSize: 16, color: C.primary },
    detalhe:           { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1, marginTop: 4 },
    linhaValor:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 },
    total:             { borderTopWidth: 1, borderTopColor: C.border, paddingTop: 12 },
    rotulo:            { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    valor:             { fontFamily: F.sansMedium, fontSize: 22, color: C.primary },
    texto:             { fontFamily: F.sans, fontSize: 13, color: C.fg, lineHeight: 19 },
    aviso:             { borderWidth: 1, padding: 12, fontFamily: F.sans, fontSize: 13, marginBottom: 16, lineHeight: 19 },
    mensagem:          { flexDirection: 'row', gap: 12, borderWidth: 1, padding: 14, marginBottom: 16 },
    mensagemTitulo:    { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, marginBottom: 4 },
    qr:                { width: 220, height: 220, backgroundColor: '#fff', marginBottom: 10 },
    codigo:            { alignSelf: 'stretch', fontFamily: F.mono, fontSize: 11, color: C.primary, borderWidth: 1, borderColor: C.border, padding: 10, marginTop: 6 },
    opcao:             { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: C.border, padding: 14, marginBottom: 8 },
    opcaoTitulo:       { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
    opcaoTexto:        { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, marginTop: 2, lineHeight: 17 },
    btnPrimario:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: C.primary, paddingVertical: 16, marginBottom: 12 },
    btnPrimarioText:   { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2 },
    btnSecundario:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, paddingVertical: 14, marginTop: 4 },
    btnSecundarioText: { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 },
  });
}
