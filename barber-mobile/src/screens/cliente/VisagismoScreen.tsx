import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

type Nav = StackNavigationProp<ClienteStackParamList>;
type PontosFormato = Record<string, number>;

const PERGUNTAS: { pergunta: string; opcoes: { texto: string; pontos: PontosFormato }[] }[] = [
  {
    pergunta: 'Como é a largura da sua testa?',
    opcoes: [
      { texto: 'Larga (mais larga que o queixo)', pontos: { oval: 1, quadrado: 2, triangular: 3 } },
      { texto: 'Estreita (mais estreita que o queixo)', pontos: { triangular: 3, losango: 2 } },
      { texto: 'Proporcional', pontos: { oval: 3, oblongo: 1 } },
    ],
  },
  {
    pergunta: 'Como é a linha do seu queixo?',
    opcoes: [
      { texto: 'Pontudo / afinado', pontos: { oval: 2, triangular: 1, losango: 2 } },
      { texto: 'Quadrado / angular', pontos: { quadrado: 3, oblongo: 1 } },
      { texto: 'Arredondado', pontos: { redondo: 3, oval: 1 } },
    ],
  },
  {
    pergunta: 'Qual é a proporção do seu rosto?',
    opcoes: [
      { texto: 'Comprido (muito mais alto que largo)', pontos: { oblongo: 3, quadrado: 1 } },
      { texto: 'Largo (quase igual em altura e largura)', pontos: { redondo: 2, quadrado: 2 } },
      { texto: 'Equilibrado', pontos: { oval: 3 } },
    ],
  },
  {
    pergunta: 'Onde é o ponto mais largo do seu rosto?',
    opcoes: [
      { texto: 'Nas maçãs do rosto', pontos: { losango: 3, oval: 1 } },
      { texto: 'Na testa', pontos: { triangular: 2, quadrado: 1 } },
      { texto: 'Testa e mandíbula são iguais', pontos: { quadrado: 2, oblongo: 1 } },
      { texto: 'Distribuído uniformemente', pontos: { oval: 2, redondo: 1 } },
    ],
  },
];

function calcularFormato(respostas: PontosFormato[]): string {
  const totais: Record<string, number> = { oval: 0, redondo: 0, quadrado: 0, triangular: 0, losango: 0, oblongo: 0 };
  for (const r of respostas) for (const [f, p] of Object.entries(r)) totais[f] = (totais[f] ?? 0) + p;
  return Object.entries(totais).sort((a, b) => b[1] - a[1])[0][0];
}

export default function VisagismoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user } = useAuth();
  const navigation = useNavigation<Nav>();
  const [perguntaAtual, setPerguntaAtual] = useState(0);
  const [respostas, setRespostas] = useState<PontosFormato[]>([]);

  function responder(pontos: PontosFormato) {
    const novas = [...respostas, pontos];
    if (perguntaAtual < PERGUNTAS.length - 1) {
      setRespostas(novas);
      setPerguntaAtual(perguntaAtual + 1);
    } else {
      const formato = calcularFormato(novas);
      salvarENavegar(formato);
    }
  }

  async function salvarENavegar(formato: string) {
    if (user) await supabase.from('profiles').update({ formato_rosto: formato }).eq('user_id', user.id);
    navigation.navigate('Recomendacao', { formato });
  }

  const q = PERGUNTAS[perguntaAtual];
  const progresso = perguntaAtual / PERGUNTAS.length;

  return (
    <View style={s.screen}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>VISAGISMO</Text>
        <Text style={s.pageTitle}>Análise do Rosto</Text>

        <TouchableOpacity style={s.btnIA} onPress={() => navigation.navigate('VisagismoFoto')}>
          <Feather name="cpu" size={14} color={C.primaryFg} />
          <Text style={s.btnIAText}>ANALISAR COM IA</Text>
        </TouchableOpacity>
      </View>

      <View style={s.progressoBg}>
        <View style={[s.progressoFill, { width: `${progresso * 100}%` }]} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24, marginBottom: 4 }}>
        <Text style={s.progressoLabel}>PERGUNTA {perguntaAtual + 1} / {PERGUNTAS.length}</Text>
        <Text style={s.progressoLabel}>{Math.round(progresso * 100)}%</Text>
      </View>

      <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 40 }}>
        <Text style={s.pergunta}>{q.pergunta}</Text>

        {q.opcoes.map((opcao, i) => (
          <TouchableOpacity key={i} style={[s.opcao, i < q.opcoes.length - 1 && s.opcaoBorder]} onPress={() => responder(opcao.pontos)}>
            <Text style={s.opcaoText}>{opcao.texto}</Text>
            <Feather name="chevron-right" size={14} color={C.mutedFg} />
          </TouchableOpacity>
        ))}

        {perguntaAtual > 0 && (
          <TouchableOpacity onPress={() => { setPerguntaAtual(0); setRespostas([]); }} style={s.reiniciar}>
            <Feather name="rotate-ccw" size={12} color={C.mutedFg} />
            <Text style={s.reiniciarText}>REINICIAR</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:         { flex: 1, backgroundColor: C.bg },
    pageHeader:     { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:      { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    progressoBg:    { height: 2, backgroundColor: C.border, marginHorizontal: 24, marginTop: 16 },
    progressoFill:  { height: 2, backgroundColor: C.accent },
    progressoLabel: { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1, marginTop: 4 },
    pergunta:       { fontFamily: F.sansLight, fontSize: 20, color: C.primary, lineHeight: 28, marginBottom: 24, marginTop: 8 },
    opcao:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18 },
    opcaoBorder:    { borderBottomWidth: 1, borderBottomColor: C.border },
    opcaoText:      { fontFamily: F.sans, fontSize: 15, color: C.fg, flex: 1, marginRight: 12 },
    reiniciar:      { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 24 },
    reiniciarText:  { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    btnIA:          { flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: C.primary, paddingVertical: 12, paddingHorizontal: 20, marginTop: 16, alignSelf: 'flex-start' },
    btnIAText:      { fontFamily: F.mono, fontSize: 10, color: C.primaryFg, letterSpacing: 2 },
  });
}
