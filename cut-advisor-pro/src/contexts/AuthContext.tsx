import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Enums } from "@/integrations/supabase/types";
import { papelEfetivo } from "@/lib/areaDeLogin";

type AppRole = Enums<"app_role">;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);

  // A role chega depois da sessao. Enquanto a primeira busca de um usuario nao
  // termina, o contexto continua "carregando"; sem isso as paginas restritas
  // viam role nula ao recarregar e mandavam o admin de volta para a home.
  const [roleLoading, setRoleLoading] = useState(false);
  const roleUserId = useRef<string | null>(null);

  const fetchRole = async (userId: string) => {
    // Renovacoes de token do mesmo usuario nao voltam ao estado de carregando
    if (roleUserId.current !== userId) {
      roleUserId.current = userId;
      // O papel da conta anterior nao vale para esta
      setRole(null);
      setRoleLoading(true);
    }
    try {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", userId);
      // Resposta de uma conta que ja saiu (ex.: login recusado pela area, que
      // entra e sai em seguida): descarta
      if (roleUserId.current !== userId) return;
      // Prefer highest privilege: admin > barbeiro > cliente
      if (data && data.length > 0) setRole(papelEfetivo(data.map((r) => r.role)));
    } finally {
      if (roleUserId.current === userId) setRoleLoading(false);
    }
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          fetchRole(session.user.id);
        } else {
          roleUserId.current = null;
          setRole(null);
          setRoleLoading(false);
        }
        setLoading(false);
      }
    );

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchRole(session.user.id);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, role, loading: loading || roleLoading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};
