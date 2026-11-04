import { useState } from "react";
import { Link } from "react-router-dom";
import { ShieldCheck, ExternalLink, Loader2, ArrowLeft } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { AVISO_VISAGISMO, concederConsentimentoVisagismo, type SituacaoConsentimento } from "@/lib/privacidade";

interface Props {
  onConcordou: (situacao: SituacaoConsentimento) => void;
  onVoltar: () => void;
}

// Aviso exibido no lugar do envio de foto ate o cliente concordar. A caixa
// comeca desmarcada e so o botao "Concordar e continuar" registra a escolha;
// sair da tela ou voltar nao conta como concordancia.
export default function AvisoPrivacidadeVisagismo({ onConcordou, onVoltar }: Props) {
  const [marcado, setMarcado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function concordar() {
    if (!marcado || enviando) return;
    setEnviando(true);
    setErro(null);
    try {
      onConcordou(await concederConsentimentoVisagismo());
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar sua concordância. Tente novamente.");
      setEnviando(false);
    }
  }

  const secao = "font-mono text-[10px] text-accent tracking-[0.2em] uppercase mb-2";

  return (
    <section aria-labelledby="aviso-privacidade-titulo" className="border border-accent/40 bg-card mb-10">
      <div className="p-6 sm:p-8 space-y-6">
        <div className="flex items-start gap-3">
          <ShieldCheck size={20} className="text-accent flex-shrink-0 mt-1" />
          <div>
            <h2 id="aviso-privacidade-titulo" className="text-xl font-light text-primary tracking-tight">
              {AVISO_VISAGISMO.titulo}
            </h2>
            <p className="text-sm text-foreground leading-relaxed mt-2">{AVISO_VISAGISMO.introducao}</p>
          </div>
        </div>

        <div>
          <h3 className={secao}>Como utilizaremos sua foto?</h3>
          <ul className="space-y-2">
            {AVISO_VISAGISMO.usos.map((u) => (
              <li key={u} className="flex gap-3 text-sm text-foreground leading-relaxed">
                <span aria-hidden className="size-1.5 bg-accent flex-shrink-0 mt-2" />
                {u}
              </li>
            ))}
          </ul>
        </div>

        <div>
          <h3 className={secao}>Processamento por inteligência artificial</h3>
          <p className="text-sm text-foreground leading-relaxed">{AVISO_VISAGISMO.ia}</p>
        </div>

        <div>
          <h3 className={secao}>Seus direitos</h3>
          <p className="text-sm text-foreground leading-relaxed">{AVISO_VISAGISMO.direitos}</p>
        </div>

        <Link
          to="/privacidade"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 font-mono text-[10px] tracking-widest uppercase text-accent hover:text-primary transition-colors"
        >
          <ExternalLink size={12} /> Consultar Aviso de Privacidade
        </Link>

        <label className="flex items-start gap-3 border border-border p-4 cursor-pointer">
          <Checkbox
            checked={marcado}
            onCheckedChange={(v) => { setMarcado(v === true); setErro(null); }}
            disabled={enviando}
            className="mt-0.5 rounded-none"
          />
          <span className="text-sm text-primary leading-relaxed">{AVISO_VISAGISMO.concordancia}</span>
        </label>

        {erro && (
          <p role="alert" className="text-destructive font-mono text-xs border border-destructive/30 p-3">{erro}</p>
        )}

        <div className="flex flex-col-reverse sm:flex-row gap-3">
          <button
            type="button"
            onClick={onVoltar}
            disabled={enviando}
            className="sm:flex-1 flex items-center justify-center gap-2 border border-border py-4 font-mono text-[10px] tracking-widest uppercase text-foreground hover:text-primary hover:border-primary transition-colors disabled:opacity-50"
          >
            <ArrowLeft size={12} /> Voltar
          </button>
          <button
            type="button"
            onClick={concordar}
            disabled={!marcado || enviando}
            className="sm:flex-[2] flex items-center justify-center gap-2 bg-primary text-primary-foreground py-4 font-mono text-[10px] tracking-widest uppercase hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {enviando && <Loader2 size={12} className="animate-spin" />}
            {enviando ? "Registrando..." : "Concordar e continuar"}
          </button>
        </div>
      </div>
    </section>
  );
}
