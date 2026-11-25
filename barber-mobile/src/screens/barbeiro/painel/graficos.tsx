import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Pressable, TouchableOpacity } from 'react-native';
import { F, Theme } from '../../../lib/theme';
import { formatarReais } from '../../../lib/pagamentos';
import { TEXTOS_INDICADORES } from '../../../lib/painelBarbeiro';

// Graficos do Painel do Barbeiro, iguais aos do site (so Views). So exibicao:
// desenham os valores que o painel ja recebe, sem calcular nada alem de
// proporcoes. Cor principal: o verde da marca (accent), forte no destaque e
// suave no resto; texto sempre nas cores de texto. No celular nao ha "passar
// o mouse": tocar numa coluna mostra o valor dela embaixo do grafico.

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);
// Cor com transparencia (#RRGGBB + alfa)
export const suave = (cor: string, alfa = '66') => (cor.length === 7 ? `${cor}${alfa}` : cor);

export function useEstilosGraficos(C: Theme) {
  return useMemo(() => estilos(C), [C]);
}

export function Legenda({ C, cor, rotulo, valor }: { C: Theme; cor: string; rotulo: string; valor?: string }) {
  const s = useEstilosGraficos(C);
  return (
    <View style={s.legenda}>
      <View style={[s.legendaCor, { backgroundColor: cor }]} />
      <Text style={s.legendaTexto}>{rotulo}</Text>
      {!!valor && <Text style={s.legendaValor}>{valor}</Text>}
    </View>
  );
}

// Moldura comum dos graficos e listas do painel
export function Painel({ C, titulo, nota, acao, children }: { C: Theme; titulo: string; nota?: string; acao?: React.ReactNode; children: React.ReactNode }) {
  const s = useEstilosGraficos(C);
  return (
    <View style={s.painel} accessibilityLabel={titulo}>
      <View style={s.painelTopo}>
        <View style={{ flex: 1 }}>
          <Text style={s.painelTitulo}>{titulo.toUpperCase()}</Text>
          {!!nota && <Text style={s.painelNota}>{nota}</Text>}
        </View>
        {acao}
      </View>
      {children}
    </View>
  );
}

export const Esqueleto = ({ C, altura = 140 }: { C: Theme; altura?: number }) => (
  <View style={{ height: altura, backgroundColor: C.muted, opacity: 0.6, borderRadius: 3 }} accessibilityLabel="Carregando" />
);

export function Vazio({ C, children }: { C: Theme; children: string }) {
  const s = useEstilosGraficos(C);
  return <Text style={s.vazio}>{children}</Text>;
}

export function Erro({ C, mensagem, onTentar }: { C: Theme; mensagem: string; onTentar?: () => void }) {
  const s = useEstilosGraficos(C);
  return (
    <View style={s.erro} accessibilityRole="alert">
      <Text style={s.erroTexto}>{mensagem}</Text>
      {onTentar && (
        <TouchableOpacity onPress={onTentar} accessibilityRole="button">
          <Text style={s.erroBotao}>{TEXTOS_INDICADORES.tentar.toUpperCase()}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ---------------------------------------------------------------
// Barra dividida: um todo repartido em partes (2px de folga entre elas)
// ---------------------------------------------------------------
export interface Parte { chave: string; valor: number; cor: string }

export function BarraDividida({ C, partes, rotulo, altura = 10 }: { C: Theme; partes: Parte[]; rotulo: string; altura?: number }) {
  const total = partes.reduce((s, p) => s + Math.max(0, p.valor), 0);
  return (
    <View style={{ flexDirection: 'row', gap: 2, height: altura }} accessible accessibilityLabel={rotulo}>
      {total === 0
        ? <View style={{ flex: 1, borderRadius: 3, backgroundColor: C.muted }} />
        : partes.filter((p) => p.valor > 0).map((p) => (
          <View key={p.chave} style={{ flex: p.valor, borderRadius: 3, backgroundColor: p.cor }} />
        ))}
    </View>
  );
}

// Quanto do faturamento virou comissao do barbeiro
export function DivisaoFaturamento({ C, faturamento, comissao }: { C: Theme; faturamento: number; comissao: number }) {
  const s = useEstilosGraficos(C);
  const fat = Number(faturamento);
  const com = Math.max(0, Math.min(Number(comissao), fat));
  if (!(fat > 0)) return null;
  const casa = fat - com;
  return (
    <View style={{ gap: 8 }}>
      <View style={s.linhaTitulo}>
        <Text style={s.miniTitulo}>{TEXTOS_INDICADORES.divisao.toUpperCase()}</Text>
        <Text style={s.miniTexto}>você fica com <Text style={s.forte}>{pct(com, fat)}%</Text></Text>
      </View>
      <BarraDividida
        C={C}
        rotulo={`Do faturamento de ${formatarReais(fat)}, ${formatarReais(com)} são sua comissão e ${formatarReais(casa)} ficam com a barbearia`}
        partes={[{ chave: 'voce', valor: com, cor: C.accent }, { chave: 'casa', valor: casa, cor: suave(C.fg, '55') }]}
      />
      <View style={s.legendas}>
        <Legenda C={C} cor={C.accent} rotulo="Sua parte" valor={formatarReais(com)} />
        <Legenda C={C} cor={suave(C.fg, '55')} rotulo="Barbearia" valor={formatarReais(casa)} />
      </View>
    </View>
  );
}

// Quanto das comissoes acumuladas ja foi pago (medidor)
export function ProgressoComissoes({ C, comissaoTotal, recebidoTotal }: { C: Theme; comissaoTotal: number; recebidoTotal: number }) {
  const s = useEstilosGraficos(C);
  const total = Number(comissaoTotal);
  if (!(total > 0)) return null;
  const pago = Math.max(0, Math.min(Number(recebidoTotal), total));
  const p = pct(pago, total);
  return (
    <View style={{ gap: 8 }}>
      <View style={s.linhaTitulo}>
        <Text style={s.miniTitulo}>{TEXTOS_INDICADORES.comissoesPagas.toUpperCase()}</Text>
        <Text style={s.miniTexto}><Text style={s.forte}>{formatarReais(pago)}</Text> de {formatarReais(total)}</Text>
      </View>
      <View
        style={{ height: 10, borderRadius: 3, backgroundColor: C.muted, overflow: 'hidden' }}
        accessible accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: p }}
        accessibilityLabel={`${p}% das comissões acumuladas já foram pagas`}
      >
        <View style={{ width: `${p}%`, height: '100%', borderRadius: 3, backgroundColor: C.accent }} />
      </View>
      <View style={s.linhaTitulo}>
        <Text style={s.eixo}>{p}% pago</Text>
        <Text style={s.eixo}>{100 - p}% a receber</Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------
// Colunas de uma serie no tempo (por dia, semana ou mes). Negativos
// (estornos e reembolsos) descem abaixo da linha do zero.
// ---------------------------------------------------------------
export interface Coluna { chave: string; rotulo: string; valor: number; descricao: string }

const ALTURA = 140;

export function GraficoColunas({ C, colunas, rotulo, formatar }: { C: Theme; colunas: Coluna[]; rotulo: string; formatar: (v: number) => string }) {
  const s = useEstilosGraficos(C);
  const [selecionada, setSelecionada] = useState<string | null>(null);
  const maxPos = Math.max(0, ...colunas.map((c) => c.valor));
  const maxNeg = Math.max(0, ...colunas.map((c) => -c.valor));
  const escala = maxPos + maxNeg || 1;
  const alturaPos = (maxPos / escala) * ALTURA;
  const maior = colunas.find((c) => c.valor === maxPos && maxPos > 0);
  const escolhida = colunas.find((c) => c.chave === selecionada) ?? null;
  const meio = Math.floor((colunas.length - 1) / 2);

  return (
    <View accessibilityLabel={rotulo}>
      <View style={{ height: ALTURA, flexDirection: 'row', gap: 2, marginTop: 18 }}>
        <View style={[s.zero, { top: alturaPos }]} />
        {colunas.map((c) => {
          const h = Math.max((Math.abs(c.valor) / escala) * ALTURA, c.valor !== 0 ? 2 : 0);
          const ativa = c === escolhida || (!escolhida && c.valor === maxPos && maxPos > 0);
          const positiva = c.valor > 0;
          return (
            <Pressable
              key={c.chave} style={{ flex: 1 }} onPress={() => setSelecionada(c.chave === selecionada ? null : c.chave)}
              accessibilityRole="button" accessibilityLabel={c.descricao} hitSlop={{ top: 8, bottom: 8 }}
            >
              {c.valor !== 0 && (
                <View style={[s.barraCaixa, positiva ? { bottom: ALTURA - alturaPos, height: h } : { top: alturaPos, height: h }]}>
                  <View
                    style={[s.barra, positiva ? s.barraTopo : s.barraBase, {
                      backgroundColor: positiva ? (ativa ? C.accent : suave(C.accent)) : suave(C.destructive, 'cc'),
                    }]}
                  />
                </View>
              )}
              {c === maior && !escolhida && (
                <Text numberOfLines={1} style={[s.pico, { top: alturaPos - h - 15 }]}>{formatar(c.valor)}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
      {colunas.length <= 7 ? (
        <View style={{ flexDirection: 'row', gap: 2, marginTop: 6 }}>
          {colunas.map((c) => <Text key={c.chave} style={[s.eixo, { flex: 1, textAlign: 'center' }]}>{c.rotulo}</Text>)}
        </View>
      ) : (
        // Muitas colunas: so o inicio, o meio e o fim, sem cortar o texto
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
          {[colunas[0], colunas[meio], colunas[colunas.length - 1]].map((c) => <Text key={c.chave} style={s.eixo}>{c.rotulo}</Text>)}
        </View>
      )}
      <Text style={s.selecao}>{escolhida ? escolhida.descricao : 'Toque numa coluna para ver o valor.'}</Text>
      {maxNeg > 0 && <View style={{ marginTop: 6 }}><Legenda C={C} cor={suave(C.destructive, 'cc')} rotulo="Estornos e reembolsos" /></View>}
    </View>
  );
}

// Barras horizontais com nome, quantidade e parcela (servicos mais realizados)
export function BarrasHorizontais({ C, itens }: { C: Theme; itens: { nome: string; quantidade: number }[] }) {
  const s = useEstilosGraficos(C);
  const total = itens.reduce((t, i) => t + i.quantidade, 0);
  const maximo = Math.max(1, ...itens.map((i) => i.quantidade));
  return (
    <View style={{ gap: 12 }}>
      {itens.map((item, n) => (
        <View key={item.nome} accessible accessibilityLabel={`${item.nome}: ${item.quantidade} (${pct(item.quantidade, total)}%)`}>
          <View style={[s.linhaTitulo, { marginBottom: 4 }]}>
            <Text numberOfLines={1} style={s.itemNome}>{item.nome}</Text>
            <Text style={s.eixo}><Text style={s.forte}>{item.quantidade}</Text> · {pct(item.quantidade, total)}%</Text>
          </View>
          <View style={{ height: 8, borderRadius: 3, backgroundColor: C.muted }}>
            <View style={{ width: `${(item.quantidade / maximo) * 100}%`, height: '100%', borderRadius: 3, backgroundColor: n === 0 ? C.accent : suave(C.accent, '80') }} />
          </View>
        </View>
      ))}
    </View>
  );
}

function estilos(C: Theme) {
  return StyleSheet.create({
    painel:       { marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.border, backgroundColor: C.card, padding: 16 },
    painelTopo:   { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 12 },
    painelTitulo: { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5 },
    painelNota:   { fontFamily: F.sans, fontSize: 12, color: C.fg, marginTop: 4, lineHeight: 17 },
    vazio:        { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, textAlign: 'center', paddingVertical: 24 },
    erro:         { borderWidth: 1, borderColor: suave(C.destructive, '66'), padding: 12, gap: 8 },
    erroTexto:    { fontFamily: F.sans, fontSize: 13, color: C.destructive },
    erroBotao:    { fontFamily: F.mono, fontSize: 9, color: C.destructive, letterSpacing: 1.5, textDecorationLine: 'underline' },
    legenda:      { flexDirection: 'row', alignItems: 'center', gap: 6 },
    legendaCor:   { width: 10, height: 10, borderRadius: 2 },
    legendaTexto: { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    legendaValor: { fontFamily: F.sansMedium, fontSize: 12, color: C.primary },
    legendas:     { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 },
    linhaTitulo:  { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 },
    miniTitulo:   { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1.2 },
    miniTexto:    { fontFamily: F.sans, fontSize: 12, color: C.mutedFg },
    forte:        { fontFamily: F.sansBold, color: C.primary },
    eixo:         { fontFamily: F.mono, fontSize: 9, color: C.mutedFg },
    zero:         { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: C.border },
    barraCaixa:   { position: 'absolute', left: 0, right: 0, alignItems: 'center' },
    barra:        { width: '100%', maxWidth: 22, height: '100%' },
    barraTopo:    { borderTopLeftRadius: 4, borderTopRightRadius: 4 },
    barraBase:    { borderBottomLeftRadius: 4, borderBottomRightRadius: 4 },
    pico:         { position: 'absolute', left: -20, right: -20, textAlign: 'center', fontFamily: F.mono, fontSize: 9, color: C.primary },
    selecao:      { fontFamily: F.mono, fontSize: 10, color: C.fg, marginTop: 10 },
    itemNome:     { fontFamily: F.sans, fontSize: 13, color: C.primary, flex: 1 },
  });
}
