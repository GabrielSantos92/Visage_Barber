import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { format } from "date-fns";
import Navbar from "@/components/Navbar";
import {
  METODOS_COMISSAO, MeuFinanceiro, Periodo, buscarMeuFinanceiro, dataCurta, intervaloDoPeriodo, percentual,
} from "@/lib/financeiro";
import { formatarReais } from "@/lib/pagamentos";

// So os dados do proprio barbeiro: o banco (meu_financeiro) identifica quem
// chama e nao aceita outro barbeiro
const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "semana", rotulo: "Esta semana" },
  { valor: "mes", rotulo: "Este mês" },
  { valor: "personalizado", rotulo: "Personalizado" },
];
const ROTULO_TIPO = { servico: "Serviço", reembolso: "Reembolso", cancelamento: "Cancelado" };

const chipCls = (ativo: boolean) =>
  `px-3 py-1.5 border font-mono text-[10px] uppercase tracking-widest transition-colors ${
    ativo ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:border-primary"}`;
const campoCls = "bg-background border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary";

const Cartao = ({ rotulo, valor, sub }: { rotulo: string; valor: string; sub?: string }) => (
  <div className="border border-border p-4">
    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{rotulo}</p>
    <p className="text-xl font-bold text-primary mt-1">{valor}</p>
    {sub && <p className="font-mono text-[9px] text-muted-foreground mt-1">{sub}</p>}
  </div>
);

const BarbeiroFinanceiro = () => {
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [personalizado, setPersonalizado] = useState(() => intervaloDoPeriodo("mes"));
  const [dados, setDados] = useState<MeuFinanceiro | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo, new Date(), personalizado), [periodo, personalizado]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    setErro(null);
    buscarMeuFinanceiro(intervalo.inicio, intervalo.fim)
      .then((d) => { if (ativo) setDados(d); })
      .catch((e) => { if (ativo) setErro((e as Error).message); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [intervalo]);

  const saldo = dados ? Number(dados.comissao_total) - Number(dados.recebido_total) : 0;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-4xl mx-auto px-6 py-10">
        <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-1">Barbeiro</p>
        <h1 className="text-3xl font-light text-primary tracking-tighter mb-6">Meu Financeiro</h1>

        <div className="flex flex-wrap items-end gap-2 mb-6" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
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
          <span className="font-mono text-[10px] text-muted-foreground ml-auto">
            {dataCurta(intervalo.inicio, true)} a {dataCurta(intervalo.fim, true)}
          </span>
        </div>

        {erro && <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive mb-6">{erro}</p>}

        {carregando && !dados ? (
          <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
        ) : dados && (
          <>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
              <Cartao rotulo="Serviços concluídos" valor={String(dados.servicos)} sub="Pagos, no período" />
              <Cartao rotulo="Faturamento gerado" valor={formatarReais(dados.faturamento)} />
              <Cartao rotulo="Sua comissão" valor={dados.percentual == null ? "A definir" : percentual(dados.percentual)} sub={dados.percentual == null ? "O administrador ainda não configurou" : "Percentual atual"} />
              <Cartao rotulo="Comissão no período" valor={formatarReais(dados.comissao)} />
              <Cartao rotulo="Recebido no período" valor={formatarReais(dados.recebido)} />
              <Cartao rotulo="Saldo a receber" valor={formatarReais(saldo)} sub={`Total acumulado: ${formatarReais(dados.comissao_total)}`} />
            </div>

            <section className="mb-8">
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Serviços que geraram comissão</h2>
              {dados.lancamentos.length === 0 ? (
                <p className="border border-border p-4 text-sm text-muted-foreground">Nenhum serviço concluído e pago no período.</p>
              ) : (
                <div className="border border-border overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border">
                      <tr><th className="text-left p-3">Data</th><th className="text-left p-3">Serviço</th><th className="text-right p-3">Valor pago</th><th className="text-right p-3">%</th><th className="text-right p-3">Comissão</th></tr>
                    </thead>
                    <tbody>
                      {dados.lancamentos.map((l) => (
                        <tr key={l.id} className="border-b border-border last:border-0">
                          <td className="p-3 font-mono text-[10px]">{dataCurta(l.competencia)}</td>
                          <td className="p-3">
                            {l.servico}
                            {l.tipo !== "servico" && <span className="ml-2 font-mono text-[9px] uppercase text-destructive">{ROTULO_TIPO[l.tipo]}</span>}
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
            </section>

            <section>
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Pagamentos recebidos</h2>
              {dados.pagamentos.length === 0 ? (
                <p className="border border-border p-4 text-sm text-muted-foreground">Nenhum pagamento de comissão registrado ainda.</p>
              ) : (
                <div className="border border-border divide-y divide-border">
                  {dados.pagamentos.map((p) => (
                    <div key={p.id} className="p-3 flex flex-wrap justify-between gap-2 text-sm">
                      <div>
                        <p className="text-primary">Semana de {dataCurta(p.semana_inicio, true)}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">
                          {format(new Date(p.pago_em), "dd/MM/yyyy")} · {METODOS_COMISSAO.find((m) => m.valor === p.metodo)?.rotulo ?? p.metodo}
                          {p.comprovante ? ` · ${p.comprovante}` : ""}
                        </p>
                      </div>
                      <span className="font-bold text-primary">{formatarReais(p.valor)}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
};

export default BarbeiroFinanceiro;
