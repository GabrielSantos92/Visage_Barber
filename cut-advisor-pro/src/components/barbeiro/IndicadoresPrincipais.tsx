import type { ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, CalendarX2, Minus, Receipt, Scissors, Star, Wallet } from "lucide-react";
import { formatarReais } from "@/lib/pagamentos";
import type { MeuDesempenho, MeuFinanceiro } from "@/lib/financeiro";
import {
  TEXTOS_INDICADORES, TEXTOS_PAINEL, notaAvaliacoes, notaComVirgula, ticketMedio, variacao,
} from "@/lib/painelBarbeiro";
import type { ResumoAtendimentos, ResumoAvaliacoes, Variacao } from "@/lib/painelBarbeiro";

// Indicadores principais do periodo, com a variacao contra o periodo anterior.
// Cada cartao mostra o proprio carregamento: o faturamento aparece assim que
// meu_financeiro responde, sem esperar as contagens.

const COR_TENDENCIA = {
  bom: "text-green-700 dark:text-green-500",
  ruim: "text-destructive",
  neutro: "text-muted-foreground",
};

function Tendencia({ v, maisEhMelhor = true }: { v: Variacao | null | undefined; maisEhMelhor?: boolean }) {
  if (v === undefined) return <span className="inline-block h-3 w-24 animate-pulse rounded-[2px] bg-foreground/10" aria-hidden />;
  if (v === null) return <span className={COR_TENDENCIA.neutro}>{TEXTOS_INDICADORES.semComparacao}</span>;
  const bom = (v.tendencia === "alta") === maisEhMelhor;
  const cor = v.tendencia === "estavel" ? COR_TENDENCIA.neutro : bom ? COR_TENDENCIA.bom : COR_TENDENCIA.ruim;
  const Icone = v.tendencia === "alta" ? ArrowUpRight : v.tendencia === "queda" ? ArrowDownRight : Minus;
  return (
    <span className={`inline-flex items-center gap-1 ${cor}`}>
      <Icone aria-hidden className="size-3.5" />
      {v.texto}
    </span>
  );
}

// O rotulo e o primeiro paragrafo do cartao (o resto e irmao dele)
export function CartaoIndicador({ rotulo, valor, nota, icone, variacao: v, maisEhMelhor, alerta }: {
  rotulo: string;
  // null: ainda carregando
  valor: string | null;
  nota?: string;
  icone: ReactNode;
  // undefined: comparacao carregando; null: sem comparacao
  variacao?: Variacao | null;
  maisEhMelhor?: boolean;
  alerta?: boolean;
}) {
  return (
    <div className="relative flex h-full flex-col border border-border bg-card p-4 transition-colors hover:border-foreground/40">
      <p className="pr-8 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{rotulo}</p>
      {valor === null ? (
        <p aria-label="Carregando" className="mt-2 h-7 w-28 animate-pulse rounded-[3px] bg-foreground/10" />
      ) : (
        <p className={`mt-1.5 text-2xl font-bold tracking-tight ${alerta ? "text-amber-700 dark:text-amber-500" : "text-primary"}`}>{valor}</p>
      )}
      <p className="mt-1 text-xs"><Tendencia v={v} maisEhMelhor={maisEhMelhor} /></p>
      {nota && <p className="mt-auto pt-2 text-xs leading-snug text-muted-foreground">{nota}</p>}
      <span aria-hidden className="absolute right-4 top-4 text-muted-foreground">{icone}</span>
    </div>
  );
}

interface Props {
  fin: MeuFinanceiro | null;
  // undefined: carregando; null: indisponivel
  finAnterior: MeuFinanceiro | null | undefined;
  desempenho: MeuDesempenho | null;
  // null: carregando
  atendimentos: { atual: ResumoAtendimentos; anterior: ResumoAtendimentos } | null;
  erroAtendimentos: boolean;
  avaliacoes: { atual: ResumoAvaliacoes; anterior: ResumoAvaliacoes; geral: ResumoAvaliacoes } | null;
  erroAvaliacoes: boolean;
}

const icone = "size-4";

export default function IndicadoresPrincipais({ fin, finAnterior, desempenho, atendimentos, erroAtendimentos, avaliacoes, erroAvaliacoes }: Props) {
  const ticket = ticketMedio(fin);
  const ticketAnterior = finAnterior === undefined ? undefined : ticketMedio(finAnterior);
  const comparar = <T,>(anterior: T | undefined, calcular: (a: T) => Variacao | null) => (anterior === undefined ? undefined : calcular(anterior));
  const concluidos = desempenho ? desempenho.dias_semana.reduce((s, n) => s + n, 0) : null;
  const carregandoContagem = !atendimentos && !erroAtendimentos;

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label={TEXTOS_INDICADORES.titulo}>
      <div className="col-span-2 md:col-span-1">
        <CartaoIndicador
          rotulo={TEXTOS_PAINEL.faturamento}
          valor={fin ? formatarReais(fin.faturamento) : "—"}
          nota={TEXTOS_PAINEL.faturamentoNota}
          icone={<Wallet className={icone} />}
          variacao={fin ? comparar(finAnterior, (a) => (a ? variacao(Number(fin.faturamento), Number(a.faturamento)) : null)) : null}
        />
      </div>
      <CartaoIndicador
        rotulo={TEXTOS_INDICADORES.atendimentos}
        valor={concluidos == null ? "—" : String(concluidos)}
        nota={desempenho ? TEXTOS_INDICADORES.atendimentosNota : TEXTOS_INDICADORES.indisponivel}
        icone={<Scissors className={icone} />}
        variacao={concluidos == null || erroAtendimentos ? null : atendimentos ? variacao(atendimentos.atual.concluidos, atendimentos.anterior.concluidos) : undefined}
      />
      <CartaoIndicador
        rotulo={TEXTOS_INDICADORES.ticket}
        valor={ticket == null ? "—" : formatarReais(ticket)}
        nota={fin ? TEXTOS_INDICADORES.ticketNota : TEXTOS_INDICADORES.indisponivel}
        icone={<Receipt className={icone} />}
        variacao={ticket == null ? null : comparar(ticketAnterior, (a) => variacao(ticket, a))}
      />
      <CartaoIndicador
        rotulo={TEXTOS_INDICADORES.avaliacao}
        valor={erroAvaliacoes ? "—" : !avaliacoes ? null : avaliacoes.atual.media == null ? "—" : `${notaComVirgula(avaliacoes.atual.media)} ★`}
        nota={erroAvaliacoes ? TEXTOS_INDICADORES.indisponivel : avaliacoes ? notaAvaliacoes(avaliacoes.atual, avaliacoes.geral) : undefined}
        icone={<Star className={icone} />}
        variacao={erroAvaliacoes ? null : avaliacoes ? variacao(avaliacoes.atual.media, avaliacoes.anterior.media, "pontos") : undefined}
      />
      <CartaoIndicador
        rotulo={TEXTOS_INDICADORES.cancelamentos}
        valor={erroAtendimentos ? "—" : carregandoContagem ? null : String(atendimentos!.atual.cancelados)}
        nota={erroAtendimentos ? TEXTOS_INDICADORES.indisponivel : TEXTOS_INDICADORES.cancelamentosNota}
        icone={<CalendarX2 className={icone} />}
        maisEhMelhor={false}
        variacao={erroAtendimentos ? null : atendimentos ? variacao(atendimentos.atual.cancelados, atendimentos.anterior.cancelados) : undefined}
      />
    </div>
  );
}
