import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff, Mail, Lock, AlertCircle, Scissors, Info } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

const BarbeiroLogin = () => {
  const navigate = useNavigate();
  const [email, setEmail]           = useState("");
  const [password, setPassword]     = useState("");
  const [showPassword, setShowPass] = useState(false);
  const [loading, setLoading]       = useState(false);
  const [errors, setErrors]         = useState<{ email?: string; password?: string }>({});

  const validate = () => {
    const e: typeof errors = {};
    if (!email.trim()) e.email = "Email é obrigatório";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Email inválido";
    if (!password) e.password = "Senha é obrigatória";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleLogin = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!validate()) return;
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      if (error.message.includes("Invalid login")) {
        setErrors({ password: "Email ou senha incorretos" });
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success("Acesso realizado com sucesso!");
    navigate("/barbeiro/agenda");
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <div className="px-6 py-4 border-b border-border flex items-center justify-between">
        <Link to="/" className="flex items-center gap-3">
          <div className="size-7 bg-primary flex items-center justify-center">
            <div className="size-3.5 bg-background" />
          </div>
          <span className="font-mono text-[10px] tracking-widest text-primary font-bold">
            METRIC // GROOMING
          </span>
        </Link>
        <Link
          to="/login"
          className="font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary transition-colors"
        >
          ÁREA DO CLIENTE →
        </Link>
      </div>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <div className="inline-flex items-center gap-2 px-2 py-1 border border-border mb-4">
              <Scissors className="size-3 text-primary" />
              <span className="font-mono text-[10px] uppercase tracking-widest text-primary">
                ÁREA DO BARBEIRO
              </span>
            </div>
            <h1 className="text-3xl font-light tracking-tighter text-primary leading-tight">
              LOGIN <br />
              <span className="font-bold italic">PROFISSIONAL</span>
            </h1>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {/* Email */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setErrors(p => ({ ...p, email: undefined })); }}
                  className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="seu@email.com"
                />
              </div>
              {errors.email && (
                <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrors(p => ({ ...p, password: undefined })); }}
                  className="w-full bg-card border border-border pl-10 pr-12 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPassword)}
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

            {/* Forgot password */}
            <div className="text-right">
              <Link
                to="/forgot-password"
                className="font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors"
              >
                Esqueci minha senha
              </Link>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none"
            >
              {loading ? (
                <span className="font-mono text-xs animate-pulse">AUTENTICANDO...</span>
              ) : (
                "ENTRAR"
              )}
            </button>
          </form>

          {/* Info box */}
          <div className="mt-6 border border-border p-4 flex items-start gap-3">
            <Info className="size-4 text-muted-foreground shrink-0 mt-0.5" />
            <p className="font-mono text-[10px] text-muted-foreground leading-relaxed tracking-wide">
              Contas de barbeiro são criadas pelo administrador da barbearia. Entre em contato caso
              não possua acesso.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default BarbeiroLogin;
