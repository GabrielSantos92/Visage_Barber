// Pagamentos de ponta a ponta no backend: rotas reais, regras no banco (PGlite
// com as migrations) e o cliente HTTP do Mercado Pago falando com um Mercado
// Pago falso (nenhuma chamada externa, nenhuma cobranca real).
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { once } = require('node:events');
const express = require('express');

const { criarBanco, auxiliares, JOAO, CORTE_30, BARBA_30, CLIENTE_A, CLIENTE_B, ADMIN } = require('./helpers/bancoAgenda');
const { criarMercadoPago, validarAssinatura, estadoDoMercadoPago } = require('../src/services/mercadoPago');
const { criarServicoPagamentos } = require('../src/services/pagamentos');

const SEGREDO = 'segredo-de-teste';
const USUARIOS = {
  'token-a': { id: CLIENTE_A, email: 'ana@teste.com' },
  'token-b': { id: CLIENTE_B, email: 'bruno@teste.com' },
  'token-admin': { id: ADMIN, email: 'dono@teste.com' },
};

// ---------------------------------------------------------------
// Mercado Pago falso (mesmos caminhos e formatos da API)
// ---------------------------------------------------------------
function criarMpFalso() {
  const pagamentos = new Map();
  const chamadas = [];
  let seq = 1000;
  let fora = false;
  let cancelamentoFalha = false;
  const resposta = (status, dados) => ({ ok: status < 400, status, json: async () => dados });

  async function fetchFalso(url, init = {}) {
    const u = new URL(url);
    const metodo = init.method ?? 'GET';
    const corpo = init.body ? JSON.parse(init.body) : undefined;
    chamadas.push({ metodo, caminho: u.pathname, busca: u.search, corpo, headers: init.headers });
    if (fora) return resposta(500, { message: 'indisponivel' });

    if (metodo === 'POST' && u.pathname === '/v1/payments') {
      const chave = init.headers['X-Idempotency-Key'];
      const repetido = [...pagamentos.values()].find((p) => p._chave === chave);
      if (repetido) return resposta(201, repetido);
      const id = ++seq;
      const p = {
        id, _chave: chave, status: 'pending', status_detail: 'pending_waiting_transfer',
        transaction_amount: corpo.transaction_amount, transaction_amount_refunded: 0,
        external_reference: corpo.external_reference, payment_method_id: 'pix', fee_details: [], refunds: [],
        date_created: new Date().toISOString(),
        point_of_interaction: { transaction_data: { qr_code: `00020126PIX${id}`, qr_code_base64: 'iVBORw0KGgo=' } },
      };
      pagamentos.set(String(id), p);
      return resposta(201, p);
    }
    if (metodo === 'POST' && u.pathname === '/checkout/preferences') {
      const id = `pref-${++seq}`;
      return resposta(201, { id, init_point: `https://mp.test/checkout?pref=${id}`, sandbox_init_point: `https://sandbox.mp.test/checkout?pref=${id}` });
    }
    if (metodo === 'PUT' && u.pathname.startsWith('/checkout/preferences/')) return resposta(200, {});
    if (metodo === 'GET' && u.pathname === '/v1/payments/search') {
      const ref = u.searchParams.get('external_reference');
      return resposta(200, { results: [...pagamentos.values()].filter((p) => p.external_reference === ref) });
    }
    const reembolso = /^\/v1\/payments\/([^/]+)\/refunds$/.exec(u.pathname);
    if (metodo === 'POST' && reembolso) {
      const p = pagamentos.get(reembolso[1]);
      const valor = corpo.amount ?? p.transaction_amount - p.transaction_amount_refunded;
      p.refunds.push({ id: ++seq, amount: valor, date_created: new Date().toISOString() });
      p.transaction_amount_refunded += valor;
      if (p.transaction_amount_refunded >= p.transaction_amount) { p.status = 'refunded'; p.status_detail = 'refunded'; }
      else { p.status = 'approved'; p.status_detail = 'partially_refunded'; }
      return resposta(201, { id: seq, amount: valor });
    }
    const um = /^\/v1\/payments\/([^/]+)$/.exec(u.pathname);
    if (um) {
      const p = pagamentos.get(um[1]);
      if (!p) return resposta(404, { message: 'not found' });
      if (metodo === 'PUT') {
        if (cancelamentoFalha) return resposta(500, { message: 'falha ao cancelar' });
        // Como a API real: pagamento aprovado nao pode ser cancelado
        if (p.status === 'approved') return resposta(400, { message: 'Invalid operation for payment status approved' });
        p.status = corpo.status; p.status_detail = 'by_collector';
      }
      return resposta(200, p);
    }
    return resposta(404, { message: `rota falsa inexistente: ${metodo} ${u.pathname}` });
  }

  return {
    fetch: fetchFalso, pagamentos, chamadas,
    ficarFora: (v) => { fora = v; },
    falharCancelamento: (v) => { cancelamentoFalha = v; },
    // O cliente paga (PIX) ou o Mercado Pago muda o estado
    mudar(id, status, extra = {}) {
      Object.assign(pagamentos.get(String(id)), { status, ...(status === 'approved' ? { date_approved: new Date().toISOString() } : {}), ...extra });
    },
    // Tentativa de pagamento com cartao na pagina do Checkout Pro
    tentativaCartao(referencia, valor, status) {
      const id = ++seq;
      pagamentos.set(String(id), {
        id, status, status_detail: status === 'approved' ? 'accredited' : 'cc_rejected_other_reason',
        transaction_amount: valor, transaction_amount_refunded: 0, external_reference: referencia,
        payment_type_id: 'credit_card', fee_details: status === 'approved' ? [{ type: 'mercadopago_fee', amount: 2.4 }] : [],
        refunds: [], date_created: new Date(Date.now() + id).toISOString(),
        ...(status === 'approved' ? { date_approved: new Date().toISOString() } : {}),
      });
      return id;
    },
  };
}

function assinar(dataId, requestId, ts = Date.now()) {
  const v1 = crypto.createHmac('sha256', SEGREDO).update(`id:${String(dataId).toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex');
  return `ts=${ts},v1=${v1}`;
}

// ---------------------------------------------------------------
// Montagem: banco, servico, rotas
// ---------------------------------------------------------------
let db, agendar, comoUsuario, mp, servidor, base;
let notificacao = 0;

async function chamarPglite(nome, args) {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return (await db.query(`SELECT public.${nome}(${lista}) AS r`, valores)).rows[0].r;
}

function montar({ comMp = true } = {}) {
  const { criarRotasPagamentos } = carregarRotas();
  const servico = criarServicoPagamentos({
    chamar: chamarPglite,
    mp: comMp ? criarMercadoPago({ accessToken: 'TEST-token', fetch: mp.fetch }) : null,
    config: { segredoWebhook: SEGREDO, urlNotificacao: 'https://api.teste/api/pagamentos/webhook', urlRetorno: 'https://site.teste/pagamento', sandbox: true },
  });
  const app = express();
  app.use(express.json());
  app.use('/api/pagamentos', criarRotasPagamentos({
    servico,
    verificarToken: async (t) => USUARIOS[t] ?? null,
    ehAdmin: async (id) => id === ADMIN,
  }));
  return app;
}

// A rota real cria um cliente Supabase ao ser carregada: isola com variaveis falsas
function carregarRotas() {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'teste';
  return require('../src/routes/pagamentos');
}

async function iniciarServidor(app) {
  if (servidor) servidor.close();
  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}/api/pagamentos`;
}

async function post(caminho, corpo = {}, { token, headers = {} } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
}

// Notificacao como o Mercado Pago envia
function webhook(dataId, { chave = `n-${++notificacao}`, requestId = `req-${notificacao}`, assinatura } = {}) {
  return post(`/webhook?data.id=${dataId}&type=payment`, { id: chave, type: 'payment', action: 'payment.updated', data: { id: String(dataId) } }, {
    headers: { 'x-request-id': requestId, 'x-signature': assinatura ?? assinar(dataId, requestId) },
  });
}

const pagamento = async (id) => (await db.query('SELECT * FROM public.pagamentos WHERE id = $1', [id])).rows[0];
const lancamentos = async (agendamento) =>
  (await db.query('SELECT tipo, valor_pago, valor_comissao FROM public.lancamentos_financeiros WHERE agendamento_id = $1 ORDER BY id', [agendamento])).rows
    .map((l) => [l.tipo, Number(l.valor_pago), Number(l.valor_comissao)]);
const concluir = (id) => db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [id]);

before(async () => {
  db = await criarBanco();
  ({ agendar, comoUsuario } = auxiliares(db));
  await comoUsuario(ADMIN);
  await chamarPglite('configurar_comissao', { p_barbeiro_id: JOAO, p_percentual: 60 });
  await comoUsuario(null);
});

beforeEach(async () => {
  mp = criarMpFalso();
  await iniciarServidor(montar());
  await db.exec(`
    DELETE FROM public.lancamentos_financeiros; DELETE FROM public.pagamento_reembolsos; DELETE FROM public.pagamento_auditoria;
    DELETE FROM public.pagamentos; DELETE FROM public.pagamento_eventos;
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
    DELETE FROM public.agendamentos;
    ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;
  `);
});

after(() => servidor?.close());

// ---------------------------------------------------------------

test('1. PIX: valor do banco (ignora o do app), QR Code, webhook assinado aprova e o serviço concluído gera comissão', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00'); // R$ 40
  const r = await post('/', { agendamento_id: id, metodo: 'pix', valor: 1, transaction_amount: 1 }, { token: 'token-a' });
  assert.equal(r.status, 201);
  assert.equal(r.corpo.status, 'pending');
  assert.equal(r.corpo.valor, 40);
  assert.match(r.corpo.pix_copia_cola, /^00020126PIX/);
  assert.equal(r.corpo.pix_qr_base64, 'iVBORw0KGgo=');
  assert.ok(r.corpo.expira_em);

  const criacao = mp.chamadas.find((c) => c.metodo === 'POST' && c.caminho === '/v1/payments');
  assert.equal(criacao.corpo.transaction_amount, 40);
  assert.equal(criacao.corpo.payment_method_id, 'pix');
  assert.equal(criacao.corpo.payer.email, 'ana@teste.com');
  assert.equal(criacao.corpo.external_reference, r.corpo.id);
  assert.equal(criacao.headers['X-Idempotency-Key'], r.corpo.id);
  assert.equal(criacao.headers.Authorization, 'Bearer TEST-token');

  // O app dizer que pagou nao muda nada: so o provedor
  const mpId = (await pagamento(r.corpo.id)).provedor_pagamento_id;
  mp.mudar(mpId, 'approved', { fee_details: [{ type: 'mercadopago_fee', amount: 0.4 }] });
  const w = await webhook(mpId);
  assert.equal(w.status, 200);
  assert.equal(w.corpo.situacao, 'processado');
  const p = await pagamento(r.corpo.id);
  assert.deepEqual([p.status, Number(p.taxa)], ['approved', 0.4]);

  await concluir(id);
  assert.deepEqual(await lancamentos(id), [['servico', 40, 24]]);
});

test('6. webhook repetido não duplica; assinatura inválida é recusada e não muda nada', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await concluir(id);
  const r = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const mpId = (await pagamento(r.corpo.id)).provedor_pagamento_id;
  mp.mudar(mpId, 'approved');

  const falsa = await webhook(mpId, { assinatura: `ts=${Date.now()},v1=${'0'.repeat(64)}` });
  assert.equal(falsa.status, 401);
  assert.equal((await pagamento(r.corpo.id)).status, 'pending');

  const consultasAntes = mp.chamadas.filter((c) => c.metodo === 'GET').length;
  assert.equal((await webhook(mpId, { chave: 'mesma', requestId: 'r1' })).corpo.situacao, 'processado');
  assert.equal((await webhook(mpId, { chave: 'mesma', requestId: 'r1' })).corpo.situacao, 'repetido');
  // Outra notificacao do mesmo pagamento: reprocessa, mas sem duplicar receita
  assert.equal((await webhook(mpId)).corpo.situacao, 'processado');
  assert.equal(mp.chamadas.filter((c) => c.metodo === 'GET').length, consultasAntes + 2);
  assert.deepEqual(await lancamentos(id), [['servico', 40, 24]]);
});

test('2. cartão: Checkout Pro só com crédito; tentativa recusada e depois aprovada na mesma página', async () => {
  const id = await agendar(CLIENTE_A, JOAO, BARBA_30, '09:00'); // R$ 35
  const r = await post('/', { agendamento_id: id, metodo: 'cartao' }, { token: 'token-a' });
  assert.equal(r.status, 201);
  assert.match(r.corpo.link_pagamento, /^https:\/\/sandbox\.mp\.test\/checkout/);

  const pref = mp.chamadas.find((c) => c.caminho === '/checkout/preferences');
  assert.equal(pref.corpo.items[0].unit_price, 35);
  assert.equal(pref.corpo.external_reference, r.corpo.id);
  assert.deepEqual(pref.corpo.payment_methods.excluded_payment_types.map((t) => t.id).sort(),
    ['atm', 'bank_transfer', 'debit_card', 'prepaid_card', 'ticket']);
  assert.equal(pref.corpo.back_urls.success, `https://site.teste/pagamento/${id}?retorno=1`);
  assert.equal(pref.corpo.auto_return, 'approved');

  const recusada = mp.tentativaCartao(r.corpo.id, 35, 'rejected');
  await webhook(recusada);
  assert.equal((await pagamento(r.corpo.id)).status, 'rejected');

  const aprovada = mp.tentativaCartao(r.corpo.id, 35, 'approved');
  await webhook(aprovada);
  // Uma notificacao atrasada da tentativa recusada nao derruba a aprovada
  await webhook(recusada);
  const p = await pagamento(r.corpo.id);
  assert.deepEqual([p.status, p.provedor_pagamento_id, Number(p.taxa)], ['approved', String(aprovada), 2.4]);

  // Ao voltar do Checkout Pro o app sincroniza: mesma resposta
  const s = await post(`/${r.corpo.id}/sincronizar`, {}, { token: 'token-a' });
  assert.equal(s.corpo.status, 'approved');
});

test('3. presencial: registra a escolha sem chamar o provedor', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const r = await post('/', { agendamento_id: id, metodo: 'presencial' }, { token: 'token-a' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.corpo.metodo, r.corpo.status, r.corpo.valor], ['presencial', 'pending', 40]);
  assert.equal(mp.chamadas.length, 0);
});

test('5. recusado pelo provedor não gera receita nem comissão', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await concluir(id);
  const r = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const mpId = (await pagamento(r.corpo.id)).provedor_pagamento_id;
  mp.mudar(mpId, 'cancelled', { status_detail: 'expired' });
  await webhook(mpId);
  const p = await pagamento(r.corpo.id);
  assert.deepEqual([p.status, p.aprovado_em], ['expired', null]);
  assert.deepEqual(await lancamentos(id), []);
  // Expirado: pode gerar um novo PIX
  const novo = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  assert.equal(novo.status, 201);
  assert.notEqual(novo.corpo.id, r.corpo.id);
});

test('15. cliente não cobra nem consulta agendamento/pagamento de outro; sem login nada', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  assert.equal((await post('/', { agendamento_id: id, metodo: 'pix' })).status, 401);
  const alheio = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-b' });
  assert.deepEqual([alheio.status, alheio.corpo.code], [404, 'AGENDAMENTO_NAO_ENCONTRADO']);

  const r = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const outro = await post(`/${r.corpo.id}/sincronizar`, {}, { token: 'token-b' });
  assert.deepEqual([outro.status, outro.corpo.code], [404, 'PAGAMENTO_NAO_ENCONTRADO']);
  // O admin pode sincronizar qualquer um
  assert.equal((await post(`/${r.corpo.id}/sincronizar`, {}, { token: 'token-admin' })).status, 200);
  assert.equal((await post('/', { agendamento_id: id, metodo: 'boleto' }, { token: 'token-a' })).status, 400);
});

test('trocar de PIX para cartão cancela o PIX no provedor; o PIX em aberto é reaproveitado', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const denovo = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  assert.equal(denovo.corpo.id, pix.corpo.id);
  assert.equal(mp.chamadas.filter((c) => c.caminho === '/v1/payments').length, 1);

  const mpId = (await pagamento(pix.corpo.id)).provedor_pagamento_id;
  await post('/', { agendamento_id: id, metodo: 'cartao' }, { token: 'token-a' });
  assert.ok(mp.chamadas.some((c) => c.metodo === 'PUT' && c.caminho === `/v1/payments/${mpId}` && c.corpo.status === 'cancelled'));
  const cancelado = await pagamento(pix.corpo.id);
  assert.deepEqual([cancelado.status, cancelado.cancelamento_provedor], ['canceled', 'confirmado']);
});

test('10. reembolso online: só o admin; parcial ajusta a comissão', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await concluir(id);
  const r = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const mpId = (await pagamento(r.corpo.id)).provedor_pagamento_id;
  mp.mudar(mpId, 'approved');
  await webhook(mpId);

  assert.equal((await post(`/${r.corpo.id}/reembolsar`, { valor: 10 }, { token: 'token-a' })).status, 403);
  assert.equal((await post(`/${r.corpo.id}/reembolsar`, { valor: 100 }, { token: 'token-admin' })).status, 400);
  const parcial = await post(`/${r.corpo.id}/reembolsar`, { valor: 10 }, { token: 'token-admin' });
  assert.equal(parcial.status, 200);
  assert.deepEqual([parcial.corpo.status, parcial.corpo.valor_reembolsado], ['partially_refunded', 10]);
  const pedido = mp.chamadas.find((c) => c.caminho === `/v1/payments/${mpId}/refunds`);
  assert.equal(pedido.corpo.amount, 10);
  assert.ok(pedido.headers['X-Idempotency-Key']);
  assert.deepEqual(await lancamentos(id), [['servico', 40, 24], ['reembolso', -10, -6]]);

  // O resto: reembolso total
  const resto = await post(`/${r.corpo.id}/reembolsar`, {}, { token: 'token-admin' });
  assert.deepEqual([resto.corpo.status, resto.corpo.valor_reembolsado], ['refunded', 40]);
  const ls = await lancamentos(id);
  assert.equal(ls.reduce((s, l) => s + l[2], 0), 0);
});

test('provedor fora do ar: 502 e a cobrança é liberada para nova tentativa; sem credenciais só o presencial', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  mp.ficarFora(true);
  const falha = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  assert.deepEqual([falha.status, falha.corpo.code], [502, 'PROVEDOR_INDISPONIVEL']);
  const { rows } = await db.query('SELECT status FROM public.pagamentos WHERE agendamento_id = $1', [id]);
  assert.deepEqual(rows.map((r) => r.status), ['canceled']);
  mp.ficarFora(false);
  assert.equal((await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' })).status, 201);

  await iniciarServidor(montar({ comMp: false }));
  const outro = await agendar(CLIENTE_B, JOAO, CORTE_30, '10:00');
  const semMp = await post('/', { agendamento_id: outro, metodo: 'pix' }, { token: 'token-b' });
  assert.deepEqual([semMp.status, semMp.corpo.code], [503, 'PAGAMENTO_ONLINE_INDISPONIVEL']);
  assert.equal((await post('/', { agendamento_id: outro, metodo: 'presencial' }, { token: 'token-b' })).status, 201);
  assert.equal((await webhook(123)).status, 503);
});

test('assinatura do webhook segue o manifesto da documentação', () => {
  const ts = '1704908010';
  const v1 = crypto.createHmac('sha256', 'chave').update('id:abc123;request-id:req-9;ts:1704908010;').digest('hex');
  assert.equal(validarAssinatura({ assinatura: `ts=${ts},v1=${v1}`, requestId: 'req-9', dataId: 'ABC123', segredo: 'chave' }), true);
  assert.equal(validarAssinatura({ assinatura: `ts=${ts},v1=${v1}`, requestId: 'outro', dataId: 'ABC123', segredo: 'chave' }), false);
  assert.equal(validarAssinatura({ assinatura: `ts=${ts},v1=${v1}`, requestId: 'req-9', dataId: 'ABC123', segredo: 'errada' }), false);
  assert.equal(validarAssinatura({ assinatura: undefined, requestId: 'req-9', dataId: 'ABC123', segredo: 'chave' }), false);
});

test('estados do Mercado Pago viram os estados do sistema', () => {
  const base = { id: 1, transaction_amount: 40, fee_details: [{ amount: 1.2 }, { amount: 0.3 }] };
  const e = (p) => estadoDoMercadoPago({ ...base, ...p });
  assert.equal(e({ status: 'approved' }).status, 'approved');
  assert.equal(e({ status: 'approved' }).taxa, 1.5);
  assert.equal(e({ status: 'approved', status_detail: 'partially_refunded', transaction_amount_refunded: 10 }).status, 'partially_refunded');
  assert.equal(e({ status: 'refunded' }).status, 'refunded');
  assert.equal(e({ status: 'in_process' }).status, 'pending');
  assert.equal(e({ status: 'rejected' }).status, 'rejected');
  assert.equal(e({ status: 'cancelled', status_detail: 'expired' }).status, 'expired');
  assert.equal(e({ status: 'cancelled', status_detail: 'by_collector' }).status, 'canceled');
  const chargeback = e({ status: 'charged_back' });
  assert.deepEqual([chargeback.status, chargeback.valor_reembolsado, chargeback.reembolsos.length], ['refunded', 40, 1]);
});

// ---------------------------------------------------------------
// Duplicidade, cancelamento no provedor e historico (migration 19)
// ---------------------------------------------------------------
const historico = async (pagamentoId) =>
  (await db.query('SELECT evento, origem, ator, valor, detalhe FROM public.pagamento_auditoria WHERE pagamento_id = $1 ORDER BY id', [pagamentoId])).rows;
const doAgendamento = async (id) =>
  (await db.query('SELECT * FROM public.pagamentos WHERE agendamento_id = $1 ORDER BY criado_em', [id])).rows;
async function comoAdmin(fn) {
  await comoUsuario(ADMIN);
  try { return await fn(); } finally { await comoUsuario(null); }
}

test('duplicidade: o cancelamento do PIX falhou, o cliente pagou PIX e cartão — o admin devolve só a duplicidade', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00'); // R$ 40
  await concluir(id);
  const pix = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const mpPix = (await pagamento(pix.corpo.id)).provedor_pagamento_id;

  // Troca para cartao com o Mercado Pago recusando o cancelamento do PIX
  mp.falharCancelamento(true);
  const cartao = await post('/', { agendamento_id: id, metodo: 'cartao' }, { token: 'token-a' });
  mp.falharCancelamento(false);
  assert.equal(cartao.status, 201);
  assert.deepEqual([(await pagamento(pix.corpo.id)).status, (await pagamento(pix.corpo.id)).cancelamento_provedor], ['canceled', 'falhou']);

  // Paga o cartao e tambem o PIX que continuou aberto no Mercado Pago
  await webhook(mp.tentativaCartao(cartao.corpo.id, 40, 'approved'));
  mp.mudar(mpPix, 'approved');
  await webhook(mpPix);
  const dup = await pagamento(pix.corpo.id);
  assert.deepEqual([dup.status, dup.duplicidade_de], ['approved', cartao.corpo.id]);
  assert.deepEqual(await lancamentos(id), [['servico', 40, 24]]);

  // Reembolsar o cartao (que quitou o atendimento) antes da duplicidade: recusado
  const errado = await post(`/${cartao.corpo.id}/reembolsar`, {}, { token: 'token-admin' });
  assert.deepEqual([errado.status, errado.corpo.code], [409, 'DUPLICIDADE_PENDENTE']);
  assert.equal(mp.chamadas.filter((c) => c.caminho.endsWith('/refunds')).length, 0);

  // Devolve a duplicidade, com motivo: total, sem mexer na comissao
  const devolvida = await post(`/${pix.corpo.id}/reembolsar`, { motivo: '  Pagou duas vezes  ' }, { token: 'token-admin' });
  assert.equal(devolvida.status, 200);
  assert.deepEqual([devolvida.corpo.status, devolvida.corpo.valor_reembolsado], ['refunded', 40]);
  const pedido = mp.chamadas.find((c) => c.caminho === `/v1/payments/${mpPix}/refunds`);
  assert.deepEqual(pedido.corpo, {});
  assert.deepEqual(await lancamentos(id), [['servico', 40, 24]]);
  const [rb] = (await db.query('SELECT motivo, registrado_por FROM public.pagamento_reembolsos WHERE pagamento_id = $1', [pix.corpo.id])).rows;
  assert.deepEqual([rb.motivo, rb.registrado_por], ['Pagou duas vezes', ADMIN]);
  const eventos = (await historico(pix.corpo.id)).map((e) => [e.evento, e.origem]);
  for (const esperado of [['cancelamento_provedor', 'sistema'], ['duplicidade', 'provedor'], ['reembolso_solicitado', 'admin'], ['reembolso', 'provedor']]) {
    assert.ok(eventos.some((e) => e[0] === esperado[0] && e[1] === esperado[1]), `faltou ${esperado.join('/')}`);
  }

  // Agora o cartao pode ser reembolsado
  assert.equal((await post(`/${cartao.corpo.id}/reembolsar`, { valor: 10 }, { token: 'token-admin' })).status, 200);
});

test('trocar de meio com o PIX já pago: não gera a segunda cobrança', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  // O cliente pagou o PIX e, antes da confirmacao chegar, tentou trocar para cartao
  mp.mudar((await pagamento(pix.corpo.id)).provedor_pagamento_id, 'approved');
  const cartao = await post('/', { agendamento_id: id, metodo: 'cartao' }, { token: 'token-a' });
  assert.deepEqual([cartao.status, cartao.corpo.code], [409, 'JA_PAGO']);
  assert.equal(mp.chamadas.filter((c) => c.caminho === '/checkout/preferences').length, 0);
  const pagos = (await doAgendamento(id)).filter((p) => p.status === 'approved');
  assert.deepEqual(pagos.map((p) => [p.id, p.duplicidade_de]), [[pix.corpo.id, null]]);
});

test('pagou duas vezes na página do cartão: os dois valores ficam registrados (webhook e sincronização)', async () => {
  const id = await agendar(CLIENTE_A, JOAO, BARBA_30, '09:00'); // R$ 35
  const cartao = await post('/', { agendamento_id: id, metodo: 'cartao' }, { token: 'token-a' });
  const a1 = mp.tentativaCartao(cartao.corpo.id, 35, 'approved');
  const a2 = mp.tentativaCartao(cartao.corpo.id, 35, 'approved');
  await webhook(a1);
  await webhook(a2);
  await webhook(a2);
  let linhas = await doAgendamento(id);
  assert.deepEqual(linhas.map((p) => [p.provedor_pagamento_id, p.status, p.duplicidade_de]),
    [[String(a1), 'approved', null], [String(a2), 'approved', cartao.corpo.id]]);

  // A sincronizacao do cliente devolve a cobranca dele e nao cria outros registros
  const s = await post(`/${cartao.corpo.id}/sincronizar`, {}, { token: 'token-a' });
  assert.deepEqual([s.corpo.id, s.corpo.status], [cartao.corpo.id, 'approved']);
  linhas = await doAgendamento(id);
  assert.equal(linhas.length, 2);
});

test('pagamento na barbearia: o PIX em aberto é cancelado no Mercado Pago pela rota do admin', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const mpPix = (await pagamento(pix.corpo.id)).provedor_pagamento_id;
  // O admin registra pelo app (funcao do banco) e pede o cancelamento no provedor
  await comoAdmin(() => chamarPglite('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'dinheiro', p_desconto: 0, p_taxa: 0 }));

  assert.equal((await post('/cobrancas-abertas/cancelar', { agendamento_id: id }, { token: 'token-a' })).status, 403);
  const r = await post('/cobrancas-abertas/cancelar', { agendamento_id: id }, { token: 'token-admin' });
  assert.deepEqual([r.status, r.corpo], [200, { canceladas: 1, falharam: 0 }]);
  assert.ok(mp.chamadas.some((c) => c.metodo === 'PUT' && c.caminho === `/v1/payments/${mpPix}` && c.corpo.status === 'cancelled'));
  assert.equal((await pagamento(pix.corpo.id)).cancelamento_provedor, 'confirmado');
  // Nada mais em aberto
  assert.deepEqual((await post('/cobrancas-abertas/cancelar', {}, { token: 'token-admin' })).corpo, { canceladas: 0, falharam: 0 });
});

test('pagamento na barbearia depois de o PIX já ter sido pago: a duplicidade aparece na hora', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  mp.mudar((await pagamento(pix.corpo.id)).provedor_pagamento_id, 'approved'); // a notificacao ainda nao chegou
  const { pagamento: presencial } = await comoAdmin(() => chamarPglite('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'dinheiro', p_desconto: 0, p_taxa: 0 }));

  const r = await post('/cobrancas-abertas/cancelar', { agendamento_id: id }, { token: 'token-admin' });
  assert.deepEqual(r.corpo, { canceladas: 0, falharam: 1 });
  const dup = await pagamento(pix.corpo.id);
  assert.deepEqual([dup.status, dup.duplicidade_de], ['approved', presencial.id]);
  const hoje = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
  const resumo = await comoAdmin(() => chamarPglite('financeiro_resumo', { p_inicio: hoje, p_fim: '2100-01-01' }));
  assert.deepEqual([Number(resumo.duplicados_quantidade), Number(resumo.duplicados_valor), Number(resumo.total_recebido)], [1, 40, 80]);
});

test('reembolso que o Mercado Pago não confirma: nada muda e a falha fica no histórico', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await post('/', { agendamento_id: id, metodo: 'pix' }, { token: 'token-a' });
  const mpPix = (await pagamento(pix.corpo.id)).provedor_pagamento_id;
  mp.mudar(mpPix, 'approved');
  await webhook(mpPix);

  mp.ficarFora(true);
  const r = await post(`/${pix.corpo.id}/reembolsar`, { valor: 10, motivo: 'atraso' }, { token: 'token-admin' });
  mp.ficarFora(false);
  assert.deepEqual([r.status, r.corpo.code], [502, 'PROVEDOR_INDISPONIVEL']);
  const p = await pagamento(pix.corpo.id);
  assert.deepEqual([p.status, Number(p.valor_reembolsado)], ['approved', 0]);
  const eventos = await historico(pix.corpo.id);
  assert.deepEqual(eventos.slice(-2).map((e) => [e.evento, e.ator, e.detalhe]),
    [['reembolso_solicitado', ADMIN, 'atraso'], ['reembolso_falhou', ADMIN, 'indisponivel']]);
  // Valor invalido nem chega ao provedor
  assert.equal((await post(`/${pix.corpo.id}/reembolsar`, { valor: 'abc' }, { token: 'token-admin' })).status, 400);
  assert.equal(mp.chamadas.filter((c) => c.caminho.endsWith('/refunds')).length, 1);
});
