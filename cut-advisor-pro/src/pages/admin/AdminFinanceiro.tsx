import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, AlertTriangle, History, Loader2, RefreshCw, Undo2, Wallet, XCircle } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import AdminLayout from "@/components/admin/AdminNav";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  AReceber, EventoPagamento, FORMAS_PRESENCIAIS, LinhaBarbeiro, LinhaPagamento, LinhaReembolso, PERIODOS, Periodo,
  PontoSerie, ROTULO_ORIGEM, ROTULO_ORIGEM_REEMBOLSO, Resumo, agrupar, buscarAReceber, buscarDuplicidades,
  buscarHistorico, buscarPagamentosAdmin, buscarPorBarbeiro, buscarReembolsos, buscarResumo, buscarSerie, dataCurta,
  descreverEvento, detalheDoEvento, intervaloDoPeriodo, percentual, registrarPagamentoPresencial,
  registrarReembolsoPresencial,
} from "@/lib/financeiro";
import {
  ROTULO_METODO, ROTULO_STATUS, StatusPagamento, cancelarCobrancasAbertas, formatarReais, reembolsarOnline,
  sincronizarPagamento,
} from "@/lib/pagamentos";

const chipCls = (ativo: boolean) =>
  `px-3 py-1.5 border font-mono text-[10px] uppercase tracking-widest transition-colors ${
    ativo ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:border-primary"}`;
const campoCls = "bg-background border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary";
const acaoCls = "flex items-center gap-1 border border-border px-2 py-1 font-mono text-[9px] uppercase tracking-widest text-foreground hover:border-primary hover:text-primary disabled:opacity-50";

const STATUS: StatusPagamento[] = ["pending", "approved", "rejected", "expired", "refunded", "partially_refunded", "canceled"];

const Indicador = ({ rotulo, valor, sub, destaque }: { rotulo: string; valor: string; sub?: string; destaque?: boolean }) => (
  <div className={`border p-4 ${destaque ? "border-accent/50" : "border-border"}`}>
    <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">{rotulo}</p>
    <p className="text-xl font-bold text-primary mt-1">{valor}</p>
    {sub && <p className="font-mono text-[9px] text-muted-foreground mt-1">{sub}</p>}
  </div>
);

type Acao =
  | { tipo: "presencial"; item: AReceber }
  | { tipo: "reembolso"; item: LinhaPagamento }
  | { tipo: "historico"; item: LinhaPagamento };

const AdminFinanceiro = () => {
  const [periodo, setPeriodo] = useState<Periodo>("mes");
  const [personalizado, setPersonalizado] = useState(() => intervaloDoPeriodo("mes"));
  const [barbeiroId, setBarbeiroId] = useState("");
  const [servicoId, setServicoId] = useState("");
  const [status, setStatus] = useState<StatusPagamento | "">("");
  const [catalogo, setCatalogo] = useState<{ barbeiros: { id: string; nome: string }[]; servicos: { id: string; nome: string }[] }>({ barbeiros: [], servicos: [] });

  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [serie, setSerie] = useState<PontoSerie[]>([]);
  const [porBarbeiro, setPorBarbeiro] = useState<LinhaBarbeiro[]>([]);
  const [pagamentos, setPagamentos] = useState<LinhaPagamento[]>([]);
  const [aReceber, setAReceber] = useState<AReceber[]>([]);
  const [duplicidades, setDuplicidades] = useState<LinhaPagamento[]>([]);
  const [reembolsos, setReembolsos] = useState<LinhaReembolso[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [acao, setAcao] = useState<Acao | null>(null);
  const [processando, setProcessando] = useState<string | null>(null);
  const [cancelando, setCancelando] = useState(false);

  const intervalo = useMemo(() => intervaloDoPeriodo(periodo, new Date(), personalizado), [periodo, personalizado]);

  useEffect(() => {
    Promise.all([
      supabase.from("barbeiros").select("id, nome").order("nome"),
      supabase.from("servicos").select("id, nome").order("nome"),
    ]).then(([b, s]) => setCatalogo({ barbeiros: b.data ?? [], servicos: s.data ?? [] }));
  }, []);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    const filtros = { ...intervalo, barbeiroId, servicoId, status: status || null };
    try {
      const [r, s, b, p, a, d, rb] = await Promise.all([
        buscarResumo(filtros), buscarSerie(filtros), buscarPorBarbeiro(filtros),
        buscarPagamentosAdmin(filtros), buscarAReceber(intervalo.inicio, intervalo.fim),
        buscarDuplicidades(), buscarReembolsos(filtros),
      ]);
      setResumo(r); setSerie(s); setPorBarbeiro(b); setPagamentos(p); setAReceber(a); setDuplicidades(d); setReembolsos(rb);
    } catch (e) {
      setErro((e as Error).message);
    }
    setCarregando(false);
  }, [intervalo, barbeiroId, servicoId, status]);

  useEffect(() => { carregar(); }, [carregar]);

  async function verificar(p: LinhaPagamento) {
    setProcessando(p.id);
    try {
      const atualizado = await sincronizarPagamento(p.id);
      toast.success(`Pagamento ${ROTULO_STATUS[atualizado.status].toLowerCase()}.`);
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setProcessando(null);
  }

  // Cobrancas canceladas aqui que ainda podem ser pagas no Mercado Pago
  async function cancelarAbertas() {
    setCancelando(true);
    try {
      const r = await cancelarCobrancasAbertas();
      if (r.falharam) {
        toast.error(`${r.falharam} cobrança(s) não puderam ser canceladas agora. Se alguma já tiver sido paga, ela aparece como duplicidade.`);
      } else {
        toast.success(r.canceladas ? `${r.canceladas} cobrança(s) cancelada(s) no Mercado Pago.` : "Nenhuma cobrança aberta para cancelar.");
      }
      await carregar();
    } catch (e) {
      toast.error((e as Error).message);
    }
    setCancelando(false);
  }

  const grafico = useMemo(() => agrupar(serie, intervalo.inicio, intervalo.fim), [serie, intervalo]);

  return (
    <AdminLayout>
      <div className="mb-8">
        <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-1">Admin</p>
        <h1 className="text-3xl font-light text-primary tracking-tighter">Financeiro</h1>
      </div>

      {/* Filtros */}
      <div className="border border-border p-4 mb-6 space-y-3">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Período">
          {PERIODOS.map((p) => (
            <button key={p.valor} onClick={() => setPeriodo(p.valor)} aria-pressed={periodo === p.valor} className={chipCls(periodo === p.valor)}>
              {p.rotulo}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-3 items-end">
          {periodo === "personalizado" && (
            <>
              <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">De
                <input type="date" value={personalizado.inicio} onChange={(e) => setPersonalizado((p) => ({ ...p, inicio: e.target.value }))} className={`${campoCls} block mt-1`} />
              </label>
              <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Até
                <input type="date" value={personalizado.fim} onChange={(e) => setPersonalizado((p) => ({ ...p, fim: e.target.value }))} className={`${campoCls} block mt-1`} />
              </label>
            </>
          )}
          <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Barbeiro
            <select value={barbeiroId} onChange={(e) => setBarbeiroId(e.target.value)} className={`${campoCls} block mt-1`}>
              <option value="">Todos</option>
              {catalogo.barbeiros.map((b) => <option key={b.id} value={b.id}>{b.nome}</option>)}
            </select>
          </label>
          <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Serviço
            <select value={servicoId} onChange={(e) => setServicoId(e.target.value)} className={`${campoCls} block mt-1`}>
              <option value="">Todos</option>
              {catalogo.servicos.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </label>
          <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Status do pagamento
            <select value={status} onChange={(e) => setStatus(e.target.value as StatusPagamento | "")} className={`${campoCls} block mt-1`}>
              <option value="">Todos</option>
              {STATUS.map((s) => <option key={s} value={s}>{ROTULO_STATUS[s]}</option>)}
            </select>
          </label>
          <p className="font-mono text-[10px] text-muted-foreground ml-auto">
            {dataCurta(intervalo.inicio, true)} a {dataCurta(intervalo.fim, true)}
          </p>
        </div>
      </div>

      {erro && <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive mb-6">{erro}</p>}

      {carregando && !resumo ? (
        <div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div>
      ) : resumo && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-3">
            <Indicador rotulo="Faturamento bruto" valor={formatarReais(resumo.faturamento_bruto)}
              sub={`${resumo.servicos} serviço(s) realizados e pagos · após descontos e reembolsos: ${formatarReais(resumo.faturamento)}`} />
            <Indicador rotulo="Total recebido" valor={formatarReais(resumo.total_recebido)} sub={`Líquido de taxas e reembolsos: ${formatarReais(resumo.recebido_liquido)}`} />
            <Indicador rotulo="Pagamentos pendentes" valor={formatarReais(resumo.pendentes_valor)} sub={`${resumo.pendentes_quantidade} cobrança(s) em aberto`} />
            <Indicador rotulo="Taxas dos meios de pagamento" valor={formatarReais(resumo.taxas)} />
            <Indicador rotulo="Comissões dos barbeiros" valor={formatarReais(resumo.comissoes)} sub="Serviços do período" />
            <Indicador rotulo="Comissões pendentes" valor={formatarReais(resumo.comissoes_pendentes)} sub="Saldo a pagar hoje" />
            <Indicador rotulo="Comissões pagas" valor={formatarReais(resumo.comissoes_pagas)} sub="Pagas no período" />
            <Indicador rotulo="Reembolsos" valor={formatarReais(resumo.reembolsos)} sub={resumo.descontos ? `Descontos: ${formatarReais(resumo.descontos)}` : undefined} />
          </div>
          <div className="border border-accent/50 p-4 mb-8">
            <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Receita da barbearia antes das demais despesas</p>
            <p className="text-2xl font-bold text-primary mt-1">{formatarReais(resumo.receita_barbearia)}</p>
            <p className="text-xs text-muted-foreground mt-2">
              Valor dos serviços realizados menos comissões e taxas dos meios de pagamento. Ainda não desconta aluguel,
              produtos, contas e outras despesas: <strong>não é lucro líquido</strong>.
            </p>
          </div>

          {/* Pendencias que pedem acao do admin (situacao de hoje, qualquer periodo) */}
          {(resumo.duplicados_quantidade > 0 || resumo.cobrancas_abertas > 0) && (
            <div role="alert" className="border border-amber-500/50 bg-amber-500/5 p-4 mb-8 space-y-3">
              {resumo.duplicados_quantidade > 0 && (
                <p className="flex items-start gap-2 text-sm text-foreground">
                  <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    <strong>{resumo.duplicados_quantidade} pagamento(s) em duplicidade</strong>: {formatarReais(resumo.duplicados_valor)} recebidos
                    a mais. Confira em "Pagamentos em duplicidade" e devolva ao cliente.
                  </span>
                </p>
              )}
              {resumo.cobrancas_abertas > 0 && (
                <div className="flex flex-wrap items-center gap-3 text-sm">
                  <p className="flex items-start gap-2 text-foreground flex-1">
                    <AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" />
                    <span>{resumo.cobrancas_abertas} cobrança(s) cancelada(s) aqui ainda podem ser pagas no Mercado Pago.</span>
                  </p>
                  <button onClick={cancelarAbertas} disabled={cancelando} className={acaoCls}>
                    <XCircle className="size-3" /> {cancelando ? "Cancelando..." : "Cancelar no Mercado Pago"}
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Graficos */}
          <div className="grid lg:grid-cols-2 gap-4 mb-8">
            <div className="border border-border p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Faturamento e comissões</p>
              {grafico.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">Sem serviços pagos no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={grafico}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="rotulo" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip formatter={(v: number) => formatarReais(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="comissao" name="Comissões" stackId="a" fill="hsl(var(--accent))" />
                    <Bar dataKey="barbearia" name="Barbearia" stackId="a" fill="hsl(var(--primary))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="border border-border p-4">
              <p className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Desempenho dos profissionais</p>
              {porBarbeiro.every((b) => b.faturamento === 0) ? (
                <p className="text-sm text-muted-foreground py-12 text-center">Sem serviços pagos no período.</p>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={porBarbeiro.filter((b) => b.faturamento !== 0)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                    <XAxis dataKey="nome" tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <YAxis tick={{ fontSize: 10 }} stroke="hsl(var(--muted-foreground))" />
                    <Tooltip formatter={(v: number) => formatarReais(v)} contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))" }} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Bar dataKey="faturamento" name="Faturamento" fill="hsl(var(--primary))" />
                    <Bar dataKey="comissao" name="Comissão" fill="hsl(var(--accent))" />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Por barbeiro */}
          <section className="mb-8">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Por barbeiro</h2>
            <div className="border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <tr><th className="text-left p-3">Barbeiro</th><th className="text-right p-3">Serviços</th><th className="text-right p-3">Faturamento</th><th className="text-right p-3">Comissão</th><th className="text-right p-3">% atual</th><th className="text-right p-3">Saldo a pagar</th></tr>
                </thead>
                <tbody>
                  {porBarbeiro.map((b) => (
                    <tr key={b.barbeiro_id} className="border-b border-border last:border-0">
                      <td className="p-3 text-primary">{b.nome}{!b.ativo && <span className="ml-2 font-mono text-[9px] text-muted-foreground">INATIVO</span>}</td>
                      <td className="p-3 text-right">{b.servicos}</td>
                      <td className="p-3 text-right">{formatarReais(b.faturamento)}</td>
                      <td className="p-3 text-right">{formatarReais(b.comissao)}</td>
                      <td className="p-3 text-right">{b.percentual == null ? <span className="text-amber-500">Não configurada</span> : percentual(b.percentual)}</td>
                      <td className="p-3 text-right font-bold">{formatarReais(b.saldo_pendente)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* A receber na barbearia */}
          <section className="mb-8">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-1">Atendimentos sem pagamento confirmado</h2>
            <p className="text-xs text-muted-foreground mb-3">Registre aqui o que o cliente pagou na barbearia (dinheiro, maquininha ou PIX direto).</p>
            {aReceber.length === 0 ? (
              <p className="border border-border p-4 text-sm text-muted-foreground">Nenhum atendimento pendente de pagamento no período.</p>
            ) : (
              <div className="border border-border divide-y divide-border">
                {aReceber.map((a) => (
                  <div key={a.agendamento_id} className="p-3 flex flex-wrap items-center gap-3 justify-between">
                    <div className="text-sm">
                      <p className="text-primary">{a.cliente} · {a.servico}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {format(new Date(a.data_hora), "dd/MM HH:mm")} · {a.barbeiro}
                        {a.metodo_pendente ? ` · ${a.metodo_pendente === "presencial" ? "vai pagar na barbearia" : `${ROTULO_METODO[a.metodo_pendente]} em aberto`}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-bold text-primary">{formatarReais(a.preco)}</span>
                      <button onClick={() => setAcao({ tipo: "presencial", item: a })} className={acaoCls}>
                        <Wallet className="size-3" /> Registrar pagamento
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Duplicidades a devolver */}
          {duplicidades.length > 0 && (
            <section className="mb-8">
              <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-1">Pagamentos em duplicidade</h2>
              <p className="text-xs text-muted-foreground mb-3">
                O atendimento já estava quitado por outro pagamento. O valor entrou na conta, não gera comissão e deve ser
                devolvido ao cliente. Nada é devolvido automaticamente.
              </p>
              <div className="border border-amber-500/40 divide-y divide-border">
                {duplicidades.map((d) => (
                  <div key={d.id} className="p-3 flex flex-wrap items-center gap-3 justify-between">
                    <div className="text-sm">
                      <p className="text-primary">{d.cliente} · {d.servico}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        Atendimento {format(new Date(d.data_hora), "dd/MM HH:mm")} · {ROTULO_METODO[d.metodo]}
                        {d.aprovado_em ? ` · pago em ${format(new Date(d.aprovado_em), "dd/MM HH:mm")}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-primary">{formatarReais(d.valor - d.valor_reembolsado)}</span>
                      <button onClick={() => setAcao({ tipo: "historico", item: d })} className={acaoCls}>
                        <History className="size-3" /> Histórico
                      </button>
                      <button onClick={() => setAcao({ tipo: "reembolso", item: d })} className={acaoCls}>
                        <Undo2 className="size-3" /> Devolver
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* Pagamentos */}
          <section className="mb-8">
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Pagamentos</h2>
            {pagamentos.length === 0 ? (
              <p className="border border-border p-4 text-sm text-muted-foreground">Nenhum pagamento no período.</p>
            ) : (
              <div className="border border-border overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border">
                    <tr><th className="text-left p-3">Atendimento</th><th className="text-left p-3">Cliente</th><th className="text-left p-3">Serviço</th><th className="text-left p-3">Meio</th><th className="text-left p-3">Status</th><th className="text-right p-3">Valor</th><th className="text-right p-3">Taxa</th><th className="p-3" /></tr>
                  </thead>
                  <tbody>
                    {pagamentos.map((p) => {
                      const reembolsavel = p.status === "approved" || p.status === "partially_refunded";
                      const abertaNoProvedor = p.status === "canceled" && (p.cancelamento_provedor === "pendente" || p.cancelamento_provedor === "falhou");
                      return (
                        <tr key={p.id} className="border-b border-border last:border-0">
                          <td className="p-3 font-mono text-[10px]">{format(new Date(p.data_hora), "dd/MM HH:mm")}</td>
                          <td className="p-3">{p.cliente}</td>
                          <td className="p-3">{p.servico}<span className="block font-mono text-[9px] text-muted-foreground">{p.barbeiro}</span></td>
                          <td className="p-3 font-mono text-[10px] uppercase">{ROTULO_METODO[p.metodo]}</td>
                          <td className="p-3 font-mono text-[10px] uppercase">
                            {ROTULO_STATUS[p.status]}
                            {p.duplicidade_de && <span className="block text-amber-500">Duplicidade</span>}
                            {abertaNoProvedor && <span className="block text-amber-500">Cancelamento no Mercado Pago não confirmado</span>}
                          </td>
                          <td className="p-3 text-right">
                            {formatarReais(p.valor)}
                            {p.valor_reembolsado > 0 && <span className="block font-mono text-[9px] text-destructive">- {formatarReais(p.valor_reembolsado)}</span>}
                          </td>
                          <td className="p-3 text-right">{formatarReais(p.taxa)}</td>
                          <td className="p-3">
                            <div className="flex justify-end items-center gap-2">
                              {p.status === "pending" && p.metodo !== "presencial" && (
                                <button onClick={() => verificar(p)} disabled={processando === p.id} className={acaoCls}>
                                  <RefreshCw className={`size-3 ${processando === p.id ? "animate-spin" : ""}`} /> Verificar
                                </button>
                              )}
                              {reembolsavel && !p.tem_duplicidade && (
                                <button onClick={() => setAcao({ tipo: "reembolso", item: p })} className={acaoCls}>
                                  <Undo2 className="size-3" /> {p.duplicidade_de ? "Devolver" : "Reembolsar"}
                                </button>
                              )}
                              {reembolsavel && p.tem_duplicidade && (
                                <span className="font-mono text-[9px] text-amber-500 text-right">Devolva a duplicidade antes</span>
                              )}
                              <button onClick={() => setAcao({ tipo: "historico", item: p })} aria-label={`Histórico do pagamento de ${p.cliente}`} className={acaoCls}>
                                <History className="size-3" /> Histórico
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Reembolsos */}
          <section>
            <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Reembolsos do período</h2>
            {reembolsos.length === 0 ? (
              <p className="border border-border p-4 text-sm text-muted-foreground">Nenhum reembolso no período.</p>
            ) : (
              <div className="border border-border divide-y divide-border">
                {reembolsos.map((r) => (
                  <div key={r.id} className="p-3 flex flex-wrap justify-between gap-2 text-sm">
                    <div>
                      <p className="text-primary">
                        {r.cliente} · {r.servico}
                        {r.duplicidade && <span className="ml-2 font-mono text-[9px] uppercase text-amber-500">Duplicidade</span>}
                      </p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        {format(new Date(r.reembolsado_em), "dd/MM/yyyy HH:mm")} · {ROTULO_METODO[r.metodo]} · {ROTULO_ORIGEM_REEMBOLSO[r.origem]}
                        {r.registrado_por ? ` · ${r.registrado_por}` : ""}
                      </p>
                      {r.motivo && <p className="text-xs text-muted-foreground mt-1">{r.motivo}</p>}
                    </div>
                    <span className="font-bold text-destructive">- {formatarReais(r.valor)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <AcaoDialog acao={acao?.tipo === "historico" ? null : acao} onClose={() => setAcao(null)} onConcluido={() => { setAcao(null); carregar(); }} />
      <HistoricoDialog item={acao?.tipo === "historico" ? acao.item : null} onClose={() => setAcao(null)} />
    </AdminLayout>
  );
};

// Registrar pagamento presencial, reembolso ou devolucao de duplicidade
function AcaoDialog({ acao, onClose, onConcluido }: {
  acao: Exclude<Acao, { tipo: "historico" }> | null; onClose: () => void; onConcluido: () => void;
}) {
  const [forma, setForma] = useState("dinheiro");
  const [desconto, setDesconto] = useState("");
  const [taxa, setTaxa] = useState("");
  const [valor, setValor] = useState("");
  const [motivo, setMotivo] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const duplicada = acao?.tipo === "reembolso" && !!acao.item.duplicidade_de;

  useEffect(() => {
    setForma("dinheiro"); setDesconto(""); setTaxa(""); setErro(null); setConfirmado(false);
    setMotivo(acao?.tipo === "reembolso" && acao.item.duplicidade_de ? "Pagamento em duplicidade" : "");
    setValor(acao?.tipo === "reembolso" ? String((acao.item.valor - acao.item.valor_reembolsado).toFixed(2)).replace(".", ",") : "");
  }, [acao]);

  const numero = (v: string) => (v.trim() === "" ? 0 : Number(v.replace(",", ".")));

  async function confirmar() {
    if (!acao) return;
    setSalvando(true);
    setErro(null);
    try {
      if (acao.tipo === "presencial") {
        await registrarPagamentoPresencial(acao.item.agendamento_id, forma, numero(desconto), numero(taxa));
        toast.success("Pagamento registrado.");
      } else if (acao.item.metodo === "presencial") {
        await registrarReembolsoPresencial(acao.item.id, numero(valor), motivo);
        toast.success("Reembolso registrado.");
      } else {
        await reembolsarOnline(acao.item.id, numero(valor), motivo.trim() || undefined);
        toast.success(duplicada ? "Duplicidade devolvida ao cliente pelo Mercado Pago." : "Reembolso realizado no Mercado Pago.");
      }
      onConcluido();
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  const total = acao?.tipo === "presencial" ? Math.max(0, acao.item.preco - numero(desconto)) : 0;

  return (
    <Dialog open={!!acao} onOpenChange={(aberto) => { if (!aberto && !salvando) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-md p-0 gap-0 border-border bg-background sm:rounded-none">
        <div className="px-6 py-4 border-b border-border">
          <DialogTitle className="font-mono text-[10px] tracking-widest text-muted-foreground font-normal uppercase">
            {acao?.tipo === "presencial" ? "Registrar pagamento na barbearia" : duplicada ? "Devolver pagamento em duplicidade" : "Reembolsar pagamento"}
          </DialogTitle>
        </div>
        {acao && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-primary">
              {acao.item.cliente} · {acao.item.servico}
            </p>
            {acao.tipo === "presencial" ? (
              <>
                <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Forma de pagamento
                  <select value={forma} onChange={(e) => setForma(e.target.value)} className={`${campoCls} w-full mt-2`}>
                    {FORMAS_PRESENCIAIS.map((f) => <option key={f.valor} value={f.valor}>{f.rotulo}</option>)}
                  </select>
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Desconto (R$)
                    <input inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0,00" className={`${campoCls} w-full mt-2`} />
                  </label>
                  <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Taxa da maquininha (R$)
                    <input inputMode="decimal" value={taxa} onChange={(e) => setTaxa(e.target.value)} placeholder="0,00" className={`${campoCls} w-full mt-2`} />
                  </label>
                </div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-foreground">
                  Valor recebido: <span className="text-primary text-sm">{formatarReais(total)}</span>
                </p>
              </>
            ) : (
              <>
                <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">
                  {duplicada ? "Valor a devolver (R$)" : "Valor a reembolsar (R$)"}
                  <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={`${campoCls} w-full mt-2`} />
                </label>
                <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Motivo (opcional)
                  <input value={motivo} onChange={(e) => setMotivo(e.target.value)} className={`${campoCls} w-full mt-2`} />
                </label>
                {acao.item.metodo !== "presencial" && (
                  <p className="text-xs text-muted-foreground">O reembolso é feito no Mercado Pago e devolvido ao cliente pelo mesmo meio de pagamento.</p>
                )}
                {duplicada ? (
                  <>
                    <p className="text-xs text-muted-foreground">
                      Este valor foi recebido a mais: o atendimento já estava quitado por outro pagamento. Devolver não altera
                      a comissão nem o faturamento do atendimento.
                    </p>
                    <label className="flex items-start gap-2 text-xs text-foreground">
                      <input type="checkbox" checked={confirmado} onChange={(e) => setConfirmado(e.target.checked)} className="mt-0.5" />
                      Confirmo que este pagamento é uma duplicidade e autorizo a devolução ao cliente.
                    </label>
                  </>
                ) : (
                  <p className="flex items-start gap-2 text-xs text-amber-500">
                    <AlertCircle className="size-3.5 mt-0.5 shrink-0" />
                    A comissão do barbeiro é ajustada proporcionalmente ao valor reembolsado.
                  </p>
                )}
              </>
            )}
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} disabled={salvando} className="border border-border px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary">
                Cancelar
              </button>
              <button onClick={confirmar} disabled={salvando || (duplicada && !confirmado)} className="bg-primary text-primary-foreground px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 disabled:opacity-50">
                {salvando ? "Salvando..." : "Confirmar"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Historico (auditoria) de todos os pagamentos do atendimento
function HistoricoDialog({ item, onClose }: { item: LinhaPagamento | null; onClose: () => void }) {
  const [eventos, setEventos] = useState<EventoPagamento[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!item) return;
    setEventos(null);
    setErro(null);
    buscarHistorico(item.id).then(setEventos).catch((e) => setErro((e as Error).message));
  }, [item]);

  return (
    <Dialog open={!!item} onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-lg p-0 gap-0 border-border bg-background sm:rounded-none">
        <div className="px-6 py-4 border-b border-border">
          <DialogTitle className="font-mono text-[10px] tracking-widest text-muted-foreground font-normal uppercase">Histórico do atendimento</DialogTitle>
        </div>
        {item && (
          <div className="p-6 space-y-4 max-h-[70vh] overflow-y-auto">
            <p className="text-sm text-primary">{item.cliente} · {item.servico} · {format(new Date(item.data_hora), "dd/MM/yyyy HH:mm")}</p>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            {!eventos && !erro && <Loader2 className="size-5 animate-spin text-primary mx-auto" />}
            {eventos?.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhuma operação registrada. O histórico começa a ser gravado a partir desta versão do financeiro.</p>
            )}
            {!!eventos?.length && (
              <ol className="space-y-3">
                {eventos.map((e) => (
                  <li key={e.id} className="border-l-2 border-border pl-3">
                    <p className="text-sm text-primary">{descreverEvento(e)}</p>
                    <p className="font-mono text-[10px] text-muted-foreground">
                      {format(new Date(e.registrado_em), "dd/MM/yyyy HH:mm:ss")} · {ROTULO_METODO[e.metodo]} · {ROTULO_ORIGEM[e.origem]}
                      {e.ator ? ` (${e.ator})` : ""}
                    </p>
                    {detalheDoEvento(e) && <p className="text-xs text-muted-foreground">{detalheDoEvento(e)}</p>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AdminFinanceiro;
