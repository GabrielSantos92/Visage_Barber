import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import { TEXTOS_PAINEL, buscarAgendaDoBarbeiro, buscarNaoLidas } from "@/lib/painelBarbeiro";
import type { AgendaDoBarbeiro } from "@/lib/painelBarbeiro";
import VisaoDoDia from "./VisaoDoDia";
import DesempenhoFinanceiro from "./DesempenhoFinanceiro";
import { useAcoesAgendamento } from "./useAcoesAgendamento";

// Painel do Barbeiro (/dashboard): a tela principal do barbeiro, igual a aba
// Painel do app. A. Resumo do dia (com as acoes nos atendimentos de hoje);
// B. Meu desempenho; C. Atendimentos realizados; D. Comissoes e recebimentos.
// A agenda completa (por dia, proximos, historico) fica em /barbeiro/agenda.
export default function PainelBarbeiro() {
  const { user } = useAuth();
  const userId = user?.id;
  const [agenda, setAgenda] = useState<AgendaDoBarbeiro | null>(null);
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Muda para o bloco financeiro recarregar
  const [versao, setVersao] = useState(0);

  const carregarNaoLidas = useCallback(async (barbeiroId: string) => {
    if (!userId) return;
    try { setNaoLidas(await buscarNaoLidas(barbeiroId, userId)); } catch { /* o selo do chat e opcional */ }
  }, [userId]);

  const carregarAgenda = useCallback(async () => {
    if (!userId) return;
    try {
      // So os atendimentos de hoje: o resto fica na Agenda
      const dados = await buscarAgendaDoBarbeiro(userId, new Date());
      setAgenda(dados);
      setErro(null);
      if (dados.barbeiroId) carregarNaoLidas(dados.barbeiroId);
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : TEXTOS_PAINEL.erroAgenda);
    }
    setCarregando(false);
  }, [userId, carregarNaoLidas]);

  useEffect(() => { carregarAgenda(); }, [carregarAgenda]);

  const barbeiroId = agenda?.barbeiroId ?? null;
  const { pedirCancelamento, abrirChat, dialogos } = useAcoesAgendamento({
    barbeiroId,
    // Cancelar ou registrar falta muda a agenda e, se o atendimento ja estava
    // concluido e pago, tambem o financeiro (estorno): recarrega os dois
    onAlterado: () => {
      carregarAgenda();
      setVersao((v) => v + 1);
    },
    onChatFechado: () => { if (barbeiroId) carregarNaoLidas(barbeiroId); },
  });

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-10">
        <div className="border-b border-border pb-6 mb-10">
          <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-2">{TEXTOS_PAINEL.rotulo}</p>
          <h1 className="text-4xl font-light text-primary tracking-tighter">{TEXTOS_PAINEL.titulo}</h1>
        </div>

        {carregando && !agenda ? (
          <div className="flex justify-center py-16"><Loader2 aria-label="Carregando" className="size-6 animate-spin text-primary" /></div>
        ) : !agenda ? (
          <div role="alert" className="border border-destructive/40 p-4 text-sm text-destructive">
            <p>{erro ?? TEXTOS_PAINEL.erroAgenda}</p>
            <button onClick={() => { setCarregando(true); carregarAgenda(); }} className="mt-3 font-mono text-[10px] uppercase tracking-widest underline">
              Tentar novamente
            </button>
          </div>
        ) : !agenda.barbeiroId ? (
          <p className="border border-border p-6 text-sm text-foreground">{TEXTOS_PAINEL.semVinculo}</p>
        ) : (
          <>
            {erro && <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive mb-6">{erro}</p>}
            <VisaoDoDia agendamentos={agenda.agendamentos} naoLidas={naoLidas} onAcao={pedirCancelamento} onChat={abrirChat} />
            <DesempenhoFinanceiro versao={versao} />
          </>
        )}
      </main>

      {dialogos}
    </div>
  );
}
