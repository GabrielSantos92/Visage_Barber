import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { F, Theme } from '../../../lib/theme';
import { DIAS_SEMANA, TEXTOS_PAINEL, resumoDiasSemana, rotuloDia } from '../../../lib/painelBarbeiro';
import { suave } from './graficos';

// Atendimentos concluidos por dia da semana (segunda a domingo), so com Views,
// como no site. Conta atendimentos, nao dinheiro; o dia com mais cortes fica
// em destaque (verde forte), os demais em verde suave, com grade leve ao fundo.
const ALTURA = 120;

export default function GraficoDiasSemana({ dias, C }: { dias: number[]; C: Theme }) {
  const s = React.useMemo(() => estilos(C), [C]);
  const resumo = resumoDiasSemana(dias);
  if (!resumo.total) return <Text style={s.vazio}>{TEXTOS_PAINEL.atendimentosVazio}</Text>;

  return (
    <View>
      <View style={s.area}>
        {[0.25, 0.5, 0.75].map((f) => <View key={f} style={[s.grade, { bottom: f * ALTURA }]} />)}
        <View style={s.colunas}>
          {dias.map((qtd, i) => {
            const topo = qtd === resumo.maximo;
            return (
              <View key={DIAS_SEMANA.curto[i]} style={s.coluna} accessible accessibilityLabel={rotuloDia(i, qtd)}>
                {qtd > 0 && <Text style={[s.qtd, topo && s.destaque]}>{qtd}</Text>}
                <View style={{
                  width: '70%', maxWidth: 24, height: (qtd / resumo.maximo) * ALTURA,
                  backgroundColor: topo ? C.accent : suave(C.accent), borderTopLeftRadius: 4, borderTopRightRadius: 4,
                }} />
              </View>
            );
          })}
        </View>
      </View>
      <View style={s.rotulos}>
        {dias.map((qtd, i) => (
          <Text key={DIAS_SEMANA.curto[i]} style={[s.rotulo, qtd === resumo.maximo && s.destaque]}>{DIAS_SEMANA.curto[i]}</Text>
        ))}
      </View>
      <Text style={s.resumo}>{resumo.texto}</Text>
    </View>
  );
}

function estilos(C: Theme) {
  return StyleSheet.create({
    vazio:    { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingVertical: 24, textAlign: 'center' },
    area:     { height: ALTURA + 18, justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: C.border },
    grade:    { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: C.border, opacity: 0.5 },
    colunas:  { flexDirection: 'row', alignItems: 'flex-end' },
    coluna:   { flex: 1, alignItems: 'center' },
    qtd:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, marginBottom: 4 },
    destaque: { color: C.primary, fontFamily: F.mono, fontWeight: '700' },
    rotulos:  { flexDirection: 'row', marginTop: 6 },
    rotulo:   { flex: 1, textAlign: 'center', fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    resumo:   { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 0.5, marginTop: 12 },
  });
}
