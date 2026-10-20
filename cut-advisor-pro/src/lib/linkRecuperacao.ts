// Fragmento da URL na carga da pagina. O link de recuperacao do Supabase chega como
//   #access_token=...&type=recovery                    (valido)
//   #error=access_denied&error_code=otp_expired...      (expirado ou ja usado)
// e o client do Supabase limpa esse fragmento ao iniciar, entao ele e lido aqui,
// durante a carga dos modulos, antes de qualquer resposta de rede.
export const HASH_INICIAL = typeof window !== "undefined" ? window.location.hash : "";

const params = new URLSearchParams(HASH_INICIAL.replace(/^#/, ""));

export const linkRecuperacaoValido = params.get("type") === "recovery" && !params.get("error");
export const linkRecuperacaoExpirado = params.get("error_code") === "otp_expired";

// Lembra, so nesta aba, que a recuperacao esta em andamento: recarregar a
// pagina de nova senha nao pode descartar o link ja aberto
const CHAVE = "visage-recuperacao-senha";

function gravar(valor: boolean) {
  try {
    if (valor) sessionStorage.setItem(CHAVE, "1");
    else sessionStorage.removeItem(CHAVE);
  } catch {
    // sessionStorage indisponivel (modo privado restrito): segue so com o fragmento
  }
}

if (linkRecuperacaoValido) gravar(true);
else if (linkRecuperacaoExpirado) gravar(false);

// Depois de salvar a senha (ou sem sessao) o link da carga da pagina nao vale mais
let encerrada = false;

export function recuperacaoEmAndamento(): boolean {
  if (encerrada) return false;
  if (linkRecuperacaoValido) return true;
  try {
    return sessionStorage.getItem(CHAVE) === "1";
  } catch {
    return false;
  }
}

export function encerrarRecuperacao() {
  encerrada = true;
  gravar(false);
}

// O link so deve levar a tela de nova senha uma vez por carga da pagina
let redirecionamentoPendente = linkRecuperacaoValido || linkRecuperacaoExpirado;

export function consumirRedirecionamentoInicial(): boolean {
  const pendente = redirecionamentoPendente;
  redirecionamentoPendente = false;
  return pendente;
}
