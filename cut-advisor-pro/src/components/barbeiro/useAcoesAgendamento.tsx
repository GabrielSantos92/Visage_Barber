import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import ChatDialog from "@/components/ChatDialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { TEXTOS_ACAO, TEXTOS_CANCELAMENTO, acaoDoAgendamento, cancelarAgendamento, dataHoraCurta } from "@/lib/painelBarbeiro";
import type { AgendamentoPainel, StatusAgendamento } from "@/lib/painelBarbeiro";

interface Opcoes {
  barbeiroId: string | null;
  // Depois de cancelar (ou de descobrir o status real no banco): a tela atualiza seus dados
  onAlterado: (id: string, status: StatusAgendamento | null) => void;
  // O chat fechou: a tela recarrega as mensagens nao lidas
  onChatFechado?: () => void;
}

// Acoes do barbeiro nos atendimentos, as mesmas na Agenda e no Painel:
// cancelar ou registrar falta (sempre com confirmacao) e abrir o chat.
// A regra e a gravacao ficam em lib/painelBarbeiro (iguais as do app).
export function useAcoesAgendamento({ barbeiroId, onAlterado, onChatFechado }: Opcoes) {
  // Agendamento aguardando confirmacao de cancelamento no Popup
  const [cancelando, setCancelando] = useState<AgendamentoPainel | null>(null);
  const [processando, setProcessando] = useState(false);
  const [chat, setChat] = useState<{ clienteId: string; nome: string } | null>(null);

  const textos = TEXTOS_ACAO[(cancelando && acaoDoAgendamento(cancelando)) || "cancelar"];

  const confirmar = async () => {
    if (!cancelando || processando) return;
    const alvo = cancelando;
    const sucesso = TEXTOS_ACAO[acaoDoAgendamento(alvo) || "cancelar"].sucesso;
    setProcessando(true);
    const r = await cancelarAgendamento(alvo.id);
    setProcessando(false);
    // Em erro o Popup fica aberto para tentar de novo ou voltar
    if (r.resultado === "erro") {
      toast.error(TEXTOS_CANCELAMENTO.erro);
      return;
    }
    setCancelando(null);
    if (r.resultado === "ok") toast.success(sucesso);
    else toast.error(TEXTOS_CANCELAMENTO.inalterado);
    onAlterado(alvo.id, r.status);
  };

  const dialogos: ReactNode = (
    <>
      {chat && barbeiroId && (
        <ChatDialog
          open
          onOpenChange={(aberto) => {
            if (!aberto) {
              setChat(null);
              onChatFechado?.();
            }
          }}
          barbeiroId={barbeiroId}
          clienteId={chat.clienteId}
          outroNome={chat.nome}
        />
      )}

      {/* Confirmacao antes de cancelar: nada muda sem o clique em confirmar */}
      <AlertDialog open={!!cancelando} onOpenChange={(aberto) => { if (!aberto && !processando) setCancelando(null); }}>
        <AlertDialogContent className="border-border bg-background sm:rounded-none max-w-[calc(100%-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-primary">{textos.titulo}</AlertDialogTitle>
            <AlertDialogDescription>{textos.mensagem}</AlertDialogDescription>
          </AlertDialogHeader>
          {cancelando && (
            <div className="border border-border px-4 py-3 font-mono text-[10px] uppercase tracking-widest text-foreground">
              <p className="text-primary">{cancelando.profiles?.nome ?? "Cliente"}</p>
              <p className="mt-1">
                {dataHoraCurta(cancelando.data_hora)}
                {cancelando.servicos?.nome ? ` · ${cancelando.servicos.nome}` : ""}
              </p>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={processando} className="rounded-none font-mono text-[10px] tracking-widest uppercase">
              {TEXTOS_CANCELAMENTO.voltar}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={processando}
              onClick={(e) => { e.preventDefault(); confirmar(); }}
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-[10px] tracking-widest uppercase"
            >
              {processando && <Loader2 className="size-3 mr-2 animate-spin" />}
              {processando ? TEXTOS_CANCELAMENTO.processando : textos.confirmar}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );

  return {
    pedirCancelamento: (a: AgendamentoPainel) => setCancelando(a),
    abrirChat: (a: AgendamentoPainel) => setChat({ clienteId: a.cliente_id, nome: a.profiles?.nome ?? "Cliente" }),
    dialogos,
  };
}
