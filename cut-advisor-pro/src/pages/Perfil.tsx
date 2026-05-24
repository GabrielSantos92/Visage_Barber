import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import { User, Phone, Mail, ArrowLeft, Save, AlertCircle, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import Navbar from "@/components/Navbar";

const Perfil = () => {
  const navigate = useNavigate();
  const { user, role } = useAuth();
  const [form, setForm] = useState({ nome: "", telefone: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("nome, telefone")
      .eq("user_id", user.id)
      .single()
      .then(({ data }) => {
        if (data) setForm({ nome: data.nome || "", telefone: data.telefone || "" });
        setLoading(false);
      });
  }, [user]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!form.nome.trim()) e.nome = "Nome é obrigatório";
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate() || !user) return;

    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({ nome: form.nome.trim(), telefone: form.telefone.trim() || null })
      .eq("user_id", user.id);
    setSaving(false);

    if (error) {
      toast.error("Erro ao salvar. Tente novamente.");
      return;
    }

    toast.success("Perfil atualizado com sucesso!");
  };

  const roleLabel: Record<string, string> = {
    admin: "Administrador",
    barbeiro: "Barbeiro",
    cliente: "Cliente",
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-lg mx-auto px-6 py-8">
        <button
          onClick={() => navigate("/")}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="size-3" /> Voltar
        </button>

        <div className="inline-block px-2 py-1 border border-border mb-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
            CONTA // PERFIL
          </span>
        </div>
        <h1 className="text-3xl font-light tracking-tighter text-primary mb-8">
          MEU <span className="font-bold italic">PERFIL</span>
        </h1>

        {/* Info card */}
        <div className="border border-border p-4 mb-8 flex items-center gap-4">
          <div className="size-12 bg-secondary flex items-center justify-center font-bold text-primary text-lg flex-shrink-0">
            {form.nome ? form.nome.charAt(0).toUpperCase() : <User className="size-5" />}
          </div>
          <div>
            <p className="text-sm font-bold text-primary">{form.nome || "—"}</p>
            <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest flex items-center gap-1">
              <Mail className="size-3" /> {user?.email}
            </p>
            {role && (
              <span className="inline-block mt-1 font-mono text-[10px] uppercase tracking-widest px-2 py-0.5 border border-primary/30 text-primary">
                {roleLabel[role]}
              </span>
            )}
          </div>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <span className="font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</span>
          </div>
        ) : (
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            onSubmit={handleSave}
            className="space-y-5"
          >
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
                  onChange={(e) => { setForm(p => ({ ...p, nome: e.target.value })); setErrors(p => ({ ...p, nome: "" })); }}
                  className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="Seu nome completo"
                />
              </div>
              {errors.nome && (
                <p className="mt-1 text-xs text-destructive flex items-center gap-1">
                  <AlertCircle className="size-3" /> {errors.nome}
                </p>
              )}
            </div>

            {/* Email (read-only) */}
            <div>
              <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
                Email <span className="text-muted-foreground">(não editável)</span>
              </label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
                <input
                  type="email"
                  value={user?.email || ""}
                  disabled
                  className="w-full bg-secondary border border-border pl-10 pr-4 py-3 text-sm text-muted-foreground cursor-not-allowed"
                />
              </div>
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
                  onChange={(e) => setForm(p => ({ ...p, telefone: e.target.value }))}
                  className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                  placeholder="(11) 99999-9999"
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none flex items-center justify-center gap-2"
            >
              {saving ? (
                <span className="font-mono text-xs animate-pulse">SALVANDO...</span>
              ) : (
                <><Save className="size-4" /> SALVAR ALTERAÇÕES</>
              )}
            </button>
          </motion.form>
        )}
      </main>
    </div>
  );
};

export default Perfil;
