import { useEffect, useRef, useState } from "react";
import { MessageCircle, Send, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

// conversas / mensagens nao estao nos types gerados do Supabase
const db = supabase as any;

type Mensagem = {
  id: string;
  conversa_id: string;
  remetente_id: string;
  conteudo: string;
  created_at: string;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** id da tabela barbeiros (nao o user_id) */
  barbeiroId: string;
  /** id do usuario do auth (agendamentos.cliente_id) */
  clienteId: string;
  /** nome exibido no cabecalho: o outro participante da conversa */
  outroNome: string;
};

const ChatDialog = ({ open, onOpenChange, barbeiroId, clienteId, outroNome }: Props) => {
  const { user } = useAuth();
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState("");
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const conversaIdRef = useRef<string | null>(null);
  const fimRef = useRef<HTMLDivElement>(null);

  // Abre (ou cria) a conversa deste par cliente/barbeiro
  useEffect(() => {
    if (!open) return;
    let cancelado = false;
    conversaIdRef.current = null;
    setMensagens([]);
    setLoading(true);

    const init = async () => {
      let { data: conversa } = await db
        .from("conversas")
        .select("id")
        .eq("cliente_id", clienteId)
        .eq("barbeiro_id", barbeiroId)
        .maybeSingle();

      if (!conversa) {
        const { data: nova } = await db
          .from("conversas")
          .insert({ cliente_id: clienteId, barbeiro_id: barbeiroId })
          .select("id")
          .single();
        conversa = nova;
      }

      if (cancelado) return;

      if (!conversa) {
        toast.error("Nao foi possivel abrir a conversa");
        setLoading(false);
        return;
      }

      conversaIdRef.current = conversa.id;
      await buscarMensagens(conversa.id);
      setLoading(false);
    };

    init();
    return () => { cancelado = true; };
  }, [open, barbeiroId, clienteId]);

  // Polling a cada 3s enquanto o chat esta aberto (igual ao app mobile)
  useEffect(() => {
    if (!open) return;
    const interval = setInterval(() => {
      if (conversaIdRef.current) buscarMensagens(conversaIdRef.current);
    }, 3000);
    return () => clearInterval(interval);
  }, [open]);

  useEffect(() => {
    fimRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [mensagens]);

  const buscarMensagens = async (cid: string) => {
    const { data } = await db
      .from("mensagens")
      .select("*")
      .eq("conversa_id", cid)
      .order("created_at", { ascending: true });

    if (data) setMensagens(data as Mensagem[]);

    // Marca como lidas as mensagens recebidas do outro participante
    if (user) {
      await db
        .from("mensagens")
        .update({ lida: true })
        .eq("conversa_id", cid)
        .neq("remetente_id", user.id);
    }
  };

  const enviar = async () => {
    const cid = conversaIdRef.current;
    const conteudo = texto.trim();
    if (!conteudo || !cid || !user || enviando) return;

    setTexto("");
    setEnviando(true);
    const { error } = await db
      .from("mensagens")
      .insert({ conversa_id: cid, remetente_id: user.id, conteudo });

    if (error) {
      toast.error("Erro ao enviar mensagem");
      setTexto(conteudo);
    } else {
      await buscarMensagens(cid);
    }
    setEnviando(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 border-border bg-background [&>button]:hidden">
        {/* Cabecalho */}
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="size-9 bg-secondary flex items-center justify-center font-bold text-primary text-sm">
              {outroNome.charAt(0) || "?"}
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-primary tracking-tight">
                {outroNome}
              </DialogTitle>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                CHAT // DIRETO
              </p>
            </div>
          </div>
          <button
            onClick={() => onOpenChange(false)}
            className="p-1.5 text-muted-foreground hover:text-primary transition-colors"
            aria-label="Fechar conversa"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Mensagens */}
        <div className="h-[380px] overflow-y-auto px-5 py-4 space-y-3">
          {loading ? (
            <div className="h-full flex items-center justify-center">
              <span className="font-mono text-xs text-muted-foreground animate-pulse">
                CARREGANDO...
              </span>
            </div>
          ) : mensagens.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center gap-3 text-center">
              <MessageCircle className="size-8 text-border" />
              <p className="text-sm text-foreground">Nenhuma mensagem ainda</p>
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                Inicie a conversa com {outroNome}
              </p>
            </div>
          ) : (
            mensagens.map((m) => {
              const minha = m.remetente_id === user?.id;
              return (
                <div key={m.id} className={`flex ${minha ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[78%] border p-3 ${
                      minha
                        ? "bg-primary border-primary text-primary-foreground"
                        : "bg-card border-border text-foreground"
                    }`}
                  >
                    <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
                      {m.conteudo}
                    </p>
                    <p
                      className={`font-mono text-[9px] tracking-widest mt-1.5 ${
                        minha ? "text-primary-foreground/60 text-right" : "text-muted-foreground"
                      }`}
                    >
                      {new Date(m.created_at).toLocaleTimeString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={fimRef} />
        </div>

        {/* Envio */}
        <div className="flex items-end gap-2 border-t border-border p-3">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                enviar();
              }
            }}
            placeholder="Digite uma mensagem..."
            maxLength={500}
            rows={1}
            className="flex-1 resize-none bg-card border border-border px-3.5 py-2.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:border-primary max-h-24"
          />
          <button
            onClick={enviar}
            disabled={!texto.trim() || enviando}
            className="size-11 flex items-center justify-center border border-border bg-primary text-primary-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:bg-card disabled:text-muted-foreground disabled:pointer-events-none"
            aria-label="Enviar mensagem"
          >
            <Send className="size-4" />
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ChatDialog;
