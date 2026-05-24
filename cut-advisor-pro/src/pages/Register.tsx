import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { Eye, EyeOff, Mail, Lock, User, Phone, AlertCircle, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";

const Register = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    nome: "",
    email: "",
    password: "",
    confirmPassword: "",
    telefone: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const updateField = (field: string, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
    setErrors(prev => ({ ...prev, [field]: "" }));
  };

  const passwordStrength = (pw: string) => {
    if (pw.length === 0) return null;
    if (pw.length < 6) return { label: "Fraca", color: "text-destructive" };
    if (pw.length < 8) return { label: "Média", color: "text-yellow-500" };
    return { label: "Forte", color: "text-green-500" };
  };

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.nome.trim()) e.nome = "Nome é obrigatório";
    if (!form.email.trim()) e.email = "Email é obrigatório";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = "Email inválido";
    if (!form.password) e.password = "Senha é obrigatória";
    else if (form.password.length < 6) e.password = "Mínimo 6 caracteres";
    if (form.password !== form.confirmPassword) e.confirmPassword = "Senhas não coincidem";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email: form.email,
      password: form.password,
      options: {
        data: {
          nome: form.nome,
          telefone: form.telefone,
        },
      },
    });
    setLoading(false);

    if (error) {
      if (error.message.includes("already registered")) {
        setErrors({ email: "Este email já está cadastrado" });
      } else {
        toast.error(error.message);
      }
      return;
    }

    toast.success("Conta criada! Verifique seu email para confirmar.");
    navigate("/login");
  };

  const strength = passwordStrength(form.password);

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

      {/* Form */}
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
                AUTH // REGISTER
              </span>
            </div>
            <h1 className="text-3xl font-light tracking-tighter text-primary leading-tight">
              CRIE SUA <br />
              <span className="font-bold italic">CONTA</span>
            </h1>
          </div>

          <form onSubmit={handleRegister} className="space-y-4">
            {/* Nome */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Nome completo
              </label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="text"
                  value={form.nome}
                  onChange={(e) => updateField("nome", e.target.value)}
                  className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="Seu nome"
                />
              </div>
              {errors.nome && (
                <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.nome}
                </p>
              )}
            </div>

            {/* Email */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Email
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
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

            {/* Telefone */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Telefone <span className="text-muted-foreground">(opcional)</span>
              </label>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="tel"
                  value={form.telefone}
                  onChange={(e) => updateField("telefone", e.target.value)}
                  className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="(11) 99999-9999"
                />
              </div>
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
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
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
              {strength && (
                <p className={`mt-1 text-xs flex items-center gap-1 ${strength.color}`}>
                  <CheckCircle className="size-3" /> Senha: {strength.label}
                </p>
              )}
              {errors.password && (
                <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.password}
                </p>
              )}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Confirmar senha
              </label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type={showPassword ? "text" : "password"}
                  value={form.confirmPassword}
                  onChange={(e) => updateField("confirmPassword", e.target.value)}
                  className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="Repita a senha"
                />
              </div>
              {errors.confirmPassword && (
                <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.confirmPassword}
                </p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none mt-2"
            >
              {loading ? (
                <span className="font-mono text-xs animate-pulse">PROCESSANDO...</span>
              ) : (
                "CRIAR CONTA"
              )}
            </button>
          </form>

          {/* Login link */}
          <div className="mt-6 text-center">
            <span className="text-sm text-foreground">Já tem conta? </span>
            <Link to="/login" className="text-sm text-primary font-bold hover:underline">
              Entrar
            </Link>
          </div>
        </motion.div>
      </div>
    </div>
  );
};

export default Register;
