// O UNICO cliente Supabase do backend. Nenhum outro arquivo de src/ chama
// createClient nem le SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY (o teste
// test/ambienteServidor.test.js confere). Toda chamada (banco, RPC, Auth,
// Storage) passa pelo fetch protegido da guarda (services/ambienteServidor.js):
// antes de o ambiente ser liberado, nada sai.
//
// Sem configuracao valida (BACKEND_AMBIENTE, URL e chave), o cliente aponta
// para um endereco que nunca e chamado: a guarda ja nasce bloqueada e recusa
// tudo. Nao ha chave reserva: nunca a anon nem outra.

const { createClient } = require('@supabase/supabase-js');
const { lerAmbienteServidor, criarGuardaAmbiente } = require('./ambienteServidor');

const config = lerAmbienteServidor(process.env);
const valido = config.problemas.length === 0;

let supabase = null;

// Marca do banco, lida pelo mesmo cliente das rotas
async function lerMarca() {
  const { data, error, status } = await supabase.rpc('ambiente_do_banco');
  return { marca: typeof data === 'string' ? data : null, erro: error ? { code: error.code ?? null, status: status ?? 0 } : null };
}

const guarda = criarGuardaAmbiente({ config, lerMarca });

supabase = createClient(
  valido ? config.url : 'https://ambiente-bloqueado.invalid',
  valido ? process.env.SUPABASE_SERVICE_ROLE_KEY.trim() : 'ambiente-bloqueado',
  {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { fetch: guarda.protegerFetch() },
  },
);

// RPC: devolve os dados ou lanca o erro do PostgREST ({ code, details, message })
async function chamar(nome, args) {
  const { data, error } = await supabase.rpc(nome, args);
  if (error) throw error;
  return data;
}

// Usuario do token de sessao (Supabase Auth) ou null
async function verificarToken(token) {
  const { data, error } = await supabase.auth.getUser(token);
  return error ? null : data?.user ?? null;
}

async function ehAdmin(userId) {
  const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin');
  if (error) throw error;
  return (data ?? []).length > 0;
}

module.exports = { supabase, guarda, ambiente: config.ambiente, chamar, verificarToken, ehAdmin };
