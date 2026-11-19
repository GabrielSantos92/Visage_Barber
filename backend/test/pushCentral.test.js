// Push de ponta a ponta com a migration 30: o servico real do backend
// (services/notificacoes.js) lendo a fila do banco (PGlite no estado de
// producao + 30) e falando com uma Expo FALSA. Confere o marcador do banco, a
// fila antiga ao ligar, o envio unico e que a falha da Expo nao tira o aviso
// da central. Nenhuma notificacao real e enviada.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { criarBanco, MIGRATIONS_PUSH_30, JOAO, CORTE_30, CLIENTE_A, USUARIO_JOAO } = require('./helpers/bancoAgenda');
const { criarExpoPush } = require('../src/services/expoPush');
const { criarServicoNotificacoes } = require('../src/services/notificacoes');

const TOKEN_JOAO = 'ExponentPushToken[joao-celular]';
const silencioso = { log() {}, info() {}, warn() {}, error() {} };

function criarExpoFalsa() {
  const mensagens = [];
  const estado = { falhar: false };
  let seq = 0;
  const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });
  return {
    mensagens,
    estado,
    async fetch(url, init) {
      const corpo = JSON.parse(init.body);
      if (new URL(url).pathname.endsWith('/getReceipts')) return resposta(200, { data: {} });
      if (estado.falhar) return resposta(500, { errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'indisponivel' }] });
      mensagens.push(...corpo);
      return resposta(200, { data: corpo.map(() => ({ status: 'ok', id: `ticket-${++seq}` })) });
    },
  };
}

async function montar() {
  const db = await criarBanco({ migracoes: MIGRATIONS_PUSH_30 });
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento');
  await db.query('INSERT INTO public.dispositivos_push (user_id, token) VALUES ($1, $2)', [USUARIO_JOAO, TOKEN_JOAO]);
  const chamar = async (nome, args) => {
    const chaves = Object.keys(args);
    const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
    const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    return (await db.query(`SELECT public.${nome}(${lista}) AS r`, valores)).rows[0].r;
  };
  const expo = criarExpoFalsa();
  const servico = criarServicoNotificacoes({
    chamar,
    expo: criarExpoPush({ accessToken: 'acesso-expo-teste', fetch: expo.fetch, timeoutMs: 2000 }),
    config: { esperasRegistro: [0, 0], esperaReciboTesteMs: 0, intervaloRecibosMs: 0 },
    log: silencioso,
    esperar: async () => {},
  });
  // O cliente agenda (logado): o barbeiro recebe o aviso de novo agendamento
  let minutos = 180;
  const agendar = async () => {
    await db.query("SELECT set_config('test.uid', $1, false)", [CLIENTE_A]);
    const { rows: [{ id }] } = await db.query(
      `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
       VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4), 'confirmado') RETURNING id`,
      [CLIENTE_A, JOAO, CORTE_30, (minutos += 60)]);
    await db.query("SELECT set_config('test.uid', '', false)");
    return id;
  };
  const statusPush = async (ag) => (await db.query(
    "SELECT status, motivo FROM public.notificacoes WHERE agendamento_id = $1 AND canal = 'push'", [ag])).rows[0];
  const ligar = (v = true) => db.query('UPDATE public.notificacao_config SET push_ativo = $1 WHERE id', [v]);
  const central = async (uid) => {
    await db.query("SELECT set_config('test.uid', $1, false)", [uid]);
    const { rows } = await db.query('SELECT agendamento_id, lida_em FROM public.minhas_notificacoes()');
    await db.query("SELECT set_config('test.uid', '', false)");
    return rows;
  };
  return { db, expo, servico, agendar, statusPush, ligar, central };
}

test('push desligado no banco: o backend ligado não envia nada (a central só começa na ativação)', async () => {
  const { expo, servico, agendar, statusPush, central } = await montar();
  const ag = await agendar();
  await servico.processarFila();
  assert.equal(expo.mensagens.length, 0);
  assert.equal((await statusPush(ag)).status, 'pendente');
  assert.deepEqual(await central(USUARIO_JOAO), []);
});

test('ao ligar: nada antigo sai; o aviso novo sai uma vez, com os dados para abrir a tela certa', async () => {
  const { expo, servico, agendar, statusPush, ligar } = await montar();
  const antigo = await agendar();
  await ligar();
  await servico.processarFila();
  assert.equal(expo.mensagens.length, 0, 'aviso de antes da ativacao nunca sai');
  assert.deepEqual(await statusPush(antigo), { status: 'ignorada', motivo: 'antes_da_ativacao' });

  const novo = await agendar();
  await servico.processarFila();
  await servico.processarFila();
  assert.equal(expo.mensagens.length, 1, 'enviado uma vez so');
  const m = expo.mensagens[0];
  assert.equal(m.to, TOKEN_JOAO);
  assert.equal(m.channelId, 'agendamentos');
  assert.deepEqual(m.data, { tipo: 'novo_agendamento', destinatario: USUARIO_JOAO, agendamento_id: novo });
  assert.equal((await statusPush(novo)).status, 'enviada');
});

test('Expo fora do ar: o aviso continua na central e volta para a fila (nova tentativa)', async () => {
  const { expo, servico, agendar, statusPush, ligar, central } = await montar();
  await ligar();
  expo.estado.falhar = true;
  const ag = await agendar();
  await servico.processarFila();
  assert.equal(expo.mensagens.length, 0);
  assert.equal((await statusPush(ag)).status, 'pendente');
  assert.deepEqual((await central(USUARIO_JOAO)).map((l) => l.agendamento_id), [ag]);
});

test('o barbeiro agenda para o cliente: só o cliente recebe, com o texto de quem agendou', async () => {
  const { db, expo, servico, ligar } = await montar();
  const TOKEN_ANA = 'ExponentPushToken[ana-celular]';
  await db.query('INSERT INTO public.dispositivos_push (user_id, token) VALUES ($1, $2)', [CLIENTE_A, TOKEN_ANA]);
  await ligar();
  await db.query("SELECT set_config('test.uid', $1, false)", [USUARIO_JOAO]);
  const { rows: [{ id }] } = await db.query(
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
     VALUES ($1, $2, $3, date_trunc('minute', now()) + interval '3 days', 'confirmado') RETURNING id`, [CLIENTE_A, JOAO, CORTE_30]);
  await db.query("SELECT set_config('test.uid', '', false)");
  await servico.processarFila();
  assert.deepEqual(expo.mensagens.map((m) => m.to), [TOKEN_ANA], 'quem agendou (o barbeiro) nao recebe');
  assert.equal(expo.mensagens[0].title, 'Agendamento marcado para você');
  assert.match(expo.mensagens[0].body, /^João agendou Corte .*para você dia \d\d\/\d\d às /);
  assert.deepEqual(expo.mensagens[0].data, { tipo: 'novo_agendamento', destinatario: CLIENTE_A, agendamento_id: id });
});
