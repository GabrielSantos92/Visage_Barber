// Confirmacao de presenca pelo WhatsApp (migration 25) direto no banco (PGlite):
// quando o pedido e gerado, a reserva e o resultado do envio, as respostas SIM e
// NAO, cancelamento e mudanca de horario, descadastro e acesso. Nenhum servico
// externo e chamado: a Meta so entra nos testes do backend, e falsa.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  criarBanco, recusa, migration, MIGRATIONS_AGENDA, MIGRATIONS_WHATSAPP,
  JOAO, PEDRO, CORTE_30, CLIENTE_A, CLIENTE_B, CLIENTE_C, ADMIN, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

const TEL_A = '5511987654321';
const TEL_B = '5521998765432';

let db;
let minuto = 0;

before(async () => {
  db = await criarBanco({
    migracoes: MIGRATIONS_WHATSAPP,
    antesDasMigrations: `
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon;
    `,
  });
  await db.exec(`
    INSERT INTO public.profiles (user_id, nome, telefone) VALUES
      ('${CLIENTE_A}', 'Ana Paula Souza', '11987654321'),
      ('${CLIENTE_B}', 'Bruno Lima', '(21) 99876-5432'),
      ('${CLIENTE_C}', 'Caio Fixo', '1133334444'),
      ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
    -- Os horarios dos testes sao relativos a agora: fora da grade da barbearia
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
  `);
});

beforeEach(async () => {
  await db.exec(`
    RESET ROLE;
    DELETE FROM public.agendamentos;
    DELETE FROM public.notificacoes;
    DELETE FROM public.whatsapp_eventos;
    DELETE FROM public.consentimentos;
  `);
});

const q = async (sql, params) => (await db.query(sql, params)).rows;
const um = async (sql, params) => (await q(sql, params))[0];
const consentir = (uid) => db.query(
  "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', 'v1', 'web')", [uid]);

// Agendamento daqui a `minutos`, com o horario definido ha `definidoHaMin` minutos
async function agendar(cliente, minutos, { barbeiro = JOAO, definidoHaMin = 24 * 60 } = {}) {
  minuto += 1;
  const { id } = await um(
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora)
     VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4) + make_interval(secs => $5)) RETURNING id`,
    [cliente, barbeiro, CORTE_30, minutos, minuto]);
  await db.query('UPDATE public.agendamentos SET horario_definido_em = now() - make_interval(mins => $2) WHERE id = $1', [id, definidoHaMin]);
  return id;
}
const enfileirar = async () => (await um('SELECT public.enfileirar_confirmacoes_presenca() AS n')).n;
const reservar = async () => (await um('SELECT public.reservar_whatsapp(20) AS r')).r;
const concluir = async (id, resultado) => (await um('SELECT public.concluir_envio_whatsapp($1, $2) AS r', [id, JSON.stringify(resultado)])).r;
const confirmacao = (agendamento) => um('SELECT * FROM public.confirmacoes_presenca WHERE agendamento_id = $1 ORDER BY criada_em DESC LIMIT 1', [agendamento]);
const aviso = (id) => um('SELECT * FROM public.notificacoes WHERE id = $1', [id]);
const responder = async (evento, de, tipo, { payload = null, contexto = null, texto = null } = {}) => (await um(
  'SELECT public.whatsapp_registrar_resposta($1, $2, $3, $4, $5, $6) AS r', [evento, de, tipo, payload, contexto, texto])).r;

// Pedido ja enviado (aceito pela Meta) para o cliente
async function pedidoEnviado(cliente = CLIENTE_A, { wamid = `wamid.${++minuto}`, waId = TEL_A, minutos = 100 } = {}) {
  await consentir(cliente).catch(() => {});
  const ag = await agendar(cliente, minutos);
  await enfileirar();
  const itens = await reservar();
  const item = itens.find((i) => i.dados.agendamento_id === ag);
  assert.ok(item, 'o pedido deveria ter sido reservado');
  await concluir(item.id, { status: 'aceito', wamid, wa_id: waId });
  return { ag, item, wamid, conf: await confirmacao(ag) };
}

test('pedido: só para quem autorizou e tem celular, entre 2 h e 1 h antes, uma única vez', async () => {
  const semConsentimento = await agendar(CLIENTE_A, 100);
  assert.equal(await enfileirar(), 0);

  await consentir(CLIENTE_A);
  await consentir(CLIENTE_C);
  const cedo = await agendar(CLIENTE_A, 150);
  const tarde = await agendar(CLIENTE_A, 40);
  const fixo = await agendar(CLIENTE_C, 100);
  assert.equal(await enfileirar(), 1);
  assert.equal(await enfileirar(), 0, 'rodar de novo não duplica');

  const c = await confirmacao(semConsentimento);
  assert.equal(c.estado, 'pendente');
  for (const id of [cedo, tarde, fixo]) assert.equal(await confirmacao(id), undefined);

  const n = await aviso(c.notificacao_id);
  assert.equal(n.canal, 'whatsapp');
  assert.equal(n.tipo, 'confirmacao_presenca');
  assert.equal(n.destinatario_id, CLIENTE_A);
  assert.deepEqual(
    { cliente: n.dados.cliente_nome, barbeiro: n.dados.barbeiro_nome, servico: n.dados.servico, conf: n.dados.confirmacao_id },
    { cliente: 'Ana', barbeiro: 'João', servico: 'Corte', conf: c.id });
  // O pedido vence 1 hora antes do atendimento
  const { ok } = await um('SELECT $1::timestamptz = $2::timestamptz - interval \'60 minutes\' AS ok', [n.expira_em, c.data_hora]);
  assert.equal(ok, true);
});

test('pedido: quem agendou ou mudou o horário com menos de 2 horas não recebe', async () => {
  await consentir(CLIENTE_A);
  const ag = await agendar(CLIENTE_A, 100, { definidoHaMin: 5 });
  assert.equal(await enfileirar(), 0);
  assert.equal(await confirmacao(ag), undefined);
  // O gatilho marca a hora em que o horário foi definido
  const novo = await um(
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora)
     VALUES ($1, $2, $3, now() + interval '3 days') RETURNING horario_definido_em > now() - interval '1 minute' AS ok`,
    [CLIENTE_B, PEDRO, CORTE_30]);
  assert.equal(novo.ok, true);
});

test('envio: a reserva devolve o telefone, grava a tentativa e o aceite deixa "sem resposta"', async () => {
  await consentir(CLIENTE_B);
  const ag = await agendar(CLIENTE_B, 110);
  await enfileirar();
  const itens = await reservar();
  assert.equal(itens.length, 1);
  assert.equal(itens[0].telefone, TEL_B);
  assert.equal(itens[0].tipo, 'confirmacao_presenca');
  assert.deepEqual(await reservar(), [], 'reservado não é devolvido de novo');
  assert.deepEqual(await q('SELECT tentativa, estado FROM public.whatsapp_mensagens'), [{ tentativa: 1, estado: 'iniciado' }]);

  assert.deepEqual(await concluir(itens[0].id, { status: 'aceito', wamid: 'wamid.X1', wa_id: '552198765432' }), { status: 'enviada' });
  assert.equal((await aviso(itens[0].id)).status, 'enviada');
  assert.equal((await confirmacao(ag)).estado, 'enviada');
  assert.deepEqual(await q('SELECT estado, wamid FROM public.whatsapp_mensagens'), [{ estado: 'aceito', wamid: 'wamid.X1' }]);
  // Concluir de novo não muda nada
  assert.equal((await concluir(itens[0].id, { status: 'recusado', erro: 'x' })).ja_concluido, true);
  assert.equal((await confirmacao(ag)).estado, 'enviada');
});

test('envio: erro da Meta tenta de novo; recusa e resultado incerto não', async () => {
  await consentir(CLIENTE_A);
  await consentir(CLIENTE_B);
  const a = await agendar(CLIENTE_A, 110);
  const b = await agendar(CLIENTE_B, 112);
  await enfileirar();
  const [ia, ib] = await reservar();

  const r = await concluir(ia.id, { status: 'erro', erro: '429' });
  assert.equal(r.status, 'pendente');
  assert.equal((await aviso(ia.id)).status, 'pendente');
  assert.equal((await confirmacao(a)).estado, 'pendente');
  // Só volta depois da espera
  assert.deepEqual(await reservar(), []);
  await db.query('UPDATE public.notificacoes SET proxima_tentativa = now() WHERE id = $1', [ia.id]);
  const de_novo = await reservar();
  assert.equal(de_novo.length, 1);
  assert.equal(de_novo[0].tentativas, 2);
  assert.equal((await concluir(ia.id, { status: 'recusado', erro: '131026' })).status, 'falhou');
  assert.deepEqual({ estado: (await confirmacao(a)).estado, motivo: (await confirmacao(a)).motivo }, { estado: 'nao_enviada', motivo: '131026' });

  assert.deepEqual(await concluir(ib.id, { status: 'incerto', erro: 'timeout' }), { status: 'falhou', motivo: 'resultado_incerto' });
  assert.equal((await confirmacao(b)).estado, 'nao_enviada');
  assert.deepEqual(await reservar(), [], 'resultado incerto nunca é reenviado');
  assert.deepEqual(
    await q('SELECT tentativa, estado FROM public.whatsapp_mensagens WHERE notificacao_id = $1 ORDER BY tentativa', [ia.id]),
    [{ tentativa: 1, estado: 'falhou' }, { tentativa: 2, estado: 'falhou' }]);
});

test('envio: reserva vencida sem resultado vira "resultado incerto" e não é reenviada', async () => {
  await consentir(CLIENTE_A);
  const ag = await agendar(CLIENTE_A, 110);
  await enfileirar();
  const [item] = await reservar();
  await db.query("UPDATE public.notificacoes SET reservada_ate = now() - interval '1 second' WHERE id = $1", [item.id]);
  assert.deepEqual(await reservar(), []);
  const n = await aviso(item.id);
  assert.deepEqual({ status: n.status, motivo: n.motivo }, { status: 'falhou', motivo: 'resultado_incerto' });
  assert.deepEqual(await q('SELECT estado FROM public.whatsapp_mensagens'), [{ estado: 'incerto' }]);
  assert.equal((await confirmacao(ag)).estado, 'nao_enviada');
  // O resultado que chega atrasado não reabre nada
  assert.equal((await concluir(item.id, { status: 'erro', erro: '500' })).ja_concluido, true);
});

test('envio: na hora de enviar, sem autorização ou com o agendamento cancelado nada sai', async () => {
  await consentir(CLIENTE_A);
  await consentir(CLIENTE_B);
  const a = await agendar(CLIENTE_A, 110);
  const b = await agendar(CLIENTE_B, 112);
  await enfileirar();
  await db.query("UPDATE public.consentimentos SET revogado_em = now(), revogado_origem = 'web' WHERE user_id = $1", [CLIENTE_A]);
  // Cancelamento direto, sem o gatilho, para exercitar a reconferência do envio
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER invalidar_confirmacao_presenca');
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [b]);
  await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER invalidar_confirmacao_presenca');

  assert.deepEqual(await reservar(), []);
  const ca = await confirmacao(a);
  const cb = await confirmacao(b);
  assert.deepEqual({ estado: ca.estado, motivo: ca.motivo }, { estado: 'nao_enviada', motivo: 'sem_consentimento' });
  assert.deepEqual({ estado: cb.estado, motivo: cb.motivo }, { estado: 'invalidada', motivo: 'agendamento_cancelado' });
  assert.deepEqual(await q('SELECT 1 FROM public.whatsapp_mensagens'), []);
});

test('resposta SIM pelo botão: confirma; a primeira resposta é a definitiva; repetição é ignorada', async () => {
  const { ag, conf, wamid } = await pedidoEnviado();
  const sim = await responder('in.1', TEL_A, 'botao', { payload: `VB_SIM:${conf.id}`, contexto: wamid });
  assert.equal(sim.resultado, 'confirmada');
  assert.equal(sim.agendamento_id, ag);
  const c = await confirmacao(ag);
  assert.deepEqual({ estado: c.estado, origem: c.resposta_origem }, { estado: 'confirmada', origem: 'botao' });
  assert.ok(c.respondida_em);

  assert.equal((await responder('in.1', TEL_A, 'botao', { payload: `VB_NAO:${conf.id}`, contexto: wamid })).resultado, 'duplicada');
  const depois = await responder('in.2', TEL_A, 'botao', { payload: `VB_NAO:${conf.id}`, contexto: wamid });
  assert.deepEqual({ r: depois.resultado, estado: depois.estado }, { r: 'ja_respondida', estado: 'confirmada' });
  assert.equal((await confirmacao(ag)).estado, 'confirmada');
});

test('resposta NÃO: registra, não cancela o agendamento e avisa o barbeiro que autorizou', async () => {
  await consentir(USUARIO_JOAO);
  const { ag, conf, wamid } = await pedidoEnviado();
  const nao = await responder('in.3', TEL_A, 'botao', { payload: `VB_NAO:${conf.id}`, contexto: wamid });
  assert.equal(nao.resultado, 'recusada');
  assert.equal((await confirmacao(ag)).estado, 'recusada');
  assert.equal((await um('SELECT status FROM public.agendamentos WHERE id = $1', [ag])).status, 'confirmado');

  const avisos = await q("SELECT destinatario_id, canal, dados FROM public.notificacoes WHERE tipo = 'presenca_negada'");
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].destinatario_id, USUARIO_JOAO);
  assert.equal(avisos[0].canal, 'whatsapp');
  assert.equal(avisos[0].dados.cliente_nome, 'Ana');
  const itens = await reservar();
  assert.deepEqual(itens.map((i) => [i.tipo, i.telefone]), [['presenca_negada', '5511912345678']]);
});

test('resposta NÃO: barbeiro sem autorização não recebe WhatsApp (vê só na agenda)', async () => {
  const { conf, wamid } = await pedidoEnviado();
  assert.equal((await responder('in.4', TEL_A, 'botao', { payload: `VB_NAO:${conf.id}`, contexto: wamid })).resultado, 'recusada');
  assert.deepEqual(await q("SELECT 1 FROM public.notificacoes WHERE tipo = 'presenca_negada'"), []);
});

test('botão: de outro número, de outra mensagem ou sem contexto não vale', async () => {
  const { ag, conf, wamid } = await pedidoEnviado();
  const tentativas = [
    ['in.5', TEL_B, { payload: `VB_SIM:${conf.id}`, contexto: wamid }],
    ['in.6', TEL_A, { payload: `VB_SIM:${conf.id}`, contexto: 'wamid.outra' }],
    ['in.7', TEL_A, { payload: `VB_SIM:${conf.id}` }],
    ['in.8', TEL_A, { payload: 'VB_SIM:nao-e-uuid', contexto: wamid }],
    ['in.9', TEL_A, { payload: `SIM:${conf.id}`, contexto: wamid }],
  ];
  for (const [evento, de, extra] of tentativas) {
    assert.equal((await responder(evento, de, 'botao', extra)).resultado, 'invalida', evento);
  }
  assert.equal((await confirmacao(ag)).estado, 'enviada');
});

test('cancelamento: invalida o pedido; a resposta atrasada não é aceita', async () => {
  const { ag, conf, wamid } = await pedidoEnviado();
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [ag]);
  const c = await confirmacao(ag);
  assert.deepEqual({ estado: c.estado, motivo: c.motivo }, { estado: 'invalidada', motivo: 'agendamento_cancelado' });
  assert.equal((await responder('in.10', TEL_A, 'botao', { payload: `VB_SIM:${conf.id}`, contexto: wamid })).resultado, 'agendamento_invalido');
  assert.equal((await responder('in.11', TEL_A, 'texto', { texto: 'sim' })).resultado, 'sem_pedido');
  assert.equal((await confirmacao(ag)).estado, 'invalidada');
});

test('cancelamento antes do envio: o aviso pendente é descartado', async () => {
  await consentir(CLIENTE_A);
  const ag = await agendar(CLIENTE_A, 100);
  await enfileirar();
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [ag]);
  const c = await confirmacao(ag);
  assert.equal(c.estado, 'invalidada');
  const n = await aviso(c.notificacao_id);
  assert.deepEqual({ status: n.status, motivo: n.motivo }, { status: 'ignorada', motivo: 'agendamento_cancelado' });
  assert.deepEqual(await reservar(), []);
});

test('mudança de horário: o pedido antigo deixa de valer e o novo horário ganha outro', async () => {
  const { ag, conf, wamid } = await pedidoEnviado();
  await db.query("UPDATE public.agendamentos SET data_hora = data_hora + interval '10 minutes' WHERE id = $1", [ag]);
  assert.equal((await um('SELECT estado FROM public.confirmacoes_presenca WHERE id = $1', [conf.id])).estado, 'invalidada');
  assert.equal((await responder('in.12', TEL_A, 'botao', { payload: `VB_SIM:${conf.id}`, contexto: wamid })).resultado, 'agendamento_invalido');

  // Mudou agora, com menos de 2 horas: sem novo pedido
  assert.equal(await enfileirar(), 0);
  // Mudança feita com antecedência: sai um pedido novo para o novo horário
  await db.query("UPDATE public.agendamentos SET horario_definido_em = now() - interval '1 day' WHERE id = $1", [ag]);
  assert.equal(await enfileirar(), 1);
  const novos = await q('SELECT estado FROM public.confirmacoes_presenca WHERE agendamento_id = $1 ORDER BY criada_em', [ag]);
  assert.deepEqual(novos.map((x) => x.estado).sort(), ['invalidada', 'pendente']);
});

test('horário já passou: a resposta não é aceita', async () => {
  const { ag, conf, wamid } = await pedidoEnviado();
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER USER');
  await db.query("UPDATE public.agendamentos SET data_hora = now() - interval '1 minute' WHERE id = $1", [ag]);
  await db.query("UPDATE public.confirmacoes_presenca SET data_hora = (SELECT data_hora FROM public.agendamentos WHERE id = $1) WHERE id = $2", [ag, conf.id]);
  await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER USER; ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;');
  assert.equal((await responder('in.13', TEL_A, 'botao', { payload: `VB_SIM:${conf.id}`, contexto: wamid })).resultado, 'agendamento_invalido');
  const c = await um('SELECT estado, motivo FROM public.confirmacoes_presenca WHERE id = $1', [conf.id]);
  assert.deepEqual(c, { estado: 'invalidada', motivo: 'horario_passou' });
});

test('texto: "Sim" e "Não" valem com um único pedido aberto, inclusive com o número sem o 9', async () => {
  const um1 = await pedidoEnviado(CLIENTE_A, { waId: '551187654321' });
  assert.equal((await responder('in.14', TEL_A, 'texto', { texto: 'talvez' })).resultado, 'nao_reconhecida');
  assert.equal((await responder('in.15', '551187654321', 'texto', { texto: ' Não. ' })).resultado, 'recusada');
  const c = await confirmacao(um1.ag);
  assert.deepEqual({ estado: c.estado, origem: c.resposta_origem }, { estado: 'recusada', origem: 'texto' });

  const b = await pedidoEnviado(CLIENTE_B, { waId: TEL_B });
  assert.equal((await responder('in.16', TEL_B, 'texto', { texto: 'SIM' })).resultado, 'confirmada');
  assert.equal((await confirmacao(b.ag)).estado, 'confirmada');
});

test('texto: com dois pedidos abertos é ambíguo, a não ser que responda a uma mensagem', async () => {
  const p1 = await pedidoEnviado(CLIENTE_A, { minutos: 100 });
  const p2 = await pedidoEnviado(CLIENTE_A, { minutos: 115 });
  const r = await responder('in.17', TEL_A, 'texto', { texto: 'sim' });
  assert.deepEqual({ r: r.resultado, abertos: r.abertos }, { r: 'ambigua', abertos: 2 });
  assert.equal((await confirmacao(p1.ag)).estado, 'enviada');
  assert.equal((await responder('in.18', TEL_A, 'texto', { texto: 'sim', contexto: p2.wamid })).resultado, 'confirmada');
  assert.equal((await confirmacao(p2.ag)).estado, 'confirmada');
  assert.equal((await confirmacao(p1.ag)).estado, 'enviada');
});

test('descadastro: PARAR revoga a autorização e nenhum pedido novo é gerado', async () => {
  await pedidoEnviado();
  const r = await responder('in.19', TEL_A, 'texto', { texto: 'Parar' });
  assert.deepEqual(r, { resultado: 'descadastro', revogados: 1 });
  const k = await um("SELECT revogado_origem FROM public.consentimentos WHERE user_id = $1", [CLIENTE_A]);
  assert.equal(k.revogado_origem, 'whatsapp');
  await agendar(CLIENTE_A, 105);
  assert.equal(await enfileirar(), 0);
});

test('estado da entrega: só avança; falha da Meta marca o pedido como não enviado', async () => {
  const { ag, wamid } = await pedidoEnviado();
  const status = async (s, erro = null) => (await um('SELECT public.whatsapp_registrar_status($1, $2, $3) AS r', [wamid, s, erro])).r;
  assert.equal(await status('entregue'), 'entregue');
  assert.equal(await status('enviado'), 'ignorado');
  assert.equal(await status('lido'), 'lido');
  assert.equal(await status('falhou', '131026'), 'ignorado');
  assert.equal((await um('SELECT public.whatsapp_registrar_status($1, $2) AS r', ['wamid.nao-existe', 'lido'])).r, 'desconhecida');
  assert.equal((await confirmacao(ag)).estado, 'enviada');

  const outro = await pedidoEnviado(CLIENTE_B, { waId: TEL_B });
  assert.equal((await um('SELECT public.whatsapp_registrar_status($1, $2, $3) AS r', [outro.wamid, 'falhou', '131026'])).r, 'falhou');
  const c = await confirmacao(outro.ag);
  assert.deepEqual({ estado: c.estado, motivo: c.motivo }, { estado: 'nao_enviada', motivo: 'meta: 131026' });
  assert.equal((await aviso(outro.item.id)).status, 'falhou');
});

test('push: a reserva do push não pega avisos do WhatsApp', async () => {
  await consentir(CLIENTE_A);
  await agendar(CLIENTE_A, 100);
  await enfileirar();
  assert.deepEqual((await um('SELECT public.reservar_notificacoes(50) AS r')).r, []);
  assert.equal((await q("SELECT 1 FROM public.notificacoes WHERE canal = 'whatsapp' AND status = 'pendente'")).length, 1);
});

test('rotina de cada minuto: também gera os pedidos de confirmação', async () => {
  await consentir(CLIENTE_A);
  await agendar(CLIENTE_A, 100);
  const { r } = await um('SELECT public.rotina_notificacoes() AS r');
  assert.equal(r.confirmacoes, 1);
  assert.equal(r.pendentes, true);
});

test('situação para a agenda: barbeiro, cliente e admin veem; outra pessoa não', async () => {
  const p = await pedidoEnviado();
  const ver = async (uid) => {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('test.uid', $1, false)", [uid]);
    await db.exec('SET ROLE authenticated');
    try {
      return await q('SELECT agendamento_id, situacao FROM public.presenca_dos_agendamentos($1)', [[p.ag]]);
    } finally {
      await db.exec('RESET ROLE');
    }
  };
  for (const uid of [USUARIO_JOAO, CLIENTE_A, ADMIN]) {
    assert.deepEqual(await ver(uid), [{ agendamento_id: p.ag, situacao: 'sem_resposta' }]);
  }
  assert.deepEqual(await ver(CLIENTE_B), []);
  await responder('in.20', TEL_A, 'botao', { payload: `VB_NAO:${p.conf.id}`, contexto: p.wamid });
  assert.deepEqual(await ver(USUARIO_JOAO), [{ agendamento_id: p.ag, situacao: 'recusada' }]);
});

test('acesso: usuário comum não lê as tabelas nem executa as funções do backend', async () => {
  await db.query("SELECT set_config('test.uid', $1, false)", [CLIENTE_A]);
  await db.exec('SET ROLE authenticated');
  try {
    for (const sql of [
      'SELECT * FROM public.confirmacoes_presenca',
      'SELECT * FROM public.whatsapp_mensagens',
      'SELECT * FROM public.whatsapp_eventos',
      'SELECT public.reservar_whatsapp(1)',
      "SELECT public.concluir_envio_whatsapp(gen_random_uuid(), '{}'::jsonb)",
      "SELECT public.whatsapp_registrar_resposta('e', '5511987654321', 'texto', NULL, NULL, 'sim')",
      "SELECT public.whatsapp_registrar_status('w', 'lido')",
      'SELECT public.enfileirar_confirmacoes_presenca()',
      'SELECT public.whatsapp_consentiu(gen_random_uuid())',
    ]) {
      assert.equal((await recusa(db.query(sql))).code, '42501', sql);
    }
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('consentimento: aceita a nova finalidade e a revogação pelo WhatsApp; outras continuam recusadas', async () => {
  await consentir(CLIENTE_A);
  await db.query("UPDATE public.consentimentos SET revogado_em = now(), revogado_origem = 'whatsapp' WHERE user_id = $1", [CLIENTE_A]);
  const r = await recusa(db.query(
    "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'marketing', 'v1', 'web')", [CLIENTE_A]));
  assert.equal(r.code, '23514');
});

test('migration: sem as migrations 21 e 22 para com mensagem clara e não cria nada', async () => {
  const semFila = await criarBanco({ migracoes: MIGRATIONS_AGENDA.filter((m) => !/_notificacoes/.test(m)) });
  const r = await recusa(semFila.exec(migration('20261113000025_whatsapp_confirmacao_presenca.sql')));
  assert.match(r.message, /Rode antes as migrations 20261109000021 e 20261109000022/);
  await semFila.exec('ROLLBACK');
  const { rows } = await semFila.query(
    "SELECT to_regclass('public.confirmacoes_presenca') IS NULL AS sem_tabela, to_regprocedure('public.reservar_whatsapp(integer)') IS NULL AS sem_funcao");
  assert.deepEqual(rows[0], { sem_tabela: true, sem_funcao: true });
  const coluna = await semFila.query(
    "SELECT 1 FROM information_schema.columns WHERE table_name = 'agendamentos' AND column_name = 'horario_definido_em'");
  assert.equal(coluna.rows.length, 0);
});
