import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { METODOS_COMISSAO, dataCurta, intervaloDoPeriodo, percentual } from "@/lib/financeiro";
import type { Periodo } from "@/lib/financeiro";
import { formatarReais } from "@/lib/pagamentos";
import {
  PERIODOS_PAINEL, ROTULO_LANCAMENTO, TEXTOS_PAINEL, buscarPainelFinanceiro, cartaoPercentual, notaSaldo, saldoAReceber,
} from "@/lib/painelBarbeiro";
import type { PainelFinanceiro } from "@/lib/painelBarbeiro";
import GraficoDiasSemana from "./GraficoDiasSemana";
import { campoCls, chipCls } from "./estilos";

const Cartao = ({ rotulo, valor, nota, alerta, largo }: { rotulo: string; valor: string; nota?: string; alerta?: boolean; largo?: boolean }) => (
  <div className={`border border-border bg-background p-4 ${largo ? "col-span-2" : ""}`}>
    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{rotulo}</p>
    <p className={`mt-1 text-xl font-bold ${alerta ? "text-amber-500" : "text-primary"}`}>{valor}</p>
    {nota && <p className="mt-1 text-xs text-muted-foreground">{nota}</p>}
  </div>
);

const Bloco = ({ titulo, nota, children }: { titulo: string; nota: string; children: React.ReactNode }) => (
  <section className="border border-border bg-card p-5" aria-label={titulo}>
    <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{titulo}</h3>
    <p className="mt-1 mb-4 text-sm text-foreground">{nota}</p>
    {children}
  </section>
);

// Blocos B, C e D do Painel do Barbeiro: Meu desempenho, Atendimentos
// realizados e Comissoes e recebimentos. Valores so do banco (meu_financeiro e
// meu_desempenho), pelo periodo escolhido. `versao` muda quando o painel pede
// recarga (ex.: depois de cancelar um atendimento, que pode gerar estorno).
export default function DesempenhoFinanceiro({ versao }: { versao: number }) {
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [personalizado, setPersonalizado] = useState(() => intervaloDoPeriodo("mes"));
  const [dados, setDados] = useState<PainelFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo, new Date(), personalizado), [periodo, personalizado]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    buscarPainelFinanceiro(intervalo.inicio, intervalo.fim).then((d) => {
      if (!ativo) return;
      setDados(d);
      setCarregando(false);
    });
    return () => { ativo = false; };
  }, [intervalo, versao]);

  const fin = dados?.financeiro ?? null;
  const pct = cartaoPercentual(dados?.desempenho ?? null);

  return (
    <section className="mt-14" aria-labelledby="titulo-desempenho">
      <div className="border-b border-border pb-4 mb-6">
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
          <span className="ml-auto font-mono text-[10px] text-muted-foreground">
            {dataCurta(intervalo.inicio, true)} a {dataCurta(intervalo.fim, true)}
          </span>
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground">{TEXTOS_PAINEL.periodoNota}</p>
      </div>

      {carregando && !dados ? (
        <div className="flex justify-center py-16"><Loader2 aria-label="Carregando" className="size-6 animate-spin text-primary" /></div>
      ) : dados && (
        <>
          <div className="grid gap-6 lg:grid-cols-2">
            {/* B. Resultado financeiro: lancamentos oficiais (concluidos e pagos) */}
            <Bloco titulo={TEXTOS_PAINEL.resultado} nota={TEXTOS_PAINEL.resultadoNota}>
              {fin ? (
                <div className="grid grid-cols-2 gap-3">
                  <Cartao largo rotulo={TEXTOS_PAINEL.faturamento} valor={formatarReais(fin.faturamento)} nota={TEXTOS_PAINEL.faturamentoNota} />
                  <Cartao rotulo={TEXTOS_PAINEL.comissao} valor={formatarReais(fin.comissao)} nota={TEXTOS_PAINEL.comissaoNota} />
                  <Cartao rotulo={TEXTOS_PAINEL.percentual} valor={pct.valor} nota={pct.nota} alerta={pct.pendente} />
                </div>
              ) : (
                <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive">{dados.erroFinanceiro}</p>
              )}
            </Bloco>

            {/* C. Atendimentos realizados: contagem, independe do pagamento */}
            <Bloco titulo={TEXTOS_PAINEL.atendimentos} nota={TEXTOS_PAINEL.atendimentosNota}>
              {dados.desempenho ? (
                <GraficoDiasSemana dias={dados.desempenho.dias_semana} />
              ) : (
                <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive">{dados.erroDesempenho}</p>
              )}
            </Bloco>
          </div>

          {/* D. Comissoes e recebimentos */}
          {fin && (
            <section className="mt-10" aria-labelledby="titulo-comissoes">
              <h2 id="titulo-comissoes" className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">{TEXTOS_PAINEL.comissoes}</h2>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
                <Cartao rotulo={TEXTOS_PAINEL.servicosComissao} valor={String(fin.servicos)} />
                <Cartao rotulo={TEXTOS_PAINEL.recebido} valor={formatarReais(fin.recebido)} />
                <Cartao rotulo={TEXTOS_PAINEL.saldo} valor={formatarReais(saldoAReceber(fin))} nota={notaSaldo(fin)} />
              </div>

              <h3 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">{TEXTOS_PAINEL.lancamentos}</h3>
              {fin.lancamentos.length === 0 ? (
                <p className="border border-border p-4 text-sm text-muted-foreground mb-8">{TEXTOS_PAINEL.lancamentosVazio}</p>
              ) : (
                <div className="border border-border overflow-x-auto mb-8">
                  <table className="w-full text-sm">
                    <thead className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border">
                      <tr><th className="text-left p-3">Data</th><th className="text-left p-3">Serviço</th><th className="text-right p-3">Valor pago</th><th className="text-right p-3">%</th><th className="text-right p-3">Comissão</th></tr>
                    </thead>
                    <tbody>
                      {fin.lancamentos.map((l) => (
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

              <h3 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">{TEXTOS_PAINEL.pagamentos}</h3>
              {fin.pagamentos.length === 0 ? (
                <p className="border border-border p-4 text-sm text-muted-foreground">{TEXTOS_PAINEL.pagamentosVazio}</p>
              ) : (
                <div className="border border-border divide-y divide-border">
                  {fin.pagamentos.map((p) => (
                    <div key={p.id} className="p-3 flex flex-wrap justify-between gap-2 text-sm">
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
            </section>
          )}
        </>
      )}
    </section>
  );
}
