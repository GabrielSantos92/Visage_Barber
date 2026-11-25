import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, TextInput } from 'react-native';
import { F, Theme } from '../../../lib/theme';
import { MeuFinanceiro, Periodo, buscarMeuFinanceiro, dataCurta, intervaloDoPeriodo } from '../../../lib/financeiro';
import { formatarReais } from '../../../lib/pagamentos';
import {
  NOME_AGRUPAMENTO, PERIODOS_PAINEL, TEXTOS_INDICADORES, TEXTOS_PAINEL, atendimentosPorFaixa, buscarAtendimentosDoPeriodo,
  buscarPainelFinanceiro, evolucaoFinanceira, periodoAnterior, resumoAtendimentos, resumoAvaliacoes, textoIntervalo,
} from '../../../lib/painelBarbeiro';
import type { Agrupamento, AtendimentoDoPeriodo, AvaliacaoPainel, Faixa, PainelFinanceiro } from '../../../lib/painelBarbeiro';
import GraficoDiasSemana from './GraficoDiasSemana';
import IndicadoresPrincipais from './IndicadoresPrincipais';
import ComissoesRecebimentos from './ComissoesRecebimentos';
import { BarraDividida, BarrasHorizontais, Erro, Esqueleto, GraficoColunas, Legenda, Painel, Vazio } from './graficos';
import AvisoDadosSalvos from '../../../components/AvisoDadosSalvos';
import { useCacheDaTela } from '../../../hooks/useCacheDaTela';
import { VALIDADE } from '../../../lib/cacheLocal';
import { mensagemDeErro } from '../../../lib/conexao';

// Periodo personalizado digitado no formato brasileiro (DD/MM/AAAA); o banco
// recebe AAAA-MM-DD
const isoParaBr = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
function brParaIso(br: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(br);
  if (!m) return null;
  const [, d, mes, a] = m;
  const data = new Date(Number(a), Number(mes) - 1, Number(d));
  // Recusa datas que nao existem (ex.: 31/02)
  if (data.getDate() !== Number(d) || data.getMonth() !== Number(mes) - 1) return null;
  return `${a}-${mes}-${d}`;
}
// Mascara enquanto digita: so numeros, barras automaticas
const mascaraData = (texto: string) => {
  const n = texto.replace(/\D/g, '').slice(0, 8);
  return n.length > 4 ? `${n.slice(0, 2)}/${n.slice(2, 4)}/${n.slice(4)}` : n.length > 2 ? `${n.slice(0, 2)}/${n.slice(2)}` : n;
};
const nomeDaFaixa = (f: Faixa, a: Agrupamento) => (a === 'semana' ? `semana de ${f.rotulo}` : f.rotulo);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// Meu desempenho: indicadores, graficos e comissoes do periodo escolhido,
// iguais aos do site. Tres cargas independentes, cada uma com o proprio
// carregamento, erro e valores salvos no aparelho:
//   1. meu_financeiro + meu_desempenho do periodo (indicadores principais);
//   2. meu_financeiro do periodo anterior (so a comparacao; so muda com o filtro);
//   3. status e servico dos agendamentos do periodo anterior ate o fim do atual
//      (contagens, cancelamentos, servicos e atendimentos por periodo), numa consulta.
// `versao` muda quando o painel pede recarga (foco, puxar para atualizar, ou
// depois de cancelar um atendimento, que muda as contagens e pode gerar estorno).
export default function DesempenhoFinanceiro({ C, versao, barbeiroId, avaliacoes, erroAvaliacoes }: {
  C: Theme; versao: number; barbeiroId: string; avaliacoes: AvaliacaoPainel[] | null; erroAvaliacoes: boolean;
}) {
  const s = useMemo(() => makeStyles(C), [C]);
  const [periodo, setPeriodo] = useState<Periodo>('semana');
  // Periodo personalizado digitado como DD/MM/AAAA
  const [inicioDigitado, setInicio] = useState(() => isoParaBr(intervaloDoPeriodo('mes').inicio));
  const [fimDigitado, setFim] = useState(() => isoParaBr(intervaloDoPeriodo('mes').fim));
  const [dados, setDados] = useState<PainelFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [anterior, setAnterior] = useState<{ chave: string; fin: MeuFinanceiro | null } | null>(null);
  const [atividade, setAtividade] = useState<{ chave: string; lista: AtendimentoDoPeriodo[] | null } | null>(null);
  const [serie, setSerie] = useState<'faturamento' | 'comissao'>('faturamento');
  const pedido = useRef(0);
  // Tentar de novo pelo aviso de dados salvos / pelo erro dos atendimentos
  const [recarga, setRecarga] = useState(0);
  const [recargaAtividade, setRecargaAtividade] = useState(0);

  const inicioIso = brParaIso(inicioDigitado);
  const fimIso = brParaIso(fimDigitado);
  const personalizado = inicioIso && fimIso ? { inicio: inicioIso, fim: fimIso } : undefined;
  const { inicio, fim } = intervaloDoPeriodo(periodo, new Date(), personalizado);
  const intervalo = useMemo(() => ({ inicio, fim }), [inicio, fim]);
  const ant = useMemo(() => periodoAnterior(intervalo), [intervalo]);
  const chave = `${inicio}:${fim}`;
  const salvavel = periodo !== 'personalizado';

  // Valores salvos da ultima carga de cada periodo (desta conta; o periodo
  // personalizado nao e guardado). Sao os mesmos que o banco devolveu,
  // mostrados com a data em que foram salvos se a atualizacao falhar.
  const cache = useCacheDaTela<PainelFinanceiro>(salvavel ? `barbeiro:financeiro:${inicio}:${fim}` : null, VALIDADE.agenda);
  const cacheAnterior = useCacheDaTela<MeuFinanceiro>(salvavel ? `barbeiro:financeiro:anterior:${ant.inicio}:${ant.fim}` : null, VALIDADE.agenda);
  const cacheAtividade = useCacheDaTela<AtendimentoDoPeriodo[]>(salvavel ? `barbeiro:atividade:${ant.inicio}:${fim}` : null, VALIDADE.agenda);

  useEffect(() => {
    cache.restaurar((d) => { setDados(d); setCarregando(false); });
  }, [cache.restaurar]);
  useEffect(() => {
    cacheAnterior.restaurar((f) => setAnterior({ chave, fin: f }));
  }, [cacheAnterior.restaurar]);
  useEffect(() => {
    cacheAtividade.restaurar((l) => setAtividade({ chave, lista: l }));
  }, [cacheAtividade.restaurar]);

  // 1. Indicadores principais do periodo
  useEffect(() => {
    const atual = ++pedido.current;
    setCarregando(true);
    buscarPainelFinanceiro(inicio, fim).then((d) => {
      // Resposta de um periodo que ja foi trocado: descarta
      if (atual !== pedido.current) return;
      setCarregando(false);
      if (d.financeiro && d.desempenho) {
        setDados(d);
        cache.salvar(d);
        return;
      }
      // Falhou: com os valores salvos do periodo na tela, ficam eles e o aviso
      if (cache.falhou(new Error(d.erroFinanceiro ?? d.erroDesempenho ?? ''))) return;
      setDados(d);
    });
  }, [inicio, fim, versao, recarga]);

  // 2. Periodo anterior (so ao trocar o filtro: cancelar um atendimento de hoje nao o muda)
  useEffect(() => {
    let ativo = true;
    const k = `${inicio}:${fim}`;
    buscarMeuFinanceiro(ant.inicio, ant.fim)
      .then((f) => { if (!ativo) return; setAnterior({ chave: k, fin: f }); cacheAnterior.salvar(f); })
      .catch((e) => { if (ativo && !cacheAnterior.falhou(e)) setAnterior({ chave: k, fin: null }); });
    return () => { ativo = false; };
  }, [inicio, fim, ant.inicio, ant.fim, recarga]);

  // 3. Agendamentos do periodo anterior ate o fim do atual
  useEffect(() => {
    let ativo = true;
    const k = `${inicio}:${fim}`;
    buscarAtendimentosDoPeriodo(barbeiroId, { inicio: ant.inicio, fim })
      .then((lista) => { if (!ativo) return; setAtividade({ chave: k, lista }); cacheAtividade.salvar(lista); })
      .catch((e) => { if (ativo && !cacheAtividade.falhou(e)) setAtividade({ chave: k, lista: null }); });
    return () => { ativo = false; };
  }, [barbeiroId, inicio, fim, ant.inicio, versao, recargaAtividade]);

  // Resultados de outro periodo (o filtro mudou e a resposta ainda nao veio) nao valem
  const finAnterior = anterior?.chave === chave ? anterior.fin : undefined;
  const lista = atividade?.chave === chave ? atividade.lista : undefined;
  const erroAtividade = lista === null;

  const atendimentos = useMemo(
    () => (lista ? { atual: resumoAtendimentos(lista, intervalo), anterior: resumoAtendimentos(lista, ant) } : null),
    [lista, intervalo, ant],
  );
  const porFaixa = useMemo(() => (lista ? atendimentosPorFaixa(lista, intervalo) : null), [lista, intervalo]);
  const notas = useMemo(
    () => (avaliacoes ? { atual: resumoAvaliacoes(avaliacoes, intervalo), anterior: resumoAvaliacoes(avaliacoes, ant), geral: resumoAvaliacoes(avaliacoes) } : null),
    [avaliacoes, intervalo, ant],
  );
  const fin = dados?.financeiro ?? null;
  const evolucao = useMemo(() => (fin ? evolucaoFinanceira(fin.lancamentos, intervalo) : null), [fin, intervalo]);
  const umDia = inicio === fim;

  const alternarSerie = fin && !umDia ? (
    <View style={{ flexDirection: 'row' }} accessibilityRole="radiogroup" accessibilityLabel="Valor do gráfico">
      {(['faturamento', 'comissao'] as const).map((v) => (
        <TouchableOpacity
          key={v} onPress={() => setSerie(v)} style={[s.chipPequeno, serie === v && s.chipAtivo]}
          accessibilityRole="radio" accessibilityState={{ checked: serie === v }}
        >
          <Text style={[s.chipPequenoTexto, serie === v && { color: C.primaryFg }]}>
            {(v === 'faturamento' ? TEXTOS_INDICADORES.verFaturamento : TEXTOS_INDICADORES.verComissao).toUpperCase()}
          </Text>
        </TouchableOpacity>
      ))}
    </View>
  ) : undefined;

  return (
    <View>
      <Text style={s.titulo}>{TEXTOS_PAINEL.desempenho}</Text>

      <ScrollView
        horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtros}
        accessibilityRole="radiogroup" accessibilityLabel="Período"
      >
        {PERIODOS_PAINEL.map((p) => (
          <TouchableOpacity
            key={p.valor} style={[s.chip, periodo === p.valor && s.chipAtivo]} onPress={() => setPeriodo(p.valor)}
            accessibilityRole="radio" accessibilityState={{ checked: periodo === p.valor }}
          >
            <Text style={[s.chipText, periodo === p.valor && { color: C.primaryFg }]}>{p.rotulo.toUpperCase()}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {periodo === 'personalizado' && (
        <View style={s.datas}>
          <TextInput style={s.data} value={inicioDigitado} onChangeText={(t) => setInicio(mascaraData(t))} placeholder="DD/MM/AAAA" placeholderTextColor={C.mutedFg} keyboardType="number-pad" maxLength={10} accessibilityLabel="Data inicial" />
          <Text style={s.legenda}>até</Text>
          <TextInput style={s.data} value={fimDigitado} onChangeText={(t) => setFim(mascaraData(t))} placeholder="DD/MM/AAAA" placeholderTextColor={C.mutedFg} keyboardType="number-pad" maxLength={10} accessibilityLabel="Data final" />
        </View>
      )}
      <Text style={[s.legenda, s.margem]}>
        {dataCurta(inicio, true)} a {dataCurta(fim, true)} · {TEXTOS_INDICADORES.comparado.toLowerCase()} {textoIntervalo(ant)}
      </Text>
      <Text style={[s.nota, s.margem]}>{TEXTOS_PAINEL.periodoNota}</Text>
      <AvisoDadosSalvos salvoEm={cache.salvoEm} falha={cache.falha} onTentar={() => setRecarga((n) => n + 1)} />

      {carregando && !dados ? (
        <ActivityIndicator color={C.primary} style={{ marginTop: 32 }} />
      ) : dados && (
        <View style={{ opacity: carregando ? 0.6 : 1 }}>
          <IndicadoresPrincipais
            C={C}
            fin={fin}
            finAnterior={finAnterior}
            desempenho={dados.desempenho}
            atendimentos={atendimentos}
            erroAtendimentos={erroAtividade}
            avaliacoes={notas}
            erroAvaliacoes={erroAvaliacoes}
          />

          {/* Evolucao do faturamento (lancamentos oficiais) */}
          <Painel C={C} titulo={TEXTOS_INDICADORES.evolucao} nota={TEXTOS_INDICADORES.evolucaoNota}>
            {alternarSerie}
            {!fin ? <Vazio C={C}>{TEXTOS_INDICADORES.indisponivel}</Vazio>
              : umDia ? <Vazio C={C}>{TEXTOS_INDICADORES.umDia}</Vazio>
                : !fin.lancamentos.length ? <Vazio C={C}>{TEXTOS_INDICADORES.semFaturamento}</Vazio>
                  : evolucao && (
                    <GraficoColunas
                      C={C}
                      rotulo={`${serie === 'faturamento' ? TEXTOS_INDICADORES.verFaturamento : TEXTOS_INDICADORES.verComissao} ${NOME_AGRUPAMENTO[evolucao.agrupamento]}`}
                      formatar={formatarReais}
                      colunas={evolucao.pontos.map((p) => ({
                        chave: p.inicio, rotulo: p.rotulo, valor: p[serie],
                        descricao: `${nomeDaFaixa(p, evolucao.agrupamento)}: ${formatarReais(p[serie])}`,
                      }))}
                    />
                  )}
          </Painel>

          {/* Atendimentos por periodo e situacao dos agendamentos do periodo */}
          <Painel C={C} titulo={TEXTOS_INDICADORES.atendimentosPeriodo} nota={TEXTOS_INDICADORES.atendimentosPeriodoNota}>
            {erroAtividade ? (
              <Erro C={C} mensagem={TEXTOS_INDICADORES.erroAtividade} onTentar={() => setRecargaAtividade((n) => n + 1)} />
            ) : !atendimentos || !porFaixa ? (
              <Esqueleto C={C} />
            ) : (
              <>
                {umDia ? <Vazio C={C}>{TEXTOS_INDICADORES.umDia}</Vazio>
                  : atendimentos.atual.concluidos === 0 ? <Vazio C={C}>{TEXTOS_PAINEL.atendimentosVazio}</Vazio>
                    : (
                      <GraficoColunas
                        C={C}
                        rotulo={`Atendimentos concluídos ${NOME_AGRUPAMENTO[porFaixa.agrupamento]}`}
                        formatar={String}
                        colunas={porFaixa.pontos.map((p) => ({
                          chave: p.inicio, rotulo: p.rotulo, valor: p.concluidos,
                          descricao: `${nomeDaFaixa(p, porFaixa.agrupamento)}: ${plural(p.concluidos, 'concluído', 'concluídos')}`,
                        }))}
                      />
                    )}
                <View style={s.distribuicao}>
                  <BarraDividida
                    C={C}
                    rotulo={`Agendamentos do período: ${atendimentos.atual.concluidos} concluídos, ${atendimentos.atual.cancelados} cancelados, ${atendimentos.atual.aAtender} a atender`}
                    partes={[
                      { chave: 'c', valor: atendimentos.atual.concluidos, cor: C.primary },
                      { chave: 'x', valor: atendimentos.atual.cancelados, cor: C.destructive },
                      { chave: 'a', valor: atendimentos.atual.aAtender, cor: C.success },
                    ]}
                  />
                  <View style={s.legendas}>
                    <Legenda C={C} cor={C.primary} rotulo="Concluídos" valor={String(atendimentos.atual.concluidos)} />
                    <Legenda C={C} cor={C.destructive} rotulo="Cancelados e faltas" valor={String(atendimentos.atual.cancelados)} />
                    <Legenda C={C} cor={C.success} rotulo="A atender" valor={String(atendimentos.atual.aAtender)} />
                  </View>
                </View>
              </>
            )}
          </Painel>

          {/* Servicos mais realizados (concluidos) */}
          <Painel C={C} titulo={TEXTOS_INDICADORES.servicos} nota={TEXTOS_INDICADORES.servicosNota}>
            {erroAtividade ? <Erro C={C} mensagem={TEXTOS_INDICADORES.erroAtividade} />
              : !atendimentos ? <Esqueleto C={C} altura={90} />
                : !atendimentos.atual.servicos.length ? <Vazio C={C}>{TEXTOS_INDICADORES.servicosVazio}</Vazio>
                  : <BarrasHorizontais C={C} itens={atendimentos.atual.servicos.slice(0, 5)} />}
          </Painel>

          {/* Desempenho por dia da semana (meu_desempenho) */}
          <Painel C={C} titulo={TEXTOS_INDICADORES.diasSemana} nota={TEXTOS_PAINEL.atendimentosNota}>
            {dados.desempenho ? (
              <GraficoDiasSemana dias={dados.desempenho.dias_semana} C={C} />
            ) : (
              <Erro C={C} mensagem={mensagemDeErro({ message: dados.erroDesempenho }, dados.erroDesempenho ?? TEXTOS_PAINEL.erroDesempenho)} />
            )}
          </Painel>

          <ComissoesRecebimentos C={C} fin={fin} desempenho={dados.desempenho} erro={dados.erroFinanceiro} />
        </View>
      )}
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    titulo:           { fontFamily: F.sansLight, fontSize: 22, color: C.primary, paddingHorizontal: 24, marginTop: 32, letterSpacing: -0.5 },
    filtros:          { flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 8 },
    chip:             { borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 },
    chipAtivo:        { backgroundColor: C.primary, borderColor: C.primary },
    chipText:         { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1 },
    chipPequeno:      { borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, paddingVertical: 7, marginRight: -1 },
    chipPequenoTexto: { fontFamily: F.mono, fontSize: 9, color: C.fg, letterSpacing: 1 },
    datas:            { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingBottom: 8 },
    data:             { flex: 1, borderWidth: 1, borderColor: C.border, color: C.primary, fontFamily: F.mono, fontSize: 12, paddingHorizontal: 10, paddingVertical: 10 },
    margem:           { paddingHorizontal: 24 },
    legenda:          { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    nota:             { fontFamily: F.sans, fontSize: 11, color: C.mutedFg, marginTop: 4, marginBottom: 4 },
    distribuicao:     { marginTop: 16, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.border, gap: 8 },
    legendas:         { flexDirection: 'row', flexWrap: 'wrap', columnGap: 16, rowGap: 4 },
  });
}
