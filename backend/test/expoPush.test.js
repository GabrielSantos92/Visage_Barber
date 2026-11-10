// Cliente da Expo (services/expoPush.js) com um fetch falso: nenhuma chamada
// sai para a rede e nenhuma notificacao real e enviada.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarExpoPush, classificarTicket } = require('../src/services/expoPush');

const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
const token = (i) => `ExponentPushToken[aparelho-${i}]`;
const mensagem = (i) => ({ to: token(i), title: 'Título', body: 'Corpo' });

// fetch falso: guarda cada pedido e responde com `responder(corpo, caminho)`
function falso(responder) {
  const pedidos = [];
  async function fetch(url, init) {
    const corpo = JSON.parse(init.body);
    const caminho = new URL(url).pathname;
    pedidos.push({ url, caminho, headers: init.headers, corpo });
    return responder(corpo, caminho, init);
  }
  return { fetch, pedidos };
}

const aceitaTudo = (corpo) => resposta(200, { data: corpo.map((m) => ({ status: 'ok', id: `t-${m.to}` })) });

test('envia em lotes de até 100 e devolve um resultado por mensagem, na mesma ordem', async () => {
  const f = falso(aceitaTudo);
  const expo = criarExpoPush({ fetch: f.fetch });
  const mensagens = Array.from({ length: 250 }, (_, i) => mensagem(i));
  const resultados = await expo.enviar(mensagens);
  assert.deepEqual(f.pedidos.map((p) => p.corpo.length), [100, 100, 50]);
  assert.ok(f.pedidos.every((p) => p.url === 'https://exp.host/--/api/v2/push/send'));
  assert.equal(resultados.length, 250);
  resultados.forEach((r, i) => assert.deepEqual(r, { status: 'aceito', ticket_id: `t-${token(i)}` }));
});

test('uma mensagem só pode voltar como objeto em vez de lista', async () => {
  const f = falso(() => resposta(200, { data: { status: 'ok', id: 'unico' } }));
  const [r] = await criarExpoPush({ fetch: f.fetch }).enviar([mensagem(1)]);
  assert.deepEqual(r, { status: 'aceito', ticket_id: 'unico' });
});

test('classifica cada ticket e nunca guarda o texto da Expo (que traz o token do aparelho)', async () => {
  const f = falso(() => resposta(200, { data: [
    { status: 'ok', id: 'a' },
    { status: 'error', message: `"${token(2)}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } },
    { status: 'error', message: `muitas mensagens para ${token(3)}`, details: { error: 'MessageRateExceeded' } },
    { status: 'error', message: 'grande demais', details: { error: 'MessageTooBig' } },
    { status: 'error', message: `erro novo para ${token(5)}`, details: { error: 'AlgoNovo' } },
    // a sexta mensagem ficou sem ticket
  ] }));
  const resultados = await criarExpoPush({ fetch: f.fetch }).enviar([1, 2, 3, 4, 5, 6].map(mensagem));
  assert.deepEqual(resultados, [
    { status: 'aceito', ticket_id: 'a' },
    { status: 'recusado', erro: 'DeviceNotRegistered' },
    { status: 'erro', erro: 'MessageRateExceeded' },
    { status: 'recusado', erro: 'MessageTooBig' },
    { status: 'erro', erro: 'AlgoNovo' },
    { status: 'erro', erro: 'SemTicket' },
  ]);
  assert.ok(!JSON.stringify(resultados).includes('ExponentPushToken'));
  assert.deepEqual(classificarTicket(undefined), { status: 'erro', erro: 'SemTicket' });
});

test('falhas do pedido: timeout, rede, 429, 5xx e 401 são temporárias; 400 é definitiva; resposta inválida é temporária', async () => {
  const casos = [
    [(_c, _p, init) => new Promise((_, rejeitar) => init.signal.addEventListener('abort',
      () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' })))), { status: 'erro', erro: 'Timeout' }],
    [() => { throw new TypeError('fetch failed'); }, { status: 'erro', erro: 'FalhaDeConexao' }],
    [() => resposta(429, { errors: [{ code: 'TOO_MANY_REQUESTS', message: 'x' }] }), { status: 'erro', erro: 'HTTP 429 TOO_MANY_REQUESTS' }],
    [() => resposta(503, {}), { status: 'erro', erro: 'HTTP 503' }],
    [() => resposta(401, { errors: [{ code: 'UNAUTHORIZED', message: 'x' }] }), { status: 'erro', erro: 'HTTP 401 UNAUTHORIZED' }],
    [() => resposta(400, { errors: [{ code: 'VALIDATION_ERROR', message: `"to" invalido: ${token(1)}` }] }), { status: 'recusado', erro: 'HTTP 400 VALIDATION_ERROR' }],
    [() => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('json'); } }), { status: 'erro', erro: 'RespostaInvalida' }],
  ];
  for (const [responder, esperado] of casos) {
    const f = falso(responder);
    const inicio = Date.now();
    const [r] = await criarExpoPush({ fetch: f.fetch, timeoutMs: 30 }).enviar([mensagem(1)]);
    assert.deepEqual(r, esperado);
    assert.ok(Date.now() - inicio < 2000, 'nao pode travar');
  }
});

test('lote recusado por inteiro (ex.: token de outro projeto): manda uma a uma e só a mensagem com problema falha', async () => {
  const f = falso((corpo) => {
    if (corpo.length > 1) return resposta(400, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'x' }] });
    if (corpo[0].to === token(1)) return resposta(400, { errors: [{ code: 'VALIDATION_ERROR', message: 'x' }] });
    return aceitaTudo(corpo);
  });
  const resultados = await criarExpoPush({ fetch: f.fetch }).enviar([0, 1, 2].map(mensagem));
  assert.deepEqual(f.pedidos.map((p) => p.corpo.length), [3, 1, 1, 1]);
  assert.deepEqual(resultados, [
    { status: 'aceito', ticket_id: `t-${token(0)}` },
    { status: 'recusado', erro: 'HTTP 400 VALIDATION_ERROR' },
    { status: 'aceito', ticket_id: `t-${token(2)}` },
  ]);
});

test('cabeçalhos: Authorization só com o token de acesso da Expo; JSON e gzip sempre', async () => {
  const comToken = falso(aceitaTudo);
  await criarExpoPush({ fetch: comToken.fetch, accessToken: 'acesso-expo' }).enviar([mensagem(1)]);
  assert.equal(comToken.pedidos[0].headers.Authorization, 'Bearer acesso-expo');
  assert.equal(comToken.pedidos[0].headers['Content-Type'], 'application/json');
  assert.equal(comToken.pedidos[0].headers['Accept-Encoding'], 'gzip, deflate');

  const semToken = falso(aceitaTudo);
  await criarExpoPush({ fetch: semToken.fetch }).enviar([mensagem(1)]);
  assert.equal('Authorization' in semToken.pedidos[0].headers, false);
});

test('recibos: em lotes de até 1000; o que ainda não tem recibo fica de fora; erro vira só o código', async () => {
  const ids = Array.from({ length: 1500 }, (_, i) => `t-${i}`);
  const f = falso((corpo) => resposta(200, { data: Object.fromEntries(corpo.ids
    .filter((id) => id !== 't-7') // ainda sem recibo
    .map((id) => [id, id === 't-3'
      ? { status: 'error', message: `falhou para ${token(3)}`, details: { error: 'DeviceNotRegistered' } }
      : { status: 'ok' }])) }));
  const recibos = await criarExpoPush({ fetch: f.fetch }).recibos(ids);
  assert.deepEqual(f.pedidos.map((p) => [p.caminho, p.corpo.ids.length]), [
    ['/--/api/v2/push/getReceipts', 1000], ['/--/api/v2/push/getReceipts', 500],
  ]);
  assert.equal(recibos.length, 1499);
  assert.deepEqual(recibos.find((r) => r.ticket_id === 't-3'), { ticket_id: 't-3', status: 'error', erro: 'DeviceNotRegistered' });
  assert.ok(!recibos.some((r) => r.ticket_id === 't-7'));
  assert.ok(!JSON.stringify(recibos).includes('ExponentPushToken'));
});

test('recibos: pedido que falha lança erro temporário (o backend tenta de novo depois)', async () => {
  const f = falso(() => resposta(502, {}));
  await assert.rejects(criarExpoPush({ fetch: f.fetch }).recibos(['t-1']), (e) => e.temporario === true && e.message === 'HTTP 502');
});
