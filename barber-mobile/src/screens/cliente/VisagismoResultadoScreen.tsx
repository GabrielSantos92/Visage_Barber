import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, Image,
  ActivityIndicator, TouchableOpacity, Alert, Platform,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import { api } from '../../lib/api';
import {
  AnaliseSalva, BarbeiroChat, salvarAnalise, excluirAnalise, enviarAnaliseNoChat,
} from '../../lib/visagismoSalvos';
import ImagemVisagismo from '../../components/ImagemVisagismo';
import EscolherBarbeiroModal from '../../components/EscolherBarbeiroModal';

type Route = RouteProp<ClienteStackParamList, 'VisagismoResultado'>;
type Nav = StackNavigationProp<ClienteStackParamList>;
type Acao = 'app' | 'enviar' | 'excluir' | 'galeria' | 'compartilhar';

// O Expo Go nao traz o modulo nativo da galeria, e importar no topo do arquivo
// derruba o app na abertura. Carregado so no uso, a falha cai no catch de quem chama.
function carregarGaleria(): typeof import('expo-media-library') {
  return require('expo-media-library');
}

export default function VisagismoResultadoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const { params: { resultado, fotoUri, fotoBase64, salvo } } = useRoute<Route>();
  // Aberta pelo historico: a comparacao ja esta gravada, nada e gerado de novo.
  const doHistorico = !!salvo;

  const [imagemUrl, setImagemUrl]           = useState<string | null>(null);
  const [imagemCarregada, setImagemCarregada] = useState(false);
  const [imagemErro, setImagemErro]         = useState(false);
  const [acao, setAcao]                     = useState<Acao | null>(null);
  const [analiseSalva, setAnaliseSalva]     = useState<AnaliseSalva | null>(salvo ?? null);
  const [naGaleria, setNaGaleria]           = useState(false);
  const [escolhendoBarbeiro, setEscolhendoBarbeiro] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const comparacaoRef = useRef<View>(null);

  useEffect(() => {
    if (!doHistorico) gerarImagem();
    return () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); };
  }, []);

  // Transforma o cartao de comparacao (antes + depois) em um unico JPG.
  function capturarComparacao() {
    return captureRef(comparacaoRef, { format: 'jpg', quality: 0.95, result: 'tmpfile' });
  }

  // Grava a comparacao na conta do cliente (uma vez so) e devolve o registro.
  async function garantirSalva(): Promise<AnaliseSalva> {
    if (analiseSalva) return analiseSalva;
    if (!user) throw new Error('Faça login para salvar a análise.');
    const base64 = await captureRef(comparacaoRef, { format: 'jpg', quality: 0.9, result: 'base64' });
    const nova = await salvarAnalise(user.id, resultado, base64);
    setAnaliseSalva(nova);
    return nova;
  }

  async function salvarNoApp() {
    setAcao('app');
    try {
      await garantirSalva();
    } catch (e: any) {
      Alert.alert('Não foi possível salvar', e.message ?? 'Tente novamente.');
    }
    setAcao(null);
  }

  async function enviarAoBarbeiro(barbeiro: BarbeiroChat) {
    setEscolhendoBarbeiro(false);
    if (!user) return;
    setAcao('enviar');
    try {
      const analise = await garantirSalva();
      await enviarAnaliseNoChat(user.id, barbeiro.id, analise);
      navigation.navigate('Chat', { outroNome: barbeiro.nome, barbeiroId: barbeiro.id, clienteId: user.id });
    } catch (e: any) {
      Alert.alert('Não foi possível enviar', e.message ?? 'Tente novamente.');
    }
    setAcao(null);
  }

  function confirmarExclusao() {
    Alert.alert('Excluir análise', 'A comparação será removida do app. Se você já enviou a um barbeiro, a imagem some do chat também.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Excluir', style: 'destructive', onPress: excluir },
    ]);
  }

  async function excluir() {
    if (!analiseSalva) return;
    setAcao('excluir');
    try {
      await excluirAnalise(analiseSalva);
      navigation.goBack();
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Não foi possível excluir.');
      setAcao(null);
    }
  }

  async function compartilhar() {
    setAcao('compartilhar');
    try {
      const uri = await capturarComparacao();
      await Sharing.shareAsync(uri, { mimeType: 'image/jpeg', UTI: 'public.jpeg', dialogTitle: 'Compartilhar comparação' });
    } catch {
      Alert.alert('Erro', 'Não foi possível compartilhar a imagem.');
    }
    setAcao(null);
  }

  async function salvarNaGaleria() {
    setAcao('galeria');
    try {
      const MediaLibrary = carregarGaleria();
      const perm = await MediaLibrary.requestPermissionsAsync(true, ['photo']);
      if (!perm.granted) {
        Alert.alert('Permissão necessária', 'Permita o acesso à galeria nas configurações para salvar a imagem.');
        setAcao(null);
        return;
      }
      const uri = await capturarComparacao();
      await MediaLibrary.Asset.create(uri);
      setNaGaleria(true);
    } catch {
      // No Expo Go o acesso a galeria e limitado: o compartilhamento serve de saida.
      Alert.alert('Não foi possível salvar', 'Você ainda pode salvar a imagem pelo menu de compartilhamento.', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Compartilhar', onPress: compartilhar },
      ]);
    }
    setAcao(null);
  }

  async function gerarImagem() {
    setImagemCarregada(false);
    setImagemErro(false);
    setImagemUrl(null);
    setNaGaleria(false);
    timeoutRef.current = setTimeout(() => setImagemErro(true), 360000);
    try {
      const data = await api.post<{ base64: string; contentType: string }>('/api/visagismo/imagem-referencia', {
        // A analise inteira: o backend extrai dela so os atributos de estilo.
        analise: resultado,
        imagem_base64: fotoBase64 ?? '',
      });
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setImagemUrl(`data:${data.contentType};base64,${data.base64}`);
      setImagemCarregada(true);
    } catch (e: any) {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      setImagemErro(true);
    }
  }

  const formatoLabel: Record<string, string> = {
    oval: 'Oval', redondo: 'Redondo', quadrado: 'Quadrado',
    triangular: 'Triangular', losango: 'Losango', oblongo: 'Oblongo',
  };

  const podeSalvar = !doHistorico && imagemCarregada && !!imagemUrl && Platform.OS !== 'web';

  return (
    <View style={s.screen}>

    {/* Cartao usado so para gerar a imagem salva/compartilhada. Fica atras do
        ScrollView (que tem fundo opaco), entao nunca aparece na tela. */}
    {podeSalvar && (
      <View ref={comparacaoRef} collapsable={false} pointerEvents="none" style={s.comparacao}>
        <Text style={s.comparacaoMarca}>VISAGE BARBER · VISAGISMO IA</Text>
        <Text style={s.comparacaoTitulo}>{resultado.corte_principal?.nome}</Text>
        <View style={s.comparacaoFotos}>
          {fotoUri ? (
            <View style={s.fotoContainer}>
              <Image source={{ uri: fotoUri }} style={s.comparacaoImg} resizeMode="cover" />
              <Text style={s.comparacaoLegenda}>ANTES</Text>
            </View>
          ) : null}
          <View style={s.fotoContainer}>
            <Image source={{ uri: imagemUrl! }} style={s.comparacaoImg} resizeMode="cover" />
            <Text style={[s.comparacaoLegenda, { color: C.accent }]}>DEPOIS</Text>
          </View>
        </View>
        <Text style={s.comparacaoRodape}>
          ROSTO {(formatoLabel[resultado.formato_rosto] ?? resultado.formato_rosto ?? '').toUpperCase()}
          {resultado.barba?.estilo ? ` · BARBA ${resultado.barba.estilo.toUpperCase()}` : ''}
        </Text>
      </View>
    )}

    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 48 }}>

      {/* Header */}
      <View style={s.header}>
        <Text style={s.headerLabel}>ANÁLISE DE VISAGISMO</Text>
        <Text style={s.headerTitle}>{doHistorico ? 'Análise Salva' : 'Seu Resultado'}</Text>
      </View>

      {/* Do historico: a comparacao gravada. Analise nova: fotos lado a lado. */}
      {salvo ? (
        <View style={s.salvaImg}>
          <ImagemVisagismo path={salvo.imagem_path} />
        </View>
      ) : (
      <View style={s.fotosRow}>
        {fotoUri ? (
          <View style={s.fotoContainer}>
            <Text style={s.fotoLabel}>SUA FOTO</Text>
            <Image source={{ uri: fotoUri }} style={s.fotoImg} resizeMode="cover" />
          </View>
        ) : null}

        <View style={s.fotoContainer}>
          <Text style={s.fotoLabel}>COM O CORTE IDEAL</Text>
          <View style={s.fotoImg}>
            {imagemCarregada && imagemUrl ? (
              <Image source={{ uri: imagemUrl }} style={StyleSheet.absoluteFill} resizeMode="cover" />
            ) : imagemErro ? (
              <View style={s.corteCard}>
                <Feather name="scissors" size={22} color={C.accent} />
                <Text style={s.corteCardNome}>{resultado.corte_principal?.nome}</Text>
                {(resultado.corte_principal?.caracteristicas ?? []).slice(0, 3).map((c: string, i: number) => (
                  <Text key={i} style={s.corteCardItem}>· {c}</Text>
                ))}
                <TouchableOpacity onPress={gerarImagem} style={{ marginTop: 10 }}>
                  <Text style={s.fotoPlaceholderText}>↻ GERAR IMAGEM</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={s.fotoPlaceholder}>
                <ActivityIndicator color={C.accent} />
                <Text style={s.fotoPlaceholderText}>GERANDO...</Text>
              </View>
            )}
          </View>
        </View>
      </View>
      )}

      {/* Salvar no app / enviar ao barbeiro */}
      {(podeSalvar || doHistorico) && (
        <View style={s.acoesRow}>
          {doHistorico ? (
            <TouchableOpacity style={[s.btnAcao, { borderColor: C.destructive }]} onPress={confirmarExclusao} disabled={acao !== null}>
              {acao === 'excluir' ? (
                <ActivityIndicator color={C.destructive} size="small" />
              ) : (
                <>
                  <Feather name="trash-2" size={14} color={C.destructive} />
                  <Text style={[s.btnAcaoText, { color: C.destructive }]}>EXCLUIR</Text>
                </>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={[s.btnAcao, s.btnAcaoPrimario]} onPress={salvarNoApp} disabled={acao !== null || !!analiseSalva}>
              {acao === 'app' ? (
                <ActivityIndicator color={C.primaryFg} size="small" />
              ) : (
                <>
                  <Feather name={analiseSalva ? 'check' : 'bookmark'} size={14} color={C.primaryFg} />
                  <Text style={[s.btnAcaoText, { color: C.primaryFg }]}>{analiseSalva ? 'SALVO NO APP' : 'SALVAR NO APP'}</Text>
                </>
              )}
            </TouchableOpacity>
          )}
          <TouchableOpacity style={s.btnAcao} onPress={() => setEscolhendoBarbeiro(true)} disabled={acao !== null}>
            {acao === 'enviar' ? (
              <ActivityIndicator color={C.primary} size="small" />
            ) : (
              <>
                <Feather name="send" size={14} color={C.primary} />
                <Text style={s.btnAcaoText}>ENVIAR NO CHAT</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Levar a imagem para fora do app */}
      {podeSalvar && (
        <View style={s.linksRow}>
          <TouchableOpacity style={s.linkAcao} onPress={salvarNaGaleria} disabled={acao !== null}>
            {acao === 'galeria'
              ? <ActivityIndicator color={C.mutedFg} size="small" />
              : <Feather name={naGaleria ? 'check' : 'download'} size={12} color={C.mutedFg} />}
            <Text style={s.linkAcaoText}>{naGaleria ? 'SALVO NA GALERIA' : 'BAIXAR NA GALERIA'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={s.linkAcao} onPress={compartilhar} disabled={acao !== null}>
            {acao === 'compartilhar'
              ? <ActivityIndicator color={C.mutedFg} size="small" />
              : <Feather name="share-2" size={12} color={C.mutedFg} />}
            <Text style={s.linkAcaoText}>COMPARTILHAR</Text>
          </TouchableOpacity>
        </View>
      )}

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

    <EscolherBarbeiroModal
      visible={escolhendoBarbeiro}
      onClose={() => setEscolhendoBarbeiro(false)}
      onEscolher={enviarAoBarbeiro}
    />
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:               { flex: 1, backgroundColor: C.bg },
    header:               { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    headerLabel:          { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, marginBottom: 4 },
    headerTitle:          { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    fotosRow:             { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 16, gap: 12 },
    fotoContainer:        { flex: 1 },
    fotoLabel:            { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 6 },
    fotoImg:              { width: '100%', height: 160, backgroundColor: C.card, overflow: 'hidden' },
    fotoPlaceholder:      { flex: 1, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border },
    fotoPlaceholderText:  { fontFamily: F.mono, fontSize: 9, color: C.accent, marginTop: 8, letterSpacing: 1 },
    corteCard:            { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: C.accent, backgroundColor: C.card },
    corteCardNome:        { fontFamily: F.sansMedium, fontSize: 13, color: C.primary, textAlign: 'center', marginTop: 8, marginBottom: 6 },
    corteCardItem:        { fontFamily: F.sans, fontSize: 10, color: C.mutedFg, textAlign: 'center', lineHeight: 16 },
    acoesRow:             { flexDirection: 'row', paddingHorizontal: 24, paddingTop: 12, gap: 12 },
    btnAcao:              { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.primary, paddingVertical: 14 },
    btnAcaoPrimario:      { backgroundColor: C.primary },
    btnAcaoText:          { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 },
    linksRow:             { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 24, paddingTop: 14, gap: 24 },
    linkAcao:             { flexDirection: 'row', alignItems: 'center', gap: 6 },
    linkAcaoText:         { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5 },
    salvaImg:             { paddingHorizontal: 24, paddingTop: 16 },
    // Cartao capturado como imagem
    comparacao:           { position: 'absolute', top: 0, left: 0, width: 360, padding: 20, backgroundColor: C.bg },
    comparacaoMarca:      { fontFamily: F.mono, fontSize: 9, color: C.accent, letterSpacing: 1.5, marginBottom: 6 },
    comparacaoTitulo:     { fontFamily: F.sansLight, fontSize: 22, color: C.primary, letterSpacing: -0.5, marginBottom: 14 },
    comparacaoFotos:      { flexDirection: 'row', gap: 8 },
    comparacaoImg:        { width: '100%', aspectRatio: 3 / 4, backgroundColor: C.card },
    comparacaoLegenda:    { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, marginTop: 6 },
    comparacaoRodape:     { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, marginTop: 14 },
    card:                 { marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.border, padding: 20 },
    cardHeader:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
    cardLabel:            { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    formatoNome:          { fontFamily: F.sansLight, fontSize: 28, color: C.primary, letterSpacing: -0.5, marginBottom: 6 },
    tracos:               { fontFamily: F.sans, fontSize: 14, color: C.mutedFg, lineHeight: 22 },
    cortePrincipalNome:   { fontFamily: F.sansMedium, fontSize: 18, color: C.primary, marginBottom: 8 },
    corteDesc:            { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, lineHeight: 20, marginBottom: 14 },
    caracteristicasList:  { gap: 8 },
    caracteristicaItem:   { flexDirection: 'row', alignItems: 'center', gap: 8 },
    caracteristicaText:   { fontFamily: F.sans, fontSize: 13, color: C.fg, flex: 1 },
    tagsRow:              { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    tag:                  { borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 6 },
    tagText:              { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1 },
    evitarItem:           { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    evitarText:           { fontFamily: F.sans, fontSize: 13, color: C.fg, flex: 1 },
    resumoText:           { fontFamily: F.sans, fontSize: 14, color: C.fg, lineHeight: 22 },
  });
}
