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
import { linkWhatsAppAgendamento } from "@/lib/whatsapp";

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

// lucide-react nao tem o icone do WhatsApp
const WhatsAppIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

const MeusAgendamentos = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [loading, setLoading] = useState(true);
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});
  const [chat, setChat] = useState<{ barbeiroId: string; nome: string } | null>(null);
  const [telefones, setTelefones] = useState<Record<string, string>>({});

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

      // Telefone do barbeiro (cadastrado pelo admin em profiles.telefone), por barbeiro_id
      const { data: tels } = await (supabase as any).rpc("telefones_barbeiros_do_cliente");
      const mapa: Record<string, string> = {};
      (tels ?? []).forEach((t: any) => { mapa[t.barbeiro_id] = t.telefone; });
      setTelefones(mapa);
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
              const whatsapp = linkWhatsAppAgendamento({
                telefone: telefones[a.barbeiro_id],
                barbeiroNome: a.barbeiros?.nome,
                servicoNome: a.servicos?.nome,
                dataHora: a.data_hora,
              });
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
                      {a.status !== "cancelado" && whatsapp && (
                        <a
                          href={whatsapp}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="font-mono text-[10px] uppercase tracking-widest text-[#25D366] hover:underline flex items-center gap-1"
                        >
                          <WhatsAppIcon className="size-3" /> WhatsApp
                        </a>
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
