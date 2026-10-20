import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import LogoMark from "@/components/LogoMark";
import NovaSenhaForm from "@/components/auth/NovaSenhaForm";
import { encerrarRecuperacao, recuperacaoEmAndamento } from "@/lib/linkRecuperacao";

type Estado = "verificando" | "valido" | "invalido" | "concluido";

const ResetPassword = () => {
  const [estado, setEstado] = useState<Estado>("verificando");

  useEffect(() => {
    let ativo = true;
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && ativo) setEstado("valido");
    });

    if (!recuperacaoEmAndamento()) {
      setEstado("invalido");
    } else {
      // getSession espera o client terminar de processar o link. Sem sessao
      // (link recusado ou sessao ja encerrada) a recuperacao acabou.
      supabase.auth.getSession().then(({ data }) => {
        if (!ativo) return;
        if (!data.session) encerrarRecuperacao();
        setEstado((e) => (e === "verificando" ? (data.session ? "valido" : "invalido") : e));
      });
    }

    return () => { ativo = false; subscription.unsubscribe(); };
  }, []);

  const salvar = async (senha: string) => {
    const { error } = await supabase.auth.updateUser({ password: senha });
    if (error) {
      if (error.code === "same_password") return "A nova senha deve ser diferente da anterior.";
      if (error.code === "weak_password") return "Senha recusada: escolha uma senha mais forte.";
      if (error.status === 401 || error.code === "session_not_found" || error.code === "session_expired") {
        return "Este link expirou. Solicite um novo.";
      }
      return "Não foi possível alterar a senha. Tente novamente.";
    }
    // Encerra todas as sessoes (inclusive esta): o acesso volta pela nova senha
    await supabase.auth.signOut({ scope: "global" });
    encerrarRecuperacao();
    setEstado("concluido");
    return null;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-6 py-4 border-b border-border">
        <Link to="/" className="flex items-center gap-3">
          <LogoMark className="h-8" />
          <span className="font-mono text-[10px] tracking-widest text-primary font-bold">VISAGE BARBER</span>
        </Link>
      </div>

      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <motion.div
          key={estado}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="w-full max-w-sm"
        >
          {estado === "verificando" && (
            <p className="text-center font-mono text-xs text-foreground animate-pulse">VERIFICANDO LINK...</p>
          )}

          {estado === "invalido" && (
            <div className="text-center">
              <h1 className="text-2xl font-light tracking-tighter text-primary mb-4">
                LINK <span className="font-bold italic">INVÁLIDO</span>
              </h1>
              <p className="text-sm text-foreground mb-6">
                Este link de redefinição expirou, já foi usado ou é inválido.
              </p>
              <Link to="/forgot-password" className="text-sm text-primary font-bold hover:underline">
                Solicitar novo link
              </Link>
            </div>
          )}

          {estado === "valido" && (
            <>
              <div className="mb-8">
                <div className="inline-block px-2 py-1 border border-border mb-4">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">AUTH // RESET</span>
                </div>
                <h1 className="text-3xl font-light tracking-tighter text-primary leading-tight">
                  NOVA <br />
                  <span className="font-bold italic">SENHA</span>
                </h1>
              </div>
              <NovaSenhaForm onSalvar={salvar} />
            </>
          )}

          {estado === "concluido" && (
            <div>
              <div className="size-14 bg-card border border-border flex items-center justify-center mb-6">
                <CheckCircle className="size-7 text-primary" />
              </div>
              <h1 className="text-3xl font-light tracking-tighter text-primary leading-tight mb-4">
                SENHA <br />
                <span className="font-bold italic">ALTERADA</span>
              </h1>
              <p className="text-sm text-foreground mb-8">
                Sua senha foi redefinida e as sessões abertas foram encerradas. Entre novamente com a nova senha.
              </p>
              <Link
                to="/login"
                className="block text-center w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all hover:bg-accent hover:text-accent-foreground"
              >
                IR PARA O LOGIN
              </Link>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default ResetPassword;
