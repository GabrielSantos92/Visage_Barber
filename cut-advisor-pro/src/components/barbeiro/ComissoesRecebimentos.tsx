import { useState } from "react";
import { METODOS_COMISSAO, dataCurta, percentual } from "@/lib/financeiro";
import type { MeuDesempenho, MeuFinanceiro } from "@/lib/financeiro";
import { formatarReais } from "@/lib/pagamentos";
import {
  LIMITE_LISTA, ROTULO_LANCAMENTO, TEXTOS_INDICADORES, TEXTOS_PAINEL, cartaoPercentual, notaSaldo, saldoAReceber,
} from "@/lib/painelBarbeiro";
import { DivisaoFaturamento, Erro, ProgressoComissoes } from "./graficos";

// O rotulo e o primeiro paragrafo do cartao
const Cartao = ({ rotulo, valor, nota, alerta }: { rotulo: string; valor: string; nota?: string; alerta?: boolean }) => (
  <div className="h-full border border-border bg-card p-4">
    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{rotulo}</p>
    <p className={`mt-1.5 text-xl font-bold tracking-tight ${alerta ? "text-amber-700 dark:text-amber-500" : "text-primary"}`}>{valor}</p>
    {nota && <p className="mt-1 text-xs leading-snug text-muted-foreground">{nota}</p>}
  </div>
);

// Os cinco mais recentes; "Ver todos" mostra a lista inteira ali mesmo
function VerTodos({ total, aberto, onAlternar, rotulo }: { total: number; aberto: boolean; onAlternar: () => void; rotulo: string }) {
  if (total <= LIMITE_LISTA) return null;
  return (
    <button
      onClick={onAlternar} aria-expanded={aberto} aria-label={`${aberto ? TEXTOS_INDICADORES.verMenos : TEXTOS_INDICADORES.verTodos}: ${rotulo}`}
      className="font-mono text-[10px] uppercase tracking-widest text-primary underline-offset-4 hover:underline"
    >
      {aberto ? TEXTOS_INDICADORES.verMenos : `${TEXTOS_INDICADORES.verTodos} (${total})`}
    </button>
  );
}

const Cabecalho = ({ titulo, children }: { titulo: string; children?: React.ReactNode }) => (
  <div className="mb-3 flex items-baseline justify-between gap-3">
    <h3 className="font-mono text-[10px] uppercase tracking-widest text-foreground">{titulo}</h3>
    {children}
  </div>
);

// Comissoes e recebimentos: valores de meu_financeiro, sem nenhuma conta nova
// alem do saldo (comissoes acumuladas menos o que ja foi pago), como antes.
export default function ComissoesRecebimentos({ fin, desempenho, erro }: { fin: MeuFinanceiro | null; desempenho: MeuDesempenho | null; erro: string | null }) {
  const [todosLancamentos, setTodosLancamentos] = useState(false);
  const [todosPagamentos, setTodosPagamentos] = useState(false);
  const pct = cartaoPercentual(desempenho);

  return (
    <section className="mt-12" aria-labelledby="titulo-comissoes">
      <h2 id="titulo-comissoes" className="mb-4 text-xl font-light tracking-tighter text-primary">{TEXTOS_PAINEL.comissoes}</h2>
      {!fin ? (
        <Erro mensagem={erro ?? TEXTOS_PAINEL.erroFinanceiro} />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <Cartao rotulo={TEXTOS_PAINEL.comissao} valor={formatarReais(fin.comissao)} nota={TEXTOS_PAINEL.comissaoNota} />
            <Cartao rotulo={TEXTOS_PAINEL.percentual} valor={pct.valor} nota={pct.nota} alerta={pct.pendente} />
            <Cartao rotulo={TEXTOS_PAINEL.servicosComissao} valor={String(fin.servicos)} />
            <Cartao rotulo={TEXTOS_PAINEL.recebido} valor={formatarReais(fin.recebido)} />
            <div className="col-span-2 md:col-span-2 xl:col-span-1">
              <Cartao rotulo={TEXTOS_PAINEL.saldo} valor={formatarReais(saldoAReceber(fin))} nota={notaSaldo(fin)} />
            </div>
          </div>

          {(Number(fin.faturamento) > 0 || Number(fin.comissao_total) > 0) && (
            <div className="mt-3 grid gap-6 border border-border bg-card p-5 md:grid-cols-2">
              <DivisaoFaturamento faturamento={fin.faturamento} comissao={fin.comissao} />
              <ProgressoComissoes comissaoTotal={fin.comissao_total} recebidoTotal={fin.recebido_total} />
            </div>
          )}

          <div className="mt-8 grid gap-8 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <Cabecalho titulo={TEXTOS_PAINEL.lancamentos}>
                <VerTodos total={fin.lancamentos.length} aberto={todosLancamentos} onAlternar={() => setTodosLancamentos((v) => !v)} rotulo={TEXTOS_PAINEL.lancamentos} />
              </Cabecalho>
              {fin.lancamentos.length === 0 ? (
                <p className="border border-border p-4 text-sm text-muted-foreground">{TEXTOS_PAINEL.lancamentosVazio}</p>
              ) : (
                <div className="overflow-x-auto border border-border bg-card">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                      <tr><th className="p-3 text-left">Data</th><th className="p-3 text-left">Serviço</th><th className="p-3 text-right">Valor pago</th><th className="p-3 text-right">%</th><th className="p-3 text-right">Comissão</th></tr>
                    </thead>
                    <tbody>
                      {(todosLancamentos ? fin.lancamentos : fin.lancamentos.slice(0, LIMITE_LISTA)).map((l) => (
                        <tr key={l.id} className="border-b border-border last:border-0">
                          <td className="p-3 font-mono text-[10px]">{dataCurta(l.competencia)}</td>
                          <td className="p-3">
                            {l.servico}
                            {l.tipo !== "servico" && <span className="ml-2 font-mono text-[9px] uppercase text-destructive">{ROTULO_LANCAMENTO[l.tipo]}</span>}
                          </td>
                          <td className="p-3 text-right">{formatarReais(l.valor_pago)}</td>
                          <td className="p-3 text-right">{percentual(l.percentual)}</td>
                          <td className={`p-3 text-right font-bold ${Number(l.comissao) < 0 ? "text-destructive" : "text-primary"}`}>{formatarReais(l.comissao)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="lg:col-span-2">
              <Cabecalho titulo={TEXTOS_PAINEL.pagamentos}>
                <VerTodos total={fin.pagamentos.length} aberto={todosPagamentos} onAlternar={() => setTodosPagamentos((v) => !v)} rotulo={TEXTOS_PAINEL.pagamentos} />
              </Cabecalho>
              {fin.pagamentos.length === 0 ? (
                <p className="border border-border p-4 text-sm text-muted-foreground">{TEXTOS_PAINEL.pagamentosVazio}</p>
              ) : (
                <div className="divide-y divide-border border border-border bg-card">
                  {(todosPagamentos ? fin.pagamentos : fin.pagamentos.slice(0, LIMITE_LISTA)).map((p) => (
                    <div key={p.id} className="flex flex-wrap justify-between gap-2 p-3 text-sm">
                      <div>
                        <p className="text-primary">Semana de {dataCurta(p.semana_inicio, true)}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {new Date(p.pago_em).toLocaleDateString("pt-BR")} · {METODOS_COMISSAO.find((m) => m.valor === p.metodo)?.rotulo ?? p.metodo}
                          {p.comprovante ? ` · ${p.comprovante}` : ""}
                        </p>
                      </div>
                      <span className="font-bold text-primary">{formatarReais(p.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
