// Push de ponta a ponta com a migration 30: o servico real do backend
// (services/notificacoes.js) lendo a fila do banco (PGlite no estado de
// producao + 30) e falando com uma Expo FALSA. Confere o marcador do banco, a
// fila antiga ao ligar, o envio unico e que a falha da Expo nao tira o aviso
// da central. Nenhuma notificacao real e enviada.
const { test } = require('node:test');
const assert = require('node:assert/strict');

const { criarBanco, MIGRATIONS_PUSH_30, JOAO, CORTE_30, CLIENTE_A, USUARIO_JOAO } = require('./helpers/bancoAgenda');
const { criarExpoPush } = require('../src/services/expoPush');
const { criarServicoNotificacoes, TEXTO_PUSH } = require('../src/services/notificacoes');

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

test('ao ligar: nada antigo sai; o aviso novo sai uma vez, só com o id do aviso', async () => {
  const { db, expo, servico, agendar, statusPush, ligar } = await montar();
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
  const { rows: [aviso] } = await db.query("SELECT id FROM public.notificacoes WHERE agendamento_id = $1 AND canal = 'push'", [novo]);
  assert.deepEqual(m.data, { tipo: 'novo_agendamento', notificacao_id: aviso.id });
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

test('o barbeiro agenda para o cliente: só o cliente recebe; quem agendou fica só na central', async () => {
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
  const { rows: [aviso] } = await db.query("SELECT id, dados FROM public.notificacoes WHERE agendamento_id = $1 AND canal = 'push'", [id]);
  assert.deepEqual([expo.mensagens[0].title, expo.mensagens[0].body], ['Visage Barber', TEXTO_PUSH.agendamento]);
  assert.deepEqual(expo.mensagens[0].data, { tipo: 'novo_agendamento', notificacao_id: aviso.id });
  // O detalhe (quem agendou) continua no banco, para a central da cliente
  assert.deepEqual([aviso.dados.papel, aviso.dados.ator, aviso.dados.barbeiro_nome], ['cliente', 'barbeiro', 'João']);
});

test('aparelho ainda vinculado à conta anterior (logout sem internet): nenhum push revela dado pessoal', async () => {
  const { db, expo, servico, ligar, central } = await montar();
  // O celular da Ana continua registrado para ela (o logout nao conseguiu desvincular)
  const TOKEN_ANA = 'ExponentPushToken[ana-celular]';
  await db.query('INSERT INTO public.dispositivos_push (user_id, token) VALUES ($1, $2)', [CLIENTE_A, TOKEN_ANA]);
  await ligar();
  // Todos os tipos para a Ana: novo (o barbeiro agenda), cancelamento, lembrete e mensagem
  const como = async (uid, sql, p) => {
    await db.query("SELECT set_config('test.uid', $1, false)", [uid ?? '']);
    try { return (await db.query(sql, p)).rows; } finally { await db.query("SELECT set_config('test.uid', '', false)"); }
  };
  const ag = async (min) => (await como(USUARIO_JOAO,
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
     VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4), 'confirmado') RETURNING id`,
    [CLIENTE_A, JOAO, CORTE_30, min]))[0].id;
  const a1 = await ag(3 * 24 * 60);
  const a2 = await ag(4 * 24 * 60);
  await como(USUARIO_JOAO, "UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [a2]);
  const a3 = await ag(20); // lembrete (30 min antes): marcado bem antes
  await db.query("UPDATE public.agendamentos SET created_at = now() - interval '1 day' WHERE id = $1", [a3]);
  await db.query('SELECT public.rotina_notificacoes()');
  const { rows: [conv] } = await db.query(
    'INSERT INTO public.conversas (cliente_id, barbeiro_id) VALUES ($1, $2) RETURNING id', [CLIENTE_A, JOAO]);
  await como(USUARIO_JOAO, 'INSERT INTO public.mensagens (conversa_id, remetente_id, conteudo) VALUES ($1, $2, $3)',
    [conv.id, USUARIO_JOAO, 'Seu corte das 15h com degradê está confirmado']);
  await servico.processarFila();

  const paraAna = expo.mensagens.filter((m) => m.to === TOKEN_ANA);
  assert.deepEqual([...new Set(paraAna.map((m) => m.data.tipo))].sort(), ['cancelamento', 'lembrete', 'mensagem', 'novo_agendamento']);
  // Tudo o que identifica alguem ou o atendimento, tirado do proprio banco
  const { rows: [p] } = await db.query(
    `SELECT (SELECT nome FROM public.profiles WHERE user_id = $1) AS cliente, b.nome AS barbeiro, s.nome AS servico
       FROM public.barbeiros b, public.servicos s WHERE b.id = $2 AND s.id = $3`, [CLIENTE_A, JOAO, CORTE_30]);
  const horas = (await db.query('SELECT data_hora FROM public.agendamentos WHERE id = ANY ($1)', [[a1, a2, a3]])).rows
    .flatMap((r) => { const d = new Date(r.data_hora); return [d.toISOString().slice(0, 10), `${String(d.getUTCDate()).padStart(2, '0')}/`]; });
  const proibidos = [p.cliente, p.barbeiro, p.servico, 'degradê', '15h', CLIENTE_A, USUARIO_JOAO, JOAO, a1, a2, a3, conv.id, ...horas]
    .filter(Boolean).flatMap((x) => [x, ...String(x).split(' ').filter((w) => w.length > 2)]);
  for (const m of paraAna) {
    const texto = JSON.stringify(m);
    for (const dado of proibidos) assert.ok(!texto.includes(dado), `"${dado}" no push ${m.data.tipo}`);
    assert.deepEqual(Object.keys(m.data).sort(), ['notificacao_id', 'tipo']);
    assert.equal(m.title, 'Visage Barber');
    assert.ok(Object.values(TEXTO_PUSH).includes(m.body));
  }
  // O detalhe so aparece na central, para a propria conta logada
  assert.ok((await central(CLIENTE_A)).length >= 4);
});
