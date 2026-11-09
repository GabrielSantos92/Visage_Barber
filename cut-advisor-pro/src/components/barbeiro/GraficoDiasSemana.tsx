import { DIAS_SEMANA, TEXTOS_PAINEL, resumoDiasSemana, rotuloDia } from "@/lib/painelBarbeiro";

// Atendimentos concluidos por dia da semana (segunda a domingo), como no app.
// Conta atendimentos, nao dinheiro; o dia com mais cortes fica em destaque.
export default function GraficoDiasSemana({ dias }: { dias: number[] }) {
  const resumo = resumoDiasSemana(dias);
  if (!resumo.total) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{TEXTOS_PAINEL.atendimentosVazio}</p>;
  }
  return (
    <div>
      <ul className="flex items-end justify-between gap-2" aria-label="Atendimentos por dia da semana">
        {dias.map((qtd, i) => {
          const topo = qtd === resumo.maximo;
          return (
            <li key={DIAS_SEMANA.curto[i]} aria-label={rotuloDia(i, qtd)} className="flex flex-1 flex-col items-center">
              <span aria-hidden className={`mb-1 font-mono text-[11px] ${topo ? "text-primary" : "text-muted-foreground"}`}>{qtd}</span>
              <div aria-hidden className="flex h-36 w-6 items-end border-b border-border">
                <div className={`w-full ${topo ? "bg-accent" : "bg-foreground/50"}`} style={{ height: `${(qtd / resumo.maximo) * 100}%` }} />
              </div>
              <span aria-hidden className={`mt-2 font-mono text-[10px] tracking-widest ${topo ? "text-primary" : "text-muted-foreground"}`}>
                {DIAS_SEMANA.curto[i]}
              </span>
            </li>
          );
        })}
      </ul>
      <p className="mt-4 font-mono text-[10px] text-muted-foreground">{resumo.texto}</p>
    </div>
  );
}
