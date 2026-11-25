import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { buscarMeuFinanceiro, dataCurta, intervaloDoPeriodo } from "@/lib/financeiro";
import type { MeuFinanceiro, Periodo } from "@/lib/financeiro";
import { formatarReais } from "@/lib/pagamentos";
import {
  NOME_AGRUPAMENTO, PERIODOS_PAINEL, TEXTOS_INDICADORES, TEXTOS_PAINEL, atendimentosPorFaixa, buscarAtendimentosDoPeriodo,
  buscarPainelFinanceiro, evolucaoFinanceira, periodoAnterior, resumoAtendimentos, resumoAvaliacoes, textoIntervalo,
} from "@/lib/painelBarbeiro";
import type { Agrupamento, AtendimentoDoPeriodo, AvaliacaoPainel, Faixa, PainelFinanceiro } from "@/lib/painelBarbeiro";
import GraficoDiasSemana from "./GraficoDiasSemana";
import IndicadoresPrincipais from "./IndicadoresPrincipais";
import ComissoesRecebimentos from "./ComissoesRecebimentos";
import { BarraDividida, BarrasHorizontais, Erro, Esqueleto, GraficoColunas, Legenda, Painel, Vazio } from "./graficos";
import { COR_BARRA, campoCls, chipCls } from "./estilos";

const nomeDaFaixa = (f: Faixa, a: Agrupamento) => (a === "semana" ? `semana de ${f.rotulo}` : f.rotulo);
const plural = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

// Meu desempenho: indicadores, graficos e comissoes do periodo escolhido.
// Tres cargas independentes, cada uma com o proprio carregamento e erro:
//   1. meu_financeiro + meu_desempenho do periodo (indicadores principais);
//   2. meu_financeiro do periodo anterior (so a comparacao; so muda com o filtro);
//   3. status e servico dos agendamentos do periodo anterior ate o fim do atual
//      (contagens, cancelamentos, servicos e atendimentos por periodo), numa consulta.
// `versao` muda quando o painel pede recarga (ex.: depois de cancelar um
// atendimento, que muda as contagens e pode gerar estorno).
export default function DesempenhoFinanceiro({ versao, barbeiroId, avaliacoes, erroAvaliacoes }: {
  versao: number; barbeiroId: string; avaliacoes: AvaliacaoPainel[] | null; erroAvaliacoes: boolean;
}) {
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [personalizado, setPersonalizado] = useState(() => intervaloDoPeriodo("mes"));
  const [dados, setDados] = useState<PainelFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [anterior, setAnterior] = useState<{ chave: string; fin: MeuFinanceiro | null } | null>(null);
  const [atividade, setAtividade] = useState<{ chave: string; lista: AtendimentoDoPeriodo[] | null } | null>(null);
  const [recargaAtividade, setRecargaAtividade] = useState(0);
  const [serie, setSerie] = useState<"faturamento" | "comissao">("faturamento");

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo, new Date(), personalizado), [periodo, personalizado]);
  const { inicio, fim } = intervalo;
  const ant = useMemo(() => periodoAnterior({ inicio, fim }), [inicio, fim]);
  const chave = `${inicio}:${fim}`;

  // 2. Periodo anterior (antes do atual: o pedido do periodo atual e o ultimo)
  useEffect(() => {
    let ativo = true;
    const k = `${inicio}:${fim}`;
    buscarMeuFinanceiro(ant.inicio, ant.fim)
      .then((f) => { if (ativo) setAnterior({ chave: k, fin: f }); })
      .catch(() => { if (ativo) setAnterior({ chave: k, fin: null }); });
    return () => { ativo = false; };
  }, [inicio, fim, ant.inicio, ant.fim]);

  // 1. Indicadores principais do periodo
  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    buscarPainelFinanceiro(inicio, fim).then((d) => {
      if (!ativo) return;
      setDados(d);
      setCarregando(false);
    });
    return () => { ativo = false; };
  }, [inicio, fim, versao]);

  // 3. Agendamentos do periodo anterior ate o fim do atual
  useEffect(() => {
    let ativo = true;
    const k = `${inicio}:${fim}`;
    buscarAtendimentosDoPeriodo(barbeiroId, { inicio: ant.inicio, fim })
      .then((lista) => { if (ativo) setAtividade({ chave: k, lista }); })
      .catch(() => { if (ativo) setAtividade({ chave: k, lista: null }); });
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

  return (
    <section className="mt-14" aria-labelledby="titulo-desempenho">
      <div className="mb-6 border-b border-border pb-4">
        <h2 id="titulo-desempenho" className="text-2xl font-light tracking-tighter text-primary">{TEXTOS_PAINEL.desempenho}</h2>
        <div className="mt-4 flex flex-wrap items-end gap-2" role="group" aria-label="Período">
          {PERIODOS_PAINEL.map((p) => (
            <button key={p.valor} onClick={() => setPeriodo(p.valor)} aria-pressed={periodo === p.valor} className={chipCls(periodo === p.valor)}>
              {p.rotulo}
            </button>
          ))}
          {periodo === "personalizado" && (
            <>
              <input aria-label="Data inicial" type="date" value={personalizado.inicio} onChange={(e) => setPersonalizado((p) => ({ ...p, inicio: e.target.value }))} className={campoCls} />
              <input aria-label="Data final" type="date" value={personalizado.fim} onChange={(e) => setPersonalizado((p) => ({ ...p, fim: e.target.value }))} className={campoCls} />
            </>
          )}
          <span className="ml-auto text-right font-mono text-[10px] text-muted-foreground">
            {dataCurta(inicio, true)} a {dataCurta(fim, true)}
            <span className="block">{TEXTOS_INDICADORES.comparado} {textoIntervalo(ant)}</span>
          </span>
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">{TEXTOS_PAINEL.periodoNota}</p>
      </div>

      {carregando && !dados ? (
        <div className="flex justify-center py-16"><Loader2 aria-label="Carregando" className="size-6 animate-spin text-primary" /></div>
      ) : dados && (
        <div className={`transition-opacity ${carregando ? "opacity-60" : ""}`}>
          <IndicadoresPrincipais
            fin={fin}
            finAnterior={finAnterior}
            desempenho={dados.desempenho}
            atendimentos={atendimentos}
            erroAtendimentos={erroAtividade}
            avaliacoes={notas}
            erroAvaliacoes={erroAvaliacoes}
          />

          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            {/* Evolucao do faturamento (lancamentos oficiais) */}
            <Painel
              className="lg:col-span-2"
              titulo={TEXTOS_INDICADORES.evolucao}
              nota={TEXTOS_INDICADORES.evolucaoNota}
              acao={fin && !umDia ? (
                <div className="flex" role="group" aria-label="Valor do gráfico">
                  {(["faturamento", "comissao"] as const).map((s) => (
                    <button key={s} onClick={() => setSerie(s)} aria-pressed={serie === s} className={`${chipCls(serie === s)} -ml-px`}>
                      {s === "faturamento" ? TEXTOS_INDICADORES.verFaturamento : TEXTOS_INDICADORES.verComissao}
                    </button>
                  ))}
                </div>
              ) : undefined}
            >
              {!fin ? <Vazio>{TEXTOS_INDICADORES.indisponivel}</Vazio>
                : umDia ? <Vazio>{TEXTOS_INDICADORES.umDia}</Vazio>
                  : !fin.lancamentos.length ? <Vazio>{TEXTOS_INDICADORES.semFaturamento}</Vazio>
                    : evolucao && (
                      <GraficoColunas
                        rotulo={`${serie === "faturamento" ? TEXTOS_INDICADORES.verFaturamento : TEXTOS_INDICADORES.verComissao} ${NOME_AGRUPAMENTO[evolucao.agrupamento]}`}
                        formatar={formatarReais}
                        colunas={evolucao.pontos.map((p) => ({
                          chave: p.inicio, rotulo: p.rotulo, valor: p[serie],
                          descricao: `${nomeDaFaixa(p, evolucao.agrupamento)}: ${formatarReais(p[serie])}`,
                        }))}
                      />
                    )}
            </Painel>

            {/* Desempenho por dia da semana (meu_desempenho) */}
            <Painel titulo={TEXTOS_INDICADORES.diasSemana} nota={TEXTOS_PAINEL.atendimentosNota}>
              {dados.desempenho ? (
                <GraficoDiasSemana dias={dados.desempenho.dias_semana} />
              ) : (
                <Erro mensagem={dados.erroDesempenho ?? TEXTOS_PAINEL.erroDesempenho} />
              )}
            </Painel>

            {/* Atendimentos por periodo e situacao dos agendamentos do periodo */}
            <Painel className="lg:col-span-2" titulo={TEXTOS_INDICADORES.atendimentosPeriodo} nota={TEXTOS_INDICADORES.atendimentosPeriodoNota}>
              {erroAtividade ? (
                <Erro mensagem={TEXTOS_INDICADORES.erroAtividade} onTentar={() => setRecargaAtividade((n) => n + 1)} />
              ) : !atendimentos || !porFaixa ? (
                <Esqueleto />
              ) : (
                <>
                  {umDia ? <Vazio>{TEXTOS_INDICADORES.umDia}</Vazio>
                    : atendimentos.atual.concluidos === 0 ? <Vazio>{TEXTOS_PAINEL.atendimentosVazio}</Vazio>
                      : (
                        <GraficoColunas
                          rotulo={`Atendimentos concluídos ${NOME_AGRUPAMENTO[porFaixa.agrupamento]}`}
                          formatar={String}
                          colunas={porFaixa.pontos.map((p) => ({
                            chave: p.inicio, rotulo: p.rotulo, valor: p.concluidos,
                            descricao: `${nomeDaFaixa(p, porFaixa.agrupamento)}: ${plural(p.concluidos, "concluído", "concluídos")}`,
                          }))}
                        />
                      )}
                  <div className="mt-5 border-t border-border pt-4">
                    <BarraDividida
                      altura="h-2.5"
                      rotulo={`Agendamentos do período: ${atendimentos.atual.concluidos} concluídos, ${atendimentos.atual.cancelados} cancelados, ${atendimentos.atual.aAtender} a atender`}
                      partes={[
                        { chave: "c", rotulo: "Concluídos", valor: atendimentos.atual.concluidos, cor: COR_BARRA.concluido, dica: `Concluídos · ${atendimentos.atual.concluidos}` },
                        { chave: "x", rotulo: "Cancelados", valor: atendimentos.atual.cancelados, cor: COR_BARRA.cancelado, dica: `Cancelados e faltas · ${atendimentos.atual.cancelados}` },
                        { chave: "a", rotulo: "A atender", valor: atendimentos.atual.aAtender, cor: COR_BARRA.confirmado, dica: `A atender · ${atendimentos.atual.aAtender}` },
                      ]}
                    />
                    <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
                      <Legenda cor={COR_BARRA.concluido} rotulo="Concluídos" valor={String(atendimentos.atual.concluidos)} />
                      <Legenda cor={COR_BARRA.cancelado} rotulo="Cancelados e faltas" valor={String(atendimentos.atual.cancelados)} />
                      <Legenda cor={COR_BARRA.confirmado} rotulo="A atender" valor={String(atendimentos.atual.aAtender)} />
                    </div>
                  </div>
                </>
              )}
            </Painel>

            {/* Servicos mais realizados (concluidos) */}
            <Painel titulo={TEXTOS_INDICADORES.servicos} nota={TEXTOS_INDICADORES.servicosNota}>
              {erroAtividade ? (
                <Erro mensagem={TEXTOS_INDICADORES.erroAtividade} />
              ) : !atendimentos ? (
                <Esqueleto />
              ) : !atendimentos.atual.servicos.length ? (
                <Vazio>{TEXTOS_INDICADORES.servicosVazio}</Vazio>
              ) : (
                <BarrasHorizontais itens={atendimentos.atual.servicos.slice(0, 5)} rotulo="Atendimentos concluídos por serviço" />
              )}
            </Painel>
          </div>

          <ComissoesRecebimentos fin={fin} desempenho={dados.desempenho} erro={dados.erroFinanceiro} />
        </div>
      )}
    </section>
  );
}
