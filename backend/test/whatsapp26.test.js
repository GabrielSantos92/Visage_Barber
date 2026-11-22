// Cancelamento com confirmacao dupla de ponta a ponta no backend: rotas reais
// (webhook e /processar), fila e regras no banco (PGlite com a migration 26) e
// o cliente da Cloud API falando com uma Meta falsa. Tambem o isolamento do
// ambiente de teste: dois bancos locais (PGlite), um no papel do de PRODUCAO
// (sem a marca) e outro no do de TESTE (com supabase/teste/
// marcar_banco_de_teste.sql). Nenhuma mensagem real e enviada e nenhum servico
// externo e chamado.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { once } = require('node:events');
const express = require('express');

const {
  criarBanco, recusa, MIGRATIONS_WHATSAPP_26, JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');
const { criarWhatsApp, extrairEventos, botoesValidos } = require('../src/services/whatsapp');
const {
  criarConfirmacaoPresenca, montarEnvio, textoDeResposta, BOTAO_CANCELAR, BOTAO_MANTER, RODAPE_CANCELAMENTO,
} = require('../src/services/confirmacaoPresenca');
const { lerConfiguracao } = require('../src/services/notificacoesConfig');
const {
  lerAmbienteServidor, criarGuardaAmbiente, avaliarMarca, REFS_PRODUCAO,
} = require('../src/services/ambienteServidor');

const MARCA = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'teste', 'marcar_banco_de_teste.sql'), 'utf8');
const VERSAO = '2026-11-16';
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-0123';
const APP_SECRET = 'segredo-do-app-de-teste';
const VERIFY = 'token-de-verificacao-teste';
const TOKEN_META = 'token-de-acesso-de-teste';
const NUMERO_ID = '100200300';
const NUMERO_TESTE_ID = '900800700';
const TOKEN_TESTE = 'token-exclusivo-do-numero-de-teste';
const TEL_A = '5511987654321';
const TEL_B = '5521998765432';
const TEL_JOAO = '5511912345678';
// Como a Meta devolve o celular brasileiro: sem o 9
const DE_A = '551187654321';
const URL_TESTE = 'https://projetodetesteabcdefghij.supabase.co';
const URL_PRODUCAO = `https://${REFS_PRODUCAO[0]}.supabase.co`;
const PERFIS = `
  INSERT INTO public.profiles (user_id, nome, telefone) VALUES
    ('${CLIENTE_A}', 'Ana Paula Souza', '11987654321'),
    ('${CLIENTE_B}', 'Bruno Lima', '21998765432'),
    ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
  ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;`;
const ENV_TESTE = {
  BACKEND_AMBIENTE: 'teste',
  NOTIFICACOES_WHATSAPP_ATIVO: 'true', WHATSAPP_APP_SECRET: APP_SECRET, WHATSAPP_WEBHOOK_VERIFY_TOKEN: VERIFY,
  WHATSAPP_PHONE_NUMBER_ID: NUMERO_ID, WHATSAPP_ACCESS_TOKEN: TOKEN_META, WHATSAPP_TEMPLATE_CONFIRMACAO: 'confirmacao_presenca',
  WHATSAPP_AMBIENTE: 'teste', WHATSAPP_TESTE_PHONE_NUMBER_ID: NUMERO_TESTE_ID, WHATSAPP_TESTE_ACCESS_TOKEN: TOKEN_TESTE,
  WHATSAPP_TESTE_TEMPLATE_CONFIRMACAO: 'confirmacao_teste', WHATSAPP_TESTE_TEMPLATE_CANCELAMENTO: 'cancelamento_teste',
  WHATSAPP_TESTE_DESTINATARIOS: `${TEL_A},${TEL_JOAO}`,
};

// ---------------------------------------------------------------
// Meta falsa: mesmo caminho e mesmos formatos da Cloud API
// ---------------------------------------------------------------
// Respostas de erro da Meta (formato e codigos da Cloud API)
const ERROS_META = {
  janela: [400, 131047], destinatario: [400, 131026], desconhecido: [500, 131000], token: [401, 190], conta: [400, 131031],
};
function criarMetaFalsa() {
  const pedidos = [];
  // proximas: { interactive: [...], text: [...], template: [...] } respostas
  // roteirizadas por tipo de mensagem, consumidas em ordem ('timeout' ou uma
  // chave de ERROS_META); sem roteiro, aceita
  const estado = { modo: 'ok', recusarInterativa: false, proximas: { interactive: [], text: [], template: [] } };
  let n = 0;
  const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  return {
    pedidos,
    estado,
    textos: () => pedidos.filter((p) => p.corpo.type === 'text'),
    templates: () => pedidos.filter((p) => p.corpo.type === 'template'),
    interativas: () => pedidos.filter((p) => p.corpo.type === 'interactive'),
    async fetch(url, init) {
      const corpo = JSON.parse(init.body);
      pedidos.push({ url, headers: init.headers, corpo });
      // Fora da janela de 24 h a Meta recusa mensagem que nao e template (131047)
      if (corpo.type === 'interactive' && estado.recusarInterativa) return resposta(400, { error: { code: 131047, message: 'x' } });
      const roteiro = estado.proximas[corpo.type]?.shift();
      if (roteiro === 'timeout') {
        return new Promise((_, rejeitar) => init.signal.addEventListener('abort',
          () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
      }
      if (roteiro) {
        const [http, code] = ERROS_META[roteiro];
        return resposta(http, { error: { code, message: `erro para ${corpo.to}` } });
      }
      const waId = corpo.to.replace(/^(55\d\d)9(\d{8})$/, '$1$2');
      return resposta(200, { messaging_product: 'whatsapp', contacts: [{ input: corpo.to, wa_id: waId }], messages: [{ id: `wamid.M${++n}` }] });
    },
  };
}
function criarLog() {
  const linhas = [];
  const r = (...p) => linhas.push(p.join(' '));
  return { linhas, log: r, info: r, warn: r, error: r };
}
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

let db, producao, teste, meta, logs, servidor, base;
let seq = 0;

before(async () => {
  db = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26 });
  await db.exec(PERFIS);
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
});

after(() => servidor?.close());

// Sobe as rotas reais. `guarda`: a mesma conferencia do ambiente do app.js
// (nada de /api passa antes de liberar)
async function subir({ servico, phoneNumberId = NUMERO_ID, ativo = true, guarda = null }) {
  const { criarRotasWhatsapp } = carregar('../src/routes/whatsapp');
  const { criarRotasNotificacoes } = carregar('../src/routes/notificacoes');
  const app = express();
  app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
  if (guarda) app.use('/api', guarda.middleware);
  app.use('/api/whatsapp', criarRotasWhatsapp({ ativo, servico, appSecret: APP_SECRET, verifyToken: VERIFY, phoneNumberId, log: logs }));
  app.use('/api/notificacoes', criarRotasNotificacoes({
    servico: { solicitarProcessamento: async () => { throw new Error('o push não deveria ser chamado'); } },
    verificarToken: async () => null, segredo: SEGREDO, ativo: true, pushAtivo: false, log: logs,
    servicoWhatsapp: {
      solicitarProcessamento: () => ((typeof ativo === 'function' ? ativo() : ativo) ? servico.solicitarProcessamento() : Promise.resolve(null)),
    },
  }));
  if (servidor) servidor.close();
  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}`;
}

function montarServico({ chamar = chamarDe(db), config = {}, timeoutMs = 2000, agora } = {}) {
  return criarConfirmacaoPresenca({
    chamar,
    whatsapp: criarWhatsApp({ token: TOKEN_META, phoneNumberId: NUMERO_ID, fetch: meta.fetch, timeoutMs }),
    config: { templateConfirmacao: 'confirmacao_presenca', templateCancelamento: 'cancelamento_whatsapp', esperasRegistro: [0, 0], ...config },
    log: logs,
    esperar: async () => {},
    ...(agora ? { agora } : {}),
  });
}

const assinar = (texto) => `sha256=${crypto.createHmac('sha256', APP_SECRET).update(texto).digest('hex')}`;
async function webhook(corpo) {
  const texto = JSON.stringify(corpo);
  const r = await fetch(`${base}/api/whatsapp/webhook`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hub-Signature-256': assinar(texto) }, body: texto,
  });
  return { status: r.status, corpo: await r.json() };
}
const envelope = (value, phoneNumberId = NUMERO_ID) => ({
  object: 'whatsapp_business_account',
  entry: [{ id: 'waba', changes: [{ field: 'messages', value: { messaging_product: 'whatsapp', metadata: { phone_number_id: phoneNumberId }, ...value } }] }],
});
// Toque num botao de template (primeira mensagem)
const botaoTemplate = (id, de, payload, contexto, numero) => envelope({
  messages: [{ id, from: de, timestamp: '1', type: 'button', button: { payload, text: 'x' }, context: { id: contexto } }] }, numero);
// Toque num botao de resposta da mensagem interativa (segunda mensagem)
const botaoInterativo = (id, de, botaoId, contexto, numero) => envelope({
  messages: [{ id, from: de, timestamp: '1', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: botaoId, title: 'x' } }, context: { id: contexto } }] }, numero);
const texto = (id, de, body, numero) => envelope({ messages: [{ id, from: de, timestamp: '1', type: 'text', text: { body } }] }, numero);

const statusDe = async (banco, ag) => (await banco.query('SELECT status::text AS s FROM public.agendamentos WHERE id = $1', [ag])).rows[0].s;
const solicitacaoDe = async (banco, ag) => (await banco.query('SELECT * FROM public.solicitacoes_cancelamento WHERE agendamento_id = $1', [ag])).rows[0];

// Confirmacao de presenca ja enviada pelo servico (fila -> Meta falsa -> aceito)
async function pedidoEnviado(servico, { banco = db, cliente = CLIENTE_A, minutos = 100 } = {}) {
  seq += 1;
  await banco.query("INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', $2, 'web') ON CONFLICT DO NOTHING", [cliente, VERSAO]);
  const { rows: [{ id }] } = await banco.query(
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora)
     VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4) + make_interval(secs => $5)) RETURNING id`,
    [cliente, JOAO, CORTE_30, minutos, seq % 50]);
  await banco.query("UPDATE public.agendamentos SET horario_definido_em = now() - interval '1 day' WHERE id = $1", [id]);
  await banco.query('SELECT public.enfileirar_confirmacoes_presenca()');
  await servico.processarFila();
  const conf = (await banco.query('SELECT * FROM public.confirmacoes_presenca WHERE agendamento_id = $1', [id])).rows[0];
  assert.equal(conf.estado, 'enviada');
  const { wamid } = (await banco.query('SELECT wamid FROM public.whatsapp_mensagens WHERE notificacao_id = $1', [conf.notificacao_id])).rows[0];
  return { id, conf, wamid };
}
// NAO pelo botao + segunda mensagem (interativa) enviada
async function segundaEnviada(servico, p, { banco = db, de = DE_A, numero } = {}) {
  assert.equal((await webhook(botaoTemplate(`n.${++seq}`, de, `VB_NAO:${p.conf.id}`, p.wamid, numero))).status, 200);
  await servico.aguardar();
  const sol = await solicitacaoDe(banco, p.id);
  assert.equal(sol.estado, 'aguardando');
  const { wamid } = (await banco.query('SELECT wamid FROM public.whatsapp_mensagens WHERE notificacao_id = $1', [sol.notificacao_id])).rows[0];
  return { ...p, sol, wamid2: wamid };
}

// ---------------------------------------------------------------
// A. Mensagens e limites da Meta
// ---------------------------------------------------------------
test('A1. botões de resposta: monta a mensagem interativa oficial e recusa o que passa dos limites da Meta', async () => {
  const wa = criarWhatsApp({ token: TOKEN_META, phoneNumberId: NUMERO_ID, fetch: meta.fetch });
  const botoes = [{ id: 'VB_CANCELAR:1', titulo: BOTAO_CANCELAR }, { id: 'VB_MANTER:1', titulo: BOTAO_MANTER }];
  const r = await wa.enviarBotoes({ para: TEL_A, texto: 'Tem certeza?', rodape: 'Rodapé', botoes });
  assert.deepEqual(r, { status: 'aceito', wamid: 'wamid.M1', wa_id: DE_A });
  assert.deepEqual(meta.pedidos[0].corpo, {
    messaging_product: 'whatsapp', recipient_type: 'individual', to: TEL_A, type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: 'Tem certeza?' },
      footer: { text: 'Rodapé' },
      action: { buttons: [
        { type: 'reply', reply: { id: 'VB_CANCELAR:1', title: 'SIM, CANCELAR' } },
        { type: 'reply', reply: { id: 'VB_MANTER:1', title: 'NÃO, MANTER' } },
      ] },
    },
  });
  // Fora dos limites nao chega a Meta
  for (const ruim of [
    { texto: 'x', botoes: [{ id: 'a', titulo: 'NÃO, MANTER AGENDAMENTO' }] }, // 23 caracteres
    { texto: 'x', botoes: [1, 2, 3, 4].map((i) => ({ id: `b${i}`, titulo: `B${i}` })) },
    { texto: 'x', botoes: [{ id: 'a', titulo: 'Igual' }, { id: 'b', titulo: 'Igual' }] },
    { texto: 'x', botoes: [{ id: 'a'.repeat(257), titulo: 'A' }] },
    { texto: 'x'.repeat(1025), botoes: [{ id: 'a', titulo: 'A' }] },
    { texto: 'x', rodape: 'r'.repeat(61), botoes: [{ id: 'a', titulo: 'A' }] },
    { texto: '', botoes: [{ id: 'a', titulo: 'A' }] },
  ]) {
    assert.equal(botoesValidos(ruim), false, JSON.stringify(ruim).slice(0, 60));
    assert.deepEqual(await wa.enviarBotoes({ para: TEL_A, ...ruim }),
      { status: 'recusado', erro: 'configuracao:botoes_invalidos', categoria: 'configuracao' });
  }
  assert.equal(meta.pedidos.length, 1);
});

test('A2. segunda mensagem: o texto pedido, o agendamento identificado e botões dentro dos limites', () => {
  const sol = '11111111-2222-4333-8444-555555555555';
  const item = { tipo: 'confirmacao_cancelamento', dados: {
    solicitacao_id: sol, data_hora: '2026-11-18T17:30:00Z', servico: 'Corte\n+ Barba', barbeiro_nome: 'João' } };
  const e = montarEnvio(item, {});
  assert.equal(e.modo, 'botoes');
  assert.equal(e.texto, [
    'Você solicitou o cancelamento deste agendamento. Tem certeza de que deseja cancelar?',
    '',
    'Corte + Barba com João',
    '18/11 às 14h30',
    '',
    'Se confirmar, o agendamento será cancelado e o horário ficará disponível novamente.',
  ].join('\n'));
  assert.deepEqual(e.botoes, [{ id: `VB_CANCELAR:${sol}`, titulo: 'SIM, CANCELAR' }, { id: `VB_MANTER:${sol}`, titulo: 'NÃO, MANTER' }]);
  assert.equal(e.rodape, RODAPE_CANCELAMENTO);
  assert.equal(botoesValidos(e), true);
  assert.throws(() => montarEnvio({ ...item, dados: { ...item.dados, solicitacao_id: 'x' } }, {}), /solicitacao_id/);

  // Aviso ao barbeiro: template proprio (opcional)
  const aviso = montarEnvio({ tipo: 'cancelamento_whatsapp', dados: { data_hora: '2026-11-18T17:30:00Z', servico: 'Corte', cliente_nome: 'Ana' } },
    { templateCancelamento: 'cancelamento_whatsapp' });
  assert.deepEqual(aviso, { modo: 'template', template: 'cancelamento_whatsapp', parametros: ['Ana', 'Corte', '18/11', '14h30'], botoes: [] });
});

test('A3. webhook: o toque no botão da mensagem interativa chega como botão, com a mensagem respondida', () => {
  const r = extrairEventos(botaoInterativo('i.1', DE_A, 'VB_CANCELAR:abc', 'wamid.X'), NUMERO_ID);
  assert.deepEqual(r.mensagens, [{ id: 'i.1', de: DE_A, tipo: 'botao', payload: 'VB_CANCELAR:abc', contexto: 'wamid.X', texto: null }]);
});

test('A4. respostas ao cliente: cada resultado tem um texto claro; o NÃO não manda texto (a segunda mensagem é a resposta)', () => {
  const d = { data_hora: '2026-11-18T17:30:00Z' };
  assert.equal(textoDeResposta({ resultado: 'cancelamento_solicitado', ...d }), null);
  assert.match(textoDeResposta({ resultado: 'cancelamento_confirmado', ...d }), /^Pronto: o agendamento de 18\/11 às 14h30 foi cancelado e o horário foi liberado\. .*devolução não é automática/);
  assert.equal(textoDeResposta({ resultado: 'cancelamento_desistido', ...d }), 'Tudo certo: seu agendamento de 18/11 às 14h30 continua confirmado.');
  assert.match(textoDeResposta({ resultado: 'cancelamento_expirado' }), /prazo para confirmar o cancelamento terminou e o agendamento continua ativo/);
  assert.match(textoDeResposta({ resultado: 'usar_botao' }), /Mensagens escritas não cancelam agendamentos/);
  assert.equal(textoDeResposta({ resultado: 'solicitacao_encerrada', estado: 'confirmada' }), 'Este agendamento já foi cancelado.');
  assert.equal(textoDeResposta({ resultado: 'solicitacao_encerrada', estado: 'desistiu' }), 'Seu agendamento continua confirmado.');
  assert.match(textoDeResposta({ resultado: 'ja_respondida', estado: 'recusada', cancelamento: 'aguardando' }), /já pediu o cancelamento/);
  assert.match(textoDeResposta({ resultado: 'ja_respondida', estado: 'confirmada', cancelamento: null }), /já tinha sido registrada/);
  assert.match(textoDeResposta({ resultado: 'invalida', etapa: 'cancelamento' }), /Nada foi alterado/);
  assert.equal(textoDeResposta({ resultado: 'invalida' }), null);
  // O fluxo da migration 25 continua com o texto dele
  assert.match(textoDeResposta({ resultado: 'recusada' }), /O horário continua reservado/);
});

// ---------------------------------------------------------------
// B. De ponta a ponta (produção, banco com a 26, Meta falsa)
// ---------------------------------------------------------------
test('B1. NÃO pelo webhook: sai a segunda mensagem com os botões; nada é cancelado', async () => {
  const servico = montarServico();
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  assert.deepEqual(await webhook(botaoTemplate('b1', DE_A, `VB_NAO:${p.conf.id}`, p.wamid)), { status: 200, corpo: { recebido: true } });
  await servico.aguardar();
  const sol = await solicitacaoDe(db, p.id);
  const [seg] = meta.interativas();
  assert.equal(seg.corpo.to, TEL_A);
  assert.match(seg.corpo.interactive.body.text, /^Você solicitou o cancelamento deste agendamento\. Tem certeza de que deseja cancelar\?/);
  assert.deepEqual(seg.corpo.interactive.action.buttons.map((b) => [b.reply.id, b.reply.title]),
    [[`VB_CANCELAR:${sol.id}`, 'SIM, CANCELAR'], [`VB_MANTER:${sol.id}`, 'NÃO, MANTER']]);
  assert.equal(meta.textos().length, 0, 'sem texto extra: a segunda mensagem é a resposta');
  assert.equal(sol.estado, 'aguardando');
  assert.equal(await statusDe(db, p.id), 'confirmado');
});

test('B2. SIM, CANCELAR: cancela, o cliente recebe a confirmação e o barbeiro é avisado', async () => {
  await db.query("INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', $2, 'web')", [USUARIO_JOAO, VERSAO]);
  const servico = montarServico();
  await subir({ servico });
  const s = await segundaEnviada(servico, await pedidoEnviado(servico));
  assert.equal((await webhook(botaoInterativo('b2', DE_A, `VB_CANCELAR:${s.sol.id}`, s.wamid2))).status, 200);
  await servico.aguardar();
  assert.equal(await statusDe(db, s.id), 'cancelado');
  assert.match(meta.textos().at(-1).corpo.text.body, /^Pronto: o agendamento de \d\d\/\d\d às \d{1,2}h(\d\d)? foi cancelado/);
  const paraBarbeiro = meta.templates().filter((t) => t.corpo.template.name === 'cancelamento_whatsapp');
  assert.deepEqual(paraBarbeiro.map((t) => t.corpo.to), [TEL_JOAO]);
  assert.deepEqual(paraBarbeiro[0].corpo.template.components[0].parameters.slice(0, 2).map((x) => x.text), ['Ana', 'Corte']);

  // A Meta entrega o mesmo toque de novo: nada muda, nada sai
  const antes = meta.pedidos.length;
  assert.equal((await webhook(botaoInterativo('b2', DE_A, `VB_CANCELAR:${s.sol.id}`, s.wamid2))).status, 200);
  await servico.aguardar();
  assert.equal(meta.pedidos.length, antes);
  // Outro toque (novo evento): só informa
  await webhook(botaoInterativo('b2b', DE_A, `VB_CANCELAR:${s.sol.id}`, s.wamid2));
  assert.equal(meta.textos().at(-1).corpo.text.body, 'Este agendamento já foi cancelado.');
  assert.doesNotMatch(logs.linhas.join('\n'), new RegExp(`${TOKEN_META}|${TEL_A}|${DE_A}|${TEL_JOAO}`));
});

test('B3. NÃO, MANTER: o agendamento continua e o cliente é informado', async () => {
  const servico = montarServico();
  await subir({ servico });
  const s = await segundaEnviada(servico, await pedidoEnviado(servico));
  await webhook(botaoInterativo('b3', DE_A, `VB_MANTER:${s.sol.id}`, s.wamid2));
  assert.equal(await statusDe(db, s.id), 'confirmado');
  assert.match(meta.textos().at(-1).corpo.text.body, /^Tudo certo: seu agendamento de .* continua confirmado\.$/);
  assert.equal((await solicitacaoDe(db, s.id)).estado, 'desistiu');
});

test('B4. texto "sim" enquanto a confirmação de cancelamento aguarda: só orienta a usar os botões', async () => {
  const servico = montarServico();
  await subir({ servico });
  const s = await segundaEnviada(servico, await pedidoEnviado(servico));
  await webhook(texto('b4', DE_A, 'sim'));
  assert.match(meta.textos().at(-1).corpo.text.body, /Mensagens escritas não cancelam agendamentos/);
  assert.equal(await statusDe(db, s.id), 'confirmado');
  assert.equal((await solicitacaoDe(db, s.id)).estado, 'aguardando');
});

test('B5. a Meta recusa a segunda mensagem: nada é cancelado e o barbeiro vê o pedido não confirmado', async () => {
  const servico = montarServico();
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  meta.estado.recusarInterativa = true;
  await webhook(botaoTemplate('b5', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  await servico.aguardar();
  const sol = await solicitacaoDe(db, p.id);
  assert.deepEqual([sol.estado, sol.motivo], ['nao_enviada', 'janela_fechada:131047']);
  assert.equal(await statusDe(db, p.id), 'confirmado');
  // Nao tenta de novo
  await servico.processarFila();
  assert.equal(meta.interativas().length, 1);
  // Janela fechada e sem template aprovado para o aviso: o aviso de "nao
  // concluido" e registrado sem chamar a Meta (o texto nao chegaria)
  const aviso = (await db.query("SELECT status, motivo FROM public.notificacoes WHERE tipo = 'cancelamento_nao_concluido'")).rows;
  assert.deepEqual(aviso, [{ status: 'falhou', motivo: 'janela_fechada:sem_template' }]);
  assert.equal(meta.textos().length, 0);
  assert.equal(meta.templates().length, 1, 'só a confirmação de presença');
});

test('B6. toque antes de o envio da segunda mensagem ser gravado: 500 (a Meta entrega de novo) e depois vale', async () => {
  let segurar = true;
  const chamar = async (nome, args) => {
    // O resultado do envio da segunda mensagem demora a ser gravado
    if (nome === 'concluir_envio_whatsapp' && segurar && (await db.query(
      "SELECT 1 FROM public.notificacoes WHERE id = $1 AND tipo = 'confirmacao_cancelamento'", [args.p_notificacao_id])).rows.length) {
      throw Object.assign(new Error('banco lento'), { code: '57014' });
    }
    return chamarDe(db)(nome, args);
  };
  const servico = montarServico({ chamar });
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  await webhook(botaoTemplate('b6', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  await servico.aguardar();
  const sol = await solicitacaoDe(db, p.id);
  assert.equal(sol.estado, 'pendente');
  // O cliente ja recebeu e tocou; o wamid devolvido pela Meta (a Meta falsa
  // numera cada pedido) ainda nao esta no banco
  const wamid = `wamid.M${meta.pedidos.indexOf(meta.interativas()[0]) + 1}`;
  const toque = botaoInterativo('b6.toque', DE_A, `VB_CANCELAR:${sol.id}`, wamid);
  assert.equal((await webhook(toque)).status, 500);
  assert.equal(await statusDe(db, p.id), 'confirmado');
  segurar = false;
  await servico.processarFila(); // grava o resultado guardado, sem reenviar
  assert.equal(meta.interativas().length, 1);
  assert.equal((await webhook(toque)).status, 200);
  assert.equal(await statusDe(db, p.id), 'cancelado');
});

test('B7. falha do banco ao gravar o SIM, CANCELAR: 500, nada pela metade; na reentrega cancela uma vez', async () => {
  let falhar = false;
  const chamar = async (nome, args) => {
    if (nome === 'whatsapp_registrar_resposta' && falhar) throw Object.assign(new Error('banco fora'), { code: '57P01' });
    return chamarDe(db)(nome, args);
  };
  const servico = montarServico({ chamar });
  await subir({ servico });
  const s = await segundaEnviada(servico, await pedidoEnviado(servico));
  const toque = botaoInterativo('b7', DE_A, `VB_CANCELAR:${s.sol.id}`, s.wamid2);
  falhar = true;
  assert.equal((await webhook(toque)).status, 500);
  assert.equal(await statusDe(db, s.id), 'confirmado');
  falhar = false;
  assert.equal((await webhook(toque)).status, 200);
  assert.equal((await webhook(toque)).status, 200);
  assert.equal(await statusDe(db, s.id), 'cancelado');
  assert.equal(meta.textos().length, 1);
});

// ---------------------------------------------------------------
// Falhas da segunda mensagem e erros da Meta (sem cancelar nada, sem
// mensagens contraditorias, sem reenvio indiscriminado)
// ---------------------------------------------------------------
const avisosNaoConcluido = async () => (await db.query(
  "SELECT status, motivo, dados FROM public.notificacoes WHERE tipo = 'cancelamento_nao_concluido' ORDER BY criada_em")).rows;
const TEXTO_NAO_CONCLUIDO = /^Recebemos seu pedido de cancelamento do agendamento de \d\d\/\d\d às \d{1,2}h(\d\d)?, mas não conseguimos concluí-lo pelo WhatsApp\. O cancelamento NÃO foi feito e o horário continua reservado\. Para cancelar, use o aplicativo ou o site da Visage Barber, ou fale com a barbearia\.$/;

test('B8. a Meta recusa de vez a segunda mensagem: o cliente recebe UM aviso de que nada foi cancelado', async () => {
  const servico = montarServico();
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  meta.estado.proximas.interactive.push('destinatario');
  await webhook(botaoTemplate('b8', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  await servico.aguardar();
  const sol = await solicitacaoDe(db, p.id);
  assert.deepEqual([sol.estado, sol.motivo], ['nao_enviada', 'destinatario:131026']);
  assert.equal(await statusDe(db, p.id), 'confirmado', 'nada é cancelado');
  // O aviso sai logo (a janela foi aberta pelo toque), uma vez só
  assert.deepEqual(meta.textos().map((t) => t.corpo.to), [TEL_A]);
  assert.match(meta.textos()[0].corpo.text.body, TEXTO_NAO_CONCLUIDO);
  assert.deepEqual((await avisosNaoConcluido()).map((a) => a.status), ['enviada']);
  await servico.processarFila();
  await db.query('SELECT public.rotina_notificacoes()');
  await servico.processarFila();
  assert.equal(meta.textos().length, 1, 'não repete o aviso');
  assert.equal(meta.interativas().length, 1, 'não reenvia a segunda mensagem');
  // Tocar de novo em NÃO na primeira mensagem não abre outra solicitação nem cancela
  await webhook(botaoTemplate('b8.2', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  assert.match(meta.textos().at(-1).corpo.text.body, /não foi confirmado e o agendamento continua ativo/);
  assert.equal(await statusDe(db, p.id), 'confirmado');
  assert.equal((await db.query('SELECT 1 FROM public.solicitacoes_cancelamento WHERE agendamento_id = $1', [p.id])).rows.length, 1);
});

test('B9. janela fechada com template aprovado para o aviso: o aviso sai como template (data e hora)', async () => {
  const servico = montarServico({ config: { templateCancelamentoNaoConcluido: 'cancelamento_nao_concluido' } });
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  meta.estado.proximas.interactive.push('janela');
  await webhook(botaoTemplate('b9', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  await servico.aguardar();
  const aviso = meta.templates().filter((t) => t.corpo.template.name === 'cancelamento_nao_concluido');
  assert.equal(aviso.length, 1);
  assert.equal(aviso[0].corpo.to, TEL_A);
  assert.deepEqual(aviso[0].corpo.template.components[0].parameters.map((x) => x.text).length, 2);
  assert.equal(meta.textos().length, 0);
  assert.equal(await statusDe(db, p.id), 'confirmado');
});

test('B10. erro 131000 na segunda mensagem: nova tentativa, uma mensagem aceita, um cancelamento só', async () => {
  const servico = montarServico();
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  meta.estado.proximas.interactive.push('desconhecido');
  await webhook(botaoTemplate('b10', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  await servico.aguardar();
  let sol = await solicitacaoDe(db, p.id);
  assert.equal(sol.estado, 'pendente', 'a Meta disse que não enviou: volta para a fila');
  const n = (await db.query('SELECT status, motivo, tentativas FROM public.notificacoes WHERE id = $1', [sol.notificacao_id])).rows[0];
  assert.deepEqual(n, { status: 'pendente', motivo: 'temporario:131000', tentativas: 1 });
  assert.deepEqual(await avisosNaoConcluido(), [], 'sem aviso de falha enquanto ainda tenta');
  await servico.processarFila();
  assert.equal(meta.interativas().length, 1, 'respeita a espera antes de tentar de novo');
  await db.query('UPDATE public.notificacoes SET proxima_tentativa = now() WHERE id = $1', [sol.notificacao_id]);
  await servico.processarFila();
  assert.equal(meta.interativas().length, 2);
  sol = await solicitacaoDe(db, p.id);
  assert.equal(sol.estado, 'aguardando');
  const aceitas = (await db.query("SELECT wamid FROM public.whatsapp_mensagens WHERE notificacao_id = $1 AND estado = 'aceito'", [sol.notificacao_id])).rows;
  assert.equal(aceitas.length, 1);
  // Toque em um botão de mensagem sem registro de aceite: nada muda
  assert.equal((await webhook(botaoInterativo('b10.x', DE_A, `VB_CANCELAR:${sol.id}`, 'wamid.nunca-aceito'))).status, 200);
  assert.equal(await statusDe(db, p.id), 'confirmado');
  // O toque na mensagem aceita cancela; repetido (novo evento), só informa
  await webhook(botaoInterativo('b10.1', DE_A, `VB_CANCELAR:${sol.id}`, aceitas[0].wamid));
  await webhook(botaoInterativo('b10.2', DE_A, `VB_CANCELAR:${sol.id}`, aceitas[0].wamid));
  assert.equal(await statusDe(db, p.id), 'cancelado');
  const corpos = meta.textos().map((t) => t.corpo.text.body);
  assert.equal(corpos.filter((t) => /^Pronto: o agendamento/.test(t)).length, 1);
  assert.equal(corpos.at(-1), 'Este agendamento já foi cancelado.');
  assert.deepEqual(await avisosNaoConcluido(), []);
});

test('B11. resultado incerto na segunda mensagem: nunca reenvia e não manda aviso de falha (pode ter chegado)', async () => {
  const servico = montarServico({ timeoutMs: 30 });
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  meta.estado.proximas.interactive.push('timeout');
  await webhook(botaoTemplate('b11', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  await servico.aguardar();
  const sol = await solicitacaoDe(db, p.id);
  assert.deepEqual([sol.estado, sol.motivo], ['nao_enviada', 'resultado_incerto']);
  await db.query('UPDATE public.notificacoes SET proxima_tentativa = now()');
  await servico.processarFila();
  assert.equal(meta.interativas().length, 1);
  assert.deepEqual(await avisosNaoConcluido(), []);
  assert.equal(meta.textos().length, 0);
  assert.equal(await statusDe(db, p.id), 'confirmado');
});

test('B12. token recusado (190): o canal pausa, nada é reenviado na pausa e depois segue normalmente', async () => {
  let relogio = Date.now();
  const servico = montarServico({ agora: () => relogio, config: { pausaMs: 60_000 } });
  await subir({ servico });
  const p = await pedidoEnviado(servico);
  meta.estado.proximas.interactive.push('token');
  await webhook(botaoTemplate('b12', DE_A, `VB_NAO:${p.conf.id}`, p.wamid));
  await servico.aguardar();
  let sol = await solicitacaoDe(db, p.id);
  assert.equal(sol.estado, 'pendente', 'a mensagem não saiu: volta para a fila, sem aviso de falha');
  assert.equal(servico.pausado(), true);
  assert.match(logs.linhas.join('\n'), /envios PAUSADOS por 1 min: a Meta recusou \(autenticacao:190\)/);
  // Na pausa: nem reserva, nem responde ao cliente
  await db.query('UPDATE public.notificacoes SET proxima_tentativa = now()');
  const pedidos = meta.pedidos.length;
  assert.deepEqual(await servico.processarFila(), { avisos: 0, aceitos: 0, recusados: 0, erros: 0, incertos: 0, nao_gravados: 0 });
  // Um segundo NÃO normalmente recebe "Você já pediu o cancelamento..."
  assert.equal((await webhook(botaoTemplate('b12.t', DE_A, `VB_NAO:${p.conf.id}`, p.wamid))).status, 200);
  assert.equal(meta.pedidos.length, pedidos);
  assert.match(logs.linhas.join('\n'), /retorno ao cliente nao enviado: envios pausados/);
  // Depois da pausa: sai normalmente, uma vez
  relogio += 61_000;
  await servico.processarFila();
  sol = await solicitacaoDe(db, p.id);
  assert.equal(sol.estado, 'aguardando');
  assert.equal(meta.interativas().length, 2);
  assert.deepEqual(await avisosNaoConcluido(), []);
  assert.equal(await statusDe(db, p.id), 'confirmado');
  assert.doesNotMatch(logs.linhas.join('\n'), new RegExp(`${TOKEN_META}|${TEL_A}|${DE_A}`));
});

test('B13. a Meta informa depois que a segunda mensagem falhou: aviso único ao cliente; botão dela não cancela', async () => {
  const servico = montarServico();
  await subir({ servico });
  const s = await segundaEnviada(servico, await pedidoEnviado(servico));
  const estado = envelope({ statuses: [{ id: s.wamid2, status: 'failed', errors: [{ code: 131026 }] }] });
  assert.equal((await webhook(estado)).status, 200);
  await servico.aguardar();
  const sol = await solicitacaoDe(db, s.id);
  assert.deepEqual([sol.estado, sol.motivo], ['nao_enviada', 'meta: destinatario:131026']);
  assert.equal(meta.textos().length, 1);
  assert.match(meta.textos()[0].corpo.text.body, TEXTO_NAO_CONCLUIDO);
  // A Meta repete o mesmo estado: nada novo
  await webhook(estado);
  await servico.aguardar();
  assert.equal(meta.textos().length, 1);
  // Se mesmo assim o botão dessa mensagem chegar, não cancela: confirma o aviso
  await webhook(botaoInterativo('b13', DE_A, `VB_CANCELAR:${s.sol.id}`, s.wamid2));
  assert.equal(await statusDe(db, s.id), 'confirmado');
  assert.match(meta.textos().at(-1).corpo.text.body, /não foi confirmado e o agendamento continua ativo/);
});

// ---------------------------------------------------------------
// I. Isolamento: o ambiente de teste nunca usa o banco de produção
// ---------------------------------------------------------------
async function foto(banco) {
  const r = {};
  for (const t of ['agendamentos', 'confirmacoes_presenca', 'solicitacoes_cancelamento', 'notificacoes', 'whatsapp_mensagens', 'whatsapp_eventos', 'consentimentos']) {
    r[t] = (await banco.query(
      `SELECT count(*)::int AS n, md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) AS h FROM public.${t} x`)).rows[0];
  }
  return r;
}

// Marca lida do banco local como o cliente unico a le (erro do banco vira
// { code, status }, como o PostgREST devolve)
const lerMarcaDe = (banco, contar = null) => async () => {
  contar?.push('ambiente_do_banco');
  try {
    return { marca: await chamarDe(banco)('ambiente_do_banco', {}), erro: null };
  } catch (e) {
    return { marca: null, erro: { code: e.code ?? null, status: 404 } };
  }
};

// Backend no modo teste, ligado ao `banco` informado, com a mesma guarda do
// app.js (services/ambienteServidor.js) e o servico da instancia real
// (routes/whatsapp.js)
async function subirModoTeste({ banco, supabaseUrl, chamar = chamarDe(banco), leituras = null }) {
  const { criarServicoWhatsapp } = carregar('../src/routes/whatsapp');
  const env = { ...ENV_TESTE, SUPABASE_URL: supabaseUrl, SUPABASE_SERVICE_ROLE_KEY: 'chave-ficticia' };
  const wa = lerConfiguracao(env).whatsapp;
  assert.equal(wa.ativo, true);
  const servico = criarServicoWhatsapp(wa, { chamar, fetch: meta.fetch, log: logs });
  const guarda = criarGuardaAmbiente({
    config: lerAmbienteServidor(env), lerMarca: lerMarcaDe(banco, leituras), log: logs, agendar: () => {},
  });
  const ligado = await guarda.conferir();
  await subir({ servico, phoneNumberId: NUMERO_TESTE_ID, guarda });
  return { servico, ligado, guarda };
}

test('I0. bancos de produção e de teste locais', async () => {
  producao = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26 });
  teste = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26 });
  await producao.exec(PERFIS);
  await teste.exec(MARCA); // logo depois das migrations, como no passo a passo
  await teste.exec(MARCA); // pode rodar de novo
  await teste.exec(PERFIS);
  // "Dados reais" na produção: uma confirmação enviada e aguardando resposta
  const servicoProducao = montarServico({ chamar: chamarDe(producao) });
  await pedidoEnviado(servicoProducao, { banco: producao });
});

test('I1. conferência do banco: só o banco marcado, com URL que não é a de produção, libera o modo teste', async () => {
  // A leitura da marca, nos dois bancos locais
  const marcaProducao = await lerMarcaDe(producao)();
  const marcaTeste = await lerMarcaDe(teste)();
  assert.deepEqual(marcaTeste, { marca: 'teste', erro: null });
  assert.equal(marcaProducao.marca, null);
  const casos = [
    ['teste', marcaProducao, { ok: false, motivo: 'banco_sem_marca_de_teste', temporario: false }],
    ['teste', marcaTeste, { ok: true, motivo: null, temporario: false }],
    // Função inexistente pelo PostgREST: sem a marca
    ['teste', { marca: null, erro: { code: 'PGRST202', status: 404 } }, { ok: false, motivo: 'banco_sem_marca_de_teste', temporario: false }],
    ['teste', { marca: 'producao', erro: null }, { ok: false, motivo: 'banco_sem_marca_de_teste', temporario: false }],
    // Chave de outro projeto: bloqueado (confere de novo, mas nunca libera com ela)
    ['teste', { marca: null, erro: { code: null, status: 401 } }, { ok: false, motivo: 'acesso_recusado_pelo_banco', temporario: true }],
    // Rede fora: bloqueado, confere de novo depois
    ['teste', { marca: null, erro: { code: null, status: 0 } }, { ok: false, motivo: 'banco_inacessivel', temporario: true }],
    // Produção: recusa o banco de teste; aceita o de produção (sem a marca)
    ['producao', marcaTeste, { ok: false, motivo: 'banco_de_teste_com_ambiente_producao', temporario: false }],
    ['producao', marcaProducao, { ok: true, motivo: null, temporario: false }],
    ['producao', { marca: null, erro: { code: null, status: 0 } }, { ok: false, motivo: 'banco_inacessivel', temporario: true }],
  ];
  for (const [ambiente, leitura, esperado] of casos) {
    assert.deepEqual(avaliarMarca(ambiente, leitura), esperado, `${ambiente} ${JSON.stringify(leitura)}`);
  }
  // A URL de produção (ou uma que não é de projeto Supabase) nunca serve para
  // teste: bloqueado já na leitura do ambiente, sem nem ler o banco
  for (const url of [URL_PRODUCAO, 'http://localhost:54321', `${URL_PRODUCAO}/rest/v1`]) {
    const leituras = [];
    const config = lerAmbienteServidor({ BACKEND_AMBIENTE: 'teste', SUPABASE_URL: url, SUPABASE_SERVICE_ROLE_KEY: 'k' });
    assert.equal(config.problemas.length, 1, url);
    const guarda = criarGuardaAmbiente({ config, lerMarca: lerMarcaDe(teste, leituras), log: logs, agendar: () => {} });
    assert.equal(await guarda.conferir(), false);
    assert.deepEqual(leituras, [], 'nem a marca é lida');
  }
});

test('I2. backend de teste apontado para o banco de produção não atende nada e não muda NADA nele', async () => {
  const antes = await foto(producao);
  const { ligado, guarda } = await subirModoTeste({ banco: producao, supabaseUrl: URL_TESTE });
  assert.equal(ligado, false);
  assert.deepEqual(guarda.estado(), { estado: 'bloqueado', ambiente: 'teste', motivo: 'banco_sem_marca_de_teste' });
  assert.match(logs.linhas.join('\n'), /backend BLOQUEADO no ambiente teste: banco_sem_marca_de_teste/);
  const p = (await producao.query(
    "SELECT c.id, m.wamid FROM public.confirmacoes_presenca c JOIN public.whatsapp_mensagens m ON m.notificacao_id = c.notificacao_id WHERE c.estado = 'enviada'")).rows[0];
  assert.ok(p, 'o banco de produção tem uma confirmação real aberta');
  assert.equal((await webhook(botaoTemplate('x.1', DE_A, `VB_NAO:${p.id}`, p.wamid, NUMERO_TESTE_ID))).status, 503);
  assert.equal((await webhook(texto('x.2', DE_A, 'PARAR', NUMERO_TESTE_ID))).status, 503);
  const r = await fetch(`${base}/api/notificacoes/processar`, { method: 'POST', headers: { 'X-Notificacoes-Segredo': SEGREDO } });
  assert.deepEqual([r.status, (await r.json()).code], [503, 'AMBIENTE_BLOQUEADO']);
  await new Promise((ok) => setTimeout(ok, 50));
  assert.deepEqual(await foto(producao), antes, 'nenhuma linha do banco de produção mudou');
  assert.equal(meta.pedidos.length, 0, 'nada saiu para a Meta');
});

test('I3. a marca de teste se recusa a ser criada num banco com agendamentos (produção)', async () => {
  const antes = await foto(producao);
  assert.match((await recusa(producao.exec(MARCA))).message, /parece ser o de producao/);
  await producao.exec('ROLLBACK').catch(() => {});
  assert.equal((await producao.query("SELECT to_regprocedure('public.ambiente_do_banco()') AS f")).rows[0].f, null);
  assert.deepEqual(await foto(producao), antes);
});

test('I4. backend de teste no banco de teste: confirmação dupla completa pelo número de teste; produção intacta', async () => {
  const antesProducao = await foto(producao);
  await teste.query("INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', $2, 'web') ON CONFLICT DO NOTHING", [USUARIO_JOAO, VERSAO]);
  const { ligado, servico } = await subirModoTeste({ banco: teste, supabaseUrl: URL_TESTE });
  assert.equal(ligado, true);
  const p = await pedidoEnviado(servico, { banco: teste });
  const s = await segundaEnviada(servico, p, { banco: teste, numero: NUMERO_TESTE_ID });
  assert.equal(await statusDe(teste, p.id), 'confirmado', 'o primeiro NÃO não cancela');
  assert.equal((await webhook(botaoInterativo('t.ok', DE_A, `VB_CANCELAR:${s.sol.id}`, s.wamid2, NUMERO_TESTE_ID))).status, 200);
  await servico.aguardar();
  assert.equal(await statusDe(teste, p.id), 'cancelado');
  // Tudo saiu pelo número e token de teste, com o template de teste
  assert.ok(meta.pedidos.every((x) => x.url === `https://graph.facebook.com/v23.0/${NUMERO_TESTE_ID}/messages`
    && x.headers.Authorization === `Bearer ${TOKEN_TESTE}`));
  assert.deepEqual(meta.templates().filter((t) => t.corpo.to === TEL_JOAO).map((t) => t.corpo.template.name), ['cancelamento_teste']);
  assert.deepEqual(await foto(producao), antesProducao);
  assert.doesNotMatch(logs.linhas.join('\n'), new RegExp(`${TOKEN_TESTE}|${TOKEN_META}|${TEL_A}|${DE_A}`));
});

test('I5. número fora da lista de teste: nem chega ao banco de teste', async () => {
  const chamadas = [];
  await subirModoTeste({ banco: teste, supabaseUrl: URL_TESTE, chamar: async (n, a) => { chamadas.push(n); return chamarDe(teste)(n, a); } });
  chamadas.length = 0; // a conferência do banco não conta
  assert.equal((await webhook(botaoInterativo('t.fora', '552198765432', 'VB_CANCELAR:00000000-0000-4000-8000-000000000000', 'w', NUMERO_TESTE_ID))).status, 200);
  assert.equal((await webhook(texto('t.fora2', TEL_B, 'não', NUMERO_TESTE_ID))).status, 200);
  assert.deepEqual(chamadas, []);
  assert.equal(meta.pedidos.length, 0);
});
