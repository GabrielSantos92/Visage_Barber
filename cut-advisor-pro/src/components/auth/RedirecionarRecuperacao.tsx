import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { consumirRedirecionamentoInicial } from "@/lib/linkRecuperacao";

// O link do e-mail de recuperacao pode cair em outra pagina (ex.: a Site URL,
// quando /reset-password nao esta nas Redirect URLs do Supabase). Sem isto o
// usuario entraria logado sem nunca ver a tela de nova senha.
const RedirecionarRecuperacao = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const irParaNovaSenha = () => {
      if (window.location.pathname !== "/reset-password") navigate("/reset-password", { replace: true });
    };

    // So troca de pagina depois que o client do Supabase leu o token da URL:
    // navegar antes apagaria o fragmento e a sessao de recuperacao se perderia.
    // getSession espera essa leitura terminar.
    if (consumirRedirecionamentoInicial()) {
      supabase.auth.getSession().finally(irParaNovaSenha);
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") irParaNovaSenha();
    });
    return () => subscription.unsubscribe();
  }, [navigate]);

  return null;
};

export default RedirecionarRecuperacao;
