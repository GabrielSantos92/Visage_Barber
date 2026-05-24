import { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Lock, Eye, EyeOff, AlertCircle, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

const ResetPassword = () => {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isRecovery, setIsRecovery] = useState(false);

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setIsRecovery(true);
    }

    supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setIsRecovery(true);
      }
    });
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!password) newErrors.password = "Senha é obrigatória";
    else if (password.length < 6) newErrors.password = "Mínimo 6 caracteres";
    if (password !== confirmPassword) newErrors.confirmPassword = "Senhas não coincidem";
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) return;

    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (error) {
      toast.error(error.message);
      return;
    }

    toast.success("Senha redefinida com sucesso!");
    navigate("/");
  };

  if (!isRecovery) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-6">
        <div className="text-center">
          <h1 className="text-2xl font-light tracking-tighter text-primary mb-4">
            LINK <span className="font-bold italic">INVÁLIDO</span>
          </h1>
          <p className="text-sm text-foreground mb-6">
            Este link de redefinição expirou ou é inválido.
          </p>
          <Link to="/forgot-password" className="text-sm text-primary font-bold hover:underline">
            Solicitar novo link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
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
          <div className="mb-8">
            <div className="inline-block px-2 py-1 border border-border mb-4">
              <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
                AUTH // RESET
              </span>
            </div>
            <h1 className="text-3xl font-light tracking-tighter text-primary leading-tight">
              NOVA <br />
              <span className="font-bold italic">SENHA</span>
            </h1>
          </div>

          <form onSubmit={handleReset} className="space-y-4">
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Nova senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrors({}); }}
                  className="w-full bg-card border border-border pl-10 pr-12 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="Mínimo 6 caracteres"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                >
                  {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.password}
                </p>
              )}
            </div>

            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Confirmar nova senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => { setConfirmPassword(e.target.value); setErrors({}); }}
                  className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="Repita a nova senha"
                />
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.confirmPassword}
                </p>
              )}
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {loading ? (
                <span className="font-mono text-xs animate-pulse">PROCESSANDO...</span>
              ) : (
                "REDEFINIR SENHA"
              )}
            </button>
          </form>
        </motion.div>
      </div>
    </div>
  );
};

export default ResetPassword;
