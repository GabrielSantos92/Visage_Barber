import { useState, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Camera, ImageIcon, X, Cpu, Sun, User, Crop, MinusCircle, ShieldCheck } from "lucide-react";
import Navbar from "@/components/Navbar";
import AvisoPrivacidadeVisagismo from "@/components/AvisoPrivacidadeVisagismo";
import PersonalizacaoVisagismo from "@/components/PersonalizacaoVisagismo";
import { ApiError, apiPost } from "@/lib/api";
import { Preferencias, preferenciasParaEnvio, semMudanca } from "@/lib/personalizacaoVisagismo";

type EstadoConsentimento = "pendente" | "concedido";

export default function Visagismo() {
  const navigate = useNavigate();
  const [foto, setFoto] = useState<string | null>(null);
  const [fotoUrl, setFotoUrl] = useState<string | null>(null);
  const [cameraAtiva, setCameraAtiva] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // O aviso aparece a cada visita, mesmo para quem ja concordou antes: a foto so
  // pode ser escolhida depois de concordar de novo. O backend continua sendo
  // quem decide se o envio e aceito.
  const [consentimento, setConsentimento] = useState<EstadoConsentimento>("pendente");
  // Visagismo personalizado (opcional): estilo, barba e cor do cabelo
  const [preferencias, setPreferencias] = useState<Preferencias>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);

  function escolherGaleria() {
    fileInputRef.current?.click();
  }

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result as string;
      setFoto(result.split(",")[1]);
      setFotoUrl(result);
    };
    reader.readAsDataURL(file);
  }

  async function abrirCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user" } });
      streamRef.current = stream;
      setCameraAtiva(true);
      setTimeout(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play();
        }
      }, 100);
    } catch {
      setErro("Não foi possível acessar a câmera. Verifique as permissões do navegador.");
    }
  }

  function capturarFoto() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;
    canvas.getContext("2d")?.drawImage(videoRef.current, 0, 0);
    const dataUrl = canvas.toDataURL("image/jpeg", 0.7);
    setFoto(dataUrl.split(",")[1]);
    setFotoUrl(dataUrl);
    fecharCamera();
  }

  function fecharCamera() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    setCameraAtiva(false);
  }

  async function analisar() {
    if (!foto || semMudanca(preferencias)) return;
    setLoading(true);
    setErro(null);
    try {
      // Sem personalizacao o pedido e o mesmo de sempre
      const pref = preferenciasParaEnvio(preferencias);
      const resultado = await apiPost("/api/visagismo/analisar", pref ? { imagem_base64: foto, preferencias: pref } : { imagem_base64: foto });
      navigate("/visagismo/resultado", { state: { resultado, fotoUrl, fotoBase64: foto } });
    } catch (e: any) {
      // Autorizacao revogada em outro aparelho: descarta a foto e mostra o aviso de novo
      if (e instanceof ApiError && e.code === "CONSENTIMENTO_NECESSARIO") {
        setFoto(null);
        setFotoUrl(null);
        setConsentimento("pendente");
      }
      setErro(e.message || "Erro ao analisar.");
    }
    setLoading(false);
  }

  if (cameraAtiva) {
    return (
      <div className="fixed inset-0 bg-black z-50 flex flex-col">
        <video ref={videoRef} className="flex-1 w-full object-cover" playsInline muted />
        <button
          onClick={fecharCamera}
          className="absolute top-5 left-5 size-11 rounded-full bg-black/60 flex items-center justify-center text-white hover:bg-black/80 transition-colors"
        >
          <X size={20} />
        </button>
        <div className="absolute bottom-12 left-0 right-0 flex justify-center">
          <button
            onClick={capturarFoto}
            className="size-20 rounded-full border-4 border-white flex items-center justify-center hover:scale-105 transition-transform"
          >
            <div className="size-16 rounded-full bg-white" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-2xl mx-auto px-6 py-12">

        {/* Header */}
        <div className="border-b border-border pb-8 mb-10">
          <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-3">
            VISAGISMO IA
          </p>
          <h1 className="text-4xl font-light text-primary tracking-tighter mb-3">
            Análise por Foto
          </h1>
          <p className="text-sm text-foreground leading-relaxed">
            Envie uma foto do seu rosto para receber recomendações personalizadas de corte e estilo geradas por inteligência artificial.
          </p>
        </div>

        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={onFileChange}
        />

        {/* Aviso de privacidade: aparece antes de qualquer escolha de foto */}
        {consentimento === "pendente" ? (
          <AvisoPrivacidadeVisagismo
            onConcordou={(s) => { setErro(null); setConsentimento(s.consentido ? "concedido" : "pendente"); }}
            onVoltar={() => navigate(-1)}
          />
        ) : foto ? (
          <div className="mb-10 flex flex-col items-center">
            <img
              src={fotoUrl!}
              alt="Foto selecionada"
              className="w-full max-h-96 object-contain border border-border bg-card"
            />
            <button
              onClick={() => { setFoto(null); setFotoUrl(null); }}
              className="flex items-center gap-2 mt-4 font-mono text-[10px] tracking-widest text-foreground hover:text-primary transition-colors"
            >
              <X size={12} /> TROCAR FOTO
            </button>
          </div>
        ) : (
          <div className="border border-dashed border-border p-10 mb-10 flex flex-col items-center">
            <div className="size-20 border border-border flex items-center justify-center mb-5">
              <User size={36} className="text-border" />
            </div>
            <p className="font-mono text-sm text-primary mb-2 text-center uppercase tracking-tight">
              Adicione uma foto do seu rosto
            </p>
            <p className="text-xs text-foreground mb-8 text-center leading-relaxed max-w-xs">
              Para melhor resultado, use boa iluminação e olhe diretamente para a câmera
            </p>
            <div className="flex gap-3 w-full">
              <button
                onClick={escolherGaleria}
                className="flex-1 flex items-center justify-center gap-2 border border-primary py-4 font-mono text-[10px] tracking-widest text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <ImageIcon size={14} /> DA GALERIA
              </button>
              <button
                onClick={abrirCamera}
                className="flex-1 flex items-center justify-center gap-2 border border-primary py-4 font-mono text-[10px] tracking-widest text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
              >
                <Camera size={14} /> CÂMERA
              </button>
            </div>
          </div>
        )}

        {consentimento === "concedido" && (
          <p className="flex items-center gap-2 mb-10 -mt-6 font-mono text-[10px] tracking-widest uppercase text-muted-foreground">
            <ShieldCheck size={12} className="text-accent" />
            Uso da foto autorizado ·{" "}
            <Link to="/privacidade" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Aviso de Privacidade</Link>
            {" "}·{" "}
            <Link to="/perfil" className="text-accent hover:underline">Gerenciar</Link>
          </p>
        )}

        {/* Tips */}
        <div className="mb-10">
          <p className="font-mono text-[10px] text-foreground tracking-[0.3em] uppercase mb-5">
            DICAS PARA MELHOR RESULTADO
          </p>
          {[
            { Icon: Sun, text: "Use boa iluminação, de frente para a luz" },
            { Icon: User, text: "Olhe diretamente para a câmera" },
            { Icon: Crop, text: "Enquadre apenas o rosto e pescoço" },
            { Icon: MinusCircle, text: "Evite óculos ou bonés" },
          ].map(({ Icon, text }, i) => (
            <div key={i} className="flex items-center gap-3 mb-3">
              <Icon size={13} className="text-accent flex-shrink-0" />
              <span className="text-sm text-foreground">{text}</span>
            </div>
          ))}
        </div>

        {foto && consentimento === "concedido" && (
          <PersonalizacaoVisagismo valor={preferencias} onChange={setPreferencias} />
        )}

        {/* Error */}
        {erro && (
          <p className="text-destructive font-mono text-xs mb-5 border border-destructive/30 p-3">
            {erro}
          </p>
        )}

        {/* Analyze button */}
        {foto && consentimento === "concedido" && (
          <button
            onClick={analisar}
            disabled={loading || semMudanca(preferencias)}
            className="w-full flex items-center justify-center gap-3 bg-primary text-primary-foreground py-5 font-mono text-[11px] tracking-[0.3em] uppercase hover:bg-accent transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <>
                <div className="size-3 border-2 border-primary-foreground border-t-transparent rounded-full animate-spin" />
                ANALISANDO...
              </>
            ) : (
              <>
                <Cpu size={14} />
                ANALISAR COM IA
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
