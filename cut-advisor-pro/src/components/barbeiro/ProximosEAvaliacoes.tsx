import { Link } from "react-router-dom";
import { ArrowRight, Star } from "lucide-react";
import {
  AVALIACOES_RECENTES, TEXTOS_INDICADORES, horaDoAgendamento, notaComVirgula, quandoDoAgendamento, resumoAvaliacoes,
} from "@/lib/painelBarbeiro";
import type { AgendamentoPainel, AvaliacaoPainel } from "@/lib/painelBarbeiro";
import { Erro, Esqueleto, Painel } from "./graficos";

// Proximos atendimentos (a partir de amanha, no maximo cinco) e avaliacoes
// recentes. Listas curtas, so leitura: a Agenda continua com tudo.

export function ProximosAtendimentos({ lista, erro, onTentar }: { lista: AgendamentoPainel[] | null; erro: boolean; onTentar: () => void }) {
  return (
    <Painel
      titulo={TEXTOS_INDICADORES.proximos}
      acao={(
        <Link to="/barbeiro/agenda" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-primary underline-offset-4 hover:underline">
          {TEXTOS_INDICADORES.verAgenda} <ArrowRight aria-hidden className="size-3" />
        </Link>
      )}
    >
      {erro ? (
        <Erro mensagem={TEXTOS_INDICADORES.erroProximos} onTentar={onTentar} />
      ) : !lista ? (
        <Esqueleto altura="h-32" />
      ) : !lista.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{TEXTOS_INDICADORES.proximosVazio}</p>
      ) : (
        <ul className="divide-y divide-border">
          {lista.map((a) => (
            <li key={a.id} className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
              <span className="w-[4.5rem] shrink-0 text-center">
                <span className="block whitespace-nowrap font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{quandoDoAgendamento(a.data_hora).split(" · ")[0]}</span>
                <span className="block text-base font-bold text-primary">{horaDoAgendamento(a.data_hora)}</span>
              </span>
              <span className="min-w-0 border-l border-border pl-3">
                <span className="block truncate text-sm text-primary">{a.profiles?.nome ?? "Cliente"}</span>
                <span className="block truncate text-xs text-muted-foreground">{a.servicos?.nome ?? ""}</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  );
}

const Estrelas = ({ nota }: { nota: number }) => (
  <span className="inline-flex gap-0.5" role="img" aria-label={`Nota ${nota} de 5`}>
    {[1, 2, 3, 4, 5].map((n) => (
      <Star key={n} aria-hidden className={`size-3 ${n <= nota ? "fill-accent text-accent" : "text-foreground/25"}`} />
    ))}
  </span>
);

export function AvaliacoesRecentes({ lista, erro, onTentar }: { lista: AvaliacaoPainel[] | null; erro: boolean; onTentar: () => void }) {
  const geral = lista ? resumoAvaliacoes(lista) : null;
  return (
    <Painel
      titulo={TEXTOS_INDICADORES.avaliacoes}
      acao={geral?.media != null ? (
        <span className="text-right">
          <span className="block text-lg font-bold leading-none text-primary">{notaComVirgula(geral.media)} ★</span>
          <span className="font-mono text-[9px] text-muted-foreground">{geral.total} no total</span>
        </span>
      ) : undefined}
    >
      {erro ? (
        <Erro mensagem={TEXTOS_INDICADORES.erroAvaliacoes} onTentar={onTentar} />
      ) : !lista ? (
        <Esqueleto altura="h-32" />
      ) : !lista.length ? (
        <p className="py-6 text-center text-sm text-muted-foreground">{TEXTOS_INDICADORES.avaliacoesVazio}</p>
      ) : (
        <ul className="divide-y divide-border">
          {lista.slice(0, AVALIACOES_RECENTES).map((a) => (
            <li key={a.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-center justify-between gap-2">
                <Estrelas nota={a.nota} />
                <span className="font-mono text-[9px] text-muted-foreground">{new Date(a.created_at).toLocaleDateString("pt-BR")}</span>
              </div>
              {a.comentario && <p className="mt-1 line-clamp-2 text-sm text-foreground">“{a.comentario}”</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">{a.cliente ?? "Cliente"}</p>
            </li>
          ))}
        </ul>
      )}
    </Painel>
  );
}
