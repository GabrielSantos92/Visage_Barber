import { motion } from "framer-motion";
import { Clock, User, MessageCircle, Hourglass } from "lucide-react";
import { etapasDoAgendamento, pausaQueContem, ROTULO_ETAPA } from "@/lib/etapas";
import { exibirTelefone } from "@/lib/telefone";
import { formatarReais } from "@/lib/pagamentos";
import {
  ROTULO_STATUS_AGENDAMENTO, TEXTOS_ACAO, TEXTOS_CANCELAMENTO, acaoDoAgendamento, duracaoDoAgendamento,
  horaDoAgendamento, precoDoAgendamento, quandoDoAgendamento,
} from "@/lib/painelBarbeiro";
import type { AgendamentoPainel } from "@/lib/painelBarbeiro";
import { COR_STATUS } from "./estilos";

interface Props {
  agendamento: AgendamentoPainel;
  // Os demais atendimentos, para mostrar quando este cai na pausa de outro
  todos: AgendamentoPainel[];
  indice?: number;
  naoLidas?: number;
  // No Painel (varios dias) mostra a data; na Agenda do dia, so o horario
  mostrarData?: boolean;
  onAcao: (a: AgendamentoPainel) => void;
  onChat: (a: AgendamentoPainel) => void;
}

const duracaoServico = (a: AgendamentoPainel) => a.servicos?.duracao_min;
const hora = (d: Date) => horaDoAgendamento(d.toISOString());

// Cartao de um atendimento do barbeiro, com as acoes: cancelar ou registrar
// falta (com confirmacao, ver useAcoesAgendamento) e abrir o chat
export default function CartaoAgendamento({ agendamento: a, todos, indice = 0, naoLidas = 0, mostrarData, onAcao, onChat }: Props) {
  const etapas = etapasDoAgendamento(a, duracaoServico(a));
  const comPausa = etapas.length > 1;
  const naPausa = a.status !== "cancelado" ? pausaQueContem(a, todos, duracaoServico) : null;
  const acao = acaoDoAgendamento(a);
  const preco = precoDoAgendamento(a);
  const duracao = duracaoDoAgendamento(a);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(indice, 10) * 0.05 }}
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
              <p className="font-mono text-[10px] text-muted-foreground">{exibirTelefone(a.profiles.telefone)}</p>
            )}
          </div>
        </div>
        <span className={`font-mono text-[10px] uppercase px-2 py-0.5 border ${COR_STATUS[a.status]}`}>
          {ROTULO_STATUS_AGENDAMENTO[a.status].toUpperCase()}
        </span>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 font-mono text-[10px] text-foreground mb-4">
        <span className="flex items-center gap-1">
          <Clock className="size-3" />
          {mostrarData ? quandoDoAgendamento(a.data_hora) : horaDoAgendamento(a.data_hora)}
        </span>
        <span className="flex items-center gap-1">
          <User className="size-3" />
          {a.servicos?.nome}
        </span>
        {duracao != null && <span>{duracao}min</span>}
        {preco != null && <span className="text-primary font-bold">{formatarReais(preco)}</span>}
      </div>

      {/* Coloracao e afins: quando o barbeiro esta com o cliente e quando pode atender outro */}
      {comPausa && (
        <div className="grid grid-cols-3 border border-border mb-4 font-mono text-[10px] uppercase tracking-widest">
          {etapas.map((e) => (
            <div
              key={e.tipo}
              className={
                e.tipo === "pausa"
                  ? "p-2 border-x border-dashed border-border text-muted-foreground"
                  : e.tipo === "finalizacao"
                  ? "p-2 bg-accent/10 text-primary"
                  : "p-2 bg-secondary text-primary"
              }
            >
              <p className="text-[9px] text-muted-foreground">{ROTULO_ETAPA[e.tipo]}</p>
              <p className="font-bold">{hora(e.inicio)}–{hora(e.fim)}</p>
              <p className="text-[9px]">
                {e.tipo === "pausa" ? "Livre p/ outro cliente" : e.tipo === "finalizacao" ? `Retornar às ${hora(e.inicio)}` : "Com o cliente"}
              </p>
            </div>
          ))}
        </div>
      )}

      {naPausa && (
        <p className="flex items-center gap-2 mb-4 font-mono text-[10px] uppercase tracking-widest text-accent">
          <Hourglass className="size-3" />
          Na pausa de {naPausa.agendamento.profiles?.nome ?? "outro cliente"} · retornar às {hora(naPausa.pausa.fim)}
        </p>
      )}

      {/* Concluido acontece sozinho; o barbeiro so cancela ou marca falta */}
      {acao && (
        <button
          onClick={() => onAcao(a)}
          className="px-4 py-2 border border-destructive/30 text-destructive font-mono text-[10px] uppercase tracking-widest hover:bg-destructive hover:text-destructive-foreground transition-colors"
        >
          {TEXTOS_ACAO[acao].botao.toUpperCase()}
        </button>
      )}

      <button
        onClick={() => onChat(a)}
        className="mt-3 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline"
      >
        <MessageCircle className="size-3" />
        {TEXTOS_CANCELAMENTO.chat.toUpperCase()}
        {naoLidas > 0 && (
          <span className="min-w-4 px-1 bg-accent text-accent-foreground text-[9px] font-bold leading-4 text-center">
            {naoLidas}
          </span>
        )}
      </button>
    </motion.div>
  );
}
