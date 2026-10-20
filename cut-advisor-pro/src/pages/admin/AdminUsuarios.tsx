import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Search, Users } from "lucide-react";
import { format } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import AdminLayout from "@/components/admin/AdminNav";
import type { Tables } from "@/integrations/supabase/types";

type Usuario = Tables<"profiles">;

// Lista de usuarios cadastrados (profiles). Somente consulta, como no admin mobile.
const AdminUsuarios = () => {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");

  useEffect(() => { fetchUsuarios(); }, []);

  async function fetchUsuarios() {
    setLoading(true);
    const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) setErro(error.message);
    else { setErro(null); setUsuarios(data ?? []); }
    setLoading(false);
  }

  const visiveis = useMemo(() => {
    const termo = busca.trim().toLowerCase();
    if (!termo) return usuarios;
    return usuarios.filter((u) => [u.nome ?? "", u.telefone ?? ""].some((v) => v.toLowerCase().includes(termo)));
  }, [usuarios, busca]);

  return (
    <AdminLayout>
      <div className="flex flex-wrap items-end justify-between gap-4 mb-8">
        <div>
          <p className="font-mono text-[10px] tracking-widest text-muted-foreground mb-2">GESTÃO</p>
          <h1 className="text-3xl font-light tracking-tighter text-primary flex items-center gap-3">
            <Users className="size-6" /> Usuários
          </h1>
        </div>
        {!loading && !erro && (
          <div className="text-right">
            <p className="font-mono text-[9px] tracking-[0.2em] text-muted-foreground">TOTAL</p>
            <p className="font-mono text-2xl text-primary">{usuarios.length}</p>
          </div>
        )}
      </div>

      <div className="relative mb-4 max-w-md">
        <Search className="size-3.5 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={busca} onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          aria-label="Buscar usuários"
          className="w-full bg-background border border-border pl-9 pr-3 py-2.5 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
        />
      </div>

      <div className="border border-border overflow-x-auto">
        {loading ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</div>
        ) : erro ? (
          <div className="py-14 px-6 text-center">
            <AlertCircle className="size-6 text-destructive mx-auto mb-3" />
            <p className="text-sm text-primary mb-1">Não foi possível carregar os usuários.</p>
            <p className="font-mono text-[10px] text-muted-foreground mb-5">{erro}</p>
            <button
              onClick={fetchUsuarios}
              className="border border-border px-4 py-2 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary transition-colors"
            >
              Tentar novamente
            </button>
          </div>
        ) : usuarios.length === 0 ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground">Nenhum usuário cadastrado.</div>
        ) : visiveis.length === 0 ? (
          <div className="py-16 text-center font-mono text-xs text-muted-foreground">Nenhum usuário encontrado para essa busca.</div>
        ) : (
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border font-mono text-[9px] tracking-[0.2em] text-muted-foreground uppercase">
                <th className="px-6 py-3 font-normal">Usuário</th>
                <th className="px-4 py-3 font-normal">Telefone</th>
                <th className="px-6 py-3 font-normal text-right">Cadastro</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visiveis.map((u) => (
                <tr key={u.id} className="hover:bg-card/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="size-9 border border-border bg-card flex items-center justify-center shrink-0">
                        <span className="font-mono text-sm text-primary">{(u.nome || "U")[0].toUpperCase()}</span>
                      </div>
                      <p className="font-medium text-sm text-primary truncate">{u.nome || "(sem nome)"}</p>
                    </div>
                  </td>
                  <td className="px-4 py-4 font-mono text-[11px] text-foreground whitespace-nowrap">
                    {u.telefone || <span className="text-muted-foreground">Sem telefone</span>}
                  </td>
                  <td className="px-6 py-4 font-mono text-[10px] text-muted-foreground text-right whitespace-nowrap uppercase">
                    {format(new Date(u.created_at), "dd MMM yyyy", { locale: ptBR })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {!loading && !erro && usuarios.length > 0 && busca.trim() && (
        <p className="font-mono text-[10px] text-muted-foreground mt-3">
          {visiveis.length} de {usuarios.length} usuário(s)
        </p>
      )}
    </AdminLayout>
  );
};

export default AdminUsuarios;
