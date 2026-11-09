import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { F, Theme } from '../../../lib/theme';
import { DIAS_SEMANA, TEXTOS_PAINEL, resumoDiasSemana, rotuloDia } from '../../../lib/painelBarbeiro';

// Atendimentos concluidos por dia da semana (segunda a domingo), so com Views,
// como no site. Conta atendimentos, nao dinheiro; o dia com mais cortes fica
// em destaque.
const ALTURA = 120;

export default function GraficoDiasSemana({ dias, C }: { dias: number[]; C: Theme }) {
  const s = React.useMemo(() => estilos(C), [C]);
  const resumo = resumoDiasSemana(dias);
  if (!resumo.total) return <Text style={s.vazio}>{TEXTOS_PAINEL.atendimentosVazio}</Text>;

  return (
    <View>
      <View style={s.colunas}>
        {dias.map((qtd, i) => {
          const topo = qtd === resumo.maximo;
          return (
            <View key={DIAS_SEMANA.curto[i]} style={s.coluna} accessible accessibilityLabel={rotuloDia(i, qtd)}>
              <Text style={[s.qtd, topo && { color: C.primary }]}>{qtd}</Text>
              <View style={s.trilho}>
                <View style={{ height: (qtd / resumo.maximo) * ALTURA, backgroundColor: topo ? C.accent : C.fg }} />
              </View>
              <Text style={[s.rotulo, topo && { color: C.primary }]}>{DIAS_SEMANA.curto[i]}</Text>
            </View>
          );
        })}
      </View>
      <Text style={s.resumo}>{resumo.texto}</Text>
    </View>
  );
}

function estilos(C: Theme) {
  return StyleSheet.create({
    vazio:   { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingVertical: 24, textAlign: 'center' },
    colunas: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
    coluna:  { flex: 1, alignItems: 'center' },
    qtd:     { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, marginBottom: 4 },
    trilho:  { height: ALTURA, width: 18, justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: C.border },
    rotulo:  { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1, marginTop: 6 },
    resumo:  { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 0.5, marginTop: 12 },
  });
}
