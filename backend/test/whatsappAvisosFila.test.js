// Avisos de novo agendamento (migration 28) e de cancelamento (migration 29)
// de ponta a ponta no backend, com o banco no estado de producao (25, 27, 26,
// 28 e 29, PGlite): fila -> POST /api/notificacoes/processar -> reserva ->
// Cloud API (Meta FALSA, nada sai para a rede) -> resultado gravado -> estado
// da mensagem pelo webhook. Tambem a ligacao das variaveis de ambiente com o
// servico e o canal desligado.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');

const {
  criarBanco, MIGRATIONS_WHATSAPP_26, JOAO, CORTE_30, CLIENTE_A, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');
const { criarWhatsApp } = require('../src/services/whatsapp');
const { criarConfirmacaoPresenca } = require('../src/services/confirmacaoPresenca');
const { lerConfiguracao } = require('../src/services/notificacoesConfig');

const PRODUCAO = [...MIGRATIONS_WHATSAPP_26,
  '20261118000028_whatsapp_novo_agendamento.sql', '20261118000029_whatsapp_aviso_cancelamento.sql'];
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-0123';
const APP_SECRET = 'segredo-do-app-de-teste';
const NUMERO_ID = '100200300';
const TEL_A = '5511987654321';
const TEL_JOAO = '5511912345678';
const TEMPLATES = {
  templateNovoAgendamentoCliente: 'novo_cli', templateNovoAgendamentoBarbeiro: 'novo_barb',
  templateCancelamentoCliente: 'canc_cli', templateCancelamentoBarbeiro: 'canc_barb',
};

function criarMetaFalsa() {
  const pedidos = [];
  let n = 0;
  return {
    pedidos,
    templates: () => pedidos.filter((p) => p.corpo.type === 'template').map((p) => [p.corpo.template.name, p.corpo.to]).sort(),
    async fetch(url, init) {
      const corpo = JSON.parse(init.body);
      pedidos.push({ url, corpo });
      const waId = corpo.to.replace(/^(55\d\d)9(\d{8})$/, '$1$2');
      return { ok: true, status: 200, json: async () => ({ messaging_product: 'whatsapp', contacts: [{ input: corpo.to, wa_id: waId }], messages: [{ id: `wamid.A${++n}` }] }) };
    },
  };
}
const silencioso = { log() {}, info() {}, warn() {}, error() {} };
const chamarDe = (banco) => async (nome, args) => {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return (await banco.query(`SELECT public.${nome}(${lista}) AS r`, valores)).rows[0].r;
};
function carregar(modulo) {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'teste';
  return require(modulo);
}

let db, meta, servidor, base;
let minutos = 180;

before(async () => {
  db = await criarBanco({ migracoes: PRODUCAO });
  await db.exec(`
    INSERT INTO public.profiles (user_id, nome, telefone) VALUES
      ('${CLIENTE_A}', 'Ana Paula', '11987654321'), ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;`);
  for (const uid of [CLIENTE_A, USUARIO_JOAO]) {
    await db.query("INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', '2026-11-16', 'web')", [uid]);
  }
});
beforeEach(async () => {
  await db.exec('DELETE FROM public.agendamentos; DELETE FROM public.notificacoes;');
  meta = criarMetaFalsa();
});
after(() => servidor?.close());

function montarServico(config = TEMPLATES) {
  return criarConfirmacaoPresenca({
    chamar: chamarDe(db),
    whatsapp: criarWhatsApp({ token: 'token-falso', phoneNumberId: NUMERO_ID, fetch: meta.fetch, timeoutMs: 2000 }),
    config: { templateConfirmacao: 'confirmacao_presenca', esperasRegistro: [0, 0], ...config },
    log: silencioso,
    esperar: async () => {},
  });
}

// Rotas reais (/processar e webhook) com o servico dado
async function subir(servico, { ativo = true } = {}) {
  const { criarRotasWhatsapp } = carregar('../src/routes/whatsapp');
  const { criarRotasNotificacoes } = carregar('../src/routes/notificacoes');
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  app.use('/api/whatsapp', criarRotasWhatsapp({ ativo, servico, appSecret: APP_SECRET, verifyToken: 'x'.repeat(16), phoneNumberId: NUMERO_ID, log: silencioso }));
  app.use('/api/notificacoes', criarRotasNotificacoes({
    servico: { solicitarProcessamento: async () => { throw new Error('o push não deveria ser chamado'); } },
    verificarToken: async () => null, segredo: SEGREDO, ativo, pushAtivo: false, log: silencioso,
    servicoWhatsapp: ativo ? servico : null,
  }));
  if (servidor) servidor.close();
  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
}
const processar = async () => (await fetch(`${base}/api/notificacoes/processar`, {
  method: 'POST', headers: { 'X-Notificacoes-Segredo': SEGREDO } })).status;
async function webhookStatus(wamid, status) {
  const texto = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ id: 'waba', changes: [{ field: 'messages',
    value: { messaging_product: 'whatsapp', metadata: { phone_number_id: NUMERO_ID }, statuses: [{ id: wamid, status, timestamp: '1', recipient_id: '551187654321' }] } }] }] });
  const r = await fetch(`${base}/api/whatsapp/webhook`, { method: 'POST', body: texto, headers: {
    'Content-Type': 'application/json', 'X-Hub-Signature-256': `sha256=${crypto.createHmac('sha256', APP_SECRET).update(texto).digest('hex')}` } });
  return r.status;
}

const agendar = async () => (await db.query(
  `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
   VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4), 'confirmado') RETURNING id`,
  [CLIENTE_A, JOAO, CORTE_30, (minutos += 60)])).rows[0].id;
const cancelar = (ag) => db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [ag]);
const avisos = async (ag) => (await db.query(
  `SELECT n.tipo, n.dados ->> 'papel' AS papel, n.status, n.motivo, m.wamid, m.estado
     FROM public.notificacoes n LEFT JOIN public.whatsapp_mensagens m ON m.notificacao_id = n.id
    WHERE n.agendamento_id = $1 AND n.canal = 'whatsapp' ORDER BY n.tipo, papel`, [ag])).rows;

test('novo agendamento: o banco acorda o backend, sai um template para cada um e o estado da Meta é gravado', async () => {
  const servico = montarServico();
  await subir(servico);
  const ag = await agendar();
  assert.equal(await processar(), 202);
  await servico.aguardar();

  assert.deepEqual(meta.templates(), [['novo_barb', TEL_JOAO], ['novo_cli', TEL_A]]);
  const cliente = meta.pedidos.find((p) => p.corpo.template.name === 'novo_cli').corpo.template;
  assert.deepEqual(cliente.components[0].parameters.map((p) => p.text).slice(0, 3), ['Ana', 'Corte', 'João']);
  const lista = await avisos(ag);
  assert.deepEqual(lista.map((a) => [a.tipo, a.papel, a.status, a.estado]),
    [['novo_agendamento', 'barbeiro', 'enviada', 'aceito'], ['novo_agendamento', 'cliente', 'enviada', 'aceito']]);
  assert.ok(lista.every((a) => /^wamid\.A\d+$/.test(a.wamid)));

  // Estado de entrega pelo webhook; repetido, e ignorado
  const wamid = lista.find((a) => a.papel === 'cliente').wamid;
  assert.equal(await webhookStatus(wamid, 'delivered'), 200);
  assert.equal(await webhookStatus(wamid, 'delivered'), 200);
  assert.equal(await webhookStatus(wamid, 'sent'), 200); // fora de ordem: nao volta
  assert.equal((await avisos(ag)).find((a) => a.papel === 'cliente').estado, 'entregue');

  // Nova chamada: nada duplicado
  assert.equal(await processar(), 202);
  await servico.aguardar();
  assert.equal(meta.pedidos.length, 2);
});

test('cancelamento efetivado: os avisos de novo agendamento pendentes são descartados e só os de cancelamento saem', async () => {
  const servico = montarServico();
  await subir(servico);
  const ag = await agendar();
  await cancelar(ag);
  await cancelar(ag); // repetido: nao gera outro
  assert.equal(await processar(), 202);
  await servico.aguardar();

  assert.deepEqual(meta.templates(), [['canc_barb', TEL_JOAO], ['canc_cli', TEL_A]]);
  assert.deepEqual((await avisos(ag)).map((a) => [a.tipo, a.papel, a.status]), [
    ['cancelamento', 'barbeiro', 'enviada'], ['cancelamento', 'cliente', 'enviada'],
    ['novo_agendamento', 'barbeiro', 'ignorada'], ['novo_agendamento', 'cliente', 'ignorada']]);
});

test('variáveis de ambiente: os templates de produção chegam ao serviço montado pela rota real', async () => {
  const { criarServicoWhatsapp } = carregar('../src/routes/whatsapp');
  const config = lerConfiguracao({
    BACKEND_AMBIENTE: 'producao', WHATSAPP_AMBIENTE: 'producao', NOTIFICACOES_WHATSAPP_ATIVO: 'true',
    WHATSAPP_PHONE_NUMBER_ID: NUMERO_ID, WHATSAPP_ACCESS_TOKEN: 'token-falso', WHATSAPP_APP_SECRET: APP_SECRET,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'x'.repeat(16), WHATSAPP_TEMPLATE_CONFIRMACAO: 'confirmacao_presenca',
    WHATSAPP_TEMPLATE_NOVO_AGENDAMENTO_CLIENTE: 'env_novo_cli', WHATSAPP_TEMPLATE_NOVO_AGENDAMENTO_BARBEIRO: 'env_novo_barb',
    WHATSAPP_TEMPLATE_CANCELAMENTO_CLIENTE: 'env_canc_cli', WHATSAPP_TEMPLATE_CANCELAMENTO_BARBEIRO: 'env_canc_barb',
  });
  assert.equal(config.whatsapp.ativo, true);
  const servico = criarServicoWhatsapp(config.whatsapp, { chamar: chamarDe(db), fetch: meta.fetch, timeoutMs: 2000, log: silencioso });
  const ag = await agendar();
  await cancelar(ag);
  await servico.processarFila();
  assert.deepEqual(meta.templates(), [['env_canc_barb', TEL_JOAO], ['env_canc_cli', TEL_A]]);
  assert.ok(meta.pedidos.every((p) => p.url.includes(`/${NUMERO_ID}/messages`)));
});

test('sem os templates novos: nada vai para a Meta e o aviso termina como não enviado', async () => {
  const servico = montarServico({});
  await subir(servico);
  const ag = await agendar();
  assert.equal(await processar(), 202);
  await servico.aguardar();
  assert.equal(meta.pedidos.length, 0);
  assert.deepEqual([...new Set((await avisos(ag)).map((a) => `${a.status}:${a.motivo}`))], ['falhou:template_nao_configurado']);
});

test('canal desligado: /processar responde 503 e a fila fica intacta', async () => {
  const servico = montarServico();
  await subir(servico, { ativo: false });
  const ag = await agendar();
  assert.equal(await processar(), 503);
  assert.equal(meta.pedidos.length, 0);
  assert.deepEqual((await avisos(ag)).map((a) => a.status), ['pendente', 'pendente']);
});
