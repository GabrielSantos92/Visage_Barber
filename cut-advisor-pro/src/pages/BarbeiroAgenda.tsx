import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar, Clock, User, ChevronLeft, ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import Navbar from "@/components/Navbar";
import type { Enums } from "@/integrations/supabase/types";

type Status = Enums<"agendamento_status">;

type Agendamento = {
  id: string;
  data_hora: string;
  status: Status;
  observacoes: string | null;
  profiles: { nome: string; telefone: string | null } | null;
  servicos: { nome: string; duracao_min: number; preco: number } | null;
};

const statusConfig: Record<Status, { label: string; color: string; next?: Status; nextLabel?: string }> = {
  pendente:   { label: "PENDENTE",   color: "text-yellow-500 border-yellow-500/30", next: "confirmado", nextLabel: "CONFIRMAR" },
  confirmado: { label: "CONFIRMADO", color: "text-green-500 border-green-500/30",   next: "concluido",  nextLabel: "CONCLUIR"  },
  concluido:  { label: "CONCLUÍDO",  color: "text-primary border-primary/30" },
  cancelado:  { label: "CANCELADO",  color: "text-destructive border-destructive/30" },
};

const BarbeiroAgenda = () => {
  const { user } = useAuth();
  const [date, setDate] = useState(startOfDay(new Date()));
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Find barbeiro record linked to this user
  useEffect(() => {
    if (!user) return;
    supabase
      .from("barbeiros")
      .select("id")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setBarbeiroId(data.id);
        else setLoading(false);
      });
  }, [user]);

  useEffect(() => {
    if (!barbeiroId) return;
    setLoading(true);
    const dateStr = format(date, "yyyy-MM-dd");
    supabase
      .from("agendamentos")
      .select(`
        id, data_hora, status, observacoes,
        profiles!agendamentos_cliente_id_fkey(nome, telefone),
        servicos(nome, duracao_min, preco)
      `)
      .eq("barbeiro_id", barbeiroId)
      .gte("data_hora", `${dateStr}T00:00:00`)
      .lte("data_hora", `${dateStr}T23:59:59`)
      .order("data_hora")
      .then(({ data }) => {
        if (data) setAgendamentos(data as any);
        setLoading(false);
      });
  }, [barbeiroId, date]);

  const moveDate = (days: number) => {
    setDate(d => startOfDay(new Date(d.getTime() + days * 86400000)));
  };

  const updateStatus = async (id: string, newStatus: Status) => {
    const { error } = await supabase
      .from("agendamentos")
      .update({ status: newStatus })
      .eq("id", id);

    if (error) {
      toast.error("Erro ao atualizar status");
      return;
    }
    setAgendamentos(prev => prev.map(a => a.id === id ? { ...a, status: newStatus } : a));
    toast.success(`Status atualizado para ${statusConfig[newStatus].label}`);
  };

  const isToday = format(date, "yyyy-MM-dd") === format(new Date(), "yyyy-MM-dd");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="inline-block px-2 py-1 border border-border mb-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
            BARBEIRO // AGENDA
          </span>
        </div>
        <h1 className="text-3xl font-light tracking-tighter text-primary mb-8">
          AGENDA <span className="font-bold italic">DO DIA</span>
        </h1>

        {/* Date navigator */}
        <div className="flex items-center justify-between border border-border p-4 mb-8">
          <button
            onClick={() => moveDate(-1)}
            className="p-2 hover:text-primary transition-colors"
          >
            <ChevronLeft className="size-5" />
          </button>
          <div className="text-center">
            <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
              {isToday ? "HOJE" : format(date, "EEEE", { locale: ptBR }).toUpperCase()}
            </p>
            <p className="text-xl font-bold text-primary">
              {format(date, "dd 'de' MMMM, yyyy", { locale: ptBR })}
            </p>
          </div>
          <button
            onClick={() => moveDate(1)}
            className="p-2 hover:text-primary transition-colors"
          >
            <ChevronRight className="size-5" />
          </button>
        </div>

        {!barbeiroId && !loading ? (
          <div className="text-center py-16 border border-border">
            <p className="text-sm text-foreground">
              Seu usuário não está vinculado a nenhum barbeiro.
            </p>
            <p className="font-mono text-[10px] text-muted-foreground mt-2">
              Peça ao administrador para vincular sua conta.
            </p>
          </div>
        ) : loading ? (
          <div className="text-center py-16">
            <span className="font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</span>
          </div>
        ) : agendamentos.length === 0 ? (
          <div className="text-center py-16 border border-border">
            <Calendar className="size-8 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-foreground">Nenhum agendamento neste dia.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Summary */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              {(["pendente", "confirmado", "concluido"] as Status[]).map((s) => {
                const count = agendamentos.filter(a => a.status === s).length;
                const cfg = statusConfig[s];
                return (
                  <div key={s} className="border border-border p-3 text-center">
                    <p className={`font-mono text-[10px] uppercase tracking-widest ${cfg.color.split(" ")[0]}`}>{cfg.label}</p>
                    <p className="text-2xl font-bold text-primary mt-1">{count}</p>
                  </div>
                );
              })}
            </div>

            {agendamentos.map((a, i) => {
              const cfg = statusConfig[a.status];
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 }}
                  className={`border border-border p-5 ${a.status === "cancelado" ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="size-10 bg-secondary flex items-center justify-center font-bold text-primary text-sm flex-shrink-0">
                        {a.profiles?.nome?.charAt(0) || "?"}
                      </div>
                      <div>
                        <p className="text-sm font-bold text-primary">{a.profiles?.nome || "—"}</p>
                        {a.profiles?.telefone && (
                          <p className="font-mono text-[10px] text-muted-foreground">{a.profiles.telefone}</p>
                        )}
                      </div>
                    </div>
                    <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${cfg.color}`}>
                      {cfg.label}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[10px] text-foreground mb-4">
                    <span className="flex items-center gap-1">
                      <Clock className="size-3" />
                      {format(new Date(a.data_hora), "HH:mm")}
                    </span>
                    <span className="flex items-center gap-1">
                      <User className="size-3" />
                      {a.servicos?.nome}
                    </span>
                    <span>{a.servicos?.duracao_min}min</span>
                    <span className="text-primary font-bold">R$ {Number(a.servicos?.preco).toFixed(2)}</span>
                  </div>

                  {cfg.next && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => updateStatus(a.id, cfg.next!)}
                        className="flex-1 bg-primary text-primary-foreground py-2 font-mono text-[10px] uppercase tracking-widest hover:bg-accent hover:text-accent-foreground transition-colors"
                      >
                        {cfg.nextLabel}
                      </button>
                      {a.status !== "cancelado" && (
                        <button
                          onClick={() => updateStatus(a.id, "cancelado")}
                          className="px-4 py-2 border border-destructive/30 text-destructive font-mono text-[10px] uppercase tracking-widest hover:bg-destructive hover:text-destructive-foreground transition-colors"
                        >
                          CANCELAR
                        </button>
                      )}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
};

export default BarbeiroAgenda;
