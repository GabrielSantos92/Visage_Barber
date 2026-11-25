import { Link } from "react-router-dom";
import { CalendarDays } from "lucide-react";
import { ITENS_SITUACAO, TEXTOS_PAINEL, dataDeHoje, situacaoDe } from "@/lib/painelBarbeiro";
import type { AgendamentoPainel } from "@/lib/painelBarbeiro";
import CartaoAgendamento from "./CartaoAgendamento";
import { COR_TEXTO_STATUS, COR_BARRA } from "./estilos";
import { BarraDividida } from "./graficos";

interface Props {
  // Atendimentos de hoje (todos os status), em ordem de horario
  agendamentos: AgendamentoPainel[];
  naoLidas: Record<string, number>;
  onAcao: (a: AgendamentoPainel) => void;
  onChat: (a: AgendamentoPainel) => void;
}

// Bloco A do Painel do Barbeiro: resumo do dia. Situacao de hoje e os
// atendimentos de hoje, com as acoes em cada cartao. Proximos, historico e a
// navegacao por datas ficam na Agenda.
export default function VisaoDoDia({ agendamentos, naoLidas, onAcao, onChat }: Props) {
  const situacao = situacaoDe(agendamentos);
  // Progresso do dia: concluidos entre os que nao foram cancelados
  const total = agendamentos.length;
  const validos = situacao.aAtender + situacao.concluidos;
  const pctDia = validos > 0 ? Math.round((situacao.concluidos / validos) * 100) : 0;

  return (
    <section aria-labelledby="titulo-visao">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-4">
        <div>
          <h2 id="titulo-visao" className="text-2xl font-light tracking-tighter text-primary">{TEXTOS_PAINEL.visaoDoDia}</h2>
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-1">{dataDeHoje()}</p>
        </div>
        <Link
          to="/barbeiro/agenda"
          className="inline-flex items-center gap-2 border border-primary px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
        >
          <CalendarDays className="size-3" />
          {TEXTOS_PAINEL.abrirAgenda}
        </Link>
      </div>

      <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{TEXTOS_PAINEL.situacao}</h3>
      <div className="border border-border bg-card p-4 mb-6">
        <div className="grid grid-cols-3 gap-3">
          {ITENS_SITUACAO.map(({ chave, rotulo, status }) => (
            <div key={chave} className="border border-border bg-background p-3 text-center" aria-label={`${rotulo}: ${situacao[chave]}`}>
              <p className={`inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest ${COR_TEXTO_STATUS[status]}`}>
                <span aria-hidden className={`size-2 rounded-[2px] ${COR_BARRA[status]}`} />
                {rotulo}
              </p>
              <p className="text-2xl font-bold text-primary mt-1">{situacao[chave]}</p>
            </div>
          ))}
        </div>
        {total > 0 && (
          <div className="mt-4">
            <BarraDividida
              altura="h-2.5"
              rotulo={`Progresso do dia: ${situacao.concluidos} de ${validos} atendimentos concluídos`}
              partes={ITENS_SITUACAO.map(({ chave, rotulo, status }) => ({
                chave, rotulo, valor: situacao[chave], cor: COR_BARRA[status], dica: `${rotulo} · ${situacao[chave]}`,
              }))}
            />
            <p className="mt-2 font-mono text-[10px] text-muted-foreground">
              {validos > 0
                ? `${pctDia}% do dia concluído · ${situacao.concluidos} de ${validos} atendimentos`
                : "Todos os horários de hoje foram cancelados"}
            </p>
          </div>
        )}
      </div>

      <h3 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">{TEXTOS_PAINEL.hoje}</h3>
      {agendamentos.length === 0 ? (
        <p className="border border-border py-12 text-center text-sm text-muted-foreground">{TEXTOS_PAINEL.hojeVazio}</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3" aria-label={TEXTOS_PAINEL.hoje}>
          {agendamentos.map((a, i) => (
            <CartaoAgendamento
              key={a.id}
              agendamento={a}
              todos={agendamentos}
              indice={i}
              naoLidas={naoLidas[a.cliente_id] ?? 0}
              mostrarData
              onAcao={onAcao}
              onChat={onChat}
            />
          ))}
        </div>
      )}
    </section>
  );
}
