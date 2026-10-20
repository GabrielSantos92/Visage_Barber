import { supabase } from "@/integrations/supabase/client";

// Login com Google pelo OAuth do Supabase Auth. O Google devolve o usuario ao
// Supabase, que redireciona para /auth/callback com a sessao (ou com o erro).

export const ROTA_CALLBACK = "/auth/callback";

// Parametros da URL na carga da pagina: o client do Supabase limpa o fragmento
// ao iniciar, entao o erro do provedor e lido aqui, durante a carga dos modulos
export const RETORNO_INICIAL =
  typeof window !== "undefined" ? { search: window.location.search, hash: window.location.hash } : { search: "", hash: "" };

// Erro devolvido pelo Supabase/Google no retorno (query string ou fragmento).
// null = nenhum erro na URL.
export function erroDoRetornoOAuth(search: string, hash: string): string | null {
  const query = new URLSearchParams(search);
  const fragmento = new URLSearchParams(hash.replace(/^#/, ""));
  const erro = query.get("error") ?? fragmento.get("error");
  if (!erro) return null;
  // access_denied: o usuario fechou ou recusou a tela de consentimento do Google
  if (erro === "access_denied") return "Login com Google cancelado.";
  return "Não foi possível entrar com Google. Tente novamente.";
}

// O provedor precisa estar habilitado no painel do Supabase; sem isso o usuario
// seria levado a uma pagina de erro em JSON. Se a consulta falhar, segue adiante.
async function googleHabilitado(): Promise<boolean> {
  try {
    const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/auth/v1/settings`, {
      headers: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY },
    });
    if (!res.ok) return true;
    const dados = await res.json();
    return dados?.external?.google !== false;
  } catch {
    return true;
  }
}

// Leva o navegador para o Google. Devolve a mensagem de erro, ou null quando o
// redirecionamento foi iniciado.
export async function iniciarLoginGoogle(): Promise<string | null> {
  if (!(await googleHabilitado())) return "O login com Google ainda não está habilitado. Entre com email e senha.";

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}${ROTA_CALLBACK}`,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error) {
    console.error("[login-google]", error.message);
    return "Não foi possível iniciar o login com Google. Tente novamente.";
  }
  return null;
}

// Contas criadas pelo Google chegam sem "nome" no metadata usado pelo cadastro,
// e o perfil nasce com o nome vazio. Preenche so nesse caso: um nome ja
// cadastrado nunca e alterado.
export async function preencherNomeDoGoogle(userId: string, metadata: Record<string, unknown> | undefined) {
  const nome = [metadata?.full_name, metadata?.name].find((v) => typeof v === "string" && v.trim()) as string | undefined;
  if (!nome) return;
  const { error } = await supabase.from("profiles").update({ nome: nome.trim() }).eq("user_id", userId).eq("nome", "");
  if (error) console.error("[login-google] nome do perfil não preenchido:", error.message);
}
