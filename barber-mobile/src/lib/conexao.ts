// Falha de conexao (sem internet, rede instavel, tempo esgotado) x erro do
// servidor. O supabase-js nao lanca nesses casos: devolve { error } com a
// mensagem do fetch ("TypeError: Network request failed" no Android).
import { ErroConexao } from './api';

export const MENSAGEM_SEM_CONEXAO = 'Sem conexão com a internet. Verifique sua rede e tente novamente.';

const PADROES = [
  'network request failed', 'failed to fetch', 'fetch failed', 'networkerror', 'network error',
  'load failed', 'timeout', 'timed out', 'aborterror', 'internet',
];

export function ehFalhaDeConexao(erro: unknown): boolean {
  if (erro instanceof ErroConexao) return true;
  const texto = String((erro as { message?: unknown } | null)?.message ?? erro ?? '').toLowerCase();
  return PADROES.some((p) => texto.includes(p));
}

// Mensagem para mostrar ao usuario: falha de conexao vira um texto claro; os
// demais erros seguem com a mensagem de antes
export function mensagemDeErro(erro: unknown, padrao: string): string {
  if (ehFalhaDeConexao(erro)) return MENSAGEM_SEM_CONEXAO;
  const msg = (erro as { message?: unknown } | null)?.message;
  return typeof msg === 'string' && msg ? msg : padrao;
}
