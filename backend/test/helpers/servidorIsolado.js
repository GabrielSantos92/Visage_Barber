// Executado pelo teste test/ambienteServidor.test.js num processo SEPARADO
// (child_process.fork), com o ambiente que o teste montar (sem herdar o da
// maquina) e um fetch global falso: nenhuma chamada sai da maquina.
//
// Sobe o app real (src/app.js, as mesmas rotas e a mesma guarda) e faz o que o
// app.js faz ao subir: tarefas automaticas so depois de liberado, e a
// conferencia do banco. Registra toda chamada externa que o backend tentar
// (Supabase, Meta, Mercado Pago, IA) e a entrega ao teste pela IPC.
//
// CENARIO_BANCO: como o "Supabase" falso responde a leitura da marca
//   sem_marca       funcao inexistente (PGRST202): banco de producao
//   marcado         'teste': banco de teste marcado
//   fora            falha de rede: banco inacessivel
//   chave_recusada  401: chave de outro projeto

const pedidos = [];
const cenario = process.env.CENARIO_BANCO || 'sem_marca';

globalThis.fetch = async (entrada, init = {}) => {
  const url = typeof entrada === 'string' ? entrada : String(entrada?.url ?? entrada);
  pedidos.push({ url, metodo: String(init.method ?? 'GET').toUpperCase() });
  const json = (status, corpo) => new Response(JSON.stringify(corpo), {
    status, headers: { 'content-type': 'application/json' },
  });
  if (url.endsWith('/rest/v1/rpc/ambiente_do_banco')) {
    if (cenario === 'fora') throw new TypeError('fetch failed');
    if (cenario === 'chave_recusada') return json(401, { message: 'Invalid API key' });
    if (cenario === 'marcado') return json(200, 'teste');
    return json(404, { code: 'PGRST202', message: 'Could not find the function' });
  }
  if (url.includes('/auth/v1/user')) return json(401, { message: 'invalid JWT' });
  if (url.includes('/rest/v1/rpc/')) return json(200, []);
  return json(200, {});
};

process.on('message', (m) => {
  if (m?.tipo === 'pedidos') process.send({ tipo: 'pedidos', pedidos: pedidos.slice() });
});

const { app, guarda, iniciarNotificacoes } = require('../../src/app');

const servidor = app.listen(0, '127.0.0.1', async () => {
  guarda.aoLiberar(() => iniciarNotificacoes());
  await guarda.conferir().catch(() => {});
  process.send({ tipo: 'pronto', porta: servidor.address().port, estado: guarda.estado() });
});
