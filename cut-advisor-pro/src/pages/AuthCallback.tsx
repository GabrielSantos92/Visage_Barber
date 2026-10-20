import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { RETORNO_INICIAL, erroDoRetornoOAuth, preencherNomeDoGoogle } from "@/lib/loginGoogle";

const ESPERA_MAXIMA_MS = 10000;

// Retorno do login com Google. O client do Supabase le a sessao da URL ao
// iniciar; esta pagina so espera essa leitura e encaminha o usuario.
const AuthCallback = () => {
  const navigate = useNavigate();
  const iniciado = useRef(false);

  useEffect(() => {
    if (iniciado.current) return;
    iniciado.current = true;

    const falhar = (mensagem: string) => {
      toast.error(mensagem);
      navigate("/login", { replace: true });
    };

    const erro = erroDoRetornoOAuth(RETORNO_INICIAL.search, RETORNO_INICIAL.hash);
    if (erro) { falhar(erro); return; }

    // getSession espera o client terminar de ler a URL; o limite de tempo evita
    // que o usuario fique preso nesta tela se a rede nao responder
    const limite = new Promise<null>((resolve) => setTimeout(() => resolve(null), ESPERA_MAXIMA_MS));
    Promise.race([supabase.auth.getSession().then(({ data }) => data.session), limite])
      .then(async (session) => {
        if (!session) { falhar("Não foi possível concluir o login com Google. Tente novamente."); return; }
        await preencherNomeDoGoogle(session.user.id, session.user.user_metadata);
        toast.success("Login realizado com sucesso!");
        navigate("/", { replace: true });
      })
      .catch(() => falhar("Não foi possível concluir o login com Google. Tente novamente."));
  }, [navigate]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="font-mono text-xs text-muted-foreground animate-pulse">CONECTANDO...</div>
    </div>
  );
};

export default AuthCallback;
