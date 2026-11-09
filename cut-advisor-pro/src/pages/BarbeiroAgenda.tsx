import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import Navbar from "@/components/Navbar";
import CartaoAgendamento from "@/components/barbeiro/CartaoAgendamento";
import { useAcoesAgendamento } from "@/components/barbeiro/useAcoesAgendamento";
import { COR_STATUS } from "@/components/barbeiro/estilos";
import {
  ITENS_SITUACAO, MODOS_AGENDA, TEXTOS_AGENDA, TEXTOS_PAINEL, VAZIO_MODO, buscarAgendaDoBarbeiro, buscarNaoLidas,
  inicioDoDia, listaDoModo, rotuloDoDia, situacaoDe, somarDias,
} from "@/lib/painelBarbeiro";
import type { AgendamentoPainel, ModoAgenda } from "@/lib/painelBarbeiro";

const SUBTITULO: Record<ModoAgenda, string> = { dia: "DO DIA", proximos: "PRÓXIMOS", historico: "HISTÓRICO" };

// Agenda do barbeiro: o gerenciamento completo dos agendamentos, igual a aba
// Agenda do app. Por dia (navegacao por datas), Proximos (lista completa) e
// Historico, com cancelar, registrar falta e chat em cada atendimento.
// O financeiro fica so no Painel (/dashboard).
const BarbeiroAgenda = () => {
  const { user } = useAuth();
  const userId = user?.id;
  const [modo, setModo] = useState<ModoAgenda>("dia");
  const [date, setDate] = useState(() => inicioDoDia(new Date()));
  const [agendamentos, setAgendamentos] = useState<AgendamentoPainel[]>([]);
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);
  const [semVinculo, setSemVinculo] = useState(false);
  const [loading, setLoading] = useState(true);
  const [naoLidas, setNaoLidas] = useState<Record<string, number>>({});

  // Por dia: so o dia escolhido; Proximos e Historico: todos os agendamentos.
  // A busca conclui antes os horarios que ja terminaram.
  useEffect(() => {
    if (!userId) return;
    let ativo = true;
    setLoading(true);
    buscarAgendaDoBarbeiro(userId, modo === "dia" ? date : undefined)
      .then((a) => {
        if (!ativo) return;
        setSemVinculo(!a.barbeiroId);
        setBarbeiroId(a.barbeiroId);
        setAgendamentos(a.agendamentos);
      })
      .catch(() => {
        if (!ativo) return;
        toast.error(TEXTOS_AGENDA.erro);
        setAgendamentos([]);
      })
      .finally(() => { if (ativo) setLoading(false); });
    return () => { ativo = false; };
  }, [userId, modo, date]);

  // Mensagens nao lidas por cliente (mesma consulta do Painel do Barbeiro)
  const carregarNaoLidas = useCallback(async () => {
    if (!barbeiroId || !userId) return;
    setNaoLidas(await buscarNaoLidas(barbeiroId, userId));
  }, [barbeiroId, userId]);

  useEffect(() => { carregarNaoLidas(); }, [carregarNaoLidas, date, modo]);

  // Cancelar, registrar falta e chat: as mesmas acoes do Painel do Barbeiro
  const { pedirCancelamento, abrirChat, dialogos } = useAcoesAgendamento({
    barbeiroId,
    // Mostra o status gravado (ou o real, se ja tinha sido cancelado em outro aparelho)
    onAlterado: (id, status) => {
      if (status) setAgendamentos((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    },
    onChatFechado: carregarNaoLidas,
  });

  const lista = useMemo(() => listaDoModo(modo, agendamentos), [modo, agendamentos]);
  const situacao = situacaoDe(lista);
  const rotulo = rotuloDoDia(date);
  const ehHoje = rotulo.titulo === "Hoje";

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-3xl mx-auto px-6 py-8">
        <div className="inline-block px-2 py-1 border border-border mb-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
            BARBEIRO // AGENDA
          </span>
        </div>
        <h1 className="text-3xl font-light tracking-tighter text-primary mb-6">
          AGENDA <span className="font-bold italic">{SUBTITULO[modo]}</span>
        </h1>

        <div role="tablist" aria-label="Modo da agenda" className="grid grid-cols-3 border border-border mb-6">
          {MODOS_AGENDA.map((m) => (
            <button
              key={m.valor}
              role="tab"
              aria-selected={modo === m.valor}
              onClick={() => setModo(m.valor)}
              className={`py-3 font-mono text-[10px] uppercase tracking-widest transition-colors ${
                modo === m.valor ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-primary"}`}
            >
              {m.rotulo}
            </button>
          ))}
        </div>

        {/* Navegacao por datas (modo Por dia) */}
        {modo === "dia" && (
          <div className="flex items-center justify-between border border-border p-4 mb-8">
            <button
              onClick={() => setDate((d) => somarDias(d, -1))}
              aria-label={TEXTOS_AGENDA.diaAnterior}
              className="p-2 hover:text-primary transition-colors"
            >
              <ChevronLeft className="size-5" />
            </button>
            <div className="text-center">
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {rotulo.titulo.toUpperCase()}
              </p>
              <p className="text-xl font-bold text-primary">{rotulo.data}</p>
              {!ehHoje && (
                <button
                  onClick={() => setDate(inicioDoDia(new Date()))}
                  className="mt-1 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
                >
                  {TEXTOS_AGENDA.irParaHoje}
                </button>
              )}
            </div>
            <button
              onClick={() => setDate((d) => somarDias(d, 1))}
              aria-label={TEXTOS_AGENDA.diaSeguinte}
              className="p-2 hover:text-primary transition-colors"
            >
              <ChevronRight className="size-5" />
            </button>
          </div>
        )}

        {semVinculo && !loading ? (
          <div className="text-center py-16 border border-border">
            <p className="text-sm text-foreground">{TEXTOS_PAINEL.semVinculo}</p>
          </div>
        ) : loading ? (
          <div className="text-center py-16">
            <span className="font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</span>
          </div>
        ) : lista.length === 0 ? (
          <div className="text-center py-16 border border-border">
            <Calendar className="size-8 text-muted-foreground mx-auto mb-4" />
            <p className="text-sm text-foreground">{VAZIO_MODO[modo]}</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Resumo do dia escolhido */}
            {modo === "dia" && (
              <div className="grid grid-cols-3 gap-3 mb-6" aria-label={TEXTOS_AGENDA.situacao}>
                {ITENS_SITUACAO.map(({ chave, rotulo: nome, status }) => (
                  <div key={chave} className="border border-border p-3 text-center" aria-label={`${nome}: ${situacao[chave]}`}>
                    <p className={`font-mono text-[10px] uppercase tracking-widest ${COR_STATUS[status].split(" ")[0]}`}>{nome}</p>
                    <p className="text-2xl font-bold text-primary mt-1">{situacao[chave]}</p>
                  </div>
                ))}
              </div>
            )}

            {lista.map((a, i) => (
              <CartaoAgendamento
                key={a.id}
                agendamento={a}
                todos={agendamentos}
                indice={i}
                naoLidas={naoLidas[a.cliente_id] ?? 0}
                mostrarData={modo !== "dia"}
                onAcao={pedirCancelamento}
                onChat={abrirChat}
              />
            ))}
          </div>
        )}
      </main>

      {dialogos}
    </div>
  );
};

export default BarbeiroAgenda;
