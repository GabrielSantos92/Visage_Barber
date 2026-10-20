import { useEffect, useState } from "react";
import { AlertCircle, Hourglass } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import type { Tables } from "@/integrations/supabase/types";
import { duracaoTotal, ETAPA_MAX_MIN, pausaAproveitavel, validarEtapas } from "@/lib/etapas";

type Servico = Tables<"servicos">;

interface Props {
  open: boolean;
  // null = criar um novo servico
  servico: Servico | null;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls =
  "w-full bg-background border border-border px-3 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2";

const FieldError = ({ msg }: { msg?: string }) =>
  msg ? (
    <p className="mt-1 text-xs text-destructive flex items-center gap-1">
      <AlertCircle className="size-3" /> {msg}
    </p>
  ) : null;

// "" = nao informado; qualquer outro texto vira numero (NaN se invalido)
const numero = (v: string) => (v.trim() === "" ? null : Number(v.replace(",", ".")));
const texto = (v: number | null | undefined) => (v == null ? "" : String(v));

const ServicoFormDialog = ({ open, servico, onClose, onSaved }: Props) => {
  const editando = !!servico;

  const [nome, setNome] = useState("");
  const [descricao, setDescricao] = useState("");
  const [preco, setPreco] = useState("");
  const [comPausa, setComPausa] = useState(false);
  const [duracao, setDuracao] = useState("");
  const [ativoInicial, setAtivoInicial] = useState("");
  const [pausa, setPausa] = useState("");
  const [ativoFinal, setAtivoFinal] = useState("");
  const [margem, setMargem] = useState("0");
  const [saving, setSaving] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setNome(servico?.nome ?? "");
    setDescricao(servico?.descricao ?? "");
    setPreco(servico ? String(servico.preco) : "");
    setComPausa(servico?.com_pausa ?? false);
    setDuracao(texto(servico?.duracao_min ?? 30));
    setAtivoInicial(texto(servico?.ativo_inicial_min));
    setPausa(texto(servico?.pausa_min));
    setAtivoFinal(texto(servico?.ativo_final_min));
    setMargem(texto(servico?.margem_min ?? 0));
    setErros({});
  }, [open, servico]);

  const limparErro = (campo: string) => setErros((p) => ({ ...p, [campo]: "" }));

  const etapas = { ativoInicial: numero(ativoInicial), pausa: numero(pausa), ativoFinal: numero(ativoFinal), margem: numero(margem) };
  // Com pausa e nenhum tempo informado: o servico fica salvo, mas fora do agendamento
  const etapasPendentes = comPausa && etapas.ativoInicial == null && etapas.pausa == null && etapas.ativoFinal == null;
  const erroEtapas = comPausa && !etapasPendentes ? validarEtapas(etapas) : null;
  const total = comPausa && !etapasPendentes && !erroEtapas
    ? duracaoTotal(etapas.ativoInicial!, etapas.pausa!, etapas.ativoFinal!)
    : null;

  function validar() {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = "Nome é obrigatório";
    const p = numero(preco);
    if (p == null || !Number.isFinite(p) || p < 0) e.preco = "Informe um preço válido";
    if (!comPausa) {
      const d = numero(duracao);
      if (d == null || !Number.isInteger(d) || d < 1 || d > ETAPA_MAX_MIN) e.duracao = `Duração entre 1 e ${ETAPA_MAX_MIN} minutos`;
    } else if (erroEtapas) {
      e.etapas = erroEtapas;
    }
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validar()) return;
    setSaving(true);
    try {
      const base = { nome: nome.trim(), descricao: descricao.trim() || null, preco: numero(preco)! };
      let id = servico?.id;

      // Ordem importa por causa da restricao do banco (duracao = soma das etapas):
      // contínuo -> primeiro limpa as etapas, depois grava a duracao;
      // com pausa -> grava o resto, e as etapas (com a duracao) vao pela funcao.
      if (!comPausa && servico?.com_pausa) {
        const { error } = await supabase.rpc("configurar_etapas_servico", { p_servico_id: servico.id, p_com_pausa: false, p_margem: 0 });
        if (error) throw error;
      }
      const dados = comPausa ? base : { ...base, duracao_min: numero(duracao)! };
      if (id) {
        const { error } = await supabase.from("servicos").update(dados).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("servicos").insert({ ...dados, duracao_min: total ?? numero(duracao) ?? 30 }).select("id").single();
        if (error) throw error;
        id = data.id;
      }

      if (comPausa) {
        const { data: futuros, error } = await supabase.rpc("configurar_etapas_servico", {
          p_servico_id: id!,
          p_com_pausa: true,
          p_ativo_inicial: etapas.ativoInicial,
          p_pausa: etapas.pausa,
          p_ativo_final: etapas.ativoFinal,
          p_margem: etapas.margem ?? 0,
        });
        if (error) throw error;
        if (futuros && futuros > 0) {
          toast.info(`${futuros} agendamento(s) futuro(s) deste serviço mantêm os tempos com que foram marcados.`);
        }
      }

      toast.success(editando ? "Serviço atualizado." : "Serviço criado.");
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Erro ao salvar serviço.");
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={(aberto) => { if (!aberto && !saving) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-xl p-0 gap-0 border-border bg-background sm:rounded-none max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border">
          <DialogTitle className="font-mono text-[10px] tracking-widest text-muted-foreground font-normal uppercase">
            {editando ? "Editar serviço" : "Novo serviço"}
          </DialogTitle>
        </div>

        <form onSubmit={salvar} className="p-6 space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className={labelCls}>Nome *</label>
              <input
                value={nome} onChange={(e) => { setNome(e.target.value); limparErro("nome"); }}
                className={inputCls} placeholder="Ex: Coloração, Tintura, Corte" autoFocus
              />
              <FieldError msg={erros.nome} />
            </div>

            <div className="sm:col-span-2">
              <label className={labelCls}>Descrição</label>
              <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={inputCls} />
            </div>

            <div>
              <label className={labelCls}>Preço (R$) *</label>
              <input
                inputMode="decimal" value={preco} onChange={(e) => { setPreco(e.target.value); limparErro("preco"); }}
                className={inputCls} placeholder="0,00"
              />
              <FieldError msg={erros.preco} />
            </div>

            {!comPausa && (
              <div>
                <label className={labelCls}>Duração (min) *</label>
                <input
                  type="number" min={1} max={ETAPA_MAX_MIN} value={duracao}
                  onChange={(e) => { setDuracao(e.target.value); limparErro("duracao"); }}
                  className={inputCls}
                />
                <FieldError msg={erros.duracao} />
              </div>
            )}
          </div>

          <label className="flex items-start gap-3 border border-border p-4 cursor-pointer">
            <input
              type="checkbox" checked={comPausa}
              onChange={(e) => { setComPausa(e.target.checked); limparErro("etapas"); }}
              className="mt-0.5 accent-primary"
            />
            <span>
              <span className="block text-sm text-primary font-medium">Tem pausa para ação do produto</span>
              <span className="block font-mono text-[10px] text-muted-foreground mt-1">
                Coloração, tintura e afins. Na pausa o barbeiro pode atender outro cliente. Só marque se ele
                realmente puder se afastar durante a ação do produto.
              </span>
            </span>
          </label>

          {comPausa && (
            <div className="border border-border p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className={labelCls}>Atendimento inicial</label>
                  <input type="number" min={1} value={ativoInicial} onChange={(e) => { setAtivoInicial(e.target.value); limparErro("etapas"); }} className={inputCls} placeholder="min" />
                  <p className="mt-1 font-mono text-[9px] text-muted-foreground">Preparação e aplicação · com o cliente</p>
                </div>
                <div>
                  <label className={labelCls}>Pausa</label>
                  <input type="number" min={1} value={pausa} onChange={(e) => { setPausa(e.target.value); limparErro("etapas"); }} className={`${inputCls} border-dashed`} placeholder="min" />
                  <p className="mt-1 font-mono text-[9px] text-muted-foreground">Ação do produto · barbeiro livre</p>
                </div>
                <div>
                  <label className={labelCls}>Atendimento final</label>
                  <input type="number" min={1} value={ativoFinal} onChange={(e) => { setAtivoFinal(e.target.value); limparErro("etapas"); }} className={inputCls} placeholder="min" />
                  <p className="mt-1 font-mono text-[9px] text-muted-foreground">Enxágue e finalização · com o cliente</p>
                </div>
              </div>
              <div className="sm:w-1/3">
                <label className={labelCls}>Margem de segurança</label>
                <input type="number" min={0} value={margem} onChange={(e) => { setMargem(e.target.value); limparErro("etapas"); }} className={inputCls} placeholder="min" />
                <p className="mt-1 font-mono text-[9px] text-muted-foreground">Folga no início e no fim da pausa</p>
              </div>

              <p className="font-mono text-[10px] text-muted-foreground">
                Use os tempos indicados pelo fabricante do produto. O sistema não sugere tempos de ação.
              </p>

              {etapasPendentes ? (
                <p className="flex items-center gap-2 text-xs text-amber-500">
                  <AlertCircle className="size-3.5" /> Sem os tempos, o serviço não aparece para agendamento.
                </p>
              ) : total != null ? (
                <p className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary">
                  <Hourglass className="size-3.5" />
                  Duração total {total} min · {etapas.ativoInicial! + etapas.ativoFinal!} min com o cliente ·{" "}
                  {pausaAproveitavel(etapas.pausa!, etapas.margem ?? 0)} min livres na pausa
                </p>
              ) : null}
              <FieldError msg={erros.etapas || (erroEtapas ?? undefined)} />
            </div>
          )}

          {editando && (
            <p className="font-mono text-[10px] text-muted-foreground">
              Alterar os tempos vale para os próximos agendamentos. Os já marcados mantêm os tempos originais.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="border border-border px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="bg-primary text-primary-foreground px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Salvando..." : editando ? "Salvar alterações" : "Criar serviço"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default ServicoFormDialog;
