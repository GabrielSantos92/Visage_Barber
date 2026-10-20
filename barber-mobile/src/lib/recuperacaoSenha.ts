import { api } from './api';

// Chamadas ao backend para "Esqueceu a senha?". Rota publica: o backend
// responde sempre com a mesma mensagem, exista ou nao a conta.

export const SENHA_MIN = 6;

export function validarNovaSenha(senha: string, confirmacao: string): string | null {
  if (!senha) return 'Informe a nova senha.';
  if (senha.length < SENHA_MIN) return `A senha deve ter no mínimo ${SENHA_MIN} caracteres.`;
  if (new TextEncoder().encode(senha).length > 72) return 'A senha deve ter no máximo 72 caracteres.';
  if (senha !== confirmacao) return 'As senhas não coincidem.';
  return null;
}

// Erro de rede do fetch vira uma mensagem legivel
export function mensagemDeErro(err: unknown): string {
  if (err instanceof TypeError) return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
  return err instanceof Error ? err.message : 'Algo deu errado. Tente novamente.';
}

export const solicitarRecuperacaoEmail = (email: string, redirectTo: string) =>
  api.post<{ message: string }>('/api/auth/recuperar-senha/email', { email: email.trim(), redirectTo });
