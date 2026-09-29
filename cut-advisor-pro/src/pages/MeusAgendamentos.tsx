import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Calendar, Clock, User, X, ArrowLeft, MessageCircle } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import Navbar from "@/components/Navbar";
import ChatDialog from "@/components/ChatDialog";

type Agendamento = {
  id: string;
  data_hora: string;
  status: string;
  barbeiro_id: string;
  barbeiros: { nome: string } | null;
  servicos: { nome: string; preco: number } | null;
};

const statusLabels: Record<string, { label: string; color: string }> = {
  confirmado: { label: "CONFIRMADO", color: "text-green-500 border-green-500/30" },
  cancelado: { label: "CANCELADO", color: "text-destructive border-destructive/30" },
  concluido: { label: "CONCLUÍDO", color: "text-primary border-primary/30" },
};

const MeusAgendamentos = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});
  const [chat, setChat] = useState<{ barbeiroId: string; nome: string } | null>(null);

  useEffect(() => {
    if (!user) return;
    const fetch = async () => {
      // Conclui automaticamente os agendamentos cujo horario ja terminou
      await supabase.rpc("concluir_agendamentos_passados");
      const { data } = await supabase
        .from("agendamentos")
        .select("id, data_hora, status, barbeiro_id, barbeiros(nome), servicos(nome, preco)")
        .eq("cliente_id", user.id)
        .order("data_hora", { ascending: false });
      if (data) setAgendamentos(data as any);
      setLoading(false);
    };
    fetch();
  }, [user]);

  // Mensagens nao lidas por barbeiro (conversas/mensagens nao estao nos types gerados)
  const carregarNaoLidas = async () => {
    if (!user) return;
    const db = supabase as any;
    const { data: conversas } = await db
      .from("conversas")
      .select("id, barbeiro_id")
      .eq("cliente_id", user.id);
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
      if (c) mapa[c.barbeiro_id] = (mapa[c.barbeiro_id] ?? 0) + 1;
    });
    setNaoLidas(mapa);
  };

  useEffect(() => { carregarNaoLidas(); }, [user]);

  const fecharChat = (aberto: boolean) => {
    if (!aberto) {
      setChat(null);
      carregarNaoLidas();
    }
  };

  const handleCancel = async (id: string) => {
    const { error } = await supabase
      .from("agendamentos")
      .update({ status: "cancelado" as any })
      .eq("id", id);

    if (error) {
      toast.error("Erro ao cancelar");
      return;
    }

    setAgendamentos(prev =>
      prev.map(a => a.id === id ? { ...a, status: "cancelado" } : a)
    );
    toast.success("Agendamento cancelado");
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <button onClick={() => navigate("/")} className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-4">
          <ArrowLeft className="size-3" /> Voltar
        </button>
        <div className="inline-block px-2 py-1 border border-border mb-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
            HISTÓRICO // SESSÕES
          </span>
        </div>
        <h1 className="text-3xl font-light tracking-tighter text-primary mb-8">
          MEUS <span className="font-bold italic">AGENDAMENTOS</span>
        </h1>

        {loading ? (
          <div className="text-center py-16">
            <span className="font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</span>
          </div>
        ) : agendamentos.length === 0 ? (
          <div className="text-center py-16 border border-border">
            <Calendar className="size-8 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-foreground mb-4">Nenhum agendamento encontrado</p>
            <button
              onClick={() => navigate("/agendar")}
              className="bg-primary text-primary-foreground px-6 py-2 text-sm font-bold uppercase tracking-widest"
            >
              AGENDAR AGORA
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            {agendamentos.map((a) => {
              const st = statusLabels[a.status] || statusLabels.confirmado;
              const isPast = new Date(a.data_hora) < new Date();
              return (
                <motion.div
                  key={a.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`border border-border p-4 ${a.status === "cancelado" ? "opacity-50" : ""}`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-sm font-bold text-primary">{a.servicos?.nome}</p>
                      <p className="font-mono text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                        <User className="size-3" /> {a.barbeiros?.nome}
                      </p>
                    </div>
                    <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${st.color}`}>
                      {st.label}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4 font-mono text-[10px] text-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="size-3" />
                        {format(new Date(a.data_hora), "dd/MM/yyyy")}
                      </span>
                      <span className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {format(new Date(a.data_hora), "HH:mm")}
                      </span>
                    </div>
                    <div className="flex items-center gap-4">
                      {a.status !== "cancelado" && (
                        <button
                          onClick={() => setChat({ barbeiroId: a.barbeiro_id, nome: a.barbeiros?.nome ?? "Barbeiro" })}
                          className="font-mono text-[10px] uppercase tracking-widest text-primary hover:underline flex items-center gap-1"
                        >
                          <MessageCircle className="size-3" /> Chat
                          {(naoLidas[a.barbeiro_id] ?? 0) > 0 && (
                            <span className="min-w-4 px-1 bg-accent text-accent-foreground text-[9px] font-bold leading-4 text-center">
                              {naoLidas[a.barbeiro_id]}
                            </span>
                          )}
                        </button>
                      )}
                      {!isPast && a.status === "confirmado" && (
                        <button
                          onClick={() => handleCancel(a.id)}
                          className="font-mono text-[10px] uppercase tracking-widest text-destructive hover:underline flex items-center gap-1"
                        >
                          <X className="size-3" /> Cancelar
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>
        )}
      </main>

      {chat && user && (
        <ChatDialog
          open
          onOpenChange={fecharChat}
          barbeiroId={chat.barbeiroId}
          clienteId={user.id}
          outroNome={chat.nome}
        />
      )}
    </div>
  );
};

export default MeusAgendamentos;
