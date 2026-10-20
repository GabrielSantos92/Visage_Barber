import { useEffect, useState } from "react";
import { CheckSquare, Square } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

interface Servico {
  id: string;
  nome: string;
  preco: number;
  duracao_min: number;
}

interface Props {
  barbeiro: { id: string; nome: string } | null;
  onClose: () => void;
}

// Vincula/desvincula servicos do barbeiro (tabela barbeiro_servicos).
// Cada clique grava na hora, como no admin mobile.
const BarbeiroServicosDialog = ({ barbeiro, onClose }: Props) => {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [vinculados, setVinculados] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [alternandoId, setAlternandoId] = useState<string | null>(null);

  async function carregar(barbeiroId: string) {
    setLoading(true); setErro(null);
    const [svRes, bsRes] = await Promise.all([
      supabase.from("servicos").select("id, nome, preco, duracao_min").order("nome"),
      supabase.from("barbeiro_servicos").select("servico_id").eq("barbeiro_id", barbeiroId),
    ]);
    if (svRes.error || bsRes.error) {
      setErro((svRes.error ?? bsRes.error)!.message);
    } else {
      setServicos(svRes.data ?? []);
      setVinculados(new Set((bsRes.data ?? []).map((r) => r.servico_id)));
    }
    setLoading(false);
  }

  useEffect(() => {
    if (barbeiro) carregar(barbeiro.id);
  }, [barbeiro?.id]);

  async function alternar(servicoId: string) {
    if (!barbeiro || alternandoId) return;
    setAlternandoId(servicoId);
    const jaVinculado = vinculados.has(servicoId);

    const { error } = jaVinculado
      ? await supabase.from("barbeiro_servicos").delete().eq("barbeiro_id", barbeiro.id).eq("servico_id", servicoId)
      : await supabase.from("barbeiro_servicos").insert({ barbeiro_id: barbeiro.id, servico_id: servicoId });

    if (error) {
      toast.error(error.message);
    } else {
      setVinculados((prev) => {
        const next = new Set(prev);
        if (jaVinculado) next.delete(servicoId); else next.add(servicoId);
        return next;
      });
    }
    setAlternandoId(null);
  }

  return (
    <Dialog open={!!barbeiro} onOpenChange={(aberto) => { if (!aberto) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-lg p-0 gap-0 border-border bg-background sm:rounded-none">
        <div className="px-6 py-4 border-b border-border">
          <DialogTitle className="font-mono text-[10px] tracking-widest text-muted-foreground font-normal uppercase">
            Serviços — {barbeiro?.nome}
          </DialogTitle>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</div>
          ) : erro ? (
            <div className="py-10 px-6 text-center">
              <p className="text-sm text-destructive mb-4">{erro}</p>
              <button
                onClick={() => barbeiro && carregar(barbeiro.id)}
                className="border border-border px-4 py-2 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          ) : servicos.length === 0 ? (
            <div className="py-12 px-6 text-center text-sm text-muted-foreground">Nenhum serviço cadastrado no sistema.</div>
          ) : (
            <div className="divide-y divide-border">
              {servicos.map((sv) => {
                const ativo = vinculados.has(sv.id);
                return (
                  <button
                    key={sv.id}
                    onClick={() => alternar(sv.id)}
                    disabled={alternandoId !== null}
                    role="checkbox"
                    aria-checked={ativo}
                    className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-card/50 transition-colors disabled:opacity-60"
                  >
                    {ativo ? <CheckSquare className="size-4 text-accent shrink-0" /> : <Square className="size-4 text-muted-foreground shrink-0" />}
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{sv.nome}</p>
                      <p className="font-mono text-[10px] text-muted-foreground">
                        R$ {Number(sv.preco).toFixed(2).replace(".", ",")} · {sv.duracao_min} min
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-border">
          <p className="font-mono text-[10px] text-muted-foreground">
            {!loading && !erro ? `${vinculados.size} de ${servicos.length} vinculados` : ""}
          </p>
          <button
            onClick={onClose}
            className="bg-primary text-primary-foreground px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity"
          >
            Concluir
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BarbeiroServicosDialog;
