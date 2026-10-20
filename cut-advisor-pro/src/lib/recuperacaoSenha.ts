import { apiPost } from "@/lib/api";

// Chamadas ao backend para "Esqueceu a senha?". Rota publica: o backend
// responde sempre com a mesma mensagem, exista ou nao a conta.

export const SENHA_MIN = 6;

export function validarNovaSenha(senha: string, confirmacao: string): { senha?: string; confirmacao?: string } {
  const erros: { senha?: string; confirmacao?: string } = {};
  if (!senha) erros.senha = "Senha é obrigatória";
  else if (senha.length < SENHA_MIN) erros.senha = `Mínimo ${SENHA_MIN} caracteres`;
  else if (new TextEncoder().encode(senha).length > 72) erros.senha = "Máximo 72 caracteres";
  if (senha !== confirmacao) erros.confirmacao = "Senhas não coincidem";
  return erros;
}

export const solicitarRecuperacaoEmail = (email: string, redirectTo: string) =>
  apiPost<{ message: string }>("/api/auth/recuperar-senha/email", { email: email.trim(), redirectTo });
