import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, AlertCircle, ArrowLeft } from "lucide-react";
import LogoMark from "@/components/LogoMark";
import { solicitarRecuperacaoEmail } from "@/lib/recuperacaoSenha";

type Etapa = "email" | "emailEnviado";

const mensagemDe = (err: unknown) => (err instanceof Error ? err.message : "Algo deu errado. Tente novamente.");

const inputClass =
  "w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors";
const labelClass = "font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2";
const botaoClass =
  "w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none";

const Erro = ({ texto }: { texto: string }) =>
  texto ? (
    <p className="mt-1 text-xs text-destructive flex items-center gap-1">
      <AlertCircle className="size-3 shrink-0" /> {texto}
    </p>
  ) : null;

const ForgotPassword = () => {
  const [etapa, setEtapa] = useState<Etapa>("email");
  const [email, setEmail] = useState("");
  const [aviso, setAviso] = useState("");
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState("");

  const irPara = (e: Etapa) => { setErro(""); setEtapa(e); };

  const enviarEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setErro("Email é obrigatório"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setErro("Email inválido"); return; }
    setLoading(true);
    try {
      const r = await solicitarRecuperacaoEmail(email, `${window.location.origin}/reset-password`);
      setAviso(r.message);
      irPara("emailEnviado");
    } catch (err) {
      setErro(mensagemDe(err));
    } finally {
      setLoading(false);
    }
  };

  const titulo: Record<Etapa, [string, string]> = {
    email: ["RECUPERAR", "SENHA"],
    emailEnviado: ["VERIFIQUE SEU", "EMAIL"],
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 py-4 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <LogoMark className="h-8" />
          <span className="font-mono text-[10px] tracking-widest text-primary font-bold">VISAGE BARBER</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <motion.div
          key={etapa}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          <div className="mb-8">
            {etapa === "email" && (
              <Link to="/login" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-6">
                <ArrowLeft className="size-3" /> Voltar ao login
              </Link>
            )}
            <div className="block w-fit px-2 py-1 border border-border mb-4">
              <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">AUTH // RECOVERY</span>
            </div>
            <h1 className="text-3xl font-light tracking-tighter text-primary leading-tight">
              {titulo[etapa][0]} <br />
              <span className="font-bold italic">{titulo[etapa][1]}</span>
            </h1>
          </div>

          {etapa === "email" && (
            <form onSubmit={enviarEmail} className="space-y-4">
              <p className="text-sm text-foreground">Informe o email cadastrado na sua conta.</p>
              <div>
                <label htmlFor="email" className={labelClass}>Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => { setEmail(e.target.value); setErro(""); }}
                    className={inputClass}
                    placeholder="seu@email.com"
                  />
                </div>
                <Erro texto={erro} />
              </div>
              <button type="submit" disabled={loading} className={botaoClass}>
                {loading ? <span className="font-mono text-xs animate-pulse">ENVIANDO...</span> : "ENVIAR LINK"}
              </button>
            </form>
          )}

          {etapa === "emailEnviado" && (
            <div>
              <div className="size-14 bg-card border border-border flex items-center justify-center mb-6">
                <Mail className="size-7 text-primary" />
              </div>
              <p className="text-sm text-foreground mb-3">{aviso}</p>
              <p className="text-xs text-muted-foreground mb-8">
                Abra o link recebido neste navegador para criar a nova senha. Ele vale por tempo limitado e só pode ser
                usado uma vez. Confira também a caixa de spam.
              </p>
              <Link to="/login" className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary hover:underline">
                <ArrowLeft className="size-3" /> Voltar ao login
              </Link>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ForgotPassword;
