import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Scissors, Plus, X, Eye, EyeOff, AlertCircle, CheckCircle2, ToggleLeft, ToggleRight, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";

interface Barbeiro {
  id: string;
  nome: string;
  especialidade: string | null;
  ativo: boolean;
  user_id: string | null;
}

const AdminBarbeiros = () => {
  const { role, loading: authLoading } = useAuth();

  const [barbeiros, setBarbeiros]   = useState<Barbeiro[]>([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);

  const [nome, setNome]             = useState("");
  const [especialidade, setEsp]     = useState("");
  const [email, setEmail]           = useState("");
  const [senha, setSenha]           = useState("");
  const [telefone, setTelefone]     = useState("");
  const [showPass, setShowPass]     = useState(false);
  const [saving, setSaving]         = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  useEffect(() => { fetchBarbeiros(); }, []);

  async function fetchBarbeiros() {
    setLoading(true);
    const { data, error } = await supabase.from("barbeiros").select("*").order("nome");
    if (error) toast.error(error.message);
    else setBarbeiros(data ?? []);
    setLoading(false);
  }

  function validate() {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = "Nome é obrigatório";
    if (!email.trim()) e.email = "Email é obrigatório";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = "Email inválido";
    if (senha.length < 6) e.senha = "Senha deve ter no mínimo 6 caracteres";
    setFieldErrors(e);
    return Object.keys(e).length === 0;
  }

  async function handleCriar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validate()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/api/admin/create-barbeiro`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nome, email, password: senha, telefone: telefone || undefined, especialidade: especialidade || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Erro ao criar barbeiro");
      toast.success(`Barbeiro ${nome} criado com sucesso!`);
      setShowForm(false);
      resetForm();
      fetchBarbeiros();
    } catch (e: any) {
      toast.error(e.message);
    }
    setSaving(false);
  }

  function resetForm() {
    setNome(""); setEsp(""); setEmail(""); setSenha(""); setTelefone(""); setFieldErrors({});
  }

  async function toggleAtivo(b: Barbeiro) {
    const { error } = await supabase.from("barbeiros").update({ ativo: !b.ativo }).eq("id", b.id);
    if (error) toast.error(error.message);
    else fetchBarbeiros();
  }

  if (authLoading) return null;
  if (role !== "admin") return <Navigate to="/" replace />;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b border-border px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Link to="/" className="flex items-center gap-3">
            <div className="size-7 bg-primary flex items-center justify-center">
              <div className="size-3.5 bg-background" />
            </div>
            <span className="font-mono text-[10px] tracking-widest text-primary font-bold">
              METRIC // GROOMING
            </span>
          </Link>
          <span className="text-border">|</span>
          <span className="font-mono text-[10px] tracking-widest text-muted-foreground">ADMIN</span>
        </div>
        <Link to="/" className="font-mono text-[10px] tracking-widest text-muted-foreground hover:text-primary transition-colors flex items-center gap-1">
          <ArrowLeft className="size-3" /> VOLTAR
        </Link>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-10">
        {/* Page title */}
        <div className="flex items-end justify-between mb-8">
          <div>
            <p className="font-mono text-[10px] tracking-widest text-muted-foreground mb-2">GESTÃO</p>
            <h1 className="text-3xl font-light tracking-tighter text-primary flex items-center gap-3">
              <Scissors className="size-6" /> Barbeiros
            </h1>
          </div>
          <button
            onClick={() => { setShowForm(true); resetForm(); }}
            className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity"
          >
            <Plus className="size-3.5" /> NOVO BARBEIRO
          </button>
        </div>

        {/* Create form */}
        {showForm && (
          <div className="border border-border bg-card mb-8">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <span className="font-mono text-[10px] tracking-widest text-muted-foreground">NOVO BARBEIRO</span>
              <button onClick={() => setShowForm(false)} className="text-muted-foreground hover:text-primary transition-colors">
                <X className="size-4" />
              </button>
            </div>
            <form onSubmit={handleCriar} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Nome */}
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">Nome *</label>
                  <input
                    value={nome} onChange={e => { setNome(e.target.value); setFieldErrors(p => ({ ...p, nome: "" })); }}
                    className="w-full bg-background border border-border px-3 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                    placeholder="Nome completo"
                  />
                  {fieldErrors.nome && <p className="mt-1 text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {fieldErrors.nome}</p>}
                </div>

                {/* Especialidade */}
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">Especialidade</label>
                  <input
                    value={especialidade} onChange={e => setEsp(e.target.value)}
                    className="w-full bg-background border border-border px-3 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                    placeholder="Ex: Degradê, Navalhado"
                  />
                </div>

                {/* Telefone */}
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">Telefone</label>
                  <input
                    value={telefone} onChange={e => setTelefone(e.target.value)}
                    className="w-full bg-background border border-border px-3 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                    placeholder="(11) 99999-9999"
                  />
                </div>

                {/* Email */}
                <div>
                  <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">Email de acesso *</label>
                  <input
                    type="email" value={email} onChange={e => { setEmail(e.target.value); setFieldErrors(p => ({ ...p, email: "" })); }}
                    className="w-full bg-background border border-border px-3 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                    placeholder="barbeiro@email.com"
                  />
                  {fieldErrors.email && <p className="mt-1 text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {fieldErrors.email}</p>}
                </div>

                {/* Senha */}
                <div className="sm:col-span-2">
                  <label className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">Senha *</label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"} value={senha}
                      onChange={e => { setSenha(e.target.value); setFieldErrors(p => ({ ...p, senha: "" })); }}
                      className="w-full bg-background border border-border px-3 pr-12 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
                      placeholder="Mínimo 6 caracteres"
                    />
                    <button type="button" onClick={() => setShowPass(!showPass)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors">
                      {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  {fieldErrors.senha && <p className="mt-1 text-xs text-destructive flex items-center gap-1"><AlertCircle className="size-3" /> {fieldErrors.senha}</p>}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button type="button" onClick={() => setShowForm(false)} className="border border-border px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary transition-colors">
                  CANCELAR
                </button>
                <button type="submit" disabled={saving} className="bg-primary text-primary-foreground px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity disabled:opacity-50">
                  {saving ? "CRIANDO..." : "CRIAR BARBEIRO"}
                </button>
              </div>
            </form>
          </div>
        )}

        {/* Barbeiros list */}
        <div className="border border-border">
          {loading ? (
            <div className="py-16 text-center font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</div>
          ) : barbeiros.length === 0 ? (
            <div className="py-16 text-center font-mono text-xs text-muted-foreground">
              Nenhum barbeiro cadastrado.
            </div>
          ) : (
            barbeiros.map((b, i) => (
              <div key={b.id} className={`flex items-center gap-4 px-6 py-4 ${i < barbeiros.length - 1 ? "border-b border-border" : ""}`}>
                {/* Avatar */}
                <div className="size-9 border border-border bg-card flex items-center justify-center shrink-0">
                  <span className="font-mono text-sm text-primary">{b.nome[0].toUpperCase()}</span>
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm text-primary truncate">{b.nome}</p>
                  <p className="font-mono text-[10px] text-muted-foreground">{b.especialidade ?? "Sem especialidade"}</p>
                </div>

                {/* Auth status */}
                <div className="hidden sm:flex items-center gap-1.5">
                  {b.user_id ? (
                    <><CheckCircle2 className="size-3 text-green-500" /><span className="font-mono text-[9px] text-muted-foreground">COM ACESSO</span></>
                  ) : (
                    <><AlertCircle className="size-3 text-amber-500" /><span className="font-mono text-[9px] text-muted-foreground">SEM ACESSO</span></>
                  )}
                </div>

                {/* Toggle ativo */}
                <button onClick={() => toggleAtivo(b)} className="flex items-center gap-1.5 border border-border px-3 py-1.5 hover:bg-secondary transition-colors">
                  {b.ativo
                    ? <><ToggleRight className="size-4 text-primary" /><span className="font-mono text-[9px] text-primary tracking-widest">ATIVO</span></>
                    : <><ToggleLeft className="size-4 text-muted-foreground" /><span className="font-mono text-[9px] text-muted-foreground tracking-widest">INATIVO</span></>
                  }
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default AdminBarbeiros;
