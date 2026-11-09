import { useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Wallet } from "lucide-react";
import { format } from "date-fns";
import { toast } from "@/components/ui/sonner";
import AdminLayout from "@/components/admin/AdminNav";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  ComissoesConfig, LinhaFechamento, METODOS_COMISSAO, PagamentoComissao, buscarComissoes, buscarFechamento,
  buscarPagamentosComissao, configurarComissao, dataCurta, dataIso, fimDaSemana, inicioDaSemana, percentual,
  registrarPagamentoComissao, semanaAnterior, semanaSeguinte,
} from "@/lib/financeiro";
import { formatarReais } from "@/lib/pagamentos";

const campoCls = "bg-background border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary";
const botaoCls = "border border-border px-3 py-2 font-mono text-[9px] uppercase tracking-widest text-foreground hover:border-primary hover:text-primary disabled:opacity-50";
const tituloCls = "font-mono text-[10px] uppercase tracking-widest text-foreground mb-3";

// "60", "55,5" -> numero; "" -> null; invalido -> NaN
const lerPercentual = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const textoPercentual = (v: number | null) => (v == null ? "" : String(v).replace(".", ","));

const AdminComissoes = () => {
  const [config, setConfig] = useState<ComissoesConfig | null>(null);
  const [padrao, setPadrao] = useState("");
  const [proprios, setProprios] = useState<Record<string, string>>({});
  const [semana, setSemana] = useState(() => dataIso(inicioDaSemana(new Date())));
  const [fechamento, setFechamento] = useState<LinhaFechamento[]>([]);
  const [pagos, setPagos] = useState<PagamentoComissao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [pagando, setPagando] = useState<LinhaFechamento | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregarConfig = useCallback(async () => {
    const c = await buscarComissoes();
    setConfig(c);
    setPadrao(textoPercentual(c.padrao));
    setProprios(Object.fromEntries(c.barbeiros.map((b) => [b.barbeiro_id, textoPercentual(b.proprio)])));
  }, []);

  const carregarSemana = useCallback(async () => {
    const [f, p] = await Promise.all([buscarFechamento(semana), buscarPagamentosComissao()]);
    setFechamento(f);
    setPagos(p);
  }, [semana]);

  useEffect(() => {
    setErro(null);
    Promise.all([carregarConfig(), carregarSemana()])
      .catch((e) => setErro((e as Error).message))
      .finally(() => setCarregando(false));
  }, [carregarConfig, carregarSemana]);

  async function salvar(barbeiroId: string | null, texto: string) {
    const valor = lerPercentual(texto);
    if (valor != null && (!Number.isFinite(valor) || valor < 0 || valor > 100)) {
      toast.error("O percentual deve estar entre 0 e 100.");
      return;
    }
    setSalvando(barbeiroId ?? "padrao");
    try {
      await configurarComissao(barbeiroId, valor);
      toast.success(barbeiroId ? "Comissão do barbeiro atualizada." : "Comissão padrão atualizada.");
      await Promise.all([carregarConfig(), carregarSemana()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
    setSalvando(null);
  }

  if (carregando) {
    return <AdminLayout><div className="flex justify-center py-16"><Loader2 className="size-6 animate-spin text-primary" /></div></AdminLayout>;
  }

  return (
    <AdminLayout>
      <div className="mb-8">
        <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-1">Admin</p>
        <h1 className="text-3xl font-light text-primary tracking-tighter">Comissões</h1>
        <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
          A comissão é calculada sobre o valor efetivamente pago por cada serviço concluído. Mudar um percentual vale só
          para os próximos serviços: os já calculados não mudam.
        </p>
      </div>

      {erro && <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive mb-6">{erro}</p>}

      {config && (
        <>
          <section className="mb-8">
            <h2 className={tituloCls}>Padrão da barbearia</h2>
            <div className="border border-border p-4 flex flex-wrap items-end gap-3">
              <label className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Percentual padrão (%)
                <input aria-label="Percentual padrão" inputMode="decimal" value={padrao} onChange={(e) => setPadrao(e.target.value)} placeholder="Não configurado" className={`${campoCls} block mt-1 w-40`} />
              </label>
              <button onClick={() => salvar(null, padrao)} disabled={salvando === "padrao"} className={botaoCls}>Salvar padrão</button>
              <p className="text-xs text-muted-foreground basis-full">
                Vale para quem não tem percentual próprio. Sem padrão e sem percentual próprio, a comissão do serviço fica
                aguardando até o percentual ser configurado.
              </p>
            </div>
          </section>

          <section className="mb-8">
            <h2 className={tituloCls}>Por barbeiro</h2>
            <div className="border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border">
                  <tr><th className="text-left p-3">Barbeiro</th><th className="text-left p-3">Percentual próprio (%)</th><th className="text-left p-3">Em vigor</th><th className="p-3" /></tr>
                </thead>
                <tbody>
                  {config.barbeiros.map((b) => (
                    <tr key={b.barbeiro_id} className="border-b border-border last:border-0">
                      <td className="p-3 text-primary">{b.nome}{!b.ativo && <span className="ml-2 font-mono text-[9px] text-muted-foreground">INATIVO</span>}</td>
                      <td className="p-3">
                        <input
                          aria-label={`Percentual de ${b.nome}`} inputMode="decimal" value={proprios[b.barbeiro_id] ?? ""}
                          onChange={(e) => setProprios((p) => ({ ...p, [b.barbeiro_id]: e.target.value }))}
                          placeholder="Usa o padrão" className={`${campoCls} w-32`}
                        />
                      </td>
                      <td className="p-3">
                        {b.vigente == null
                          ? <span className="text-amber-500">Não configurada</span>
                          : <>{percentual(b.vigente)}{b.proprio == null && <span className="ml-1 font-mono text-[9px] text-muted-foreground">(padrão)</span>}</>}
                      </td>
                      <td className="p-3">
                        <div className="flex justify-end gap-2">
                          <button onClick={() => salvar(b.barbeiro_id, proprios[b.barbeiro_id] ?? "")} disabled={salvando === b.barbeiro_id} className={botaoCls}>
                            Salvar
                          </button>
                          {b.proprio != null && (
                            <button onClick={() => salvar(b.barbeiro_id, "")} disabled={salvando === b.barbeiro_id} className={botaoCls}>
                              Usar padrão
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      <section className="mb-8">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="font-mono text-[10px] uppercase tracking-widest text-foreground">Fechamento semanal</h2>
          <div className="flex items-center gap-2">
            <button aria-label="Semana anterior" onClick={() => setSemana(semanaAnterior(semana))} className={botaoCls}><ChevronLeft className="size-3" /></button>
            <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
              {dataCurta(semana)} a {dataCurta(fimDaSemana(semana), true)}
            </span>
            <button aria-label="Próxima semana" onClick={() => setSemana(semanaSeguinte(semana))} className={botaoCls}><ChevronRight className="size-3" /></button>
          </div>
        </div>
        <div className="border border-border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground border-b border-border">
              <tr>
                <th className="text-left p-3">Barbeiro</th><th className="text-right p-3">Serviços</th><th className="text-right p-3">Faturamento</th>
                <th className="text-right p-3">Comissão</th><th className="text-right p-3">Pago</th><th className="text-right p-3">Pendente</th><th className="p-3" />
              </tr>
            </thead>
            <tbody>
              {fechamento.length === 0 && (
                <tr><td colSpan={7} className="p-4 text-muted-foreground">Nenhum barbeiro com movimento nesta semana.</td></tr>
              )}
              {fechamento.map((f) => {
                const maximo = Math.min(f.pendente, f.saldo_geral);
                return (
                  <tr key={f.barbeiro_id} className="border-b border-border last:border-0">
                    <td className="p-3 text-primary">{f.nome}<span className="block font-mono text-[9px] text-muted-foreground">{percentual(f.percentual)}</span></td>
                    <td className="p-3 text-right">{f.servicos}</td>
                    <td className="p-3 text-right">{formatarReais(f.faturamento)}</td>
                    <td className="p-3 text-right">{formatarReais(f.comissao)}</td>
                    <td className="p-3 text-right">{formatarReais(f.pago)}</td>
                    <td className="p-3 text-right font-bold">{formatarReais(f.pendente)}</td>
                    <td className="p-3">
                      {maximo > 0 && (
                        <button onClick={() => setPagando(f)} className={`${botaoCls} flex items-center gap-1 ml-auto`}>
                          <Wallet className="size-3" /> Registrar pagamento
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground mt-2">
          Semanas de segunda a domingo (horário de Brasília). Reembolsos e cancelamentos entram na semana em que acontecem.
        </p>
      </section>

      <section className="mb-8">
        <h2 className={tituloCls}>Pagamentos de comissão registrados</h2>
        {pagos.length === 0 ? (
          <p className="border border-border p-4 text-sm text-muted-foreground">Nenhum pagamento de comissão registrado.</p>
        ) : (
          <div className="border border-border divide-y divide-border">
            {pagos.map((p) => (
              <div key={p.id} className="p-3 flex flex-wrap justify-between gap-2 text-sm">
                <div>
                  <p className="text-primary">{p.barbeiro} · semana de {dataCurta(p.semana_inicio, true)}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">
                    {format(new Date(p.pago_em), "dd/MM/yyyy HH:mm")} · {METODOS_COMISSAO.find((m) => m.valor === p.metodo)?.rotulo ?? p.metodo}
                    {p.comprovante ? ` · comprovante ${p.comprovante}` : ""} · registrado por {p.registrado_por}
                  </p>
                  {p.observacoes && <p className="text-xs text-muted-foreground mt-1">{p.observacoes}</p>}
                </div>
                <span className="font-bold text-primary">{formatarReais(p.valor)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      {config && (
        <section>
          <h2 className={tituloCls}>Histórico de alterações</h2>
          {config.historico.length === 0 ? (
            <p className="border border-border p-4 text-sm text-muted-foreground">Nenhuma comissão configurada ainda.</p>
          ) : (
            <div className="border border-border divide-y divide-border">
              {config.historico.map((h) => (
                <p key={h.id} className="p-3 text-sm flex flex-wrap justify-between gap-2">
                  <span className="text-primary">{h.barbeiro}: {h.percentual == null ? "percentual removido" : percentual(h.percentual)}</span>
                  <span className="font-mono text-[10px] text-muted-foreground">{format(new Date(h.alterado_em), "dd/MM/yyyy HH:mm")} · {h.alterado_por}</span>
                </p>
              ))}
            </div>
          )}
        </section>
      )}

      <PagamentoComissaoDialog
        linha={pagando} semana={semana}
        onClose={() => setPagando(null)}
        onConcluido={async () => { setPagando(null); await carregarSemana(); }}
      />
    </AdminLayout>
  );
};

function PagamentoComissaoDialog({ linha, semana, onClose, onConcluido }: {
  linha: LinhaFechamento | null; semana: string; onClose: () => void; onConcluido: () => void;
}) {
  const maximo = linha ? Math.min(linha.pendente, linha.saldo_geral) : 0;
  const [valor, setValor] = useState("");
  const [metodo, setMetodo] = useState("pix");
  const [comprovante, setComprovante] = useState("");
  const [observacoes, setObservacoes] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    setValor(maximo > 0 ? maximo.toFixed(2).replace(".", ",") : "");
    setMetodo("pix"); setComprovante(""); setObservacoes(""); setErro(null);
  }, [linha, maximo]);

  async function confirmar() {
    if (!linha) return;
    const v = Number(valor.replace(",", "."));
    if (!Number.isFinite(v) || v <= 0) { setErro("Informe um valor maior que zero."); return; }
    setSalvando(true);
    setErro(null);
    try {
      const r = await registrarPagamentoComissao({ barbeiroId: linha.barbeiro_id, semanaInicio: semana, valor: v, metodo, comprovante, observacoes });
      toast.success(Number(r.saldo_semana) > 0
        ? `Comissão paga. Ainda faltam ${formatarReais(r.saldo_semana)} desta semana.`
        : "Comissão paga. Semana quitada.");
      onConcluido();
    } catch (e) {
      setErro((e as Error).message);
    }
    setSalvando(false);
  }

  return (
    <Dialog open={!!linha} onOpenChange={(aberto) => { if (!aberto && !salvando) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-md p-0 gap-0 border-border bg-background sm:rounded-none">
        <div className="px-6 py-4 border-b border-border">
          <DialogTitle className="font-mono text-[10px] tracking-widest text-muted-foreground font-normal uppercase">Registrar pagamento de comissão</DialogTitle>
        </div>
        {linha && (
          <div className="p-6 space-y-4">
            <p className="text-sm text-primary">
              {linha.nome} · semana de {dataCurta(semana)} a {dataCurta(fimDaSemana(semana), true)}
            </p>
            <p className="font-mono text-[10px] uppercase tracking-widest text-foreground">Pendente: <span className="text-primary text-sm">{formatarReais(maximo)}</span></p>
            <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Valor pago (R$)
              <input inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} className={`${campoCls} w-full mt-2`} />
            </label>
            <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Como foi pago
              <select value={metodo} onChange={(e) => setMetodo(e.target.value)} className={`${campoCls} w-full mt-2`}>
                {METODOS_COMISSAO.map((m) => <option key={m.valor} value={m.valor}>{m.rotulo}</option>)}
              </select>
            </label>
            <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Comprovante ou identificador (opcional)
              <input value={comprovante} onChange={(e) => setComprovante(e.target.value)} className={`${campoCls} w-full mt-2`} />
            </label>
            <label className="block font-mono text-[10px] uppercase tracking-widest text-foreground">Observações (opcional)
              <textarea value={observacoes} onChange={(e) => setObservacoes(e.target.value)} rows={2} className={`${campoCls} w-full mt-2 resize-none`} />
            </label>
            <p className="text-xs text-muted-foreground">
              Registre aqui o pagamento que você já fez ao barbeiro. O sistema não transfere dinheiro. Um valor menor que o
              pendente deixa o restante em aberto.
            </p>
            {erro && <p role="alert" className="text-sm text-destructive">{erro}</p>}
            <div className="flex justify-end gap-3 pt-2">
              <button onClick={onClose} disabled={salvando} className="border border-border px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary">Cancelar</button>
              <button onClick={confirmar} disabled={salvando} className="bg-primary text-primary-foreground px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 disabled:opacity-50">
                {salvando ? "Salvando..." : "Registrar"}
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AdminComissoes;
