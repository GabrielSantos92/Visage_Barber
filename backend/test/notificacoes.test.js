// Notificacoes push de ponta a ponta no backend: rotas reais, fila e regras no
// banco (PGlite com as migrations) e o cliente HTTP da Expo falando com uma
// Expo falsa. Nenhuma notificacao real e enviada.
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');

const {
  criarBanco, auxiliares, DIA,
  JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, CLIENTE_C, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');
const { criarExpoPush } = require('../src/services/expoPush');
const { criarServicoNotificacoes, textoDoAviso, quando, horaCurta } = require('../src/services/notificacoes');
const { criarLimitador } = require('../src/services/limiteTaxa');

const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres-0123';
const DDMM = `${DIA.slice(8, 10)}/${DIA.slice(5, 7)}`;
const TOKEN = {
  joao: 'ExponentPushToken[joao-celular]',
  joaoTablet: 'ExponentPushToken[joao-tablet]',
  ana: 'ExponentPushToken[ana-celular]',
  anaTablet: 'ExponentPushToken[ana-tablet]',
  bruno: 'ExponentPushToken[bruno-celular]',
};
const DONO = {
  [TOKEN.joao]: USUARIO_JOAO, [TOKEN.joaoTablet]: USUARIO_JOAO,
  [TOKEN.ana]: CLIENTE_A, [TOKEN.anaTablet]: CLIENTE_A, [TOKEN.bruno]: CLIENTE_B,
};
const SESSOES = { 'sessao-ana': { id: CLIENTE_A }, 'sessao-bruno': { id: CLIENTE_B }, 'sessao-caio': { id: CLIENTE_C } };

// ---------------------------------------------------------------
// Expo falsa (mesmos caminhos e formatos da API)
// ---------------------------------------------------------------
function criarExpoFalsa() {
  const pedidos = [];
  const entregues = [];
  const recibos = new Map();
  const estado = { modo: 'ok', naoRegistrados: new Set(), outroProjeto: new Set(), reciboErro: new Map() };
  let seq = 0;
  const resposta = (status, corpo) => ({ ok: status >= 200 && status < 300, status, json: async () => corpo });

  async function fetchFalso(url, init) {
    const caminho = new URL(url).pathname;
    const corpo = JSON.parse(init.body);
    pedidos.push({ caminho, headers: init.headers, corpo });
    if (estado.modo === 'timeout') {
      return new Promise((_, rejeitar) => init.signal.addEventListener('abort',
        () => rejeitar(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    if (estado.modo === 'rede') throw new TypeError('fetch failed');
    if (estado.modo === 'http500') return resposta(500, { errors: [{ code: 'INTERNAL_SERVER_ERROR', message: 'indisponivel' }] });
    if (estado.modo === 'http401') return resposta(401, { errors: [{ code: 'UNAUTHORIZED', message: 'token de acesso invalido' }] });

    if (caminho.endsWith('/getReceipts')) {
      const data = {};
      for (const id of corpo.ids) if (recibos.has(id)) data[id] = recibos.get(id);
      return resposta(200, { data });
    }
    // Como a Expo: tokens de projetos diferentes no mesmo pedido recusam o pedido inteiro
    if (corpo.length > 1 && corpo.some((m) => estado.outroProjeto.has(m.to))) {
      return resposta(400, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: 'projetos diferentes' }] });
    }
    const data = corpo.map((m) => {
      if (estado.outroProjeto.has(m.to)) return { status: 'error', message: `${m.to}: remetente errado`, details: { error: 'MismatchSenderId' } };
      if (estado.naoRegistrados.has(m.to)) {
        return { status: 'error', message: `"${m.to}" is not a registered push notification recipient`, details: { error: 'DeviceNotRegistered' } };
      }
      const id = `ticket-${++seq}`;
      entregues.push(m);
      const erro = estado.reciboErro.get(m.to);
      recibos.set(id, erro ? { status: 'error', message: `falhou para ${m.to}`, details: { error: erro } } : { status: 'ok' });
      return { status: 'ok', id };
    });
    return resposta(200, { data });
  }
  return { fetch: fetchFalso, pedidos, entregues, estado, para: (t) => entregues.filter((m) => m.to === t) };
}

function criarLog() {
  const linhas = [];
  const registrar = (...partes) => linhas.push(partes.join(' '));
  return { linhas, log: registrar, info: registrar, warn: registrar, error: registrar };
}

// ---------------------------------------------------------------
// Banco, servico e rotas
// ---------------------------------------------------------------
let db, agendar, comoUsuario;
let expo, logs, servico, servidor, base;

async function chamarPglite(nome, args) {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return (await db.query(`SELECT public.${nome}(${lista}) AS r`, valores)).rows[0].r;
}

async function buscarDispositivosPglite(usuarioId, dispositivoId) {
  const r = await db.query(
    `SELECT id, token, plataforma FROM public.dispositivos_push
      WHERE user_id = $1 AND ativo ${dispositivoId ? 'AND id = $2' : ''} ORDER BY criado_em`,
    dispositivoId ? [usuarioId, dispositivoId] : [usuarioId],
  );
  return r.rows;
}

function montarServico({ chamar = chamarPglite, config = {}, timeoutMs = 2000 } = {}) {
  return criarServicoNotificacoes({
    chamar,
    expo: criarExpoPush({ accessToken: 'acesso-expo-teste', fetch: expo.fetch, timeoutMs }),
    buscarDispositivos: buscarDispositivosPglite,
    config: { esperasRegistro: [0, 0], esperaReciboTesteMs: 0, intervaloRecibosMs: 0, ...config },
    log: logs,
    esperar: async () => {},
  });
}

// A rota real cria um cliente Supabase ao ser carregada: isola com variaveis falsas
function carregarRotas() {
  process.env.SUPABASE_URL ??= 'http://localhost:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY ??= 'teste';
  return require('../src/routes/notificacoes');
}

async function subir({ segredo = SEGREDO, ativo = true, ...limites } = {}) {
  const { criarRotasNotificacoes } = carregarRotas();
  const app = express();
  app.use(express.json());
  app.use('/api/notificacoes', criarRotasNotificacoes({
    servico, verificarToken: async (t) => SESSOES[t] ?? null, segredo, ativo, log: logs, ...limites,
  }));
  if (servidor) servidor.close();
  servidor = app.listen(0);
  await once(servidor, 'listening');
  base = `http://127.0.0.1:${servidor.address().port}/api/notificacoes`;
}

async function post(caminho, corpo = {}, { sessao, segredo } = {}) {
  const r = await fetch(`${base}${caminho}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(sessao ? { Authorization: `Bearer ${sessao}` } : {}),
      ...(segredo ? { 'X-Notificacoes-Segredo': segredo } : {}),
    },
    body: JSON.stringify(corpo),
  });
  return { status: r.status, corpo: await r.json() };
}

before(async () => {
  db = await criarBanco();
  ({ agendar, comoUsuario } = auxiliares(db));
  await db.exec(`
    INSERT INTO public.profiles (user_id, nome) VALUES
      ('${CLIENTE_A}', 'Ana Paula Souza'), ('${CLIENTE_B}', 'Bruno Lima'), ('${USUARIO_JOAO}', 'João Barbeiro');
  `);
});

beforeEach(async () => {
  await comoUsuario(null);
  await db.exec(`
    DELETE FROM public.notificacoes;
    DELETE FROM public.dispositivos_push;
    DELETE FROM public.notificacao_preferencias;
    DELETE FROM public.mensagens;
    DELETE FROM public.conversas;
    DELETE FROM public.lancamentos_financeiros;
    DELETE FROM public.pagamento_auditoria;
    DELETE FROM public.pagamento_reembolsos;
    DELETE FROM public.pagamentos;
    DELETE FROM public.pagamentos_comissao;
    DELETE FROM public.comissao_alteracoes;
    DELETE FROM public.pagamento_eventos;
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
    DELETE FROM public.agendamentos;
    ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;
  `);
  expo = criarExpoFalsa();
  logs = criarLog();
  servico = montarServico();
});

after(() => servidor?.close());

// ---------------------------------------------------------------
// Auxiliares de dados
// ---------------------------------------------------------------
async function como(uid, fn) {
  await comoUsuario(uid);
  try {
    return await fn();
  } finally {
    await comoUsuario(null);
  }
}

const rpc = (nome, args = {}) => chamarPglite(nome, args);
const registrar = (uid, token) => como(uid, () => rpc('registrar_dispositivo_push', { p_token: token }));
const idDo = async (token) => (await db.query('SELECT id FROM public.dispositivos_push WHERE token = $1', [token])).rows[0].id;
const aparelho = async (token) => (await db.query('SELECT ativo, motivo_desativacao FROM public.dispositivos_push WHERE token = $1', [token])).rows[0];
const agendarComo = (uid, hhmm) => como(uid, () => agendar(uid, JOAO, CORTE_30, hhmm));
const mudarStatus = (uid, id, status) => como(uid, () => db.query('UPDATE public.agendamentos SET status = $2 WHERE id = $1', [id, status]));
const dataHora = async (id) => (await db.query('SELECT data_hora FROM public.agendamentos WHERE id = $1', [id])).rows[0].data_hora;
const contar = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);
const processar = () => servico.solicitarProcessamento();
// Nova tentativa ja liberada (sem esperar o intervalo do banco)
const liberar = () => db.query("UPDATE public.notificacoes SET proxima_tentativa = now() WHERE status = 'pendente'");

// Agendamento daqui a N minutos (sem a checagem do horario de funcionamento)
async function agendarDaquiA(minutos, cliente = CLIENTE_A) {
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento');
  try {
    return (await db.query(
      `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, created_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4::int), now() - interval '3 hours') RETURNING id`,
      [cliente, JOAO, CORTE_30, minutos],
    )).rows[0].id;
  } finally {
    await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento');
  }
}

const novaConversa = async (cliente = CLIENTE_A) => (await db.query(
  'INSERT INTO public.conversas (cliente_id, barbeiro_id) VALUES ($1, $2) RETURNING id', [cliente, JOAO],
)).rows[0].id;
const enviarMensagem = (conversa, remetente, conteudo) => como(remetente, () =>
  db.query('INSERT INTO public.mensagens (conversa_id, remetente_id, conteudo) VALUES ($1, $2, $3)', [conversa, remetente, conteudo]));

const avisos = async (tipo) => (await db.query(
  `SELECT id, tipo, destinatario_id, status, motivo, tentativas, proxima_tentativa
     FROM public.notificacoes ${tipo ? 'WHERE tipo = $1' : ''} ORDER BY criada_em, chave`,
  tipo ? [tipo] : [],
)).rows;
const envios = async (notificacaoId) => (await db.query(
  `SELECT e.status, e.ticket_id, e.erro, d.token FROM public.notificacao_envios e
     LEFT JOIN public.dispositivos_push d ON d.id = e.dispositivo_id
    WHERE e.notificacao_id = $1 ORDER BY d.token`,
  [notificacaoId],
)).rows;

// ---------------------------------------------------------------
// Envio da fila
// ---------------------------------------------------------------
test('1. novo agendamento: o barbeiro recebe em todos os aparelhos, com texto, canal e dados certos', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(USUARIO_JOAO, TOKEN.joaoTablet);
  await registrar(CLIENTE_A, TOKEN.ana);
  const id = await agendarComo(CLIENTE_A, '10:00');

  const resumo = await processar();
  assert.equal(resumo.aceitas, 2);
  assert.deepEqual(expo.entregues.map((m) => m.to).sort(), [TOKEN.joao, TOKEN.joaoTablet].sort());
  for (const m of expo.entregues) {
    assert.equal(m.title, 'Novo agendamento');
    assert.equal(m.body, `Ana agendou Corte para dia ${DDMM} às 10h.`);
    assert.equal(m.channelId, 'agendamentos');
    assert.equal(m.priority, 'high');
    assert.equal(m.tag, `agendamento:${id}`);
    assert.deepEqual(m.data, { tipo: 'novo_agendamento', destinatario: USUARIO_JOAO, agendamento_id: id });
    assert.ok(m.ttl > 6 * 24 * 3600 && m.ttl <= 28 * 24 * 3600, `ttl ${m.ttl}`);
  }
  assert.equal(expo.pedidos[0].headers.Authorization, 'Bearer acesso-expo-teste');

  const [aviso] = await avisos('novo_agendamento');
  assert.equal(aviso.status, 'enviada');
  const lista = await envios(aviso.id);
  assert.deepEqual(lista.map((e) => e.status), ['aceito', 'aceito']);
  assert.ok(lista.every((e) => e.ticket_id));
});

test('2. cancelamento: pelo cliente só o barbeiro recebe; pelo barbeiro só o cliente; falta não envia', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(CLIENTE_A, TOKEN.ana);
  await registrar(CLIENTE_B, TOKEN.bruno);
  const daAna = await agendarComo(CLIENTE_A, '10:00');
  const doBruno = await agendarComo(CLIENTE_B, '11:00');
  await processar(); // os avisos de novo agendamento
  expo.entregues.length = 0;

  await mudarStatus(CLIENTE_A, daAna, 'cancelado');
  await mudarStatus(USUARIO_JOAO, doBruno, 'cancelado');
  const falta = await agendarDaquiA(-20); // ja comecou: "Cliente faltou"
  await mudarStatus(USUARIO_JOAO, falta, 'cancelado');
  await processar();

  const porToken = Object.fromEntries(expo.entregues.map((m) => [m.to, m]));
  assert.deepEqual(Object.keys(porToken).sort(), [TOKEN.bruno, TOKEN.joao].sort());
  assert.equal(porToken[TOKEN.joao].body, `Ana cancelou o atendimento de dia ${DDMM} às 10h (Corte).`);
  assert.equal(porToken[TOKEN.bruno].body, `João cancelou o seu atendimento de dia ${DDMM} às 11h (Corte).`);
  assert.ok(expo.entregues.every((m) => m.title === 'Agendamento cancelado' && m.channelId === 'cancelamentos'));
});

test('3. mensagem: o outro participante recebe "Você recebeu uma mensagem de ...", sem o texto; o remetente nunca recebe', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(CLIENTE_A, TOKEN.ana);
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'Segredo: chego às 9h com meu irmão');
  await processar();
  assert.deepEqual(expo.entregues.map((m) => m.to), [TOKEN.joao]);
  const [m] = expo.entregues;
  assert.deepEqual([m.title, m.body, m.channelId, m.tag],
    ['Nova mensagem', 'Você recebeu uma mensagem de Ana.', 'mensagens', `conversa:${conversa}`]);
  assert.deepEqual(m.data, {
    tipo: 'mensagem', destinatario: USUARIO_JOAO, conversa_id: conversa, barbeiro_id: JOAO, cliente_id: CLIENTE_A, outro_nome: 'Ana',
  });

  await enviarMensagem(conversa, USUARIO_JOAO, 'Pode vir!');
  await processar();
  assert.deepEqual(expo.entregues.map((x) => x.to), [TOKEN.joao, TOKEN.ana]);
  assert.equal(expo.entregues[1].body, 'Você recebeu uma mensagem de João.');
  const tudo = JSON.stringify(expo.pedidos);
  assert.ok(!tudo.includes('Segredo') && !tudo.includes('irmão') && !tudo.includes('Pode vir'));
});

test('4. várias mensagens seguidas da mesma conversa viram um aviso só por aparelho, com a contagem', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(USUARIO_JOAO, TOKEN.joaoTablet);
  const conversa = await novaConversa();
  for (const texto of ['oi', 'tudo bem?', 'posso remarcar?']) await enviarMensagem(conversa, CLIENTE_A, texto);
  await processar();
  assert.equal(expo.entregues.length, 2); // um por aparelho
  assert.ok(expo.entregues.every((m) => m.body === 'Você tem 3 mensagens novas de Ana.'));
  assert.deepEqual((await avisos('mensagem')).map((a) => a.status), ['enviada', 'enviada', 'enviada']);
  // O ticket fica so com o aviso principal (um por aparelho)
  assert.equal(await contar('SELECT count(*) AS n FROM public.notificacao_envios WHERE ticket_id IS NOT NULL'), 2);
});

test('5. não envia o que deixou de valer: cancelado antes do envio, horário passado, mensagem já lida, preferência desligada', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(CLIENTE_A, TOKEN.ana);
  // Agendado e cancelado antes de o backend ler a fila: so o cancelamento sai
  const cancelado = await agendarComo(CLIENTE_A, '10:00');
  await mudarStatus(CLIENTE_A, cancelado, 'cancelado');
  // O horario passou antes do envio
  const passou = await agendarDaquiA(10, CLIENTE_B);
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento');
  await db.query("UPDATE public.agendamentos SET data_hora = now() - interval '1 minute' WHERE id = $1", [passou]);
  await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento');
  // Mensagem lida antes do envio (ex.: pelo site)
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'oi');
  await db.query('UPDATE public.mensagens SET lida = true');
  await processar();
  assert.deepEqual(expo.entregues.map((m) => m.title), ['Agendamento cancelado']);

  // Preferencia desligada: o barbeiro nao quer avisos de mensagem
  await como(USUARIO_JOAO, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { mensagens: false } }));
  await enviarMensagem(conversa, CLIENTE_A, 'de novo');
  await processar();
  assert.equal(expo.entregues.length, 1);

  const motivos = (await avisos()).filter((a) => a.status === 'ignorada').map((a) => `${a.tipo}:${a.motivo}`).sort();
  assert.deepEqual(motivos, [
    'mensagem:ja_lida', 'mensagem:preferencia', 'novo_agendamento:agendamento_cancelado', 'novo_agendamento:horario_passou',
  ]);
});

test('6. lembrete: o cliente recebe 30 min antes, no canal de lembretes, com serviço, barbeiro e hora', async () => {
  await registrar(CLIENTE_A, TOKEN.ana);
  const id = await agendarDaquiA(20);
  await rpc('rotina_notificacoes'); // o pg_cron chama a cada minuto
  await processar();
  assert.equal(expo.entregues.length, 1); // o barbeiro tem o lembrete desligado
  const [m] = expo.para(TOKEN.ana);
  assert.deepEqual([m.title, m.body, m.channelId, m.tag],
    ['Seu atendimento está próximo', `Corte com João às ${horaCurta(await dataHora(id))}.`, 'lembretes', `agendamento:${id}`]);
  assert.ok(m.ttl >= 60 && m.ttl <= 20 * 60);
});

test('7. app desinstalado (DeviceNotRegistered): o aparelho é desativado e não recebe mais; o token não aparece em erro nem log', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(USUARIO_JOAO, TOKEN.joaoTablet);
  expo.estado.naoRegistrados.add(TOKEN.joaoTablet);
  await agendarComo(CLIENTE_A, '10:00');
  await processar();
  assert.deepEqual(expo.entregues.map((m) => m.to), [TOKEN.joao]);
  assert.deepEqual(await aparelho(TOKEN.joaoTablet), { ativo: false, motivo_desativacao: 'DeviceNotRegistered' });
  const [aviso] = await avisos('novo_agendamento');
  assert.deepEqual([aviso.status, aviso.motivo], ['enviada', 'parcial: DeviceNotRegistered']);

  await agendarComo(CLIENTE_B, '11:00');
  await processar();
  // O tablet nem e mais tentado
  assert.deepEqual(expo.pedidos.at(-1).corpo.map((m) => m.to), [TOKEN.joao]);

  const gravado = JSON.stringify((await db.query('SELECT erro FROM public.notificacao_envios')).rows)
    + JSON.stringify((await db.query('SELECT motivo FROM public.notificacoes')).rows);
  assert.ok(!gravado.includes('ExponentPushToken'));
  assert.ok(!logs.linhas.join('\n').includes('ExponentPushToken'));
});

test('8. Expo fora do ar (HTTP 500 ou falha de rede): nada se perde; o banco agenda nova tentativa e o aviso sai depois', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await agendarComo(CLIENTE_A, '10:00');

  expo.estado.modo = 'http500';
  await processar();
  let [aviso] = await avisos('novo_agendamento');
  assert.deepEqual([aviso.status, aviso.motivo, aviso.tentativas], ['pendente', 'erro_temporario: HTTP 500 INTERNAL_SERVER_ERROR', 1]);
  const espera = (new Date(aviso.proxima_tentativa) - Date.now()) / 1000;
  assert.ok(espera > 20 && espera <= 31, `espera ${espera}s`);
  await processar(); // antes da hora: nada
  assert.equal(expo.pedidos.length, 1);

  expo.estado.modo = 'rede';
  await liberar();
  await processar();
  [aviso] = await avisos('novo_agendamento');
  assert.deepEqual([aviso.status, aviso.motivo, aviso.tentativas], ['pendente', 'erro_temporario: FalhaDeConexao', 2]);

  expo.estado.modo = 'ok';
  await liberar();
  await processar();
  [aviso] = await avisos('novo_agendamento');
  assert.deepEqual([aviso.status, aviso.tentativas], ['enviada', 3]);
  assert.equal(expo.entregues.length, 1);
});

test('9. timeout da Expo: vira falha temporária sem travar o processamento', async () => {
  servico = montarServico({ timeoutMs: 50 });
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await agendarComo(CLIENTE_A, '10:00');
  expo.estado.modo = 'timeout';
  const inicio = Date.now();
  await processar();
  assert.ok(Date.now() - inicio < 5000);
  const [aviso] = await avisos('novo_agendamento');
  assert.deepEqual([aviso.status, aviso.motivo], ['pendente', 'erro_temporario: Timeout']);
});

test('10. token de acesso da Expo errado (401): tenta de novo e não desativa aparelhos', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await agendarComo(CLIENTE_A, '10:00');
  expo.estado.modo = 'http401';
  await processar();
  const [aviso] = await avisos('novo_agendamento');
  assert.deepEqual([aviso.status, aviso.motivo], ['pendente', 'erro_temporario: HTTP 401 UNAUTHORIZED']);
  assert.equal((await aparelho(TOKEN.joao)).ativo, true);
});

test('11. um token de outro projeto recusa o lote inteiro na Expo: só aquele aparelho falha, os outros recebem', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(USUARIO_JOAO, TOKEN.joaoTablet);
  expo.estado.outroProjeto.add(TOKEN.joaoTablet);
  await agendarComo(CLIENTE_A, '10:00');
  await processar();
  assert.deepEqual(expo.entregues.map((m) => m.to), [TOKEN.joao]);
  assert.deepEqual(expo.pedidos.map((p) => p.corpo.length), [2, 1, 1]); // lote recusado, depois uma a uma
  const [aviso] = await avisos('novo_agendamento');
  assert.deepEqual((await envios(aviso.id)).map((e) => [e.token, e.status, e.erro]), [
    [TOKEN.joao, 'aceito', null],
    [TOKEN.joaoTablet, 'recusado', 'MismatchSenderId'],
  ]);
  assert.equal((await aparelho(TOKEN.joaoTablet)).ativo, true); // so DeviceNotRegistered desativa
});

test('12. falha ao gravar o resultado: tenta de novo; com o banco fora, guarda e não reenvia quando o aviso volta', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  let falhas = 1;
  servico = montarServico({
    chamar: async (nome, args) => {
      if (nome === 'concluir_envio_notificacao' && falhas > 0) {
        falhas--;
        throw Object.assign(new Error('connection refused'), { code: 'ECONNREFUSED' });
      }
      return chamarPglite(nome, args);
    },
  });

  // Uma falha: a nova tentativa imediata grava
  await agendarComo(CLIENTE_A, '10:00');
  await processar();
  assert.equal((await avisos('novo_agendamento'))[0].status, 'enviada');
  assert.equal(expo.entregues.length, 1);

  // Banco fora: as 3 tentativas falham; o aviso fica reservado e o resultado, guardado
  falhas = 3;
  await agendarComo(CLIENTE_B, '11:00');
  await processar();
  assert.equal(expo.entregues.length, 2);
  assert.equal((await avisos('novo_agendamento'))[1].status, 'enviando');
  assert.ok(logs.linhas.some((l) => l.includes('guardado para gravar depois')));

  // A reserva vence e o banco devolve o mesmo aviso: o backend so grava, sem reenviar
  await db.query("UPDATE public.notificacoes SET reservada_ate = now() - interval '1 second' WHERE status = 'enviando'");
  falhas = 3; // ainda fora na primeira leitura; volta no meio
  await processar();
  assert.equal(expo.entregues.length, 2);
  assert.equal((await avisos('novo_agendamento'))[1].status, 'enviada');
});

test('13. processamento ao mesmo tempo não duplica: várias chamadas juntas e duas instâncias do backend', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await agendarComo(CLIENTE_A, '10:00');
  await agendarComo(CLIENTE_B, '11:00');
  await Promise.all([processar(), processar(), processar()]);
  assert.equal(expo.entregues.length, 2);

  // Dois servidores lendo a mesma fila
  const outro = montarServico();
  await agendarComo(CLIENTE_C, '13:00');
  await Promise.all([servico.solicitarProcessamento(), outro.solicitarProcessamento()]);
  assert.equal(expo.entregues.length, 3);
  assert.equal(new Set(expo.entregues.map((m) => m.body)).size, 3);
});

test('14. isolamento: no mesmo lote, cada aviso vai só para os aparelhos do seu destinatário (e cada erro fica com o dono)', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(CLIENTE_A, TOKEN.ana);
  await registrar(CLIENTE_B, TOKEN.bruno);
  expo.estado.naoRegistrados.add(TOKEN.bruno);
  const daAna = await agendarComo(CLIENTE_A, '10:00');
  const doBruno = await agendarComo(CLIENTE_B, '11:00');
  await mudarStatus(USUARIO_JOAO, daAna, 'cancelado');
  await mudarStatus(USUARIO_JOAO, doBruno, 'cancelado');
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'oi');
  await processar();

  // Um pedido so, com o cancelamento da Ana, o do Bruno e a mensagem para o Joao
  assert.equal(expo.pedidos.length, 1);
  const lote = expo.pedidos[0].corpo;
  assert.equal(lote.length, 3);
  for (const m of lote) assert.equal(m.data.destinatario, DONO[m.to], m.to);
  assert.equal((await aparelho(TOKEN.bruno)).ativo, false);
  assert.equal((await aparelho(TOKEN.ana)).ativo, true);
  assert.equal((await aparelho(TOKEN.joao)).ativo, true);
  const cancelamentos = Object.fromEntries((await avisos('cancelamento')).map((a) => [a.destinatario_id, a.status]));
  assert.deepEqual(cancelamentos, { [CLIENTE_A]: 'enviada', [CLIENTE_B]: 'falhou' });
});

test('15. recibos: conferidos depois de 15 min; entregue ou aparelho desativado', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(USUARIO_JOAO, TOKEN.joaoTablet);
  expo.estado.reciboErro.set(TOKEN.joaoTablet, 'DeviceNotRegistered');
  await agendarComo(CLIENTE_A, '10:00');
  await processar();
  assert.ok(!expo.pedidos.some((p) => p.caminho.endsWith('/getReceipts'))); // cedo demais

  await db.query("UPDATE public.notificacao_envios SET enviado_em = now() - interval '20 minutes'");
  await processar();
  const pedido = expo.pedidos.find((p) => p.caminho.endsWith('/getReceipts'));
  assert.deepEqual(Object.keys(pedido.corpo), ['ids']); // so os ids dos tickets
  assert.equal(pedido.corpo.ids.length, 2);
  const [aviso] = await avisos('novo_agendamento');
  assert.deepEqual((await envios(aviso.id)).map((e) => [e.token, e.status]), [
    [TOKEN.joao, 'entregue'], [TOKEN.joaoTablet, 'recusado'],
  ]);
  assert.equal((await aparelho(TOKEN.joaoTablet)).ativo, false);
});

test('16. aviso com dados que não formam uma notificação falha sem travar a fila', async () => {
  await registrar(CLIENTE_A, TOKEN.ana);
  await registrar(USUARIO_JOAO, TOKEN.joao);
  const id = await agendarComo(CLIENTE_A, '10:00');
  await mudarStatus(USUARIO_JOAO, id, 'cancelado'); // aviso para a Ana
  await db.query("UPDATE public.notificacoes SET dados = '{}'::jsonb WHERE tipo = 'cancelamento'");
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'oi'); // aviso valido para o Joao, no mesmo lote
  await processar();
  const [cancelamento] = await avisos('cancelamento');
  assert.deepEqual([cancelamento.status, cancelamento.motivo], ['falhou', 'recusado: DadosInvalidos']);
  // O resto da fila seguiu: a mensagem chegou ao barbeiro
  assert.deepEqual(expo.entregues.map((m) => [m.to, m.title]), [[TOKEN.joao, 'Nova mensagem']]);
  assert.ok(logs.linhas.some((l) => l.includes('dados invalidos')));
});

// ---------------------------------------------------------------
// Textos
// ---------------------------------------------------------------
test('17. textos: hoje, amanhã ou data, no horário de Brasília', () => {
  const agora = new Date('2026-11-10T12:00:00Z'); // 9h em Brasilia
  assert.equal(quando(new Date('2026-11-10T17:00:00Z'), agora), 'hoje às 14h');
  assert.equal(quando(new Date('2026-11-11T13:30:00Z'), agora), 'amanhã às 10h30');
  assert.equal(quando(new Date('2026-11-11T02:30:00Z'), agora), 'hoje às 23h30'); // ja e dia 11 em UTC
  assert.equal(quando(new Date('2026-11-11T03:00:00Z'), agora), 'amanhã às 0h');
  assert.equal(quando(new Date('2026-11-20T23:05:00Z'), agora), 'dia 20/11 às 20h05');
  assert.equal(quando(new Date('2027-01-01T13:00:00Z'), new Date('2026-12-31T15:00:00Z')), 'amanhã às 10h'); // virada do ano
});

test('18. textos de cada tipo: objetivos, só com primeiro nome, serviço e horário; nunca o conteúdo da mensagem', () => {
  const agora = new Date('2026-11-10T12:00:00Z');
  const base = { data_hora: '2026-11-11T17:00:00+00:00', servico: 'Corte', cliente_nome: 'Ana', barbeiro_nome: 'João' };
  const casos = [
    [{ tipo: 'novo_agendamento', dados: { ...base, papel: 'barbeiro', ator: 'cliente' } },
      'Novo agendamento', 'Ana agendou Corte para amanhã às 14h.'],
    [{ tipo: 'cancelamento', dados: { ...base, papel: 'barbeiro', ator: 'cliente' } },
      'Agendamento cancelado', 'Ana cancelou o atendimento de amanhã às 14h (Corte).'],
    [{ tipo: 'cancelamento', dados: { ...base, papel: 'cliente', ator: 'barbeiro' } },
      'Agendamento cancelado', 'João cancelou o seu atendimento de amanhã às 14h (Corte).'],
    [{ tipo: 'cancelamento', dados: { ...base, papel: 'cliente', ator: 'barbearia' } },
      'Agendamento cancelado', 'A barbearia cancelou o seu atendimento de amanhã às 14h (Corte).'],
    [{ tipo: 'cancelamento', dados: { ...base, papel: 'barbeiro', ator: 'barbearia' } },
      'Agendamento cancelado', 'A barbearia cancelou o atendimento de Ana de amanhã às 14h (Corte).'],
    [{ tipo: 'lembrete', dados: { ...base, papel: 'cliente', minutos: 30 } },
      'Seu atendimento está próximo', 'Corte com João às 14h.'],
    [{ tipo: 'lembrete', dados: { ...base, papel: 'barbeiro', minutos: 30 } },
      'Atendimento em breve', 'Ana às 14h (Corte).'],
    [{ tipo: 'mensagem', nao_lidas: 1, dados: { outro_nome: 'Ana' } }, 'Nova mensagem', 'Você recebeu uma mensagem de Ana.'],
    [{ tipo: 'mensagem', nao_lidas: 4, dados: { outro_nome: 'Ana' } }, 'Nova mensagem', 'Você tem 4 mensagens novas de Ana.'],
    [{ tipo: 'teste', dados: {} }, 'Visage Barber', 'Notificação de teste: este aparelho está pronto para receber os avisos.'],
  ];
  for (const [item, titulo, corpo] of casos) assert.deepEqual(textoDoAviso(item, agora), { titulo, corpo }, item.tipo);
  assert.throws(() => textoDoAviso({ tipo: 'cancelamento', dados: {} }, agora));
  assert.throws(() => textoDoAviso({ tipo: 'outro', dados: {} }, agora));
});

// ---------------------------------------------------------------
// Rotas
// ---------------------------------------------------------------
test('19. /processar: sem segredo ou com segredo errado → 401 e nada é enviado; com o certo → 202 e a fila é lida', async () => {
  await subir();
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await registrar(CLIENTE_B, TOKEN.bruno);
  await agendarComo(CLIENTE_A, '10:00');

  for (const segredo of [undefined, 'x'.repeat(48), SEGREDO.slice(0, -1), `${SEGREDO}0`]) {
    const r = await post('/processar', {}, { segredo });
    assert.deepEqual([r.status, r.corpo.code], [401, 'NAO_AUTORIZADO']);
  }
  await servico.aguardar();
  assert.equal(expo.pedidos.length, 0);

  // Quem chama nao escolhe destinatario nem texto: so a fila e lida
  const r = await post('/processar', { destinatario: CLIENTE_B, to: TOKEN.bruno, title: 'Promoção' }, { segredo: SEGREDO });
  assert.deepEqual([r.status, r.corpo], [202, { recebido: true }]);
  await servico.aguardar();
  assert.deepEqual(expo.entregues.map((m) => [m.to, m.title]), [[TOKEN.joao, 'Novo agendamento']]);
  assert.ok(!logs.linhas.join('\n').includes(SEGREDO));
});

test('20. /processar fica fechada sem segredo configurado (ou curto) e com as notificações desligadas', async () => {
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await agendarComo(CLIENTE_A, '10:00');
  await subir({ segredo: null }); // NOTIFICACOES_SEGREDO vazio
  assert.deepEqual(await post('/processar', {}, { segredo: SEGREDO }).then((r) => [r.status, r.corpo.code]), [503, 'NAO_CONFIGURADO']);
  await subir({ segredo: 'curto-demais' });
  assert.deepEqual(await post('/processar', {}, { segredo: 'curto-demais' }).then((r) => [r.status, r.corpo.code]), [503, 'NAO_CONFIGURADO']);
  await subir({ ativo: false });
  assert.deepEqual(await post('/processar', {}, { segredo: SEGREDO }).then((r) => [r.status, r.corpo.code]), [503, 'DESATIVADO']);
  assert.deepEqual(await post('/teste', {}, { sessao: 'sessao-ana' }).then((r) => [r.status, r.corpo.code]), [503, 'DESATIVADO']);
  await servico.aguardar();
  assert.equal(expo.pedidos.length, 0);
});

test('21. tentativas sem segredo ou com segredo errado não gastam o limite do banco e não leem a fila', async () => {
  await subir({
    limiteProcessar: criarLimitador({ max: 3, janelaMs: 60000 }),
    limiteFalhas: criarLimitador({ max: 2, janelaMs: 60000 }),
  });
  await registrar(USUARIO_JOAO, TOKEN.joao);
  await agendarComo(CLIENTE_A, '10:00'); // ha um aviso esperando na fila

  // Ataque do mesmo IP que o banco usa (aqui, todos vem de 127.0.0.1)
  const invalidas = [];
  for (const segredo of [undefined, 'errado-errado-errado-errado-errado-1', SEGREDO.slice(0, -1), undefined, 'x']) {
    invalidas.push((await post('/processar', {}, { segredo })).status);
  }
  assert.deepEqual(invalidas, [401, 401, 429, 429, 429]); // limite proprio das invalidas
  await servico.aguardar();
  assert.equal(expo.pedidos.length, 0); // nenhuma leitura da fila
  assert.equal((await avisos('novo_agendamento'))[0].status, 'pendente');
  // Log: so ate o limite das invalidas, e nunca o segredo
  assert.equal(logs.linhas.filter((l) => l.includes('segredo ausente ou errado')).length, 2);
  assert.ok(!logs.linhas.join('\n').includes(SEGREDO.slice(0, -1)));

  // As chamadas do banco continuam passando, mesmo vindo do mesmo IP
  const validas = [];
  for (let i = 0; i < 3; i++) validas.push((await post('/processar', {}, { segredo: SEGREDO })).status);
  assert.deepEqual(validas, [202, 202, 202]);
  await servico.aguardar();
  assert.deepEqual(expo.entregues.map((m) => m.to), [TOKEN.joao]);

  // O limite das autenticadas continua valendo (120/min em producao; 3 aqui)
  assert.deepEqual(await post('/processar', {}, { segredo: SEGREDO }).then((r) => [r.status, r.corpo.code]), [429, 'LIMITE']);
  // E a resposta de uma invalida nao muda com o limite das autenticadas cheio
  assert.equal((await post('/processar', {}, { segredo: 'outro-errado' })).status, 429);
  await servico.aguardar();
});

test('21b. resposta a segredo errado não ajuda a descobri-lo (mesma resposta para ausente, quase igual ou diferente)', async () => {
  await subir();
  const respostas = [];
  for (const segredo of [undefined, '', SEGREDO.slice(0, -1), `${SEGREDO}x`, SEGREDO.toUpperCase(), 'a'.repeat(200)]) {
    const r = await post('/processar', {}, { segredo });
    respostas.push(JSON.stringify([r.status, r.corpo]));
  }
  assert.equal(new Set(respostas).size, 1);
  assert.deepEqual(JSON.parse(respostas[0]), [401, { error: 'Não autorizado.', code: 'NAO_AUTORIZADO' }]);
  await servico.aguardar();
  assert.equal(expo.pedidos.length, 0);
});

test('22. /teste: exige login e envia só aos aparelhos do próprio usuário, sem gravar nada na fila e sem devolver tokens', async () => {
  await subir();
  await registrar(CLIENTE_A, TOKEN.ana);
  await registrar(CLIENTE_B, TOKEN.bruno);

  assert.deepEqual(await post('/teste').then((r) => [r.status, r.corpo.code]), [401, 'NAO_AUTENTICADO']);

  // Mesmo pedindo outro destinatario, vai so para os aparelhos de quem esta logado
  const r = await post('/teste', { destinatario: CLIENTE_B, to: TOKEN.bruno }, { sessao: 'sessao-ana' });
  assert.equal(r.status, 200);
  assert.equal(r.corpo.aparelhos, 1);
  const [resultado] = r.corpo.resultados;
  assert.equal(resultado.dispositivo_id, await idDo(TOKEN.ana));
  assert.deepEqual([resultado.plataforma, resultado.status, resultado.recibo], ['android', 'aceito', 'pendente']);
  assert.ok(resultado.ticket_id);
  assert.ok(!JSON.stringify(r.corpo).includes('ExponentPushToken'));
  assert.deepEqual(expo.entregues.map((m) => m.to), [TOKEN.ana]);
  assert.deepEqual(expo.entregues[0].data, { tipo: 'teste', destinatario: CLIENTE_A });
  assert.equal(await contar('SELECT count(*) AS n FROM public.notificacoes'), 0); // nada na fila

  // Aparelho de outra pessoa: como se nao existisse
  assert.deepEqual(await post('/teste', { dispositivo_id: await idDo(TOKEN.bruno) }, { sessao: 'sessao-ana' })
    .then((x) => [x.status, x.corpo.code]), [404, 'DISPOSITIVO_NAO_ENCONTRADO']);
  assert.deepEqual(await post('/teste', { dispositivo_id: 'nao-e-um-id' }, { sessao: 'sessao-ana' })
    .then((x) => [x.status, x.corpo.code]), [400, 'DISPOSITIVO_INVALIDO']);
  // Sem aparelho registrado
  assert.deepEqual(await post('/teste', {}, { sessao: 'sessao-caio' }).then((x) => [x.status, x.corpo.code]), [404, 'SEM_APARELHO']);
  assert.equal(expo.entregues.length, 1);
});

test('23. /teste: recibo para diagnóstico, aparelho desinstalado sem mexer no banco e limite por usuário', async () => {
  servico = montarServico({ config: { esperaReciboTesteMs: 1 } });
  await subir();
  await registrar(CLIENTE_A, TOKEN.ana);
  await registrar(CLIENTE_A, TOKEN.anaTablet);
  expo.estado.naoRegistrados.add(TOKEN.anaTablet);

  const r = await post('/teste', {}, { sessao: 'sessao-ana' });
  assert.equal(r.status, 200);
  const porAparelho = Object.fromEntries(r.corpo.resultados.map((x) => [x.dispositivo_id, x]));
  const celular = porAparelho[await idDo(TOKEN.ana)];
  const tablet = porAparelho[await idDo(TOKEN.anaTablet)];
  assert.deepEqual([celular.status, celular.recibo], ['aceito', 'ok']);
  assert.deepEqual([tablet.status, tablet.erro], ['recusado', 'DeviceNotRegistered']);
  assert.equal((await aparelho(TOKEN.anaTablet)).ativo, true); // o teste nao grava nada

  // Limite: 3 testes a cada 10 minutos por usuario
  assert.equal((await post('/teste', {}, { sessao: 'sessao-ana' })).status, 200);
  assert.equal((await post('/teste', {}, { sessao: 'sessao-ana' })).status, 200);
  assert.deepEqual(await post('/teste', {}, { sessao: 'sessao-ana' }).then((x) => [x.status, x.corpo.code]), [429, 'LIMITE']);
  // O limite e de cada usuario
  await registrar(CLIENTE_B, TOKEN.bruno);
  assert.equal((await post('/teste', {}, { sessao: 'sessao-bruno' })).status, 200);
});
