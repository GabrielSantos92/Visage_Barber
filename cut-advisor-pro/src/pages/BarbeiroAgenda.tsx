import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfDay, endOfDay } from "date-fns";
import { ptBR } from "date-fns/locale";
import { Calendar, Clock, User, ChevronLeft, ChevronRight, MessageCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import Navbar from "@/components/Navbar";
import ChatDialog from "@/components/ChatDialog";
import type { Enums } from "@/integrations/supabase/types";

type Status = Enums<"agendamento_status">;

type Agendamento = {
  id: string;
  data_hora: string;
  status: Status;
  observacoes: string | null;
  cliente_id: string;
  profiles: { nome: string; telefone: string | null } | null;
  servicos: { nome: string; duracao_min: number; preco: number } | null;
};

const statusConfig: Record<Status, { label: string; color: string }> = {
  confirmado: { label: "CONFIRMADO", color: "text-green-500 border-green-500/30" },
  concluido:  { label: "CONCLUÍDO",  color: "text-primary border-primary/30" },
  cancelado:  { label: "CANCELADO",  color: "text-destructive border-destructive/30" },
};

const BarbeiroAgenda = () => {
  const { user } = useAuth();
  const [date, setDate] = useState(startOfDay(new Date()));
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});
  const [chat, setChat] = useState<{ clienteId: string; nome: string } | null>(null);

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

    const load = async () => {
      // Conclui automaticamente os agendamentos cujo horario ja terminou
      await supabase.rpc("concluir_agendamentos_passados");
      const { data, error } = await supabase
        .from("agendamentos")
        .select("id, data_hora, status, observacoes, cliente_id, servicos(nome, duracao_min, preco)")
        .eq("barbeiro_id", barbeiroId)
        .gte("data_hora", startOfDay(date).toISOString())
        .lte("data_hora", endOfDay(date).toISOString())
        .order("data_hora");

      if (error) {
        toast.error("Erro ao carregar a agenda");
        setAgendamentos([]);
        setLoading(false);
        return;
      }

      // cliente_id referencia auth.users; em profiles a coluna equivalente e user_id
      // (profiles.id e uma PK propria), por isso os perfis vem em consulta separada.
      const ids = [...new Set((data ?? []).map((a: any) => a.cliente_id).filter(Boolean))];
      const perfis: Record<string, { nome: string; telefone: string | null }> = {};
      if (ids.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("user_id, nome, telefone")
          .in("user_id", ids);
        (profs ?? []).forEach((pr: any) => { perfis[pr.user_id] = { nome: pr.nome, telefone: pr.telefone }; });
      }

      setAgendamentos(
        (data ?? []).map((a: any) => ({ ...a, profiles: perfis[a.cliente_id] ?? null })) as Agendamento[]
      );
      setLoading(false);
    };

    load();
  }, [barbeiroId, date]);

  // Mensagens nao lidas por cliente (conversas/mensagens nao estao nos types gerados)
  const carregarNaoLidas = async () => {
    if (!barbeiroId || !user) return;
    const db = supabase as any;
    const { data: conversas } = await db
      .from("conversas")
      .select("id, cliente_id")
      .eq("barbeiro_id", barbeiroId);
    if (!conversas?.length) {
      setNaoLidas({});
      return;
    }
    const { data: msgs } = await db
      .from("mensagens")
      .select("conversa_id")
      .in("conversa_id", conversas.map((c: any) => c.id))
      .eq("lida", false)
      .neq("remetente_id", user.id);
    const mapa: Record<string, number> = {};
    (msgs ?? []).forEach((m: any) => {
      const c = conversas.find((c: any) => c.id === m.conversa_id);
      if (c) mapa[c.cliente_id] = (mapa[c.cliente_id] ?? 0) + 1;
    });
    setNaoLidas(mapa);
  };

  useEffect(() => { carregarNaoLidas(); }, [barbeiroId, date]);

  const fecharChat = (aberto: boolean) => {
    if (!aberto) {
      setChat(null);
      carregarNaoLidas();
    }
  };

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
              {(["confirmado", "concluido", "cancelado"] as Status[]).map((s) => {
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

                  {/* Concluido acontece sozinho; o barbeiro so cancela ou marca falta */}
                  {a.status !== "cancelado" && (
                    <button
                      onClick={() => updateStatus(a.id, "cancelado")}
                      className="px-4 py-2 border border-destructive/30 text-destructive font-mono text-[10px] uppercase tracking-widest hover:bg-destructive hover:text-destructive-foreground transition-colors"
                    >
                      {a.status === "concluido" || new Date(a.data_hora) <= new Date() ? "CLIENTE FALTOU" : "CANCELAR"}
                    </button>
                  )}

                  <button
                    onClick={() => setChat({ clienteId: a.cliente_id, nome: a.profiles?.nome ?? "Cliente" })}
                    className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
                  >
                    <MessageCircle className="size-3" />
                    CHAT
                    {(naoLidas[a.cliente_id] ?? 0) > 0 && (
                      <span className="min-w-4 px-1 bg-accent text-accent-foreground text-[9px] font-bold leading-4 text-center">
                        {naoLidas[a.cliente_id]}
                      </span>
                    )}
                  </button>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      {chat && barbeiroId && (
        <ChatDialog
          open
          onOpenChange={fecharChat}
          barbeiroId={barbeiroId}
          clienteId={chat.clienteId}
          outroNome={chat.nome}
        />
      )}
    </div>
  );
};

export default BarbeiroAgenda;
