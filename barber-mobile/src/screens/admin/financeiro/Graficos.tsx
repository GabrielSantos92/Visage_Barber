import React from 'react';
import { View, Text, ScrollView, StyleSheet, DimensionValue } from 'react-native';
import { F, Theme } from '../../../lib/theme';
import { LinhaBarbeiro, PontoGrafico } from '../../../lib/financeiro';
import { formatarReais } from '../../../lib/pagamentos';

// Graficos do Financeiro feitos so com Views (nenhuma biblioteca nativa nova),
// com os mesmos dados dos graficos do site. Cada barra tem o valor no leitor de tela.

const ALTURA = 140;

// Faturamento do periodo por dia (ou por mes, em periodos longos): comissoes e
// parte da barbearia empilhadas
export function GraficoFaturamento({ dados, C }: { dados: PontoGrafico[]; C: Theme }) {
  const s = React.useMemo(() => estilos(C), [C]);
  if (!dados.length) return <Text style={s.vazio}>Sem serviços pagos no período.</Text>;
  const maximo = Math.max(...dados.map((d) => d.comissao + d.barbearia), 0) || 1;
  // Muitas colunas: rotulo so em algumas, para nao embaralhar
  const passo = dados.length > 12 ? Math.ceil(dados.length / 6) : 1;
  return (
    <View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={s.colunas}>
          {dados.map((d, i) => {
            const total = d.comissao + d.barbearia;
            return (
              <View
                key={d.rotulo} style={s.coluna} accessible
                accessibilityLabel={`${d.rotulo}: faturamento ${formatarReais(total)}, comissões ${formatarReais(d.comissao)}, barbearia ${formatarReais(d.barbearia)}`}
              >
                <View style={s.pilha}>
                  <View style={{ height: (Math.max(0, d.barbearia) / maximo) * ALTURA, backgroundColor: C.primary }} />
                  <View style={{ height: (Math.max(0, d.comissao) / maximo) * ALTURA, backgroundColor: C.accent }} />
                </View>
                <Text style={[s.rotulo, total < 0 && { color: C.destructive }]} numberOfLines={1}>{i % passo === 0 ? d.rotulo : ''}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
      <Legenda s={s} itens={[['Comissões', C.accent], ['Barbearia', C.primary]]} />
    </View>
  );
}

// Faturamento e comissao de cada barbeiro no periodo
export function GraficoBarbeiros({ linhas, C }: { linhas: LinhaBarbeiro[]; C: Theme }) {
  const s = React.useMemo(() => estilos(C), [C]);
  const comMovimento = linhas.filter((b) => b.faturamento !== 0);
  if (!comMovimento.length) return <Text style={s.vazio}>Sem serviços pagos no período.</Text>;
  const maximo = Math.max(...comMovimento.map((b) => Math.max(b.faturamento, b.comissao)), 0) || 1;
  return (
    <View>
      {comMovimento.map((b) => (
        <View
          key={b.barbeiro_id} style={{ marginBottom: 12 }} accessible
          accessibilityLabel={`${b.nome}: faturamento ${formatarReais(b.faturamento)}, comissão ${formatarReais(b.comissao)}`}
        >
          <Text style={s.nome}>{b.nome}</Text>
          <Barra s={s} proporcao={b.faturamento / maximo} cor={C.primary} valor={formatarReais(b.faturamento)} />
          <Barra s={s} proporcao={b.comissao / maximo} cor={C.accent} valor={formatarReais(b.comissao)} />
        </View>
      ))}
      <Legenda s={s} itens={[['Faturamento', C.primary], ['Comissão', C.accent]]} />
    </View>
  );
}

function Barra({ s, proporcao, cor, valor }: { s: ReturnType<typeof estilos>; proporcao: number; cor: string; valor: string }) {
  const largura = `${Math.max(0, Math.min(1, proporcao)) * 100}%` as DimensionValue;
  return (
    <View style={s.barraLinha}>
      <View style={s.trilho}><View style={{ width: largura, height: '100%', backgroundColor: cor }} /></View>
      <Text style={s.barraValor}>{valor}</Text>
    </View>
  );
}

function Legenda({ s, itens }: { s: ReturnType<typeof estilos>; itens: [string, string][] }) {
  return (
    <View style={s.legenda}>
      {itens.map(([rotulo, cor]) => (
        <View key={rotulo} style={s.legendaItem}>
          <View style={{ width: 10, height: 10, backgroundColor: cor }} />
          <Text style={s.legendaTexto}>{rotulo.toUpperCase()}</Text>
        </View>
      ))}
    </View>
  );
}

function estilos(C: Theme) {
  return StyleSheet.create({
    vazio:        { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingVertical: 24, textAlign: 'center' },
    colunas:      { flexDirection: 'row', alignItems: 'flex-end', gap: 6, paddingBottom: 4 },
    coluna:       { width: 34, alignItems: 'center' },
    pilha:        { height: ALTURA, width: 16, justifyContent: 'flex-end', borderBottomWidth: 1, borderBottomColor: C.border },
    rotulo:       { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, marginTop: 4 },
    nome:         { fontFamily: F.sans, fontSize: 13, color: C.primary, marginBottom: 4 },
    barraLinha:   { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 },
    trilho:       { flex: 1, height: 10, backgroundColor: C.muted },
    barraValor:   { fontFamily: F.mono, fontSize: 9, color: C.fg, width: 86, textAlign: 'right' },
    legenda:      { flexDirection: 'row', gap: 16, marginTop: 10 },
    legendaItem:  { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendaTexto: { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
  });
}
