import { DIAS_SEMANA, TEXTOS_PAINEL, resumoDiasSemana, rotuloDia } from "@/lib/painelBarbeiro";
import { COR_SERIE, COR_SERIE_SUAVE, Dica } from "./graficos";

// Atendimentos concluidos por dia da semana (segunda a domingo), como no app.
// Conta atendimentos, nao dinheiro; o dia com mais cortes fica em destaque.
// Grade leve ao fundo, valor no topo de cada coluna e dica com a parcela do
// total ao passar o mouse. O total do periodo fica no cartao de indicadores.
const ALTURA = 160;

// Passo "redondo" da grade: 1, 2, 5, 10, 20...
function passoDaGrade(maximo: number) {
  const bruto = Math.max(1, maximo / 4);
  const base = 10 ** Math.floor(Math.log10(bruto));
  return [1, 2, 5, 10].map((m) => m * base).find((p) => p >= bruto) ?? bruto;
}

export default function GraficoDiasSemana({ dias }: { dias: number[] }) {
  const resumo = resumoDiasSemana(dias);
  if (!resumo.total) {
    return <p className="py-10 text-center text-sm text-muted-foreground">{TEXTOS_PAINEL.atendimentosVazio}</p>;
  }
  const passo = passoDaGrade(resumo.maximo);
  const teto = Math.ceil(resumo.maximo / passo) * passo;
  const linhas = Array.from({ length: teto / passo + 1 }, (_, i) => i * passo);

  return (
    <div>
      <div className="mt-6 flex gap-2">
        {/* eixo: numeros da grade */}
        <div aria-hidden className="relative w-5 shrink-0" style={{ height: ALTURA }}>
          {linhas.map((v) => (
            <span key={v} className="absolute right-0 translate-y-1/2 font-mono text-[9px] text-muted-foreground" style={{ bottom: (v / teto) * ALTURA }}>
              {v}
            </span>
          ))}
        </div>

        <div className="relative flex-1">
          {/* grade */}
          <div aria-hidden className="absolute inset-x-0 top-0" style={{ height: ALTURA }}>
            {linhas.map((v) => (
              <span key={v} className={`absolute inset-x-0 h-px ${v === 0 ? "bg-border" : "bg-border/50"}`} style={{ bottom: (v / teto) * ALTURA }} />
            ))}
          </div>

          <ul className="relative flex justify-between gap-1" aria-label="Atendimentos por dia da semana">
            {dias.map((qtd, i) => {
              const topo = qtd === resumo.maximo;
              const altura = (qtd / teto) * ALTURA;
              return (
                <li key={DIAS_SEMANA.curto[i]} aria-label={rotuloDia(i, qtd)} tabIndex={0} className="group relative flex flex-1 flex-col items-center outline-none">
                  <div aria-hidden className="relative flex w-full justify-center" style={{ height: ALTURA }}>
                    {qtd > 0 && (
                      <>
                        <span
                          className={`absolute font-mono text-[11px] ${topo ? "font-bold text-primary" : "text-muted-foreground"}`}
                          style={{ bottom: altura + 4 }}
                        >
                          {qtd}
                        </span>
                        <div
                          className={`absolute bottom-0 w-full max-w-7 rounded-t-[4px] transition-colors ${topo ? COR_SERIE : COR_SERIE_SUAVE}`}
                          style={{ height: altura }}
                        />
                      </>
                    )}
                  </div>
                  <span aria-hidden className={`mt-2 font-mono text-[10px] tracking-widest ${topo ? "font-bold text-primary" : "text-muted-foreground"}`}>
                    {DIAS_SEMANA.curto[i]}
                  </span>
                  <Dica>
                    {DIAS_SEMANA.extenso[i]} · {qtd} ({Math.round((qtd / resumo.total) * 100)}%)
                  </Dica>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
      <p className="mt-4 font-mono text-[10px] text-muted-foreground">{resumo.texto}</p>
    </div>
  );
}
