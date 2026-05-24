import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Mail, AlertCircle, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

const ForgotPassword = () => {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) { setError("Email é obrigatório"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError("Email inválido"); return; }

    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    setSent(true);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <div className="size-7 bg-primary flex items-center justify-center">
            <div className="size-3.5 bg-background" />
          </div>
          <span className="font-mono text-[10px] tracking-widest text-primary font-bold">
            METRIC // GROOMING
          </span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm"
        >
          {sent ? (
            <div className="text-center">
              <div className="size-16 bg-card border border-border flex items-center justify-center mx-auto mb-6">
                <Mail className="size-8 text-primary" />
              </div>
              <h1 className="text-2xl font-light tracking-tighter text-primary mb-2">
                EMAIL <span className="font-bold italic">ENVIADO</span>
              </h1>
              <p className="text-sm text-foreground mb-8">
                Verifique sua caixa de entrada para redefinir sua senha.
              </p>
              <Link
                to="/login"
                className="inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
              >
                <ArrowLeft className="size-3" /> Voltar ao login
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-8">
                <Link to="/login" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-6">
                  <ArrowLeft className="size-3" /> Voltar
                </Link>
                <div className="inline-block px-2 py-1 border border-border mb-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
                    AUTH // RECOVERY
                  </span>
                </div>
                <h1 className="text-3xl font-light tracking-tighter text-primary leading-tight">
                  RECUPERAR <br />
                  <span className="font-bold italic">SENHA</span>
                </h1>
                <p className="text-sm text-foreground mt-3">
                  Informe seu email para receber o link de redefinição.
                </p>
              </div>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                    Email
                  </label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setError(""); }}
                      className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                      placeholder="seu@email.com"
                    />
                  </div>
                  {error && (
                    <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                      <AlertCircle className="size-3" /> {error}
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                >
                  {loading ? (
                    <span className="font-mono text-xs animate-pulse">ENVIANDO...</span>
                  ) : (
                    "ENVIAR LINK"
                  )}
                </button>
              </form>
            </>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ForgotPassword;
