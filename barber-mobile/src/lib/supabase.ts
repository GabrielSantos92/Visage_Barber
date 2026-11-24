import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { Database } from '../types/supabase';
import { observarRequisicao } from './cacheLocal';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// Limite de espera da renovacao do token. No Android o fetch nao tem tempo
// limite: com internet instavel a renovacao podia ficar pendurada e, como o
// supabase-js faz as outras chamadas esperarem por ela, o app inteiro ficava
// carregando. Interrompida, ela conta como falha de rede: o supabase-js mantem
// a sessao salva e tenta de novo depois (a cada 30 s).
export const LIMITE_RENOVACAO_MS = 20 * 1000;

const urlDe = (input: RequestInfo | URL) =>
  typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;

function autorizacaoDe(init?: RequestInit): string | null {
  try {
    return new Headers(init?.headers).get('Authorization');
  } catch {
    return null;
  }
}

// fetch do cliente do Supabase. So observa e limita; nao muda nenhuma requisicao:
//   - consultas de dados (/rest/v1): avisa o cache local se sairam sem a sessao
//     da conta ativa (lib/cacheLocal), no envio e na resposta;
//   - renovacao do token: interrompe depois de LIMITE_RENOVACAO_MS.
export async function fetchDoApp(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = urlDe(input);
  if (url.includes('/rest/v1/')) {
    const autorizacao = autorizacaoDe(init);
    observarRequisicao(autorizacao, supabaseAnonKey);
    try {
      return await fetch(input, init);
    } finally {
      observarRequisicao(autorizacao, supabaseAnonKey);
    }
  }
  if (url.includes('/auth/v1/token') && url.includes('grant_type=refresh_token')) {
    const controle = new AbortController();
    const externo = init?.signal;
    if (externo?.aborted) controle.abort();
    else externo?.addEventListener('abort', () => controle.abort());
    const limite = setTimeout(() => controle.abort(), LIMITE_RENOVACAO_MS);
    try {
      return await fetch(input, { ...init, signal: controle.signal });
    } finally {
      clearTimeout(limite);
    }
  }
  return fetch(input, init);
}

export const supabase = createClient<Database>(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  global: { fetch: fetchDoApp },
});
