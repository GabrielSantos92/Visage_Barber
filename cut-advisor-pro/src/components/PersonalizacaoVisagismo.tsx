import { SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";
import { GRUPOS_PERSONALIZACAO, Preferencias, semMudanca } from "@/lib/personalizacaoVisagismo";

// Escolhas opcionais do visagismo personalizado. Cada grupo e um conjunto de
// radios nativos com aparencia de botao: teclado (setas) e leitor de tela
// funcionam sem codigo extra.
export default function PersonalizacaoVisagismo({
  valor,
  onChange,
}: {
  valor: Preferencias;
  onChange: (p: Preferencias) => void;
}) {
  return (
    <section aria-labelledby="personalizar-titulo" className="border border-border p-6 mb-10">
      <div className="flex items-center gap-2 mb-2">
        <SlidersHorizontal size={14} className="text-accent" />
        <h2 id="personalizar-titulo" className="font-mono text-[10px] text-foreground tracking-[0.2em] uppercase">
          Personalizar (opcional)
        </h2>
      </div>
      <p className="text-xs text-foreground leading-relaxed mb-6">
        Diga o que você quer e a IA escolhe, dentro disso, o que mais combina com o seu rosto. Só cabelo e barba
        mudam: seu rosto continua o mesmo.
      </p>

      {GRUPOS_PERSONALIZACAO.map(({ campo, titulo, opcoes }) => (
        <fieldset key={campo} className="mb-5">
          <legend className="font-mono text-[9px] text-foreground tracking-[0.2em] uppercase mb-2">{titulo}</legend>
          <div className="flex flex-wrap gap-2">
            {opcoes.map((o) => {
              const marcada = (valor[campo] ?? "") === o.valor;
              return (
                <label
                  key={o.valor || "padrao"}
                  className={cn(
                    "cursor-pointer border px-3 py-2 font-mono text-[10px] tracking-widest uppercase transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent",
                    marcada
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-foreground hover:border-primary hover:text-primary",
                  )}
                >
                  <input
                    type="radio"
                    name={`personalizar-${campo}`}
                    value={o.valor}
                    checked={marcada}
                    onChange={() => onChange({ ...valor, [campo]: o.valor })}
                    className="sr-only"
                  />
                  {o.rotulo}
                </label>
              );
            })}
          </div>
        </fieldset>
      ))}

      {semMudanca(valor) && (
        <p role="alert" className="font-mono text-[10px] text-destructive">
          Para gerar a simulação, mude ao menos o corte, a barba ou a cor do cabelo.
        </p>
      )}
    </section>
  );
}
