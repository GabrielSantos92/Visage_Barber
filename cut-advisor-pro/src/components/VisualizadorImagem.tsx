import { useCallback, useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X, ZoomIn, ZoomOut, RotateCcw } from "lucide-react";

const ESCALA_MIN = 1;
const ESCALA_MAX = 5;
const PASSO_BOTAO = 1.5;
const ESCALA_TOQUE_DUPLO = 2.5;

type Transformacao = { escala: number; x: number; y: number };
type Ponto = { x: number; y: number };
const INICIAL: Transformacao = { escala: 1, x: 0, y: 0 };

const limitarEscala = (s: number) => Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, s));

interface Props {
  src: string | null;
  alt: string;
  titulo: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Imagem em tela cheia com zoom por roda do mouse, botoes, teclado, pinca e
// toque duplo, e arraste quando ampliada. A imagem fica sempre em object-contain,
// entao a proporcao da foto nunca e alterada.
export default function VisualizadorImagem({ src, alt, titulo, open, onOpenChange }: Props) {
  const [t, setT] = useState<Transformacao>(INICIAL);
  const [interagindo, setInteragindo] = useState(false);
  const [area, setArea] = useState<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const fecharRef = useRef<HTMLButtonElement>(null);
  const tRef = useRef(t);
  tRef.current = t;

  // Gestos em andamento
  const ponteiros = useRef(new Map<number, Ponto>());
  const inicioArraste = useRef<{ p: Ponto; t: Transformacao } | null>(null);
  const inicioPinca = useRef<{ dist: number; meio: Ponto; t: Transformacao } | null>(null);
  const moveu = useRef(false);
  const ultimoToque = useRef<{ tempo: number; p: Ponto } | null>(null);

  useEffect(() => { if (open) setT(INICIAL); }, [open, src]);

  // Mantem a imagem cobrindo a area visivel: nao deixa arrastar para fora.
  const limitar = useCallback((n: Transformacao): Transformacao => {
    const img = imgRef.current;
    if (!img || !area || n.escala <= 1) return { escala: Math.max(1, n.escala), x: 0, y: 0 };
    const maxX = Math.max(0, (img.offsetWidth * n.escala - area.clientWidth) / 2);
    const maxY = Math.max(0, (img.offsetHeight * n.escala - area.clientHeight) / 2);
    return {
      escala: n.escala,
      x: Math.min(maxX, Math.max(-maxX, n.x)),
      y: Math.min(maxY, Math.max(-maxY, n.y)),
    };
  }, [area]);

  // Ponto da tela relativo ao centro da area (origem da transformacao).
  const relativo = useCallback((clientX: number, clientY: number): Ponto => {
    if (!area) return { x: 0, y: 0 };
    const r = area.getBoundingClientRect();
    return { x: clientX - r.left - r.width / 2, y: clientY - r.top - r.height / 2 };
  }, [area]);

  // Zoom mantendo fixo o ponto `foco` (relativo ao centro).
  const zoomEm = useCallback((base: Transformacao, novaEscala: number, foco: Ponto): Transformacao => {
    const escala = limitarEscala(novaEscala);
    const k = escala / base.escala;
    return limitar({ escala, x: foco.x - (foco.x - base.x) * k, y: foco.y - (foco.y - base.y) * k });
  }, [limitar]);

  const zoomBotao = (fator: number) => {
    setInteragindo(false);
    setT((atual) => zoomEm(atual, atual.escala * fator, { x: 0, y: 0 }));
  };

  // A roda precisa de listener nao passivo para impedir a rolagem da pagina.
  useEffect(() => {
    if (!area) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setInteragindo(true);
      const foco = relativo(e.clientX, e.clientY);
      setT((atual) => zoomEm(atual, atual.escala * Math.exp(-e.deltaY * 0.0015), foco));
    };
    area.addEventListener("wheel", onWheel, { passive: false });
    return () => area.removeEventListener("wheel", onWheel);
  }, [area, relativo, zoomEm]);

  function iniciarPinca() {
    const [a, b] = [...ponteiros.current.values()];
    inicioPinca.current = {
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      meio: relativo((a.x + b.x) / 2, (a.y + b.y) / 2),
      t: tRef.current,
    };
    inicioArraste.current = null;
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    setInteragindo(true);
    if (ponteiros.current.size === 1) {
      moveu.current = false;
      inicioArraste.current = { p: { x: e.clientX, y: e.clientY }, t: tRef.current };
    } else if (ponteiros.current.size === 2) {
      moveu.current = true;
      iniciarPinca();
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!ponteiros.current.has(e.pointerId)) return;
    ponteiros.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const pinca = inicioPinca.current;
    if (pinca && ponteiros.current.size >= 2) {
      const [a, b] = [...ponteiros.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const meio = relativo((a.x + b.x) / 2, (a.y + b.y) / 2);
      const escala = limitarEscala(pinca.t.escala * (dist / pinca.dist));
      const k = escala / pinca.t.escala;
      // O ponto que estava sob os dedos acompanha o meio da pinca.
      setT(limitar({
        escala,
        x: meio.x - (pinca.meio.x - pinca.t.x) * k,
        y: meio.y - (pinca.meio.y - pinca.t.y) * k,
      }));
      return;
    }

    const arraste = inicioArraste.current;
    if (!arraste) return;
    const dx = e.clientX - arraste.p.x;
    const dy = e.clientY - arraste.p.y;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moveu.current = true;
    if (arraste.t.escala > 1) setT(limitar({ ...arraste.t, x: arraste.t.x + dx, y: arraste.t.y + dy }));
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!ponteiros.current.delete(e.pointerId)) return;
    const restante = [...ponteiros.current.values()];

    if (restante.length === 1) {
      // Saiu um dedo da pinca: continua arrastando com o outro, sem salto.
      inicioPinca.current = null;
      inicioArraste.current = { p: restante[0], t: tRef.current };
      return;
    }
    if (restante.length > 1) { iniciarPinca(); return; }

    inicioPinca.current = null;
    inicioArraste.current = null;
    setInteragindo(false);
    if (moveu.current || e.type === "pointercancel") return;

    // Toque/clique simples: duplo alterna o zoom; fora da imagem, fecha.
    const agora = Date.now();
    const p = { x: e.clientX, y: e.clientY };
    const anterior = ultimoToque.current;
    if (anterior && agora - anterior.tempo < 300 && Math.hypot(p.x - anterior.p.x, p.y - anterior.p.y) < 30) {
      ultimoToque.current = null;
      const foco = relativo(p.x, p.y);
      setT((atual) => atual.escala > 1 ? INICIAL : zoomEm(atual, ESCALA_TOQUE_DUPLO, foco));
      return;
    }
    ultimoToque.current = { tempo: agora, p };
    if (e.target !== imgRef.current && tRef.current.escala === 1) onOpenChange(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    const passo = 60;
    const mover = (dx: number, dy: number) => setT((atual) => limitar({ ...atual, x: atual.x + dx, y: atual.y + dy }));
    switch (e.key) {
      case "+": case "=": zoomBotao(PASSO_BOTAO); break;
      case "-": case "_": zoomBotao(1 / PASSO_BOTAO); break;
      case "0": setInteragindo(false); setT(INICIAL); break;
      case "ArrowLeft":  if (t.escala <= 1) return; mover(passo, 0); break;
      case "ArrowRight": if (t.escala <= 1) return; mover(-passo, 0); break;
      case "ArrowUp":    if (t.escala <= 1) return; mover(0, passo); break;
      case "ArrowDown":  if (t.escala <= 1) return; mover(0, -passo); break;
      default: return;
    }
    e.preventDefault();
  }

  const botao = "size-9 border border-border flex items-center justify-center text-foreground hover:text-accent hover:border-accent transition-colors disabled:opacity-30 disabled:pointer-events-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent";

  return (
    <DialogPrimitive.Root open={open && !!src} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/95 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0"
          onOpenAutoFocus={(e) => { e.preventDefault(); fecharRef.current?.focus(); }}
          onKeyDown={onKeyDown}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <DialogPrimitive.Title className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase truncate">
              {titulo}
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">
              Use a roda do mouse, os botões, as teclas + e − ou o gesto de pinça para ampliar. Arraste ou use as setas para mover a imagem ampliada. Esc fecha.
            </DialogPrimitive.Description>
            <div className="flex items-center gap-2">
              <button type="button" className={botao} onClick={() => zoomBotao(1 / PASSO_BOTAO)} disabled={t.escala <= ESCALA_MIN} aria-label="Reduzir zoom">
                <ZoomOut size={15} />
              </button>
              <span className="w-12 text-center font-mono text-[10px] text-foreground tabular-nums" aria-live="polite">
                {Math.round(t.escala * 100)}%
              </span>
              <button type="button" className={botao} onClick={() => zoomBotao(PASSO_BOTAO)} disabled={t.escala >= ESCALA_MAX} aria-label="Ampliar zoom">
                <ZoomIn size={15} />
              </button>
              <button type="button" className={botao} onClick={() => { setInteragindo(false); setT(INICIAL); }} disabled={t.escala === 1} aria-label="Restaurar tamanho">
                <RotateCcw size={14} />
              </button>
              <DialogPrimitive.Close ref={fecharRef} className={`${botao} ml-2`} aria-label="Fechar visualização">
                <X size={16} />
              </DialogPrimitive.Close>
            </div>
          </div>

          <div className="relative flex-1 min-h-0">
            <div
              ref={setArea}
              data-testid="area-zoom"
              className={`absolute inset-4 flex items-center justify-center overflow-hidden touch-none select-none ${t.escala > 1 ? "cursor-grab active:cursor-grabbing" : ""}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
            >
              {src && (
                <img
                  ref={imgRef}
                  src={src}
                  alt={alt}
                  draggable={false}
                  className={`max-w-full max-h-full object-contain will-change-transform ${interagindo ? "" : "transition-transform duration-200 ease-out"}`}
                  style={{ transform: `translate3d(${t.x}px, ${t.y}px, 0) scale(${t.escala})` }}
                />
              )}
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
