import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Calendar, CheckCircle2, List, Pencil, Plus, Scissors, Search, ToggleLeft, ToggleRight, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import AdminLayout from "@/components/admin/AdminNav";
import BarbeiroFormDialog from "@/components/admin/BarbeiroFormDialog";
import BarbeiroServicosDialog from "@/components/admin/BarbeiroServicosDialog";
import BarbeiroAgendaDialog from "@/components/admin/BarbeiroAgendaDialog";
import { apiDelete } from "@/lib/api";
import type { Tables } from "@/integrations/supabase/types";

type Barbeiro = Tables<"barbeiros">;
type Filtro = "todos" | "ativos" | "inativos";

const filtros: { valor: Filtro; label: string }[] = [
  { valor: "todos", label: "Todos" },
  { valor: "ativos", label: "Ativos" },
  { valor: "inativos", label: "Inativos" },
];

const MSG_TEM_AGENDAMENTOS =
  "Não é possível excluir este barbeiro, pois existem agendamentos vinculados a ele. " +
  "Para preservar o histórico dos atendimentos, a exclusão não pode ser realizada.";

const acaoCls =
  "flex items-center gap-1.5 border border-border px-2.5 py-1.5 font-mono text-[9px] tracking-widest uppercase text-foreground hover:bg-secondary hover:text-primary transition-colors disabled:opacity-50";

const AdminBarbeiros = () => {
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  // Telefone informado no cadastro (profiles.telefone), por user_id
  const [telefones, setTelefones] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  const [busca, setBusca] = useState("");
  const [filtro, setFiltro] = useState<Filtro>("todos");

  const [formAberto, setFormAberto] = useState(false);
  const [editando, setEditando] = useState<Barbeiro | null>(null);
  const [servicosDe, setServicosDe] = useState<Barbeiro | null>(null);
  const [agendaDe, setAgendaDe] = useState<Barbeiro | null>(null);
  const [inativando, setInativando] = useState<Barbeiro | null>(null);
  const [alternandoId, setAlternandoId] = useState<string | null>(null);
  const [excluindo, setExcluindo] = useState<Barbeiro | null>(null);
  const [excluindoId, setExcluindoId] = useState<string | null>(null);

  useEffect(() => { fetchBarbeiros(); }, []);

  async function fetchBarbeiros() {
    setLoading(true);
    const { data, error } = await supabase.from("barbeiros").select("*").order("nome");
    if (error) {
      setErro(error.message);
      setLoading(false);
      return;
    }
    setErro(null);
    setBarbeiros(data ?? []);

    const userIds = (data ?? []).map((b) => b.user_id).filter((id): id is string => !!id);
    if (userIds.length > 0) {
      const { data: perfis } = await supabase.from("profiles").select("user_id, telefone").in("user_id", userIds);
      const mapa: Record<string, string> = {};
      (perfis ?? []).forEach((p) => { if (p.telefone) mapa[p.user_id] = p.telefone; });
      setTelefones(mapa);
    } else {
      setTelefones({});
    }
    setLoading(false);
  }

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    return barbeiros.filter((b) => {
      if (filtro === "ativos" && !b.ativo) return false;
      if (filtro === "inativos" && b.ativo) return false;
      if (!termo) return true;
      const telefone = b.user_id ? telefones[b.user_id] ?? "" : "";
      return [b.nome, b.especialidade ?? "", telefone].some((v) => v.toLowerCase().includes(termo));
    });
  }, [barbeiros, telefones, busca, filtro]);

  async function definirAtivo(b: Barbeiro, ativo: boolean) {
    setAlternandoId(b.id);
    const { error } = await supabase.from("barbeiros").update({ ativo }).eq("id", b.id);
    setAlternandoId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(ativo ? `${b.nome} foi reativado.` : `${b.nome} foi inativado.`);
    fetchBarbeiros();
  }

  // Mesma regra do admin mobile: nao inativa quem tem agendamento futuro confirmado
  async function alternarAtivo(b: Barbeiro) {
    if (!b.ativo) { definirAtivo(b, true); return; }

    setAlternandoId(b.id);
    const { data: abertos, error } = await supabase
      .from("agendamentos")
      .select("id")
      .eq("barbeiro_id", b.id)
      .eq("status", "confirmado")
      .gte("data_hora", new Date().toISOString());
    setAlternandoId(null);

    if (error) { toast.error(error.message); return; }
    if (abertos && abertos.length > 0) {
      toast.error("Não é possível inativar", {
        description: `${b.nome} tem ${abertos.length} agendamento(s) em aberto. Cancele-os antes de inativar.`,
      });
      return;
    }
    setInativando(b);
  }

  const avisarBloqueio = () => toast.error("Exclusão não permitida", { description: MSG_TEM_AGENDAMENTOS, duration: 10000 });

  // Com qualquer agendamento (em qualquer status) a exclusao nem chega a ser oferecida.
  // Esta consulta so decide o que mostrar; quem aplica a regra e o backend.
  async function pedirExclusao(b: Barbeiro) {
    setExcluindoId(b.id);
    const { data, error } = await supabase.from("agendamentos").select("id").eq("barbeiro_id", b.id).limit(1);
    setExcluindoId(null);
    if (error) { toast.error(error.message); return; }
    if (data && data.length > 0) { avisarBloqueio(); return; }
    setExcluindo(b);
  }

  async function excluir(b: Barbeiro) {
    setExcluindoId(b.id);
    try {
      await apiDelete(`/api/admin/barbeiros/${b.id}`);
      toast.success("Barbeiro excluído com sucesso.");
      fetchBarbeiros();
    } catch (e) {
      const err = e as { message?: string; code?: string };
      if (err.code === "BARBER_HAS_APPOINTMENTS") avisarBloqueio();
      else toast.error(err.message ?? "Erro ao excluir barbeiro.");
      // 404: outro admin ja excluiu; a lista e recarregada para refletir
      if (err.code === "BARBER_NOT_FOUND") fetchBarbeiros();
    }
    setExcluindoId(null);
  }

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground mb-2">GESTÃO</p>
          <h1 className="text-3xl font-light tracking-tighter text-primary flex items-center gap-3">
            <Scissors className="size-6" /> Barbeiros
          </h1>
        </div>
        <button
          onClick={() => { setEditando(null); setFormAberto(true); }}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity"
        >
          <Plus className="size-3.5" /> Novo barbeiro
        </button>
      </div>

      {/* Busca e filtro */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-56">
          <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por nome, especialidade ou telefone"
            aria-label="Buscar barbeiros"
            className="w-full bg-background border border-border pl-9 pr-3 py-2.5 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
          />
        </div>
        <div className="flex border border-border">
          {filtros.map((f) => (
            <button
              key={f.valor}
              onClick={() => setFiltro(f.valor)}
              aria-pressed={filtro === f.valor}
              className={`px-3 py-2.5 font-mono text-[10px] tracking-widest uppercase transition-colors ${
                filtro === f.valor ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="border border-border overflow-x-auto">
        {loading ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</div>
        ) : erro ? (
          <div className="py-14 px-6 text-center">
            <AlertCircle className="size-6 text-destructive mx-auto mb-3" />
            <p className="text-sm text-primary mb-1">Não foi possível carregar os barbeiros.</p>
            <p className="font-mono text-[10px] text-muted-foreground mb-5">{erro}</p>
            <button onClick={fetchBarbeiros} className={`${acaoCls} mx-auto`}>Tentar novamente</button>
          </div>
        ) : barbeiros.length === 0 ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground">Nenhum barbeiro cadastrado.</div>
        ) : visiveis.length === 0 ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground">Nenhum barbeiro encontrado para essa busca.</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                <th className="px-6 py-3 font-normal">Barbeiro</th>
                <th className="px-4 py-3 font-normal">Telefone</th>
                <th className="px-4 py-3 font-normal">Acesso</th>
                <th className="px-4 py-3 font-normal">Status</th>
                <th className="px-6 py-3 font-normal text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visiveis.map((b) => (
                <tr key={b.id} className="hover:bg-card/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="size-9 border border-border bg-card flex items-center justify-center shrink-0 overflow-hidden">
                        {b.foto_url
                          ? <img src={b.foto_url} alt="" className="size-full object-cover" />
                          : <span className="font-mono text-sm text-primary">{(b.nome[0] ?? "?").toUpperCase()}</span>}
                      </div>
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-primary truncate">{b.nome}</p>
                        <p className="font-mono text-[10px] text-muted-foreground">{b.especialidade ?? "Sem especialidade"}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-[11px] text-foreground whitespace-nowrap">
                    {(b.user_id && telefones[b.user_id]) || <span className="text-muted-foreground">Sem telefone</span>}
                  </td>
                  <td className="px-4 py-4">
                    <span className="flex items-center gap-1.5 font-mono text-[9px] text-muted-foreground whitespace-nowrap">
                      {b.user_id
                        ? <><CheckCircle2 className="size-3 text-green-500" /> COM ACESSO</>
                        : <><AlertCircle className="size-3 text-amber-500" /> SEM ACESSO</>}
                    </span>
                  </td>
                  <td className="px-4 py-4">
                    <button
                      onClick={() => alternarAtivo(b)}
                      disabled={alternandoId === b.id}
                      title={b.ativo ? "Inativar barbeiro" : "Reativar barbeiro"}
                      className={acaoCls}
                    >
                      {b.ativo
                        ? <><ToggleRight className="size-4 text-primary" /><span className="text-primary">Ativo</span></>
                        : <><ToggleLeft className="size-4 text-muted-foreground" /><span className="text-muted-foreground">Inativo</span></>}
                    </button>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => setAgendaDe(b)} className={acaoCls}><Calendar className="size-3" /> Agenda</button>
                      <button onClick={() => setServicosDe(b)} className={acaoCls}><List className="size-3" /> Serviços</button>
                      <button onClick={() => { setEditando(b); setFormAberto(true); }} className={acaoCls}><Pencil className="size-3" /> Editar</button>
                      <button
                        onClick={() => pedirExclusao(b)}
                        disabled={excluindoId === b.id}
                        className={`${acaoCls} hover:text-destructive hover:border-destructive/40`}
                      >
                        <Trash2 className="size-3" /> {excluindoId === b.id ? "Aguarde..." : "Excluir"}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !erro && barbeiros.length > 0 && (
        <p className="font-mono text-[10px] text-muted-foreground mt-3">
          {visiveis.length} de {barbeiros.length} barbeiro(s)
        </p>
      )}

      <BarbeiroFormDialog
        open={formAberto}
        barbeiro={editando}
        onClose={() => setFormAberto(false)}
        onSaved={fetchBarbeiros}
      />
      <BarbeiroServicosDialog barbeiro={servicosDe} onClose={() => setServicosDe(null)} />
      <BarbeiroAgendaDialog barbeiro={agendaDe} onClose={() => setAgendaDe(null)} />

      <AlertDialog open={!!inativando} onOpenChange={(aberto) => { if (!aberto) setInativando(null); }}>
        <AlertDialogContent className="border-border bg-background sm:rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-primary">Inativar barbeiro</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja inativar {inativando?.nome}? Ele deixa de aparecer para os clientes no agendamento. Você pode reativá-lo depois.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none font-mono text-[10px] tracking-widest uppercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (inativando) definirAtivo(inativando, false); }}
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-[10px] tracking-widest uppercase"
            >
              Inativar
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!excluindo} onOpenChange={(aberto) => { if (!aberto) setExcluindo(null); }}>
        <AlertDialogContent className="border-border bg-background sm:rounded-none">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-primary">Excluir barbeiro</AlertDialogTitle>
            <AlertDialogDescription>
              Deseja excluir {excluindo?.nome}? Esta ação é permanente: o cadastro, a agenda, os serviços vinculados
              e o acesso do barbeiro ao sistema serão removidos e não poderão ser recuperados.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-none font-mono text-[10px] tracking-widest uppercase">Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (excluindo) excluir(excluindo); }}
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-[10px] tracking-widest uppercase"
            >
              Excluir definitivamente
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AdminLayout>
  );
};

export default AdminBarbeiros;
