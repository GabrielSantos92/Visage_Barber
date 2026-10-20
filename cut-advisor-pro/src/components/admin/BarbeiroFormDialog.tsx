import { useEffect, useState } from "react";
import { AlertCircle, Eye, EyeOff } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { apiPost } from "@/lib/api";
import { normalizarTelefoneBR } from "@/lib/whatsapp";

export interface BarbeiroEditavel {
  id: string;
  nome: string;
  especialidade: string | null;
}

interface Props {
  open: boolean;
  // null = criar um novo barbeiro
  barbeiro: BarbeiroEditavel | null;
  onClose: () => void;
  onSaved: () => void;
}

const inputCls =
  "w-full bg-background border border-border px-3 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors";
const labelCls = "font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2";

const FieldError = ({ msg }: { msg?: string }) =>
  msg ? (
    <p className="mt-1 text-xs text-destructive flex items-center gap-1">
      <AlertCircle className="size-3" /> {msg}
    </p>
  ) : null;

const BarbeiroFormDialog = ({ open, barbeiro, onClose, onSaved }: Props) => {
  const editando = !!barbeiro;

  const [nome, setNome] = useState("");
  const [especialidade, setEspecialidade] = useState("");
  const [telefone, setTelefone] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [saving, setSaving] = useState(false);
  const [erros, setErros] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    setNome(barbeiro?.nome ?? "");
    setEspecialidade(barbeiro?.especialidade ?? "");
    setTelefone(""); setEmail(""); setSenha(""); setShowPass(false); setErros({});
  }, [open, barbeiro]);

  const limparErro = (campo: string) => setErros((p) => ({ ...p, [campo]: "" }));

  function validar() {
    const e: Record<string, string> = {};
    if (!nome.trim()) e.nome = "Nome é obrigatório";
    if (!editando) {
      if (!email.trim()) e.email = "Email é obrigatório";
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) e.email = "Email inválido";
      if (!telefone.trim()) e.telefone = "Telefone é obrigatório";
      else if (!normalizarTelefoneBR(telefone)) e.telefone = "Telefone inválido. Informe DDD + número";
      if (senha.length < 6) e.senha = "Senha deve ter no mínimo 6 caracteres";
    }
    setErros(e);
    return Object.keys(e).length === 0;
  }

  async function salvar(ev: React.FormEvent) {
    ev.preventDefault();
    if (!validar()) return;
    setSaving(true);
    try {
      if (barbeiro) {
        const { error } = await supabase
          .from("barbeiros")
          .update({ nome: nome.trim(), especialidade: especialidade.trim() || null })
          .eq("id", barbeiro.id);
        if (error) throw error;
        toast.success("Barbeiro atualizado.");
      } else {
        await apiPost("/api/admin/create-barbeiro", {
          email: email.trim(),
          password: senha,
          nome: nome.trim(),
          telefone: telefone.trim(),
          especialidade: especialidade.trim() || undefined,
        });
        toast.success(`Barbeiro ${nome.trim()} criado com sucesso!`);
      }
      onSaved();
      onClose();
    } catch (e) {
      toast.error((e as { message?: string })?.message ?? "Erro ao salvar barbeiro.");
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={(aberto) => { if (!aberto && !saving) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-xl p-0 gap-0 border-border bg-background sm:rounded-none max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-border">
          <DialogTitle className="font-mono text-[10px] tracking-widest text-muted-foreground font-normal uppercase">
            {editando ? "Editar barbeiro" : "Novo barbeiro"}
          </DialogTitle>
        </div>

        <form onSubmit={salvar} className="p-6 space-y-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Nome *</label>
              <input
                value={nome} onChange={(e) => { setNome(e.target.value); limparErro("nome"); }}
                className={inputCls} placeholder="Nome completo" autoFocus
              />
              <FieldError msg={erros.nome} />
            </div>

            <div>
              <label className={labelCls}>Especialidade</label>
              <input
                value={especialidade} onChange={(e) => setEspecialidade(e.target.value)}
                className={inputCls} placeholder="Ex: Degradê, Navalhado"
              />
            </div>

            {!editando && (
              <>
                <div>
                  <label className={labelCls}>Telefone / WhatsApp *</label>
                  <input
                    type="tel" value={telefone} onChange={(e) => { setTelefone(e.target.value); limparErro("telefone"); }}
                    className={inputCls} placeholder="(11) 99999-9999"
                  />
                  <FieldError msg={erros.telefone} />
                </div>

                <div>
                  <label className={labelCls}>Email de acesso *</label>
                  <input
                    type="email" value={email} onChange={(e) => { setEmail(e.target.value); limparErro("email"); }}
                    className={inputCls} placeholder="barbeiro@email.com" autoComplete="off"
                  />
                  <FieldError msg={erros.email} />
                </div>

                <div className="sm:col-span-2">
                  <label className={labelCls}>Senha *</label>
                  <div className="relative">
                    <input
                      type={showPass ? "text" : "password"} value={senha}
                      onChange={(e) => { setSenha(e.target.value); limparErro("senha"); }}
                      className={`${inputCls} pr-12`} placeholder="Mínimo 6 caracteres" autoComplete="new-password"
                    />
                    <button
                      type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
                      aria-label={showPass ? "Ocultar senha" : "Mostrar senha"}
                    >
                      {showPass ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                    </button>
                  </div>
                  <FieldError msg={erros.senha} />
                </div>
              </>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button" onClick={onClose} disabled={saving}
              className="border border-border px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="bg-primary text-primary-foreground px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
            >
              {saving ? "Salvando..." : editando ? "Salvar alterações" : "Criar barbeiro"}
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
};

export default BarbeiroFormDialog;
