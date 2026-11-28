// Isolamento do backend por ambiente (services/ambienteServidor.js e
// services/supabaseServico.js):
//   * BACKEND_AMBIENTE explicito; ausente nunca vale como producao;
//   * teste nunca usa a URL de producao e so atende com o banco marcado;
//   * producao recusa banco marcado como teste e nao exige marca;
//   * um unico cliente Supabase; nenhuma chave reserva;
//   * bloqueado: TODAS as rotas respondem 503 e nenhuma chamada externa sai.
// O app real roda num processo separado (test/helpers/servidorIsolado.js) com
// ambiente ficticio e fetch falso: nada sai da maquina e nenhum Supabase real e
// usado. O chat nao tem rota no backend (o site e o app falam direto com o
// Supabase): ver o roteiro do ambiente de teste.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fork } = require('node:child_process');

const {
  lerAmbienteServidor, criarGuardaAmbiente, AmbienteBloqueadoErro, REFS_PRODUCAO, CAMINHO_MARCA,
} = require('../src/services/ambienteServidor');

const HELPER = path.join(__dirname, 'helpers', 'servidorIsolado.js');
const REF_TESTE = 'projetodetesteabcdefghij';
const URL_TESTE = `https://${REF_TESTE}.supabase.co`;
const URL_PRODUCAO = `https://${REFS_PRODUCAO[0]}.supabase.co`;
const CHAVE = 'chave-de-servico-ficticia-0123456789';
const SEGREDO = 'segredo-ficticio-das-notificacoes-0123456789';
const TOKENS = ['token-ficticio-do-numero-de-teste', 'token-ficticio-do-numero-de-producao', 'TEST-token-ficticio-mp'];
const ARQUIVOS_SEGREDOS = [CHAVE, SEGREDO, ...TOKENS, REF_TESTE, REFS_PRODUCAO[0], 'anon-ficticia-0123'];

const WHATSAPP = {
  teste: {
    NOTIFICACOES_WHATSAPP_ATIVO: 'true', WHATSAPP_AMBIENTE: 'teste', WHATSAPP_APP_SECRET: 'segredo-app-ficticio',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verificacao-ficticia-123456', WHATSAPP_TESTE_PHONE_NUMBER_ID: '900800700',
    WHATSAPP_TESTE_ACCESS_TOKEN: TOKENS[0], WHATSAPP_TESTE_TEMPLATE_CONFIRMACAO: 'confirmacao_teste',
    WHATSAPP_TESTE_DESTINATARIOS: '5511987654321',
  },
  producao: {
    NOTIFICACOES_WHATSAPP_ATIVO: 'true', WHATSAPP_AMBIENTE: 'producao', WHATSAPP_APP_SECRET: 'segredo-app-ficticio',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'verificacao-ficticia-123456', WHATSAPP_PHONE_NUMBER_ID: '100200300',
    WHATSAPP_ACCESS_TOKEN: TOKENS[1], WHATSAPP_TEMPLATE_CONFIRMACAO: 'confirmacao_presenca',
  },
};
const COMUM = { SUPABASE_SERVICE_ROLE_KEY: CHAVE, NOTIFICACOES_SEGREDO: SEGREDO, MERCADOPAGO_ACCESS_TOKEN: TOKENS[2] };

// ---------------------------------------------------------------
// 1. Leitura do ambiente
// ---------------------------------------------------------------
test('ambiente: explícito, sem fallback, teste nunca na URL de produção, desenvolvimento nunca no Render', () => {
  const ok = (env) => assert.deepEqual(lerAmbienteServidor(env).problemas, [], JSON.stringify(env));
  const recusa = (env, padrao) => {
    const { problemas } = lerAmbienteServidor(env);
    assert.ok(problemas.some((p) => padrao.test(p)), `${JSON.stringify(env)} -> ${problemas}`);
  };
  const base = { SUPABASE_URL: URL_TESTE, SUPABASE_SERVICE_ROLE_KEY: CHAVE };
  ok({ ...base, BACKEND_AMBIENTE: 'teste' });
  ok({ ...base, BACKEND_AMBIENTE: 'producao', SUPABASE_URL: URL_PRODUCAO });
  ok({ ...base, BACKEND_AMBIENTE: 'desenvolvimento' });
  // Ausente nao vira producao; valor desconhecido tambem nao
  for (const valor of [undefined, '', '  ', 'Producao', 'homologacao', 'prod']) {
    recusa({ ...base, BACKEND_AMBIENTE: valor }, /^BACKEND_AMBIENTE/);
    assert.equal(lerAmbienteServidor({ ...base, BACKEND_AMBIENTE: valor }).ambiente, null);
  }
  // Teste nunca na URL de producao (nem com barra no fim) nem fora do Supabase
  recusa({ ...base, BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_PRODUCAO }, /PRODUCAO/);
  recusa({ ...base, BACKEND_AMBIENTE: 'teste', SUPABASE_URL: `${URL_PRODUCAO}/` }, /PRODUCAO/);
  recusa({ ...base, BACKEND_AMBIENTE: 'teste', SUPABASE_URL: 'http://localhost:54321' }, /nao e de um projeto Supabase/);
  // Sem a chave de servico: nada (a anon nunca e usada no lugar)
  recusa({ BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, SUPABASE_ANON_KEY: 'anon-ficticia-0123' }, /SUPABASE_SERVICE_ROLE_KEY ausente/);
  recusa({ BACKEND_AMBIENTE: 'producao', SUPABASE_SERVICE_ROLE_KEY: CHAVE }, /SUPABASE_URL ausente/);
  // Desenvolvimento e so local
  recusa({ ...base, BACKEND_AMBIENTE: 'desenvolvimento', RENDER: 'true' }, /Render/);
  // A chave nunca sai da leitura
  assert.doesNotMatch(JSON.stringify(lerAmbienteServidor({ ...base, BACKEND_AMBIENTE: 'teste' })), new RegExp(CHAVE));
});

// ---------------------------------------------------------------
// 2. Guarda: estados, fetch protegido e tarefas automaticas
// ---------------------------------------------------------------
function criarLog() {
  const linhas = [];
  const r = (...p) => linhas.push(p.join(' '));
  return { linhas, log: r, info: r, warn: r, error: r };
}

test('guarda: nada sai antes de liberar; só a leitura da marca passa enquanto confere', async () => {
  const log = criarLog();
  const agendadas = [];
  let respostas = [{ marca: null, erro: { code: null, status: 0 } }, { marca: null, erro: { code: null, status: 401 } }, { marca: 'teste', erro: null }];
  const guarda = criarGuardaAmbiente({
    config: lerAmbienteServidor({ BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, SUPABASE_SERVICE_ROLE_KEY: CHAVE }),
    lerMarca: async () => respostas.shift(),
    log,
    agendar: (fn, ms) => agendadas.push(ms),
  });
  const saidas = [];
  const fetchProtegido = guarda.protegerFetch(async (url) => { saidas.push(url); return { ok: true }; });
  let iniciadas = 0;
  guarda.aoLiberar(() => { iniciadas += 1; });

  // Conferindo: so a marca (POST) passa
  await assert.rejects(fetchProtegido(`${URL_TESTE}/rest/v1/agendamentos?select=*`), AmbienteBloqueadoErro);
  await assert.rejects(fetchProtegido(`${URL_TESTE}/auth/v1/user`), AmbienteBloqueadoErro);
  await assert.rejects(fetchProtegido(`${URL_TESTE}${CAMINHO_MARCA}`, { method: 'GET' }), AmbienteBloqueadoErro);
  await fetchProtegido(`${URL_TESTE}${CAMINHO_MARCA}`, { method: 'POST' });
  assert.equal(saidas.length, 1);

  // Banco fora e chave recusada: continua bloqueado, confere de novo com espera crescente
  assert.equal(await guarda.conferir(), false);
  assert.equal(await guarda.conferir(), false);
  assert.deepEqual(agendadas, [5000, 15000]);
  assert.deepEqual(guarda.estado(), { estado: 'conferindo', ambiente: 'teste', motivo: 'acesso_recusado_pelo_banco' });
  assert.equal(iniciadas, 0, 'nenhuma tarefa automática antes de liberar');
  // Middleware: 503 enquanto confere
  const res = { status(c) { this.c = c; return this; }, json(b) { this.b = b; return this; } };
  let passou = false;
  guarda.middleware({}, res, () => { passou = true; });
  assert.deepEqual([passou, res.c, res.b.code], [false, 503, 'AMBIENTE_CONFERINDO']);

  // Banco marcado: libera, inicia as tarefas uma vez e o fetch passa
  assert.equal(await guarda.conferir(), true);
  assert.equal(iniciadas, 1);
  await fetchProtegido(`${URL_TESTE}/rest/v1/agendamentos`);
  assert.equal(saidas.length, 2);
  guarda.middleware({}, res, () => { passou = true; });
  assert.equal(passou, true);
  assert.doesNotMatch(log.linhas.join('\n'), new RegExp(`${CHAVE}|${REF_TESTE}`));
});

test('guarda: motivo definitivo bloqueia de vez (sem nova leitura) e configuração inválida nem lê o banco', async () => {
  let leituras = 0;
  const marcaSem = async () => { leituras += 1; return { marca: null, erro: { code: 'PGRST202', status: 404 } }; };
  const g1 = criarGuardaAmbiente({
    config: lerAmbienteServidor({ BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, SUPABASE_SERVICE_ROLE_KEY: CHAVE }),
    lerMarca: marcaSem, log: criarLog(), agendar: () => assert.fail('não deveria tentar de novo'),
  });
  assert.equal(await g1.conferir(), false);
  assert.equal(await g1.conferir(), false);
  assert.equal(leituras, 1);
  assert.deepEqual(g1.estado(), { estado: 'bloqueado', ambiente: 'teste', motivo: 'banco_sem_marca_de_teste' });
  await assert.rejects(g1.protegerFetch(async () => ({}))(`${URL_TESTE}${CAMINHO_MARCA}`, { method: 'POST' }), AmbienteBloqueadoErro);

  const log = criarLog();
  const g2 = criarGuardaAmbiente({ config: lerAmbienteServidor({ SUPABASE_URL: URL_PRODUCAO, SUPABASE_SERVICE_ROLE_KEY: CHAVE }), lerMarca: marcaSem, log });
  assert.equal(await g2.conferir(), false);
  assert.equal(leituras, 1, 'sem BACKEND_AMBIENTE o banco nem é lido');
  assert.match(log.linhas.join('\n'), /backend BLOQUEADO: BACKEND_AMBIENTE ausente/);
  assert.doesNotMatch(log.linhas.join('\n'), new RegExp(`${CHAVE}|${REFS_PRODUCAO[0]}`));
});

// ---------------------------------------------------------------
// 3. Codigo: um cliente Supabase so
// ---------------------------------------------------------------
test('código: só services/supabaseServico.js cria cliente Supabase ou lê as credenciais; sem chave reserva', () => {
  const raiz = path.join(__dirname, '..', 'src');
  const arquivos = [];
  const andar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) andar(p);
      else if (e.name.endsWith('.js')) arquivos.push(p);
    }
  };
  andar(raiz);
  const relativo = (p) => path.relative(raiz, p).split(path.sep).join('/');
  const usam = (rx) => arquivos.filter((p) => rx.test(fs.readFileSync(p, 'utf8'))).map(relativo).sort();
  assert.deepEqual(usam(/@supabase\/supabase-js|createClient\s*\(/), ['services/supabaseServico.js']);
  assert.deepEqual(usam(/process\.env(\.|\[['"])SUPABASE_/), ['services/supabaseServico.js']);
  assert.deepEqual(usam(/SUPABASE_ANON_KEY/), [], 'nenhuma chave reserva');
  // O app passa todo /api pela guarda antes de montar qualquer rota
  const app = fs.readFileSync(path.join(raiz, 'app.js'), 'utf8');
  const guarda = app.indexOf("app.use('/api', guarda.middleware)");
  assert.ok(guarda > 0);
  for (const m of app.matchAll(/app\.use\('\/api\/[a-z]+'/g)) assert.ok(m.index > guarda, m[0]);
});

// ---------------------------------------------------------------
// 4. O app real, em processo separado, com o banco errado e com o certo
// ---------------------------------------------------------------
const ROTAS = [
  ['pagamentos: formas disponíveis', 'GET', '/api/pagamentos/config'],
  ['clientes: recuperar senha', 'POST', '/api/auth/recuperar-senha/email', { email: 'cliente@exemplo.invalid' }],
  ['administração: métricas', 'GET', '/api/admin/metrics'],
  ['barbeiros: criar', 'POST', '/api/admin/create-barbeiro', { email: 'b@exemplo.invalid', password: 'senha-ficticia', nome: 'B', telefone: '11987654321' }],
  ['barbeiros: excluir', 'DELETE', '/api/admin/barbeiros/00000000-0000-4000-8000-000000000000'],
  ['consentimento: ler', 'GET', '/api/privacidade/consentimentos/whatsapp_avisos'],
  ['consentimento: conceder', 'POST', '/api/privacidade/consentimentos/whatsapp_avisos', { versao: '2026-11-16', origem: 'web' }],
  ['consentimento: revogar', 'POST', '/api/privacidade/consentimentos/whatsapp_avisos/revogar', { origem: 'web' }],
  ['agendamentos e pagamentos: cobrar', 'POST', '/api/pagamentos', { agendamento_id: '00000000-0000-4000-8000-000000000000', metodo: 'pix' }],
  ['pagamentos: sincronizar', 'POST', '/api/pagamentos/00000000-0000-4000-8000-000000000000/sincronizar'],
  ['pagamentos: reembolsar', 'POST', '/api/pagamentos/00000000-0000-4000-8000-000000000000/reembolsar', {}],
  ['pagamentos: cobranças abertas', 'POST', '/api/pagamentos/cobrancas-abertas/cancelar', {}],
  ['webhook do Mercado Pago', 'POST', '/api/pagamentos/webhook?data.id=1&type=payment', { type: 'payment', data: { id: '1' } }],
  ['notificações: fila (chamada do banco, com o segredo certo)', 'POST', '/api/notificacoes/processar', null, { 'X-Notificacoes-Segredo': SEGREDO }],
  ['notificações: teste', 'POST', '/api/notificacoes/teste', {}],
  ['webhook da Meta: verificação', 'GET', '/api/whatsapp/webhook?hub.mode=subscribe&hub.challenge=123&hub.verify_token=verificacao-ficticia-123456'],
  ['webhook da Meta: eventos', 'POST', '/api/whatsapp/webhook', { object: 'whatsapp_business_account', entry: [] }],
  ['visagismo: análise', 'POST', '/api/visagismo/analisar', {}],
  ['visagismo: imagem', 'POST', '/api/visagismo/imagem-referencia', {}],
  ['recomendação', 'POST', '/api/recommendation', {}],
  ['recomendação: formatos', 'GET', '/api/recommendation/formatos'],
];

const filhos = [];
after(() => { for (const f of filhos) f.kill(); });

async function subirServidor({ env, banco = 'sem_marca' }) {
  const ambiente = Object.fromEntries(Object.entries({
    PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, CENARIO_BANCO: banco, ...env,
  }).filter(([, v]) => v !== undefined));
  const filho = fork(HELPER, [], { env: ambiente, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  filhos.push(filho);
  let saida = '';
  filho.stdout.on('data', (d) => { saida += d; });
  filho.stderr.on('data', (d) => { saida += d; });
  const pronto = await new Promise((ok, erro) => {
    filho.once('message', ok);
    filho.once('exit', (c) => erro(new Error(`o servidor saiu (${c}): ${saida}`)));
  });
  return {
    base: `http://127.0.0.1:${pronto.porta}`,
    estado: pronto.estado,
    saida: () => saida,
    pedidos: () => new Promise((ok) => {
      filho.once('message', (m) => ok(m.pedidos));
      filho.send({ tipo: 'pedidos' });
    }),
    encerrar: () => filho.kill(),
  };
}

async function pedir(base, [, metodo, caminho, corpo = null, cabecalhos = {}]) {
  const r = await fetch(base + caminho, {
    method: metodo,
    headers: { Authorization: 'Bearer token-de-sessao-ficticio', ...(corpo ? { 'Content-Type': 'application/json' } : {}), ...cabecalhos },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  let json = null;
  try { json = await r.json(); } catch { json = null; }
  return { status: r.status, json };
}

const semSegredos = (texto, contexto) => {
  for (const s of ARQUIVOS_SEGREDOS) assert.ok(!texto.includes(s), `${contexto}: vazou um valor configurado`);
};

const BLOQUEADOS = [
  // Backend de teste ligado a um banco sem a marca (o de producao, com a URL trocada)
  ['teste com o banco errado (sem a marca)', { BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, ...WHATSAPP.teste }, 'sem_marca', 'AMBIENTE_BLOQUEADO', 1],
  // Teste apontando para a URL de producao: nem chega a ler o banco
  ['teste com a URL de produção', { BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_PRODUCAO, ...WHATSAPP.teste }, 'marcado', 'AMBIENTE_BLOQUEADO', 0],
  // Sem BACKEND_AMBIENTE: nada, nem com a URL de producao
  ['sem BACKEND_AMBIENTE', { SUPABASE_URL: URL_PRODUCAO, WHATSAPP_AMBIENTE: 'producao' }, 'sem_marca', 'AMBIENTE_BLOQUEADO', 0],
  ['BACKEND_AMBIENTE desconhecido', { BACKEND_AMBIENTE: 'homologacao', SUPABASE_URL: URL_TESTE }, 'marcado', 'AMBIENTE_BLOQUEADO', 0],
  // Producao ligada a um banco de teste
  ['produção com banco de teste', { BACKEND_AMBIENTE: 'producao', SUPABASE_URL: URL_TESTE, ...WHATSAPP.producao }, 'marcado', 'AMBIENTE_BLOQUEADO', 1],
  // Sem a chave de servico (com a anon): sem chave reserva
  ['sem a chave de serviço', { BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, SUPABASE_SERVICE_ROLE_KEY: '', SUPABASE_ANON_KEY: 'anon-ficticia-0123' }, 'marcado', 'AMBIENTE_BLOQUEADO', 0],
  // Desenvolvimento no Render
  ['desenvolvimento no Render', { BACKEND_AMBIENTE: 'desenvolvimento', RENDER: 'true', SUPABASE_URL: URL_PRODUCAO }, 'sem_marca', 'AMBIENTE_BLOQUEADO', 0],
  // Banco fora do ar ou chave de outro projeto: bloqueado enquanto confere de novo
  ['teste com o banco fora do ar', { BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, ...WHATSAPP.teste }, 'fora', 'AMBIENTE_CONFERINDO', 1],
  ['teste com chave de outro projeto', { BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, ...WHATSAPP.teste }, 'chave_recusada', 'AMBIENTE_CONFERINDO', 1],
];

for (const [nome, env, banco, codigo, leituras] of BLOQUEADOS) {
  test(`bloqueado (${nome}): todas as rotas respondem 503 e nada sai além da leitura da marca`, async () => {
    const s = await subirServidor({ env: { ...COMUM, ...env }, banco });
    try {
      const saude = await fetch(`${s.base}/health`);
      assert.equal(saude.status, 503);
      for (const rota of ROTAS) {
        const r = await pedir(s.base, rota);
        assert.deepEqual([r.status, r.json?.code], [503, codigo], rota[0]);
        semSegredos(JSON.stringify(r.json), rota[0]);
      }
      await new Promise((ok) => setTimeout(ok, 150));
      const pedidos = await s.pedidos();
      assert.equal(pedidos.length, leituras, JSON.stringify(pedidos.map((p) => new URL(p.url).pathname)));
      for (const p of pedidos) {
        assert.equal(new URL(p.url).pathname, CAMINHO_MARCA);
        assert.equal(p.metodo, 'POST');
      }
      semSegredos(s.saida(), 'log');
    } finally {
      s.encerrar();
    }
  });
}

test('liberado (teste com o banco marcado): rotas atendem pelo mesmo cliente e as filas só começam depois', async () => {
  const s = await subirServidor({ env: { ...COMUM, BACKEND_AMBIENTE: 'teste', SUPABASE_URL: URL_TESTE, ...WHATSAPP.teste }, banco: 'marcado' });
  try {
    assert.deepEqual(s.estado, { estado: 'liberado', ambiente: 'teste', motivo: null });
    const saude = await fetch(`${s.base}/health`);
    assert.deepEqual([saude.status, await saude.json()], [200, { status: 'ok', servico: 'BarberPro API', ambiente: 'teste' }]);
    // Passa da guarda e chega ao Supabase Auth do projeto de teste (token ficticio: 401)
    const r = await pedir(s.base, ROTAS.find((x) => x[0] === 'consentimento: ler'));
    assert.equal(r.status, 401);
    let pedidos = [];
    for (let i = 0; i < 40 && !pedidos.some((p) => p.url.endsWith('/rest/v1/rpc/reservar_whatsapp')); i++) {
      await new Promise((ok) => setTimeout(ok, 50));
      pedidos = await s.pedidos();
    }
    const caminhos = pedidos.map((p) => new URL(p.url).pathname);
    assert.equal(caminhos[0], CAMINHO_MARCA, 'a primeira chamada é a leitura da marca');
    assert.ok(caminhos.indexOf('/rest/v1/rpc/reservar_whatsapp') > 0, 'a fila do WhatsApp começou depois de liberar');
    assert.ok(caminhos.includes('/auth/v1/user'));
    // Tudo para o projeto de teste; nada para a Meta (a fila estava vazia)
    for (const p of pedidos) assert.equal(new URL(p.url).host, `${REF_TESTE}.supabase.co`);
    assert.match(s.saida(), /WhatsApp ligado no ambiente teste/);
    semSegredos(s.saida(), 'log');
  } finally {
    s.encerrar();
  }
});

test('liberado (produção sem a marca de teste) e desenvolvimento local; o WhatsApp não liga fora do próprio ambiente', async () => {
  // Producao: le a marca (inexistente) e libera; sem WhatsApp configurado, nenhuma fila
  const p = await subirServidor({ env: { ...COMUM, BACKEND_AMBIENTE: 'producao', SUPABASE_URL: URL_PRODUCAO }, banco: 'sem_marca' });
  try {
    assert.deepEqual(p.estado, { estado: 'liberado', ambiente: 'producao', motivo: null });
    assert.equal((await fetch(`${p.base}/health`)).status, 200);
    await new Promise((ok) => setTimeout(ok, 150));
    assert.deepEqual((await p.pedidos()).map((x) => new URL(x.url).pathname), [CAMINHO_MARCA]);
  } finally {
    p.encerrar();
  }
  // Desenvolvimento local: libera sem ler a marca; o WhatsApp de teste configurado NAO liga
  const d = await subirServidor({ env: { ...COMUM, BACKEND_AMBIENTE: 'desenvolvimento', SUPABASE_URL: URL_TESTE, ...WHATSAPP.teste }, banco: 'sem_marca' });
  try {
    assert.deepEqual(d.estado, { estado: 'liberado', ambiente: 'desenvolvimento', motivo: null });
    await new Promise((ok) => setTimeout(ok, 150));
    assert.deepEqual(await d.pedidos(), []);
    assert.match(d.saida(), /WhatsApp pedido, mas desligado: falta BACKEND_AMBIENTE igual a WHATSAPP_AMBIENTE/);
    const webhook = await pedir(d.base, ROTAS.find((x) => x[0] === 'webhook da Meta: eventos'));
    assert.deepEqual([webhook.status, webhook.json.code], [503, 'DESATIVADO']);
  } finally {
    d.encerrar();
  }
});
