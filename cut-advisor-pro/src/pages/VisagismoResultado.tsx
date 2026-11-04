import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Scissors, User, List, Zap, Droplet, XCircle, Star, RotateCcw, ArrowLeft, Maximize2 } from "lucide-react";
import Navbar from "@/components/Navbar";
import VisualizadorImagem from "@/components/VisualizadorImagem";
import { useMensagensEspera } from "@/hooks/use-mensagens-espera";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const TEMPO_LIMITE_MS = 360000;

const formatoLabel: Record<string, string> = {
  oval: "Oval", redondo: "Redondo", quadrado: "Quadrado",
  triangular: "Triangular", losango: "Losango", oblongo: "Oblongo",
};

type StatusImagem = "gerando" | "pronta" | "erro";

function IconeAmpliar() {
  return (
    <span aria-hidden className="absolute bottom-2 right-2 size-7 bg-background/80 border border-border flex items-center justify-center text-foreground group-hover:text-accent group-hover:border-accent transition-colors">
      <Maximize2 size={12} />
    </span>
  );
}

export default function VisagismoResultado() {
  const { state } = useLocation() as { state: { resultado: any; fotoUrl?: string; fotoBase64?: string } };
  const navigate = useNavigate();

  const [imagemUrl, setImagemUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<StatusImagem>("gerando");
  const [erroMsg, setErroMsg] = useState("");
  const [ampliada, setAmpliada] = useState<"original" | "gerada" | null>(null);
  // Requisicao em andamento: impede chamadas duplicadas e e cancelada ao sair da tela.
  const requisicaoRef = useRef<AbortController | null>(null);
  const espera = useMensagensEspera(status === "gerando");

  const gerarImagem = useCallback(async () => {
    if (requisicaoRef.current || !state?.resultado) return;
    const controller = new AbortController();
    requisicaoRef.current = controller;
    let estourouTempo = false;
    const timeout = setTimeout(() => { estourouTempo = true; controller.abort(); }, TEMPO_LIMITE_MS);
    setStatus("gerando");
    setImagemUrl(null);
    setErroMsg("");
    try {
      const res = await fetch(`${API_URL}/api/visagismo/imagem-referencia`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // A analise inteira: o backend extrai dela so os atributos de estilo.
          analise: state.resultado,
          imagem_base64: state.fotoBase64 ?? "",
        }),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Erro ${res.status}`);
      const data = await res.json();
      setImagemUrl(`data:${data.contentType};base64,${data.base64}`);
      setStatus("pronta");
    } catch {
      // Cancelada porque o usuario saiu da tela: nada a mostrar.
      if (controller.signal.aborted && !estourouTempo) return;
      setErroMsg(estourouTempo
        ? "A geração demorou mais que o esperado."
        : "Não foi possível gerar a imagem agora.");
      setStatus("erro");
    } finally {
      clearTimeout(timeout);
      if (requisicaoRef.current === controller) requisicaoRef.current = null;
    }
  }, [state]);

  useEffect(() => {
    if (!state?.resultado) { navigate("/visagismo"); return; }
    gerarImagem();
    return () => {
      requisicaoRef.current?.abort();
      requisicaoRef.current = null;
    };
  }, []);

  if (!state?.resultado) return null;
  const { resultado, fotoUrl } = state;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-4xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="flex items-center gap-4 border-b border-border pb-6 mb-8">
          <button
            onClick={() => navigate("/visagismo")}
            className="size-8 border border-border flex items-center justify-center text-foreground hover:text-primary hover:border-primary transition-colors"
          >
            <ArrowLeft size={14} />
          </button>
          <div>
            <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-1">
              ANÁLISE DE VISAGISMO
            </p>
            <h1 className="text-3xl font-light text-primary tracking-tighter">Seu Resultado</h1>
          </div>
        </div>

        {/* Fotos lado a lado */}
        <div className="grid grid-cols-2 gap-4 mb-8">
          {fotoUrl && (
            <div>
              <p className="font-mono text-[9px] text-foreground tracking-[0.2em] mb-2">SUA FOTO</p>
              <button
                type="button"
                onClick={() => setAmpliada("original")}
                aria-label="Ampliar sua foto"
                className="group relative block w-full h-56 border border-border bg-card cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <img src={fotoUrl} alt="Sua foto" className="w-full h-full object-contain" />
                <IconeAmpliar />
              </button>
            </div>
          )}
          <div className={fotoUrl ? "" : "col-span-2"}>
            <p className="font-mono text-[9px] text-foreground tracking-[0.2em] mb-2">COM O CORTE IDEAL</p>
            <div className="w-full h-56 border border-border bg-card flex items-center justify-center overflow-hidden relative">
              {status === "pronta" && imagemUrl ? (
                <button
                  type="button"
                  onClick={() => setAmpliada("gerada")}
                  aria-label="Ampliar foto com o corte ideal"
                  className="group absolute inset-0 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
                >
                  <img src={imagemUrl} alt="Corte ideal" className="w-full h-full object-contain" />
                  <IconeAmpliar />
                </button>
              ) : status === "erro" ? (
                <div role="alert" className="flex flex-col items-center gap-2 p-5 text-center border border-accent/30 m-4">
                  <Scissors size={20} className="text-accent" />
                  <p className="font-mono text-[10px] text-primary leading-relaxed">{erroMsg}</p>
                  {resultado.corte_principal?.nome && (
                    <p className="font-mono text-[9px] text-foreground">Corte sugerido: {resultado.corte_principal.nome}</p>
                  )}
                  <button onClick={gerarImagem} className="mt-2 font-mono text-[10px] text-accent tracking-widest hover:text-primary transition-colors flex items-center gap-1">
                    <RotateCcw size={11} /> TENTAR NOVAMENTE
                  </button>
                </div>
              ) : (
                <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 px-4 text-center">
                  <div aria-hidden className="size-5 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                  <div className="h-9 flex items-center justify-center">
                    <p
                      key={espera.passo}
                      className="font-mono text-[9px] text-accent tracking-widest uppercase leading-relaxed motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-500"
                    >
                      {espera.mensagem}
                    </p>
                  </div>
                  <p className="font-mono text-[9px] text-foreground" aria-hidden>{espera.segundos}s</p>
                  <p className="font-mono text-[8px] text-foreground/50 leading-relaxed">IA gerando imagem.<br />Pode levar até 2 min.</p>
                </div>
              )}
            </div>
          </div>
        </div>

        <VisualizadorImagem
          open={ampliada !== null}
          onOpenChange={(aberto) => { if (!aberto) setAmpliada(null); }}
          src={ampliada === "original" ? fotoUrl ?? null : ampliada === "gerada" ? imagemUrl : null}
          alt={ampliada === "original" ? "Sua foto" : "Sua foto com o corte ideal"}
          titulo={ampliada === "original" ? "SUA FOTO" : "COM O CORTE IDEAL"}
        />

        {/* Formato do rosto */}
        <div className="border border-border p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <User size={14} className="text-accent" />
            <p className="font-mono text-[10px] text-foreground tracking-[0.2em]">FORMATO DO ROSTO</p>
          </div>
          <p className="text-5xl font-light text-primary tracking-tighter mb-3">
            {formatoLabel[resultado.formato_rosto] ?? resultado.formato_rosto}
          </p>
          <p className="text-sm text-foreground leading-relaxed">{resultado.tracos}</p>
        </div>

        {/* Corte principal */}
        <div className="border border-border p-6 mb-4">
          <div className="flex items-center gap-2 mb-4">
            <Scissors size={14} className="text-accent" />
            <p className="font-mono text-[10px] text-foreground tracking-[0.2em]">CORTE IDEAL</p>
          </div>
          <p className="text-xl font-semibold text-primary mb-2">{resultado.corte_principal?.nome}</p>
          <p className="text-sm text-foreground leading-relaxed mb-5">{resultado.corte_principal?.descricao}</p>
          <div className="space-y-2">
            {(resultado.corte_principal?.caracteristicas ?? []).map((c: string, i: number) => (
              <div key={i} className="flex items-center gap-3">
                <div className="size-1.5 bg-accent flex-shrink-0" />
                <p className="text-sm text-foreground">{c}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Cortes alternativos */}
        {resultado.cortes_alternativos?.length > 0 && (
          <div className="border border-border p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <List size={14} className="text-accent" />
              <p className="font-mono text-[10px] text-foreground tracking-[0.2em]">OUTROS CORTES QUE COMBINAM</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {resultado.cortes_alternativos.map((c: string, i: number) => (
                <span key={i} className="border border-border px-3 py-1.5 font-mono text-[10px] text-foreground tracking-widest">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Barba */}
        {resultado.barba && (
          <div className="border border-border p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Zap size={14} className="text-accent" />
              <p className="font-mono text-[10px] text-foreground tracking-[0.2em]">BARBA IDEAL</p>
            </div>
            <p className="text-xl font-semibold text-primary mb-2">{resultado.barba.estilo}</p>
            <p className="text-sm text-foreground leading-relaxed">{resultado.barba.motivo}</p>
          </div>
        )}

        {/* Cores ideais */}
        {resultado.cores_ideais?.length > 0 && (
          <div className="border border-border p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <Droplet size={14} className="text-accent" />
              <p className="font-mono text-[10px] text-foreground tracking-[0.2em]">CORES QUE TE VALORIZAM</p>
            </div>
            <div className="flex flex-wrap gap-2">
              {resultado.cores_ideais.map((c: string, i: number) => (
                <span key={i} className="border border-accent px-3 py-1.5 font-mono text-[10px] text-accent tracking-widest">
                  {c}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* O que evitar */}
        {resultado.o_que_evitar?.length > 0 && (
          <div className="border border-destructive/40 p-6 mb-4">
            <div className="flex items-center gap-2 mb-4">
              <XCircle size={14} className="text-destructive" />
              <p className="font-mono text-[10px] text-destructive tracking-[0.2em]">O QUE EVITAR</p>
            </div>
            <div className="space-y-2">
              {resultado.o_que_evitar.map((e: string, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="size-1.5 bg-destructive flex-shrink-0" />
                  <p className="text-sm text-foreground">{e}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Resumo */}
        {resultado.resumo && (
          <div className="border border-accent/30 p-6 mb-8">
            <div className="flex items-center gap-2 mb-4">
              <Star size={14} className="text-accent" />
              <p className="font-mono text-[10px] text-foreground tracking-[0.2em]">RESUMO</p>
            </div>
            <p className="text-sm text-foreground leading-relaxed">{resultado.resumo}</p>
          </div>
        )}

        {/* Agendar CTA */}
        <div className="border border-border p-8 text-center">
          <p className="font-mono text-[10px] text-foreground tracking-[0.3em] uppercase mb-3">
            PRONTO PARA O CORTE?
          </p>
          <p className="text-sm text-foreground mb-6">Agende com um dos nossos barbeiros e chegue com seu resultado em mãos.</p>
          <button
            onClick={() => navigate("/agendar")}
            className="px-8 py-4 bg-primary text-primary-foreground font-mono text-[10px] tracking-[0.3em] uppercase hover:bg-accent transition-colors"
          >
            AGENDAR AGORA
          </button>
        </div>

      </div>
    </div>
  );
}
