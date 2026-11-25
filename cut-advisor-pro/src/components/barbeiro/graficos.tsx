import type { ReactNode } from "react";
import { formatarReais } from "@/lib/pagamentos";
import { TEXTOS_INDICADORES } from "@/lib/painelBarbeiro";

// Graficos do Painel do Barbeiro. So exibicao: desenham os valores que o
// painel ja recebe (meu_financeiro, meu_desempenho, agendamentos do periodo),
// sem calcular nada alem de proporcoes. Cor principal: o verde da marca
// (accent), forte no destaque e suave no resto; texto sempre nas cores de texto.

const pct = (parte: number, todo: number) => (todo > 0 ? Math.round((parte / todo) * 100) : 0);

export const COR_SERIE = "bg-accent";
export const COR_SERIE_SUAVE = "bg-accent/40 group-hover:bg-accent/70";

// Dica que aparece ao passar o mouse (ou focar) na marca. aria-hidden: o
// mesmo conteudo ja esta no aria-label da marca.
export const Dica = ({ children }: { children: ReactNode }) => (
  <span
    aria-hidden
    className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap border border-border bg-popover px-2 py-1 font-mono text-[10px] text-popover-foreground opacity-0 shadow-md transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
  >
    {children}
  </span>
);

// Item de legenda: quadradinho com a cor da marca + texto em tinta normal
export const Legenda = ({ cor, rotulo, valor }: { cor: string; rotulo: string; valor?: string }) => (
  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
    <span aria-hidden className={`size-2.5 rounded-[2px] ${cor}`} />
    {rotulo}
    {valor && <span className="font-medium text-primary">{valor}</span>}
  </span>
);

// Moldura comum dos graficos e listas do painel
export function Painel({ titulo, nota, acao, children, className = "" }: {
  titulo: string; nota?: string; acao?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`border border-border bg-card p-5 ${className}`} aria-label={titulo}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{titulo}</h3>
          {nota && <p className="mt-1 text-sm text-foreground">{nota}</p>}
        </div>
        {acao}
      </div>
      {children}
    </section>
  );
}

export const Esqueleto = ({ altura = "h-40" }: { altura?: string }) => (
  <div aria-hidden className={`w-full animate-pulse rounded-[3px] bg-foreground/10 ${altura}`} />
);

export const Vazio = ({ children }: { children: ReactNode }) => (
  <p className="py-10 text-center text-sm text-muted-foreground">{children}</p>
);

export const Erro = ({ mensagem, onTentar }: { mensagem: string; onTentar?: () => void }) => (
  <div role="alert" className="border border-destructive/40 p-3 text-sm text-destructive">
    <p>{mensagem}</p>
    {onTentar && (
      <button onClick={onTentar} className="mt-2 font-mono text-[10px] uppercase tracking-widest underline">
        {TEXTOS_INDICADORES.tentar}
      </button>
    )}
  </div>
);

// ---------------------------------------------------------------
// Barra dividida: um todo repartido em partes (2px de folga entre elas)
// ---------------------------------------------------------------
export interface Parte { chave: string; rotulo: string; valor: number; cor: string; dica: string }

export function BarraDividida({ partes, rotulo, altura = "h-3" }: { partes: Parte[]; rotulo: string; altura?: string }) {
  const total = partes.reduce((s, p) => s + Math.max(0, p.valor), 0);
  return (
    <div role="img" aria-label={rotulo} className={`flex w-full gap-[2px] ${altura}`}>
      {total === 0 ? (
        <div className="h-full w-full rounded-[3px] bg-foreground/10" />
      ) : (
        partes.filter((p) => p.valor > 0).map((p) => (
          <div key={p.chave} className="group relative h-full" style={{ width: `${(p.valor / total) * 100}%` }}>
            <div className={`h-full w-full rounded-[3px] ${p.cor}`} />
            <Dica>{p.dica}</Dica>
          </div>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Quanto do faturamento virou comissao do barbeiro
// ---------------------------------------------------------------
export function DivisaoFaturamento({ faturamento, comissao }: { faturamento: number; comissao: number }) {
  const fat = Number(faturamento);
  const com = Math.max(0, Math.min(Number(comissao), fat));
  if (!(fat > 0)) return null;
  const casa = fat - com;
  return (
    <figure>
      <figcaption className="mb-2 flex items-baseline justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{TEXTOS_INDICADORES.divisao}</span>
        <span className="text-xs text-muted-foreground">
          você fica com <span className="font-bold text-primary">{pct(com, fat)}%</span>
        </span>
      </figcaption>
      <BarraDividida
        rotulo={`Do faturamento de ${formatarReais(fat)}, ${formatarReais(com)} são sua comissão e ${formatarReais(casa)} ficam com a barbearia`}
        partes={[
          { chave: "voce", rotulo: "Sua parte", valor: com, cor: COR_SERIE, dica: `Sua parte · ${formatarReais(com)}` },
          { chave: "casa", rotulo: "Barbearia", valor: casa, cor: "bg-foreground/30 dark:bg-foreground/25", dica: `Barbearia · ${formatarReais(casa)}` },
        ]}
      />
      <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <Legenda cor={COR_SERIE} rotulo="Sua parte" valor={formatarReais(com)} />
        <Legenda cor="bg-foreground/30 dark:bg-foreground/25" rotulo="Barbearia" valor={formatarReais(casa)} />
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------
// Quanto das comissoes acumuladas ja foi pago (medidor)
// ---------------------------------------------------------------
export function ProgressoComissoes({ comissaoTotal, recebidoTotal }: { comissaoTotal: number; recebidoTotal: number }) {
  const total = Number(comissaoTotal);
  if (!(total > 0)) return null;
  const pago = Math.max(0, Math.min(Number(recebidoTotal), total));
  const p = pct(pago, total);
  return (
    <figure>
      <figcaption className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{TEXTOS_INDICADORES.comissoesPagas}</span>
        <span className="text-xs text-muted-foreground">
          <span className="font-bold text-primary">{formatarReais(pago)}</span> de {formatarReais(total)} acumulados
        </span>
      </figcaption>
      <div
        role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p}
        aria-label={`${p}% das comissões acumuladas já foram pagas`}
        className="group relative h-3 w-full rounded-[3px] bg-foreground/15 dark:bg-foreground/10"
      >
        <div className={`h-full rounded-[3px] ${COR_SERIE} transition-[width] duration-500`} style={{ width: `${p}%` }} />
        <Dica>{p}% pago · falta {formatarReais(total - pago)}</Dica>
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{p}% pago</span>
        <span>{100 - p}% a receber</span>
      </div>
    </figure>
  );
}

// ---------------------------------------------------------------
// Colunas de uma serie no tempo (por dia, semana ou mes). Valores negativos
// (estornos e reembolsos) descem abaixo da linha do zero. O maior valor fica
// em destaque e com o numero no topo; o resto vai na dica.
// ---------------------------------------------------------------
export interface Coluna { chave: string; rotulo: string; valor: number; descricao: string }

const ALTURA = 160;

export function GraficoColunas({ colunas, rotulo, formatar }: { colunas: Coluna[]; rotulo: string; formatar: (v: number) => string }) {
  const maxPos = Math.max(0, ...colunas.map((c) => c.valor));
  const maxNeg = Math.max(0, ...colunas.map((c) => -c.valor));
  const escala = maxPos + maxNeg || 1;
  const alturaPos = (maxPos / escala) * ALTURA;
  const primeiroMaior = colunas.find((c) => c.valor === maxPos && maxPos > 0);
  // Rotulos do eixo: todos ate 8 colunas; senao o primeiro, o do meio e o ultimo
  const meio = Math.floor((colunas.length - 1) / 2);

  return (
    <div>
      <ul aria-label={rotulo} className="relative mt-5 flex items-stretch gap-[2px]" style={{ height: ALTURA }}>
        <span aria-hidden className="absolute inset-x-0 h-px bg-border" style={{ top: alturaPos }} />
        {colunas.map((c) => {
          const h = (Math.abs(c.valor) / escala) * ALTURA;
          const destaque = c.valor === maxPos && maxPos > 0;
          return (
            <li key={c.chave} tabIndex={0} aria-label={c.descricao} className="group relative flex flex-1 justify-center outline-none">
              {c.valor !== 0 && (
                <div
                  aria-hidden
                  className={`absolute left-1/2 w-full max-w-7 -translate-x-1/2 transition-colors ${c.valor > 0
                    ? `rounded-t-[4px] ${destaque ? COR_SERIE : COR_SERIE_SUAVE}`
                    : "rounded-b-[4px] bg-destructive/80"}`}
                  style={c.valor > 0 ? { bottom: ALTURA - alturaPos, height: Math.max(h, 2) } : { top: alturaPos, height: Math.max(h, 2) }}
                />
              )}
              {c === primeiroMaior && (
                <span aria-hidden className="absolute left-1/2 -translate-x-1/2 -translate-y-full whitespace-nowrap pb-1 font-mono text-[10px] font-bold text-primary"
                  style={{ top: alturaPos - h }}>
                  {formatar(c.valor)}
                </span>
              )}
              <Dica>{c.descricao}</Dica>
            </li>
          );
        })}
      </ul>
      {colunas.length <= 8 ? (
        <div aria-hidden className="mt-2 flex gap-[2px]">
          {colunas.map((c) => (
            <span key={c.chave} className="flex-1 whitespace-nowrap text-center font-mono text-[9px] text-muted-foreground">{c.rotulo}</span>
          ))}
        </div>
      ) : (
        // Muitas colunas: so o inicio, o meio e o fim, sem cortar o texto
        <div aria-hidden className="mt-2 flex justify-between font-mono text-[9px] text-muted-foreground">
          {[colunas[0], colunas[meio], colunas[colunas.length - 1]].map((c) => <span key={c.chave}>{c.rotulo}</span>)}
        </div>
      )}
      {maxNeg > 0 && (
        <div className="mt-3"><Legenda cor="bg-destructive/80" rotulo="Estornos e reembolsos" /></div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------
// Barras horizontais com nome, quantidade e parcela (servicos mais realizados)
// ---------------------------------------------------------------
export function BarrasHorizontais({ itens, rotulo }: { itens: { nome: string; quantidade: number }[]; rotulo: string }) {
  const total = itens.reduce((s, i) => s + i.quantidade, 0);
  const maximo = Math.max(1, ...itens.map((i) => i.quantidade));
  return (
    <ul aria-label={rotulo} className="space-y-3">
      {itens.map((item, n) => (
        <li key={item.nome} aria-label={`${item.nome}: ${item.quantidade} (${pct(item.quantidade, total)}%)`}>
          <div aria-hidden className="mb-1 flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-primary">{item.nome}</span>
            <span className="shrink-0 font-mono text-[11px] text-muted-foreground">
              <span className="font-bold text-primary">{item.quantidade}</span> · {pct(item.quantidade, total)}%
            </span>
          </div>
          <div aria-hidden className="h-2 w-full rounded-[3px] bg-foreground/10">
            <div className={`h-full rounded-[3px] ${n === 0 ? COR_SERIE : "bg-accent/50"}`} style={{ width: `${(item.quantidade / maximo) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
