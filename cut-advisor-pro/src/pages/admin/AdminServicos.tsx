import { useEffect, useState } from "react";
import { AlertCircle, Hourglass, Pencil, Plus, Tags, ToggleLeft, ToggleRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import AdminLayout from "@/components/admin/AdminNav";
import ServicoFormDialog from "@/components/admin/ServicoFormDialog";
import type { Tables } from "@/integrations/supabase/types";

type Servico = Tables<"servicos">;

const acaoCls =
  "flex items-center gap-1.5 border border-border px-2.5 py-1.5 font-mono text-[9px] tracking-widest uppercase text-foreground hover:bg-secondary hover:text-primary transition-colors disabled:opacity-50";

const Tempo = ({ s }: { s: Servico }) => {
  if (!s.com_pausa) return <span>{s.duracao_min} min</span>;
  if (s.pausa_min == null) {
    return (
      <span className="flex items-center gap-1.5 text-amber-500">
        <AlertCircle className="size-3" /> Tempos pendentes
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1.5">
      <Hourglass className="size-3 text-accent" />
      {s.ativo_inicial_min} + <span className="text-muted-foreground">{s.pausa_min} pausa</span> + {s.ativo_final_min}
      <span className="text-muted-foreground">= {s.duracao_min} min</span>
      {s.margem_min > 0 && <span className="text-muted-foreground">· margem {s.margem_min}</span>}
    </span>
  );
};

const AdminServicos = () => {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Servico | null>(null);
  const [alternandoId, setAlternandoId] = useState<string | null>(null);

  useEffect(() => { fetchServicos(); }, []);

  async function fetchServicos() {
    setLoading(true);
    const { data, error } = await supabase.from("servicos").select("*").order("nome");
    if (error) setErro(error.message);
    else { setServicos(data ?? []); setErro(null); }
    setLoading(false);
  }

  async function alternarAtivo(s: Servico) {
    setAlternandoId(s.id);
    const { error } = await supabase.from("servicos").update({ ativo: !s.ativo }).eq("id", s.id);
    if (error) toast.error(error.message);
    else setServicos((prev) => prev.map((x) => (x.id === s.id ? { ...x, ativo: !s.ativo } : x)));
    setAlternandoId(null);
  }

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground mb-2">GESTÃO</p>
          <h1 className="text-3xl font-light tracking-tighter text-primary flex items-center gap-3">
            <Tags className="size-6" /> Serviços
          </h1>
        </div>
        <button
          onClick={() => { setEditando(null); setFormAberto(true); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> Novo serviço
        </button>
      </div>

      <div className="border border-border overflow-x-auto">
        {loading ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</div>
        ) : erro ? (
          <div className="py-14 px-6 text-center">
            <AlertCircle className="size-6 text-destructive mx-auto mb-3" />
            <p className="text-sm text-primary mb-1">Não foi possível carregar os serviços.</p>
            <p className="font-mono text-[10px] text-muted-foreground mb-5">{erro}</p>
            <button onClick={fetchServicos} className={`${acaoCls} mx-auto`}>Tentar novamente</button>
          </div>
        ) : servicos.length === 0 ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground">Nenhum serviço cadastrado.</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                <th className="px-6 py-3 font-normal">Serviço</th>
                <th className="px-4 py-3 font-normal">Preço</th>
                <th className="px-4 py-3 font-normal">Tempo</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-6 py-3 font-normal text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {servicos.map((s) => (
                <tr key={s.id} className="hover:bg-card/50 transition-colors">
                  <td className="px-6 py-4">
                    <p className="font-medium text-sm text-primary">{s.nome}</p>
                    {s.descricao && <p className="font-mono text-[10px] text-muted-foreground">{s.descricao}</p>}
                  </td>
                  <td className="px-4 py-4 font-mono text-[11px] text-foreground whitespace-nowrap">
                    R$ {Number(s.preco).toFixed(2).replace(".", ",")}
                  </td>
                  <td className="px-4 py-4 font-mono text-[11px] text-foreground whitespace-nowrap">
                    <Tempo s={s} />
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => alternarAtivo(s)}
                      disabled={alternandoId === s.id}
                      title={s.ativo ? "Inativar serviço" : "Reativar serviço"}
                      className={acaoCls}
                    >
                      {s.ativo
                        ? <><ToggleRight className="size-4 text-primary" /><span className="text-primary">Ativo</span></>
                        : <><ToggleLeft className="size-4 text-muted-foreground" /><span className="text-muted-foreground">Inativo</span></>}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end">
                      <button onClick={() => { setEditando(s); setFormAberto(true); }} className={acaoCls}>
                        <Pencil className="size-3" /> Editar
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <ServicoFormDialog
        open={formAberto}
        servico={editando}
        onClose={() => setFormAberto(false)}
        onSaved={fetchServicos}
      />
    </AdminLayout>
  );
};

export default AdminServicos;
