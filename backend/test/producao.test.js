// Ajustes para a publicacao: CORS configuravel, cadastro publico retirado e
// pagamento online desligado enquanto o Mercado Pago nao estiver em producao.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const { opcoesCors } = require('../src/services/cors');
const { criarServicoPagamentos, pagamentoOnlineAtivo } = require('../src/services/pagamentos');
const { criarRotasPagamentos } = require('../src/routes/pagamentos');

const AG = 'a0000000-0000-4000-8000-000000000001';

test('CORS: sem CORS_ORIGENS qualquer origem (como antes); com a lista, só ela, sem barra no fim', () => {
  assert.deepEqual(opcoesCors({}), {});
  assert.deepEqual(opcoesCors({ CORS_ORIGENS: '  ' }), {});
  assert.deepEqual(opcoesCors({ CORS_ORIGENS: 'https://visagebarber.com.br/, https://www.visagebarber.com.br,,' }), {
    origin: ['https://visagebarber.com.br', 'https://www.visagebarber.com.br'],
  });
});

test('cadastro público: a rota que criava contas já confirmadas não existe mais; a recuperação de senha continua', () => {
  const router = require('../src/routes/auth');
  const rotas = router.stack.filter((c) => c.route).map((c) => [Object.keys(c.route.methods)[0], c.route.path]);
  assert.deepEqual(rotas, [['post', '/recuperar-senha/email']]);
});

test('pagamento online só com o Mercado Pago em produção (ou sandbox liberado de propósito)', () => {
  const TOKEN = { MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-ficticio' };
  assert.equal(pagamentoOnlineAtivo({}), false);
  assert.equal(pagamentoOnlineAtivo({ MERCADOPAGO_AMBIENTE: 'producao' }), false, 'sem token');
  assert.equal(pagamentoOnlineAtivo({ ...TOKEN }), false, 'sem ambiente');
  assert.equal(pagamentoOnlineAtivo({ ...TOKEN, MERCADOPAGO_AMBIENTE: 'teste' }), false, 'teste (estado atual do Render)');
  assert.equal(pagamentoOnlineAtivo({ ...TOKEN, MERCADOPAGO_AMBIENTE: 'teste', PAGAMENTO_ONLINE_TESTE: 'true' }), true);
  assert.equal(pagamentoOnlineAtivo({ ...TOKEN, MERCADOPAGO_AMBIENTE: 'teste', PAGAMENTO_ONLINE_TESTE: '1' }), false);
  assert.equal(pagamentoOnlineAtivo({ ...TOKEN, MERCADOPAGO_AMBIENTE: 'homologacao' }), false);
  assert.equal(pagamentoOnlineAtivo({ ...TOKEN, MERCADOPAGO_AMBIENTE: ' producao ' }), true);
});

function servicoDesligado() {
  const chamadas = [];
  const chamar = async (nome, args) => {
    chamadas.push(nome);
    if (nome === 'iniciar_pagamento') {
      return { pagamento: { id: 'p1', agendamento_id: args.p_agendamento_id, metodo: args.p_metodo, status: 'pending', valor: 50 }, cancelados: [] };
    }
    throw new Error(`chamada inesperada: ${nome}`);
  };
  // Mercado Pago configurado, mas fora de producao: nada pode chegar a ele
  const mp = new Proxy({}, { get: () => () => { throw new Error('não deveria chamar o Mercado Pago'); } });
  return { chamadas, servico: criarServicoPagamentos({ chamar, mp, config: { online: false } }) };
}

test('online desligado: PIX e cartão recusados antes do banco; presencial registrado; formas só presencial', async () => {
  const { chamadas, servico } = servicoDesligado();
  for (const metodo of ['pix', 'cartao']) {
    await assert.rejects(servico.criar({ usuario: { id: 'u1' }, agendamentoId: AG, metodo }), (e) => {
      assert.equal(e.status, 503);
      assert.equal(e.code, 'PAGAMENTO_ONLINE_INDISPONIVEL');
      assert.equal(e.message, 'O pagamento online ainda não está disponível. Escolha pagar na barbearia.');
      return true;
    });
  }
  assert.deepEqual(chamadas, []);
  const p = await servico.criar({ usuario: { id: 'u1' }, agendamentoId: AG, metodo: 'presencial' });
  assert.equal(p.metodo, 'presencial');
  assert.deepEqual(chamadas, ['iniciar_pagamento']);
  assert.deepEqual(servico.formas(), { online: false, metodos: ['presencial'] });
});

test('online ligado e sem Mercado Pago: formas refletem a configuração', () => {
  const mp = {};
  assert.deepEqual(criarServicoPagamentos({ chamar: async () => null, mp }).formas(), { online: true, metodos: ['pix', 'cartao', 'presencial'] });
  assert.deepEqual(criarServicoPagamentos({ chamar: async () => null, mp: null }).formas(), { online: false, metodos: ['presencial'] });
});

test('GET /api/pagamentos/config é pública e não depende de login', async () => {
  const { servico } = servicoDesligado();
  const app = express();
  app.use('/api/pagamentos', criarRotasPagamentos({ servico, verificarToken: async () => null, ehAdmin: async () => false }));
  const s = app.listen(0);
  await once(s, 'listening');
  try {
    const r = await fetch(`http://127.0.0.1:${s.address().port}/api/pagamentos/config`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { online: false, metodos: ['presencial'] });
  } finally {
    s.close();
  }
});
