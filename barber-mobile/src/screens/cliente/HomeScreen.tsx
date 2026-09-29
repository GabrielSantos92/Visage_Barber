import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image, ImageBackground, RefreshControl } from 'react-native';
import { Feather } from '@expo/vector-icons';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { CompositeNavigationProp, useFocusEffect, useNavigation } from '@react-navigation/native';
import { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { StackNavigationProp } from '@react-navigation/stack';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { Tables } from '../../types/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import ErroFetch from '../../components/ErroFetch';
import { ClienteStackParamList, ClienteTabParamList } from '../../navigation/ClienteNavigator';
import LogoMark from '../../components/LogoMark';

type Nav = CompositeNavigationProp<
  BottomTabNavigationProp<ClienteTabParamList, 'Inicio'>,
  StackNavigationProp<ClienteStackParamList>
>;

type Barbeiro = Tables<'barbeiros'>;
type Servico  = Tables<'servicos'>;

interface Proximo {
  id: string;
  data_hora: string;
  barbeiro_id: string;
  barbeiros: { nome: string } | null;
  servicos: { nome: string; preco: number; duracao_min: number } | null;
}

interface UltimoCorte {
  id: string;
  data_hora: string;
  barbeiro_id: string;
  barbeiros: { nome: string } | null;
  servicos: { nome: string } | null;
  nota: number | null; // null = ainda nao avaliado
}

const HERO = require('../../../assets/home/hero-barbershop.jpg');

const DIAS  = ['DOMINGO', 'SEGUNDA', 'TERÇA', 'QUARTA', 'QUINTA', 'SEXTA', 'SÁBADO'];
const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const FORMATOS: Record<string, { titulo: string; dica: string }> = {
  oval:       { titulo: 'Oval',       dica: 'Praticamente qualquer estilo funciona bem.' },
  redondo:    { titulo: 'Redondo',    dica: 'Volume no topo ajuda a alongar o rosto.' },
  quadrado:   { titulo: 'Quadrado',   dica: 'Texturas suaves equilibram os ângulos.' },
  triangular: { titulo: 'Triangular', dica: 'Volume no topo equilibra as proporções.' },
  losango:    { titulo: 'Losango',    dica: 'Franja lateral e laterais estruturadas.' },
  oblongo:    { titulo: 'Oblongo',    dica: 'Evite cortes altos; a barba equilibra.' },
};

const pad = (n: number) => n.toString().padStart(2, '0');
const hora = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const preco = (v: number) => `R$ ${Number(v).toFixed(2).replace('.', ',')}`;

function saudacao(d: Date) {
  const h = d.getHours();
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

function quandoLabel(d: Date) {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  const dia  = new Date(d); dia.setHours(0, 0, 0, 0);
  const diff = Math.round((dia.getTime() - hoje.getTime()) / 86400000);
  if (diff <= 0) return 'HOJE';
  if (diff === 1) return 'AMANHÃ';
  return `EM ${diff} DIAS`;
}

export default function HomeScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const navigation = useNavigation<Nav>();
  const { user, signOut } = useAuth();
  const [nome, setNome]               = useState('');
  const [formato, setFormato]         = useState<string | null>(null);
  const [proximo, setProximo]         = useState<Proximo | null>(null);
  const [ultimoCorte, setUltimoCorte] = useState<UltimoCorte | null>(null);
  const [barbeiros, setBarbeiros]     = useState<Barbeiro[]>([]);
  const [servicos, setServicos]       = useState<Servico[]>([]);
  const [naoLidas, setNaoLidas]       = useState(0);
  const [loading, setLoading]         = useState(true);
  const [refreshing, setRefreshing]   = useState(false);
  const [erro, setErro]               = useState<string | null>(null);

  useFocusEffect(useCallback(() => { carregar(); }, [user?.id]));

  async function carregar() {
    if (!user) return;
    try {
      // Conclui automaticamente os agendamentos cujo horario ja terminou
      await supabase.rpc('concluir_agendamentos_passados');

      const [perfil, prox, ultimo, barbs, servs] = await Promise.all([
        supabase.from('profiles').select('nome, formato_rosto').eq('user_id', user.id).single(),
        supabase.from('agendamentos')
          .select('id, data_hora, barbeiro_id, barbeiros(nome), servicos(nome, preco, duracao_min)')
          .eq('cliente_id', user.id).eq('status', 'confirmado')
          .gte('data_hora', new Date().toISOString())
          .order('data_hora', { ascending: true }).limit(1),
        supabase.from('agendamentos')
          .select('id, data_hora, barbeiro_id, barbeiros(nome), servicos(nome)')
          .eq('cliente_id', user.id).eq('status', 'concluido')
          .order('data_hora', { ascending: false }).limit(1),
        supabase.from('barbeiros').select('*').eq('ativo', true).order('nome'),
        supabase.from('servicos').select('*').eq('ativo', true).order('preco').limit(4),
      ]);

      const falha = prox.error ?? barbs.error ?? servs.error;
      if (falha) throw falha;

      setNome(perfil.data?.nome ?? '');
      setFormato(perfil.data?.formato_rosto ?? null);
      setProximo(((prox.data ?? [])[0] as unknown as Proximo) ?? null);
      setBarbeiros(barbs.data ?? []);
      setServicos(servs.data ?? []);

      // Considera apenas o corte concluido mais recente: se ja foi avaliado,
      // mostra a nota e oferece repetir o agendamento em vez de pedir avaliacao
      const corte = (ultimo.data ?? [])[0];
      if (corte) {
        const { data: aval } = await supabase.from('avaliacoes').select('nota')
          .eq('agendamento_id', corte.id).maybeSingle();
        setUltimoCorte({ ...(corte as unknown as UltimoCorte), nota: aval?.nota ?? null });
      } else {
        setUltimoCorte(null);
      }
      setErro(null);
    } catch (e: any) {
      setErro(e.message ?? 'Erro ao carregar a tela inicial.');
    }
    setLoading(false);
    setRefreshing(false);
    carregarNaoLidas();
  }

  async function carregarNaoLidas() {
    if (!user) return;
    // So conta conversas que o cliente consegue abrir: as dos barbeiros com
    // agendamento nao cancelado (onde "Meus Agendamentos" mostra o botao CHAT)
    const { data: ags } = await supabase.from('agendamentos').select('barbeiro_id')
      .eq('cliente_id', user.id).neq('status', 'cancelado');
    const barbeiroIds = [...new Set((ags ?? []).map((a) => a.barbeiro_id))];
    if (!barbeiroIds.length) { setNaoLidas(0); return; }

    const db = supabase as any;
    const { data: conversas } = await db.from('conversas').select('id')
      .eq('cliente_id', user.id).in('barbeiro_id', barbeiroIds);
    if (!conversas?.length) { setNaoLidas(0); return; }
    const { count } = await db.from('mensagens').select('id', { count: 'exact', head: true })
      .in('conversa_id', conversas.map((c: any) => c.id)).eq('lida', false).neq('remetente_id', user.id);
    setNaoLidas(count ?? 0);
  }

  const agora = new Date();
  const primeiroNome = (nome || user?.email?.split('@')[0] || '').split(' ')[0];
  const infoFormato = formato ? FORMATOS[formato] : null;

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <View style={s.screen}>
      {/* Header */}
      <View style={s.header}>
        <View style={s.logoRow}>
          <LogoMark size={26} color={C.primary} bg={C.bg} line={C.border} />
          <Text style={s.logoText}>VISAGE BARBER</Text>
        </View>
        <View style={s.headerActions}>
          <TouchableOpacity style={s.iconBtn} onPress={() => navigation.navigate('MeusAgendamentos')}>
            <Feather name="message-circle" size={18} color={C.primary} />
            {naoLidas > 0 && (
              <View style={s.dotBadge}><Text style={s.dotBadgeText}>{naoLidas > 9 ? '9+' : naoLidas}</Text></View>
            )}
          </TouchableOpacity>
          <TouchableOpacity style={s.iconBtn} onPress={signOut}>
            <Feather name="log-out" size={17} color={C.mutedFg} />
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); carregar(); }} tintColor={C.accent} />}
      >
        {/* Saudação */}
        <View style={s.greeting}>
          <Text style={s.greetingDate}>
            {DIAS[agora.getDay()]} · {pad(agora.getDate())} {MESES[agora.getMonth()]}
          </Text>
          <Text style={s.greetingTitle}>
            {saudacao(agora)},{'\n'}
            <Text style={s.greetingName}>{primeiroNome}</Text>
            <Text style={{ color: C.accent }}>.</Text>
          </Text>
        </View>

        {/* Busca -> agendamento */}
        <TouchableOpacity style={s.search} activeOpacity={0.8} onPress={() => navigation.navigate('Agendar')}>
          <Feather name="search" size={16} color={C.mutedFg} />
          <Text style={s.searchText}>Buscar barbeiro ou serviço</Text>
          <Feather name="arrow-right" size={14} color={C.mutedFg} />
        </TouchableOpacity>

        {erro && <ErroFetch message={erro} onRetry={() => { setErro(null); carregar(); }} />}

        {/* Próximo horário */}
        <SectionTitle C={C} label="PRÓXIMO HORÁRIO" />
        {proximo ? (() => {
          const d = new Date(proximo.data_hora);
          return (
            <View style={[s.card, s.nextCard]}>
              <View style={s.nextTop}>
                <View style={s.dateBlock}>
                  <Text style={s.dateDay}>{pad(d.getDate())}</Text>
                  <Text style={s.dateMonth}>{MESES[d.getMonth()]}</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.nextBadge}><Text style={s.nextBadgeText}>{quandoLabel(d)} · {hora(d)}</Text></View>
                  <Text style={s.nextService} numberOfLines={1}>{proximo.servicos?.nome ?? 'Serviço'}</Text>
                  <Text style={s.nextMeta} numberOfLines={1}>
                    com {proximo.barbeiros?.nome ?? '—'}
                    {proximo.servicos ? `  ·  ${proximo.servicos.duracao_min} MIN  ·  ${preco(proximo.servicos.preco)}` : ''}
                  </Text>
                </View>
              </View>
              <View style={s.nextActions}>
                <TouchableOpacity
                  style={s.nextAction}
                  onPress={() => navigation.navigate('Chat', {
                    outroNome: proximo.barbeiros?.nome ?? 'Barbeiro',
                    barbeiroId: proximo.barbeiro_id,
                    clienteId: user!.id,
                  })}>
                  <Feather name="message-circle" size={13} color={C.primary} />
                  <Text style={s.nextActionText}>FALAR COM BARBEIRO</Text>
                </TouchableOpacity>
                <View style={s.vDivider} />
                <TouchableOpacity style={s.nextAction} onPress={() => navigation.navigate('MeusAgendamentos')}>
                  <Text style={s.nextActionText}>DETALHES</Text>
                  <Feather name="arrow-right" size={13} color={C.primary} />
                </TouchableOpacity>
              </View>
            </View>
          );
        })() : (
          <TouchableOpacity style={[s.card, s.emptyCard]} activeOpacity={0.85} onPress={() => navigation.navigate('Agendar')}>
            <View style={{ flex: 1 }}>
              <Text style={s.emptyTitle}>Nenhum horário marcado</Text>
              <Text style={s.emptyText}>Reserve seu próximo corte em poucos passos.</Text>
            </View>
            <View style={s.emptyBtn}>
              <Text style={s.emptyBtnText}>AGENDAR</Text>
              <Feather name="arrow-right" size={13} color={C.accentFg} />
            </View>
          </TouchableOpacity>
        )}

        {/* Último corte: pede avaliação ou, se já avaliado, oferece repetir */}
        {ultimoCorte && (ultimoCorte.nota == null ? (
          <TouchableOpacity
            style={[s.card, s.rateCard]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Avaliacao', { agendamentoId: ultimoCorte.id, barbeiroId: ultimoCorte.barbeiro_id })}>
            <View style={s.rateIcon}><Feather name="star" size={16} color={C.accent} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.rateTitle}>Como foi seu último corte?</Text>
              <Text style={s.rateText} numberOfLines={1}>
                {ultimoCorte.servicos?.nome ?? 'Serviço'} com {ultimoCorte.barbeiros?.nome ?? '—'}
              </Text>
            </View>
            <Text style={s.rateCta}>AVALIAR</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[s.card, s.rateCard]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Agendar', { initialBarbeiroId: ultimoCorte.barbeiro_id })}>
            <View style={s.rateIcon}><Feather name="repeat" size={16} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.rateLabel}>
                ÚLTIMO CORTE · {pad(new Date(ultimoCorte.data_hora).getDate())} {MESES[new Date(ultimoCorte.data_hora).getMonth()]}
              </Text>
              <Text style={s.rateText} numberOfLines={1}>
                {ultimoCorte.servicos?.nome ?? 'Serviço'} com {ultimoCorte.barbeiros?.nome ?? '—'}
              </Text>
              <View style={s.stars}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <Feather key={n} name="star" size={11} color={n <= ultimoCorte.nota! ? C.accent : C.border} />
                ))}
              </View>
            </View>
            <Text style={[s.rateCta, { color: C.primary }]}>REPETIR</Text>
          </TouchableOpacity>
        ))}

        {/* Atalhos */}
        <SectionTitle C={C} label="ACESSO RÁPIDO" />
        <View style={s.quickRow}>
          <QuickAction C={C} s={s} icon="calendar" label={'NOVO\nHORÁRIO'} accent onPress={() => navigation.navigate('Agendar')} />
          <QuickAction C={C} s={s} icon="camera" label={'VISAGISMO\nIA'} onPress={() => navigation.navigate('VisagismoFoto')} />
          <QuickAction C={C} s={s} icon="help-circle" label={'QUIZ DO\nROSTO'} onPress={() => navigation.navigate('Visagismo')} />
          <QuickAction C={C} s={s} icon="clock" label={'MEU\nHISTÓRICO'} onPress={() => navigation.navigate('MeusAgendamentos')} />
        </View>

        {/* Banner visagismo */}
        <TouchableOpacity activeOpacity={0.9} style={s.bannerWrap} onPress={() => navigation.navigate('VisagismoFoto')}>
          <ImageBackground source={HERO} style={s.banner} resizeMode="cover">
            <Svg style={StyleSheet.absoluteFill}>
              <Defs>
                <LinearGradient id="fade" x1="0" y1="0" x2="0" y2="1">
                  <Stop offset="0" stopColor="#080808" stopOpacity="0.15" />
                  <Stop offset="1" stopColor="#080808" stopOpacity="0.95" />
                </LinearGradient>
              </Defs>
              <Rect width="100%" height="100%" fill="url(#fade)" />
            </Svg>
            <View style={s.bannerTag}><Text style={s.bannerTagText}>DIAGNÓSTICO MORFOLÓGICO</Text></View>
            <View>
              <Text style={s.bannerTitle}>Descubra o corte{'\n'}ideal para o seu rosto</Text>
              <View style={s.bannerCta}>
                <Text style={s.bannerCtaText}>ENVIAR FOTO PARA ANÁLISE</Text>
                <Feather name="arrow-right" size={13} color="#BFFF00" />
              </View>
            </View>
          </ImageBackground>
        </TouchableOpacity>

        {/* Formato do rosto */}
        {infoFormato && (
          <TouchableOpacity
            style={[s.card, s.faceCard]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('Recomendacao', { formato: formato! })}>
            <View style={s.faceIcon}><Feather name="user" size={18} color={C.primary} /></View>
            <View style={{ flex: 1 }}>
              <Text style={s.faceLabel}>SEU FORMATO DE ROSTO</Text>
              <Text style={s.faceTitle}>{infoFormato.titulo}</Text>
              <Text style={s.faceTip} numberOfLines={1}>{infoFormato.dica}</Text>
            </View>
            <Feather name="chevron-right" size={16} color={C.mutedFg} />
          </TouchableOpacity>
        )}

        {/* Barbeiros */}
        <SectionTitle C={C} label="NOSSOS BARBEIROS" count={barbeiros.length} />
        {barbeiros.length === 0 ? (
          <Text style={s.emptyInline}>Nenhum barbeiro disponível no momento.</Text>
        ) : (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 24, gap: 12 }}>
            {barbeiros.map((b) => (
              <TouchableOpacity
                key={b.id}
                style={s.barberCard}
                activeOpacity={0.85}
                onPress={() => navigation.navigate('Agendar', { initialBarbeiroId: b.id })}>
                <View style={s.barberPhoto}>
                  {b.foto_url
                    ? <Image source={{ uri: b.foto_url }} style={StyleSheet.absoluteFill} />
                    : <Text style={s.barberInitial}>{b.nome[0]?.toUpperCase()}</Text>}
                </View>
                <Text style={s.barberName} numberOfLines={1}>{b.nome}</Text>
                <Text style={s.barberEsp} numberOfLines={1}>{b.especialidade ?? 'Especialista em cortes'}</Text>
                <View style={s.barberCta}>
                  <Text style={s.barberCtaText}>AGENDAR</Text>
                  <Feather name="arrow-up-right" size={11} color={C.accent} />
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* Serviços */}
        <SectionTitle
          C={C}
          label="SERVIÇOS"
          action="VER TODOS"
          onAction={() => navigation.navigate('Agendar')}
        />
        <View style={s.servicesBox}>
          {servicos.map((sv, i) => (
            <TouchableOpacity
              key={sv.id}
              style={[s.serviceRow, i > 0 && { borderTopWidth: 1, borderTopColor: C.border }]}
              activeOpacity={0.8}
              onPress={() => navigation.navigate('Agendar')}>
              <Text style={s.serviceNum}>{String(i + 1).padStart(3, '0')}</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.serviceName} numberOfLines={1}>{sv.nome}</Text>
                <Text style={s.serviceMeta}>{sv.duracao_min} MIN</Text>
              </View>
              <Text style={s.servicePrice}>{preco(sv.preco)}</Text>
            </TouchableOpacity>
          ))}
          {servicos.length === 0 && <Text style={[s.emptyInline, { paddingVertical: 16 }]}>Nenhum serviço cadastrado.</Text>}
        </View>
      </ScrollView>
    </View>
  );
}

function SectionTitle({ C, label, count, action, onAction }: {
  C: Theme; label: string; count?: number; action?: string; onAction?: () => void;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, marginTop: 28, marginBottom: 12 }}>
      <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 }}>
        {label}{count != null ? ` // ${pad(count)}` : ''}
      </Text>
      <View style={{ flex: 1, height: 1, backgroundColor: C.border }} />
      {action && (
        <TouchableOpacity onPress={onAction} style={{ marginLeft: 12 }}>
          <Text style={{ fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 }}>{action}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function QuickAction({ C, s, icon, label, accent, onPress }: {
  C: Theme; s: ReturnType<typeof makeStyles>; icon: any; label: string; accent?: boolean; onPress: () => void;
}) {
  return (
    <TouchableOpacity style={[s.quick, accent && { borderColor: C.accent }]} activeOpacity={0.8} onPress={onPress}>
      <View style={[s.quickIcon, accent && { backgroundColor: C.accent, borderColor: C.accent }]}>
        <Feather name={icon} size={18} color={accent ? C.accentFg : C.primary} />
      </View>
      <Text style={s.quickLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:        { flex: 1, backgroundColor: C.bg },

    header:        { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, paddingTop: 52, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: C.border, backgroundColor: C.bg },
    logoRow:       { flexDirection: 'row', alignItems: 'center', gap: 8 },
    logoText:      { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 },
    headerActions: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    iconBtn:       { width: 36, height: 36, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
    dotBadge:      { position: 'absolute', top: -6, right: -6, minWidth: 16, height: 16, paddingHorizontal: 3, backgroundColor: C.accent, justifyContent: 'center', alignItems: 'center' },
    dotBadgeText:  { fontFamily: F.mono, fontSize: 9, color: C.accentFg },

    greeting:      { paddingHorizontal: 24, paddingTop: 24, paddingBottom: 18 },
    greetingDate:  { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 },
    greetingTitle: { fontFamily: F.sansLight, fontSize: 30, lineHeight: 34, color: C.fg, letterSpacing: -0.8 },
    greetingName:  { fontFamily: F.sansBold, color: C.primary },

    search:        { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, paddingHorizontal: 16, height: 48, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
    searchText:    { flex: 1, fontFamily: F.sans, fontSize: 14, color: C.mutedFg },

    card:          { marginHorizontal: 24, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },

    nextCard:      { borderColor: C.accent },
    nextTop:       { flexDirection: 'row', alignItems: 'center', gap: 16, padding: 16 },
    dateBlock:     { width: 60, height: 64, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
    dateDay:       { fontFamily: F.sansBold, fontSize: 26, color: C.primaryFg, lineHeight: 28 },
    dateMonth:     { fontFamily: F.mono, fontSize: 9, color: C.primaryFg, letterSpacing: 1.5 },
    nextBadge:     { alignSelf: 'flex-start', backgroundColor: C.accent, paddingHorizontal: 6, paddingVertical: 2, marginBottom: 6 },
    nextBadgeText: { fontFamily: F.mono, fontSize: 9, color: C.accentFg, letterSpacing: 1.2 },
    nextService:   { fontFamily: F.sansMedium, fontSize: 17, color: C.primary, marginBottom: 2 },
    nextMeta:      { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    nextActions:   { flexDirection: 'row', borderTopWidth: 1, borderTopColor: C.border },
    nextAction:    { flex: 1, flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 8, paddingVertical: 12 },
    nextActionText:{ fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.2 },
    vDivider:      { width: 1, backgroundColor: C.border },

    emptyCard:     { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16 },
    emptyTitle:    { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 2 },
    emptyText:     { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    emptyBtn:      { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: C.accent, paddingHorizontal: 12, paddingVertical: 10 },
    emptyBtnText:  { fontFamily: F.mono, fontSize: 10, color: C.accentFg, letterSpacing: 1.2 },

    rateCard:      { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, marginTop: 12 },
    rateIcon:      { width: 36, height: 36, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
    rateTitle:     { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
    rateText:      { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, marginTop: 1 },
    rateLabel:     { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 2 },
    stars:         { flexDirection: 'row', gap: 3, marginTop: 5 },
    rateCta:       { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5 },

    quickRow:      { flexDirection: 'row', gap: 8, paddingHorizontal: 24 },
    quick:         { flex: 1, alignItems: 'center', paddingVertical: 14, backgroundColor: C.card, borderWidth: 1, borderColor: C.border },
    quickIcon:     { width: 40, height: 40, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', marginBottom: 10 },
    quickLabel:    { fontFamily: F.mono, fontSize: 8.5, color: C.primary, letterSpacing: 1, textAlign: 'center', lineHeight: 12 },

    bannerWrap:    { marginHorizontal: 24, marginTop: 28, borderWidth: 1, borderColor: C.border, overflow: 'hidden' },
    banner:        { height: 200, padding: 18, justifyContent: 'space-between' },
    bannerTag:     { alignSelf: 'flex-start', borderWidth: 1, borderColor: 'rgba(255,255,255,0.35)', paddingHorizontal: 6, paddingVertical: 3, backgroundColor: 'rgba(8,8,8,0.4)' },
    bannerTagText: { fontFamily: F.mono, fontSize: 9, color: '#ffffff', letterSpacing: 1.5 },
    bannerTitle:   { fontFamily: F.sansBold, fontSize: 22, lineHeight: 26, color: '#ffffff', letterSpacing: -0.5, marginBottom: 12 },
    bannerCta:     { flexDirection: 'row', alignItems: 'center', gap: 8 },
    bannerCtaText: { fontFamily: F.mono, fontSize: 10, color: '#BFFF00', letterSpacing: 1.5 },

    faceCard:      { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, marginTop: 12 },
    faceIcon:      { width: 44, height: 44, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
    faceLabel:     { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 2 },
    faceTitle:     { fontFamily: F.sansMedium, fontSize: 17, color: C.primary },
    faceTip:       { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, marginTop: 1 },

    barberCard:    { width: 136, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, padding: 10 },
    barberPhoto:   { width: '100%', aspectRatio: 1, backgroundColor: C.muted, justifyContent: 'center', alignItems: 'center', overflow: 'hidden', marginBottom: 10 },
    barberInitial: { fontFamily: F.sansLight, fontSize: 40, color: C.primary },
    barberName:    { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
    barberEsp:     { fontFamily: F.sans, fontSize: 11, color: C.mutedFg, marginTop: 1, marginBottom: 10 },
    barberCta:     { flexDirection: 'row', alignItems: 'center', gap: 4, borderTopWidth: 1, borderTopColor: C.border, paddingTop: 8 },
    barberCtaText: { fontFamily: F.mono, fontSize: 9, color: C.accent, letterSpacing: 1.5 },

    servicesBox:   { marginHorizontal: 24, borderWidth: 1, borderColor: C.border, backgroundColor: C.card },
    serviceRow:    { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 },
    serviceNum:    { fontFamily: F.mono, fontSize: 10, color: C.mutedFg },
    serviceName:   { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
    serviceMeta:   { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1, marginTop: 2 },
    servicePrice:  { fontFamily: F.mono, fontSize: 12, color: C.primary },

    emptyInline:   { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingHorizontal: 24, textAlign: 'center' },
  });
}
