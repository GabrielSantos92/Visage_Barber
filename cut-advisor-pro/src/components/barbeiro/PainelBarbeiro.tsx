import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import { TEXTOS_PAINEL, buscarAgendaDoBarbeiro, buscarAvaliacoes, buscarNaoLidas, buscarProximos } from "@/lib/painelBarbeiro";
import type { AgendaDoBarbeiro, AgendamentoPainel, AvaliacaoPainel } from "@/lib/painelBarbeiro";
import VisaoDoDia from "./VisaoDoDia";
import DesempenhoFinanceiro from "./DesempenhoFinanceiro";
import { AvaliacoesRecentes, ProximosAtendimentos } from "./ProximosEAvaliacoes";
import { useAcoesAgendamento } from "./useAcoesAgendamento";

// Painel do Barbeiro (/dashboard): a tela principal do barbeiro, igual a aba
// Painel do app. Resumo do dia (com as acoes nos atendimentos de hoje), ao
// lado dos proximos atendimentos e das avaliacoes recentes; depois Meu
// desempenho (indicadores, graficos, comissoes e recebimentos do periodo).
// A agenda completa (por dia, proximos, historico) fica em /barbeiro/agenda.
type Carga<T> = { lista: T[] | null; erro: boolean };
export default function PainelBarbeiro() {
  const { user } = useAuth();
  const userId = user?.id;
  const [agenda, setAgenda] = useState<AgendaDoBarbeiro | null>(null);
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  // Muda para o bloco financeiro recarregar
  const [versao, setVersao] = useState(0);
  const [proximos, setProximos] = useState<Carga<AgendamentoPainel>>({ lista: null, erro: false });
  const [avaliacoes, setAvaliacoes] = useState<Carga<AvaliacaoPainel>>({ lista: null, erro: false });

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

  // Proximos e avaliacoes: independentes da agenda de hoje e do financeiro
  // (nenhum espera o outro). As avaliacoes vem uma vez; a nota de cada periodo
  // sai delas, sem nova consulta ao trocar o filtro.
  const carregarProximos = useCallback(async (id: string) => {
    setProximos((p) => ({ lista: p.lista, erro: false }));
    try { setProximos({ lista: await buscarProximos(id), erro: false }); } catch { setProximos({ lista: null, erro: true }); }
  }, []);
  const carregarAvaliacoes = useCallback(async (id: string) => {
    setAvaliacoes((a) => ({ lista: a.lista, erro: false }));
    try { setAvaliacoes({ lista: await buscarAvaliacoes(id), erro: false }); } catch { setAvaliacoes({ lista: null, erro: true }); }
  }, []);
  useEffect(() => {
    if (!barbeiroId) return;
    carregarProximos(barbeiroId);
    carregarAvaliacoes(barbeiroId);
  }, [barbeiroId, carregarProximos, carregarAvaliacoes]);
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
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-8 sm:py-10">
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
            {/* Visao do dia na largura toda; proximos e avaliacoes lado a lado logo
                abaixo (listas curtas, de altura parecida: sem vazio ao lado dos cartoes) */}
            <VisaoDoDia agendamentos={agenda.agendamentos} naoLidas={naoLidas} onAcao={pedirCancelamento} onChat={abrirChat} />
            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              <ProximosAtendimentos lista={proximos.lista} erro={proximos.erro} onTentar={() => carregarProximos(agenda.barbeiroId!)} />
              <AvaliacoesRecentes lista={avaliacoes.lista} erro={avaliacoes.erro} onTentar={() => carregarAvaliacoes(agenda.barbeiroId!)} />
            </div>
            <DesempenhoFinanceiro versao={versao} barbeiroId={agenda.barbeiroId} avaliacoes={avaliacoes.lista} erroAvaliacoes={avaliacoes.erro} />
          </>
        )}
      </main>

      {dialogos}
    </div>
  );
}
