// Confirmacao de presenca pelo WhatsApp de ponta a ponta no backend: rotas
// reais (webhook e /processar), fila e regras no banco (PGlite com a migration
// 25) e o cliente da Cloud API falando com uma Meta falsa. Nenhuma mensagem
// real e enviada e nenhum servico externo e chamado.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');

const {
  criarBanco, MIGRATIONS_WHATSAPP, JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');
const { criarWhatsApp, assinaturaConfere, extrairEventos } = require('../src/services/whatsapp');
const { criarConfirmacaoPresenca, dataEHora } = require('../src/services/confirmacaoPresenca');
const { lerConfiguracao } = require('../src/services/notificacoesConfig');

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-0123';
const APP_SECRET = 'segredo-do-app-de-teste';
const VERIFY = 'token-de-verificacao-teste';
const TOKEN_META = 'token-de-acesso-de-teste';
const NUMERO_ID = '100200300';
const TEL_A = '5511987654321';
const TEL_B = '5521998765432';
const TEL_JOAO = '5511912345678';

// ---------------------------------------------------------------
// Meta falsa: mesmo caminho e mesmos formatos da Cloud API
// ---------------------------------------------------------------
function criarMetaFalsa() {
  const pedidos = [];
  const estado = { modo: 'ok' };
  let seq = 0;
  const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  async function fetchFalso(url, init) {
    const corpo = JSON.parse(init.body);
    pedidos.push({ url, headers: init.headers, corpo });
    if (estado.modo === 'timeout') {
      return new Promise((_, rejeitar) => init.signal.addEventListener('abort',
        () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    if (estado.modo === 'sem_rede') throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } });
    if (estado.modo === 'rede') throw new TypeError('fetch failed');
    if (estado.modo === 'limite') return resposta(429, { error: { code: 130429, message: `limite para ${corpo.to}` } });
    if (estado.modo === 'http500') return resposta(500, { error: { code: 1, message: 'erro interno' } });
    if (estado.modo === 'sem_whatsapp') return resposta(400, { error: { code: 131026, message: `${corpo.to} nao recebe` } });
    if (estado.modo === 'sem_id') return resposta(200, { messages: [] });
    // A Meta devolve o celular brasileiro sem o 9 inicial
    const waId = corpo.to.replace(/^(55\d\d)9(\d{8})$/, '$1$2');
    return resposta(200, { messaging_product: 'whatsapp', contacts: [{ input: corpo.to, wa_id: waId }], messages: [{ id: `wamid.T${++seq}` }] });
  }
  return {
    fetch: fetchFalso, pedidos, estado,
    templates: () => pedidos.filter((p) => p.corpo.type === 'template'),
    textos: () => pedidos.filter((p) => p.corpo.type === 'text'),
  };
}

function criarLog() {
  const linhas = [];
  const registrar = (...partes) => linhas.push(partes.join(' '));
  return { linhas, log: registrar, info: registrar, warn: registrar, error: registrar };
}

let db, meta, logs, servico, servidor, base;
let seq = 0;

async function chamarPglite(nome, args) {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return (await db.query(`SELECT public.${nome}(${lista}) AS r`, valores)).rows[0].r;
}

function montarServico({ chamar = chamarPglite, config = {}, timeoutMs = 2000 } = {}) {
  return criarConfirmacaoPresenca({
    chamar,
    whatsapp: criarWhatsApp({ token: TOKEN_META, phoneNumberId: NUMERO_ID, fetch: meta.fetch, timeoutMs }),
    config: { templateConfirmacao: 'confirmacao_presenca', templatePresencaNegada: 'presenca_negada', esperasRegistro: [0, 0], ...config },
    log: logs,
    esperar: async () => {},
  });
}

function carregar(modulo) {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'teste';
  return require(modulo);
}

async function subir({ ativo = true, pushAtivo = false } = {}) {
  const { criarRotasWhatsapp } = carregar('../src/routes/whatsapp');
  const { criarRotasNotificacoes } = carregar('../src/routes/notificacoes');
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/whatsapp', criarRotasWhatsapp({
    ativo, servico, appSecret: APP_SECRET, verifyToken: VERIFY, phoneNumberId: NUMERO_ID, log: logs,
  }));
  const pushFalso = { solicitarProcessamento: async () => { throw new Error('o push não deveria ser chamado'); } };
  app.use('/api/notificacoes', criarRotasNotificacoes({
    servico: pushFalso, verificarToken: async () => null, segredo: SEGREDO, ativo, pushAtivo,
    servicoWhatsapp: ativo ? servico : null, log: logs,
  }));
  if (servidor) servidor.close();
  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
}

before(async () => {
  db = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP });
  await db.exec(`
    INSERT INTO public.profiles (user_id, nome, telefone) VALUES
      ('${CLIENTE_A}', 'Ana Paula Souza', '11987654321'),
      ('${CLIENTE_B}', 'Bruno Lima', '21998765432'),
      ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
  `);
});

beforeEach(async () => {
  await db.exec(`
    DELETE FROM public.agendamentos;
    DELETE FROM public.notificacoes;
    DELETE FROM public.whatsapp_eventos;
    DELETE FROM public.consentimentos;
  `);
  meta = criarMetaFalsa();
  logs = criarLog();
  servico = montarServico();
  await subir();
});

after(() => servidor?.close());

const um = async (sql, params) => (await db.query(sql, params)).rows[0];
const consentir = (uid) => db.query(
  "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', 'v1', 'web')", [uid]);
// Agendamento daqui a `minutos`, marcado com antecedencia, com o pedido ja na fila
async function agendarComPedido(cliente, minutos = 100) {
  seq += 1;
  const { id, data_hora } = await um(
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora)
     VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4) + make_interval(secs => $5))
     RETURNING id, data_hora`, [cliente, JOAO, CORTE_30, minutos, seq % 50]);
  await db.query("UPDATE public.agendamentos SET horario_definido_em = now() - interval '1 day' WHERE id = $1", [id]);
  await db.query('SELECT public.enfileirar_confirmacoes_presenca()');
  return { id, dataHora: new Date(data_hora) };
}
const confirmacao = (ag) => um('SELECT * FROM public.confirmacoes_presenca WHERE agendamento_id = $1', [ag]);

const assinar = (texto, segredo = APP_SECRET) => `sha256=${crypto.createHmac('sha256', segredo).update(texto).digest('hex')}`;
async function webhook(corpo, { assinatura } = {}) {
  const texto = JSON.stringify(corpo);
  const r = await fetch(`${base}/api/whatsapp/webhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinatura ?? assinar(texto) },
    body: texto,
  });
  return { status: r.status, corpo: await r.json() };
}
const envelope = (value) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: NUMERO_ID }, ...value } }] }],
});
const botao = (id, de, payload, contexto) => envelope({
  messages: [{ id, from: de, timestamp: '1', type: 'button', button: { payload, text: 'x' }, context: { from: '551100000000', id: contexto } }],
});
const texto = (id, de, body) => envelope({ messages: [{ id, from: de, timestamp: '1', type: 'text', text: { body } }] });

// ---------------------------------------------------------------
// Cliente da Cloud API e funcoes puras
// ---------------------------------------------------------------
test('1. cliente: monta o template oficial (corpo e botões) e autentica com o token', async () => {
  const wa = criarWhatsApp({ token: TOKEN_META, phoneNumberId: NUMERO_ID, versao: 'v23.0', fetch: meta.fetch });
  const r = await wa.enviarTemplate({
    para: TEL_A, template: 'confirmacao_presenca', parametros: ['Ana', 'Corte\n+  Barba', 'João', '13/11', '14h30'], botoes: ['VB_SIM:x', 'VB_NAO:x'],
  });
  assert.deepEqual(r, { status: 'aceito', wamid: 'wamid.T1', wa_id: '551187654321' });
  const [p] = meta.pedidos;
  assert.equal(p.url, `https://graph.facebook.com/v23.0/${NUMERO_ID}/messages`);
  assert.equal(p.headers.Authorization, `Bearer ${TOKEN_META}`);
  assert.deepEqual(p.corpo, {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: TEL_A,
    type: 'template',
    template: {
      name: 'confirmacao_presenca',
      language: { code: 'pt_BR' },
      components: [
        { type: 'body', parameters: ['Ana', 'Corte + Barba', 'João', '13/11', '14h30'].map((text) => ({ type: 'text', text })) },
        { type: 'button', sub_type: 'quick_reply', index: '0', parameters: [{ type: 'payload', payload: 'VB_SIM:x' }] },
        { type: 'button', sub_type: 'quick_reply', index: '1', parameters: [{ type: 'payload', payload: 'VB_NAO:x' }] },
      ],
    },
  });
});

test('2. cliente: classifica as respostas da Meta sem repetir o texto dela nem o número', async () => {
  const wa = criarWhatsApp({ token: TOKEN_META, phoneNumberId: NUMERO_ID, fetch: meta.fetch, timeoutMs: 30 });
  const enviar = () => wa.enviarTemplate({ para: TEL_A, template: 't' });
  const esperado = {
    sem_whatsapp: { status: 'recusado', erro: '131026' },
    limite: { status: 'erro', erro: '130429' },
    http500: { status: 'incerto', erro: '1' },
    sem_id: { status: 'incerto', erro: 'resposta_sem_id' },
    timeout: { status: 'incerto', erro: 'timeout' },
    rede: { status: 'incerto', erro: 'rede' },
    sem_rede: { status: 'erro', erro: 'ENOTFOUND' },
  };
  for (const [modo, resultado] of Object.entries(esperado)) {
    meta.estado.modo = modo;
    assert.deepEqual(await enviar(), resultado, modo);
  }
});

test('3. assinatura do webhook: só o HMAC do corpo exato com o segredo do app', () => {
  const corpo = Buffer.from('{"a":1}');
  assert.equal(assinaturaConfere(corpo, assinar('{"a":1}'), APP_SECRET), true);
  assert.equal(assinaturaConfere(corpo, assinar('{"a":2}'), APP_SECRET), false);
  assert.equal(assinaturaConfere(corpo, assinar('{"a":1}', 'outro'), APP_SECRET), false);
  assert.equal(assinaturaConfere(corpo, 'sha256=abc', APP_SECRET), false);
  assert.equal(assinaturaConfere(corpo, undefined, APP_SECRET), false);
  assert.equal(assinaturaConfere(undefined, assinar('{"a":1}'), APP_SECRET), false);
  assert.equal(assinaturaConfere(corpo, assinar('{"a":1}', ''), ''), false);
});

test('4. webhook: extrai só o que é do nosso número e ignora formatos inesperados', () => {
  const corpo = envelope({
    messages: [
      { id: 'm1', from: TEL_A, type: 'button', button: { payload: 'VB_SIM:1' }, context: { id: 'w1' } },
      { id: 'm2', from: TEL_A, type: 'text', text: { body: 'sim' } },
      { id: 'm3', from: TEL_A, type: 'image', image: {} },
      { id: 'm4', from: TEL_A, type: 'interactive', interactive: { button_reply: { id: 'VB_NAO:1' } } },
      { from: TEL_A, type: 'text', text: { body: 'sem id' } },
    ],
    statuses: [
      { id: 'w1', status: 'delivered' },
      { id: 'w2', status: 'failed', errors: [{ code: 131026, title: 'x' }] },
      { id: 'w3', status: 'deleted' },
    ],
  });
  assert.deepEqual(extrairEventos(corpo, NUMERO_ID), {
    mensagens: [
      { id: 'm1', de: TEL_A, tipo: 'botao', payload: 'VB_SIM:1', contexto: 'w1', texto: null },
      { id: 'm2', de: TEL_A, tipo: 'texto', payload: null, contexto: null, texto: 'sim' },
      { id: 'm4', de: TEL_A, tipo: 'botao', payload: 'VB_NAO:1', contexto: null, texto: null },
    ],
    status: [{ wamid: 'w1', status: 'entregue', erro: null }, { wamid: 'w2', status: 'falhou', erro: '131026' }],
  });
  assert.deepEqual(extrairEventos(corpo, 'outro-numero'), { mensagens: [], status: [] });
  for (const ruim of [null, {}, { object: 'page', entry: [] }, { object: 'whatsapp_business_account', entry: [{ changes: 'x' }] }]) {
    assert.deepEqual(extrairEventos(ruim, NUMERO_ID), { mensagens: [], status: [] });
  }
});

test('5. chaves: nada liga por padrão; a chave antiga NOTIFICACOES_ATIVAS desliga tudo', () => {
  const completo = {
    NOTIFICACOES_WHATSAPP_ATIVO: 'true', WHATSAPP_PHONE_NUMBER_ID: '1', WHATSAPP_ACCESS_TOKEN: 't', WHATSAPP_APP_SECRET: 's',
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'x'.repeat(16), WHATSAPP_TEMPLATE_CONFIRMACAO: 'confirmacao',
  };
  assert.equal(lerConfiguracao({}).whatsapp.ativo, false);
  assert.equal(lerConfiguracao({}).push.ativo, false);
  assert.equal(lerConfiguracao(completo).whatsapp.ativo, true);
  assert.equal(lerConfiguracao({ ...completo, NOTIFICACOES_WHATSAPP_ATIVO: 'TRUE' }).whatsapp.ativo, false);
  assert.deepEqual(lerConfiguracao({ ...completo, WHATSAPP_APP_SECRET: ' ' }).whatsapp.faltando, ['WHATSAPP_APP_SECRET']);
  assert.equal(lerConfiguracao({ ...completo, WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'curto' }).whatsapp.ativo, false);
  for (const antigo of ['true', 'false']) {
    const c = lerConfiguracao({ ...completo, NOTIFICACOES_PUSH_ATIVO: 'true', EXPO_ACCESS_TOKEN: 'e', NOTIFICACOES_ATIVAS: antigo });
    assert.deepEqual([c.chaveAntiga, c.whatsapp.ativo, c.push.ativo], [true, false, false], antigo);
  }
  // O WhatsApp ligado nao liga o push
  assert.equal(lerConfiguracao(completo).push.ativo, false);
  assert.deepEqual(lerConfiguracao({ ...completo, WHATSAPP_PILOTO_USUARIOS: ' a , b ,' }).whatsapp.piloto, ['a', 'b']);
});

// ---------------------------------------------------------------
// Envio
// ---------------------------------------------------------------
test('6. envio: o pedido sai com nome, serviço, barbeiro, data e hora de Brasília e os dois botões', async () => {
  await consentir(CLIENTE_A);
  const { id, dataHora } = await agendarComPedido(CLIENTE_A);
  const resumo = await servico.processarFila();
  assert.deepEqual(resumo, { avisos: 1, aceitos: 1, recusados: 0, erros: 0, incertos: 0, nao_gravados: 0 });

  const c = await confirmacao(id);
  assert.equal(c.estado, 'enviada');
  const [p] = meta.templates();
  const { data, hora } = dataEHora(dataHora.toISOString());
  assert.equal(p.corpo.to, TEL_A);
  assert.equal(p.corpo.template.name, 'confirmacao_presenca');
  assert.deepEqual(p.corpo.template.components[0].parameters.map((x) => x.text), ['Ana', 'Corte', 'João', data, hora]);
  assert.deepEqual(p.corpo.template.components.slice(1).map((x) => x.parameters[0].payload), [`VB_SIM:${c.id}`, `VB_NAO:${c.id}`]);
  // Conferencia independente do fuso
  const esperado = new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).format(dataHora);
  assert.equal(data, esperado);

  // Rodar de novo nao envia de novo
  await servico.processarFila();
  await db.query('SELECT public.rotina_notificacoes()');
  await servico.processarFila();
  assert.equal(meta.templates().length, 1);
  assert.doesNotMatch(logs.linhas.join('\n'), new RegExp(`${TOKEN_META}|${TEL_A}`));
});

test('7. envio: sem resposta da Meta fica como incerto e nunca é reenviado', async () => {
  await consentir(CLIENTE_A);
  const { id } = await agendarComPedido(CLIENTE_A);
  meta.estado.modo = 'timeout';
  servico = montarServico({ timeoutMs: 30 });
  assert.equal((await servico.processarFila()).incertos, 1);
  meta.estado.modo = 'ok';
  await servico.processarFila();
  await db.query("UPDATE public.notificacoes SET proxima_tentativa = now() - interval '1 hour'");
  await servico.processarFila();
  assert.equal(meta.templates().length, 1);
  const c = await confirmacao(id);
  assert.deepEqual({ estado: c.estado, motivo: c.motivo }, { estado: 'nao_enviada', motivo: 'resultado_incerto' });
});

test('8. envio: limite de taxa da Meta tenta de novo depois; número sem WhatsApp é falha definitiva', async () => {
  await consentir(CLIENTE_A);
  const { id } = await agendarComPedido(CLIENTE_A);
  meta.estado.modo = 'limite';
  assert.equal((await servico.processarFila()).erros, 1);
  assert.equal((await confirmacao(id)).estado, 'pendente');
  meta.estado.modo = 'ok';
  await servico.processarFila();
  assert.equal(meta.templates().length, 1, 'ainda dentro da espera');
  await db.query('UPDATE public.notificacoes SET proxima_tentativa = now()');
  await servico.processarFila();
  assert.equal(meta.templates().length, 2);
  assert.equal((await confirmacao(id)).estado, 'enviada');

  await consentir(CLIENTE_B);
  const outro = await agendarComPedido(CLIENTE_B, 110);
  meta.estado.modo = 'sem_whatsapp';
  assert.equal((await servico.processarFila()).recusados, 1);
  const c = await confirmacao(outro.id);
  assert.deepEqual({ estado: c.estado, motivo: c.motivo }, { estado: 'nao_enviada', motivo: '131026' });
});

test('9. envio: se o banco não gravar o resultado, a mensagem não é enviada de novo', async () => {
  await consentir(CLIENTE_A);
  const { id } = await agendarComPedido(CLIENTE_A);
  let falhar = true;
  servico = montarServico({
    chamar: async (nome, args) => {
      if (nome === 'concluir_envio_whatsapp' && falhar) throw Object.assign(new Error('banco fora'), { code: '57P01' });
      return chamarPglite(nome, args);
    },
  });
  assert.equal((await servico.processarFila()).nao_gravados, 1);
  assert.equal((await confirmacao(id)).estado, 'pendente');
  falhar = false;
  await servico.processarFila();
  assert.equal(meta.templates().length, 1);
  assert.equal((await confirmacao(id)).estado, 'enviada');
});

test('10. piloto: só os usuários da lista recebem', async () => {
  await consentir(CLIENTE_A);
  await consentir(CLIENTE_B);
  const a = await agendarComPedido(CLIENTE_A, 100);
  const b = await agendarComPedido(CLIENTE_B, 110);
  servico = montarServico({ config: { piloto: [CLIENTE_B] } });
  await servico.processarFila();
  assert.deepEqual(meta.templates().map((p) => p.corpo.to), [TEL_B]);
  assert.equal((await confirmacao(b.id)).estado, 'enviada');
  const c = await confirmacao(a.id);
  assert.deepEqual({ estado: c.estado, motivo: c.motivo }, { estado: 'nao_enviada', motivo: 'fora_do_piloto' });
});

// ---------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------
async function pedidoEnviado(cliente = CLIENTE_A, minutos = 100) {
  await consentir(cliente).catch(() => {});
  const ag = await agendarComPedido(cliente, minutos);
  await servico.processarFila();
  const c = await confirmacao(ag.id);
  const { wamid } = await um('SELECT wamid FROM public.whatsapp_mensagens WHERE notificacao_id = $1', [c.notificacao_id]);
  return { ...ag, conf: c, wamid };
}

test('11. webhook: verificação da Meta devolve o desafio só com o token certo', async () => {
  const ok = await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=12345`);
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), '12345');
  for (const qs of [
    'hub.mode=subscribe&hub.verify_token=errado&hub.challenge=1',
    `hub.mode=outro&hub.verify_token=${VERIFY}&hub.challenge=1`,
    `hub.mode=subscribe&hub.verify_token=${VERIFY}`,
    `hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=%3Cscript%3E`,
  ]) {
    assert.equal((await fetch(`${base}/api/whatsapp/webhook?${qs}`)).status, 403, qs);
  }
});

test('12. webhook: sem assinatura válida nada é processado', async () => {
  const p = await pedidoEnviado();
  const corpo = botao('in.1', '551187654321', `VB_SIM:${p.conf.id}`, p.wamid);
  for (const assinatura of ['', 'sha256=' + '0'.repeat(64), assinar(JSON.stringify(corpo), 'segredo-errado')]) {
    assert.equal((await webhook(corpo, { assinatura })).status, 401);
  }
  assert.equal((await confirmacao(p.id)).estado, 'enviada');
  assert.equal(meta.textos().length, 0);
});

test('13. webhook: SIM pelo botão confirma a presença e o cliente recebe o retorno; repetição é ignorada', async () => {
  const p = await pedidoEnviado();
  const corpo = botao('in.2', '551187654321', `VB_SIM:${p.conf.id}`, p.wamid);
  assert.deepEqual(await webhook(corpo), { status: 200, corpo: { recebido: true } });
  const c = await confirmacao(p.id);
  assert.deepEqual({ estado: c.estado, origem: c.resposta_origem }, { estado: 'confirmada', origem: 'botao' });
  assert.equal(meta.textos().length, 1);
  assert.equal(meta.textos()[0].corpo.to, '551187654321');
  assert.match(meta.textos()[0].corpo.text.body, /^Presença confirmada para \d\d\/\d\d às \d{1,2}h/);

  // A Meta entrega de novo a mesma mensagem: nada muda e nada e respondido
  assert.equal((await webhook(corpo)).status, 200);
  assert.equal(meta.textos().length, 1);
  // Outra resposta depois: a primeira continua valendo
  await webhook(botao('in.3', '551187654321', `VB_NAO:${p.conf.id}`, p.wamid));
  assert.equal((await confirmacao(p.id)).estado, 'confirmada');
  assert.match(meta.textos()[1].corpo.text.body, /já tinha sido registrada/);
});

test('14. webhook: NÃO registra, mantém o agendamento e avisa o barbeiro que autorizou', async () => {
  await consentir(USUARIO_JOAO);
  const p = await pedidoEnviado();
  assert.equal((await webhook(botao('in.4', TEL_A, `VB_NAO:${p.conf.id}`, p.wamid))).status, 200);
  await servico.aguardar();
  assert.equal((await confirmacao(p.id)).estado, 'recusada');
  assert.equal((await um('SELECT status FROM public.agendamentos WHERE id = $1', [p.id])).status, 'confirmado');
  assert.match(meta.textos()[0].corpo.text.body, /O barbeiro foi informado/);
  const paraBarbeiro = meta.templates().filter((t) => t.corpo.template.name === 'presenca_negada');
  assert.equal(paraBarbeiro.length, 1);
  assert.equal(paraBarbeiro[0].corpo.to, TEL_JOAO);
  assert.deepEqual(paraBarbeiro[0].corpo.template.components[0].parameters.slice(0, 2).map((x) => x.text), ['Ana', 'Corte']);
  assert.equal(paraBarbeiro[0].corpo.template.components.length, 1);
});

test('15. webhook: agendamento cancelado ou com outro horário não aceita a resposta', async () => {
  const p = await pedidoEnviado();
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [p.id]);
  await webhook(botao('in.5', TEL_A, `VB_SIM:${p.conf.id}`, p.wamid));
  assert.equal((await confirmacao(p.id)).estado, 'invalidada');
  assert.match(meta.textos()[0].corpo.text.body, /não está mais ativo/);

  const q = await pedidoEnviado(CLIENTE_B, 110);
  await db.query("UPDATE public.agendamentos SET data_hora = data_hora + interval '7 minutes' WHERE id = $1", [q.id]);
  await webhook(botao('in.6', TEL_B, `VB_SIM:${q.conf.id}`, q.wamid));
  assert.equal((await um('SELECT estado FROM public.confirmacoes_presenca WHERE id = $1', [q.conf.id])).estado, 'invalidada');
});

test('16. webhook: texto "sim" vale com um pedido aberto; botão de outro número não vale e não gera retorno', async () => {
  const p = await pedidoEnviado();
  await webhook(botao('in.7', TEL_B, `VB_SIM:${p.conf.id}`, p.wamid));
  assert.equal((await confirmacao(p.id)).estado, 'enviada');
  assert.equal(meta.textos().length, 0);
  await webhook(texto('in.8', TEL_A, 'oi, tudo bem?'));
  assert.equal(meta.textos().length, 0);
  await webhook(texto('in.9', '551187654321', 'Sim!'));
  const c = await confirmacao(p.id);
  assert.deepEqual({ estado: c.estado, origem: c.resposta_origem }, { estado: 'confirmada', origem: 'texto' });
});

test('17. webhook: PARAR revoga a autorização; estados de entrega são gravados', async () => {
  const p = await pedidoEnviado();
  const r = await webhook(envelope({ statuses: [{ id: p.wamid, status: 'delivered' }, { id: p.wamid, status: 'read' }, { id: 'wamid.outro', status: 'sent' }] }));
  assert.equal(r.status, 200);
  assert.equal((await um('SELECT estado FROM public.whatsapp_mensagens WHERE wamid = $1', [p.wamid])).estado, 'lido');

  await webhook(texto('in.10', TEL_A, 'PARAR'));
  assert.equal((await um('SELECT revogado_origem FROM public.consentimentos WHERE user_id = $1', [CLIENTE_A])).revogado_origem, 'whatsapp');
  assert.match(meta.textos()[0].corpo.text.body, /não receberá mais mensagens/);
});

test('18. webhook: falha ao gravar devolve 500 para a Meta entregar de novo, sem duplicar depois', async () => {
  const p = await pedidoEnviado();
  let falhar = true;
  servico = montarServico({
    chamar: async (nome, args) => {
      if (nome === 'whatsapp_registrar_resposta' && falhar) throw Object.assign(new Error('banco fora'), { code: '57P01' });
      return chamarPglite(nome, args);
    },
  });
  await subir();
  const corpo = botao('in.11', TEL_A, `VB_SIM:${p.conf.id}`, p.wamid);
  assert.equal((await webhook(corpo)).status, 500);
  assert.equal((await confirmacao(p.id)).estado, 'enviada');
  falhar = false;
  assert.equal((await webhook(corpo)).status, 200);
  assert.equal((await confirmacao(p.id)).estado, 'confirmada');
  assert.equal(meta.textos().length, 1);
});

test('19. desligado: webhook e /processar respondem 503 e nada é lido nem enviado', async () => {
  const p = await pedidoEnviado();
  await consentir(CLIENTE_B);
  await agendarComPedido(CLIENTE_B, 110);
  const antes = meta.pedidos.length;
  await subir({ ativo: false });
  const corpo = botao('in.12', TEL_A, `VB_SIM:${p.conf.id}`, p.wamid);
  assert.deepEqual(await webhook(corpo), { status: 503, corpo: { error: 'WhatsApp desativado no servidor.', code: 'DESATIVADO' } });
  assert.equal((await fetch(`${base}/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY}&hub.challenge=1`)).status, 503);
  const r = await fetch(`${base}/api/notificacoes/processar`, { method: 'POST', headers: { 'X-Notificacoes-Segredo': SEGREDO } });
  assert.equal(r.status, 503);
  assert.equal((await confirmacao(p.id)).estado, 'enviada');
  assert.equal(meta.pedidos.length, antes);
});

test('20. /processar: com só o WhatsApp ligado, a chamada do banco lê a fila do WhatsApp e não toca no push', async () => {
  await consentir(CLIENTE_A);
  const { id } = await agendarComPedido(CLIENTE_A);
  const semSegredo = await fetch(`${base}/api/notificacoes/processar`, { method: 'POST' });
  assert.equal(semSegredo.status, 401);
  assert.equal(meta.templates().length, 0);

  const r = await fetch(`${base}/api/notificacoes/processar`, { method: 'POST', headers: { 'X-Notificacoes-Segredo': SEGREDO } });
  assert.equal(r.status, 202);
  await servico.aguardar();
  assert.equal(meta.templates().length, 1);
  assert.equal((await confirmacao(id)).estado, 'enviada');
  assert.doesNotMatch(logs.linhas.join('\n'), /push não deveria/);
  // A rota de teste e so do push
  const teste = await fetch(`${base}/api/notificacoes/teste`, { method: 'POST' });
  assert.equal(teste.status, 503);
});
