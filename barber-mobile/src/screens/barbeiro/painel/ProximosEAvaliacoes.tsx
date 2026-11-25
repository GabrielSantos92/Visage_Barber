import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { F, Theme } from '../../../lib/theme';
import {
  AVALIACOES_RECENTES, TEXTOS_INDICADORES, horaDoAgendamento, notaComVirgula, quandoDoAgendamento, resumoAvaliacoes,
} from '../../../lib/painelBarbeiro';
import type { AgendamentoPainel, AvaliacaoPainel } from '../../../lib/painelBarbeiro';
import { Erro, Esqueleto, Painel } from './graficos';

// Proximos atendimentos (a partir de amanha, no maximo cinco) e avaliacoes
// recentes, iguais aos do site. Listas curtas, so leitura: a Agenda continua
// com tudo.

export function ProximosAtendimentos({ C, lista, erro, onTentar, onAbrirAgenda }: {
  C: Theme; lista: AgendamentoPainel[] | null; erro: boolean; onTentar: () => void; onAbrirAgenda: () => void;
}) {
  const s = useMemo(() => estilos(C), [C]);
  return (
    <Painel
      C={C}
      titulo={TEXTOS_INDICADORES.proximos}
      acao={(
        <TouchableOpacity onPress={onAbrirAgenda} accessibilityRole="link" style={s.link}>
          <Text style={s.linkTexto}>{TEXTOS_INDICADORES.verAgenda.toUpperCase()}</Text>
          <Feather name="arrow-right" size={11} color={C.primary} />
        </TouchableOpacity>
      )}
    >
      {erro ? <Erro C={C} mensagem={TEXTOS_INDICADORES.erroProximos} onTentar={onTentar} />
        : !lista ? <Esqueleto C={C} altura={90} />
          : !lista.length ? <Text style={s.vazio}>{TEXTOS_INDICADORES.proximosVazio}</Text>
            : lista.map((a, i) => (
              <View
                key={a.id} style={[s.linha, i > 0 && s.separador]} accessible
                accessibilityLabel={`${quandoDoAgendamento(a.data_hora)}, ${a.profiles?.nome ?? 'Cliente'}${a.servicos?.nome ? `, ${a.servicos.nome}` : ''}`}
              >
                <View style={s.quando}>
                  <Text style={s.dia}>{quandoDoAgendamento(a.data_hora).split(' · ')[0].toUpperCase()}</Text>
                  <Text style={s.hora}>{horaDoAgendamento(a.data_hora)}</Text>
                </View>
                <View style={s.quem}>
                  <Text numberOfLines={1} style={s.nome}>{a.profiles?.nome ?? 'Cliente'}</Text>
                  {!!a.servicos?.nome && <Text numberOfLines={1} style={s.detalhe}>{a.servicos.nome}</Text>}
                </View>
              </View>
            ))}
    </Painel>
  );
}

const Estrelas = ({ C, nota }: { C: Theme; nota: number }) => (
  <Text accessibilityLabel={`Nota ${nota} de 5`} style={{ fontSize: 12, letterSpacing: 1 }}>
    {[1, 2, 3, 4, 5].map((n) => <Text key={n} style={{ color: n <= nota ? C.accent : C.border }}>★</Text>)}
  </Text>
);

export function AvaliacoesRecentes({ C, lista, erro, onTentar }: { C: Theme; lista: AvaliacaoPainel[] | null; erro: boolean; onTentar: () => void }) {
  const s = useMemo(() => estilos(C), [C]);
  const geral = lista ? resumoAvaliacoes(lista) : null;
  return (
    <Painel
      C={C}
      titulo={TEXTOS_INDICADORES.avaliacoes}
      acao={geral?.media != null ? (
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={s.media}>{notaComVirgula(geral.media)} ★</Text>
          <Text style={s.detalhe}>{geral.total} no total</Text>
        </View>
      ) : undefined}
    >
      {erro ? <Erro C={C} mensagem={TEXTOS_INDICADORES.erroAvaliacoes} onTentar={onTentar} />
        : !lista ? <Esqueleto C={C} altura={90} />
          : !lista.length ? <Text style={s.vazio}>{TEXTOS_INDICADORES.avaliacoesVazio}</Text>
            : lista.slice(0, AVALIACOES_RECENTES).map((a, i) => (
              <View key={a.id} style={[s.avaliacao, i > 0 && s.separador]}>
                <View style={s.avaliacaoTopo}>
                  <Estrelas C={C} nota={a.nota} />
                  <Text style={s.data}>{new Date(a.created_at).toLocaleDateString('pt-BR')}</Text>
                </View>
                {!!a.comentario && <Text numberOfLines={2} style={s.comentario}>“{a.comentario}”</Text>}
                <Text style={s.detalhe}>{a.cliente ?? 'Cliente'}</Text>
              </View>
            ))}
    </Painel>
  );
}

function estilos(C: Theme) {
  return StyleSheet.create({
    link:          { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 2 },
    linkTexto:     { fontFamily: F.mono, fontSize: 9, color: C.primary, letterSpacing: 1.2 },
    vazio:         { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, textAlign: 'center', paddingVertical: 16 },
    linha:         { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
    separador:     { borderTopWidth: 1, borderTopColor: C.border },
    quando:        { width: 64, alignItems: 'center' },
    dia:           { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1 },
    hora:          { fontFamily: F.sansBold, fontSize: 16, color: C.primary },
    quem:          { flex: 1, borderLeftWidth: 1, borderLeftColor: C.border, paddingLeft: 12 },
    nome:          { fontFamily: F.sans, fontSize: 14, color: C.primary },
    detalhe:       { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, marginTop: 2 },
    media:         { fontFamily: F.sansBold, fontSize: 16, color: C.primary },
    avaliacao:     { paddingVertical: 10, gap: 4 },
    avaliacaoTopo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
    data:          { fontFamily: F.mono, fontSize: 9, color: C.mutedFg },
    comentario:    { fontFamily: F.sans, fontSize: 13, color: C.fg, lineHeight: 18 },
  });
}
