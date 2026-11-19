// Cancelamento pelo WhatsApp com confirmacao dupla (migration 26) direto no
// banco (PGlite, PostgreSQL embutido em processo, UMA conexao): o primeiro NAO
// nao cancela, so a segunda confirmacao cancela, e so o agendamento certo.
// Nenhum servico externo e chamado. Concorrencia de verdade (duas conexoes ao
// mesmo tempo) NAO e testada aqui: o PGlite executa um comando por vez.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  criarBanco, recusa, migration, MIGRATIONS_AGENDA, MIGRATIONS_WHATSAPP, MIGRATIONS_WHATSAPP_27, MIGRATIONS_WHATSAPP_26,
  JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, ADMIN, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

const VERSAO = '2026-11-16';
const TEL = { [CLIENTE_A]: '5511987654321', [CLIENTE_B]: '5521998765432' };
const TEL_JOAO = '5511912345678';
const semNove = (t) => t.replace(/^(55\d\d)9(\d{8})$/, '$1$2');
const ROLLBACK = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'rollbacks', '20261116000026_rollback.sql'), 'utf8');
const M26 = '20261116000026_whatsapp_cancelamento_confirmado.sql';
const PERMISSOES = `
  GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated, anon;`;
const PERFIS = `
  INSERT INTO public.profiles (user_id, nome, telefone) VALUES
    ('${CLIENTE_A}', 'Ana Paula Souza', '11987654321'),
    ('${CLIENTE_B}', 'Bruno Lima', '(21) 99876-5432'),
    ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
  -- Os horarios dos testes sao relativos a agora: fora da grade da barbearia
  ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;`;

let db;
let relogio = 0;
let seq = 0;

before(async () => {
  db = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26, antesDasMigrations: PERMISSOES });
  await db.exec(PERFIS);
});

beforeEach(async () => {
  await db.exec(`
    RESET ROLE;
    SELECT set_config('test.uid', '', false);
    TRUNCATE public.lancamentos_financeiros, public.pagamentos CASCADE;
    DELETE FROM public.agendamentos;
    DELETE FROM public.notificacoes;
    DELETE FROM public.whatsapp_eventos;
    DELETE FROM public.consentimentos;
  `);
});

const q = async (sql, params) => (await db.query(sql, params)).rows;
const um = async (sql, params) => (await q(sql, params))[0];
const consentir = (uid, versao = VERSAO) => db.query(
  "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', $2, 'web')", [uid, versao]);

// Agendamento daqui a `minutos`, marcado com antecedencia
async function agendar(cliente, minutos) {
  relogio = (relogio + 1) % 59;
  const { id } = await um(
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora)
     VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4) + make_interval(secs => $5)) RETURNING id`,
    [cliente, JOAO, CORTE_30, minutos, relogio]);
  await db.query("UPDATE public.agendamentos SET horario_definido_em = now() - interval '1 day' WHERE id = $1", [id]);
  return id;
}
const enfileirar = async () => (await um('SELECT public.enfileirar_confirmacoes_presenca() AS n')).n;
const reservar = async () => (await um('SELECT public.reservar_whatsapp(20) AS r')).r;
const concluir = async (id, resultado) => (await um('SELECT public.concluir_envio_whatsapp($1, $2) AS r', [id, JSON.stringify(resultado)])).r;
const responder = async (evento, de, tipo, { payload = null, contexto = null, texto = null } = {}) => (await um(
  'SELECT public.whatsapp_registrar_resposta($1, $2, $3, $4, $5, $6) AS r', [evento, de, tipo, payload, contexto, texto])).r;
const statusDo = async (id) => (await um('SELECT status::text AS s FROM public.agendamentos WHERE id = $1', [id])).s;
const confirmacao = (ag) => um('SELECT * FROM public.confirmacoes_presenca WHERE agendamento_id = $1 ORDER BY criada_em DESC LIMIT 1', [ag]);
const solicitacao = (ag) => um('SELECT * FROM public.solicitacoes_cancelamento WHERE agendamento_id = $1 ORDER BY criada_em DESC LIMIT 1', [ag]);
const avisos = (tipo) => q('SELECT * FROM public.notificacoes WHERE tipo = $1 ORDER BY criada_em', [tipo]);
const evento = () => `in.${++seq}`;

// Confirmacao de presenca ja aceita pela Meta (a Meta devolve o numero sem o 9)
async function pedidoEnviado(cliente = CLIENTE_A, { minutos = 100 } = {}) {
  await consentir(cliente).catch(() => {});
  const id = await agendar(cliente, minutos);
  await enfileirar();
  const item = (await reservar()).find((i) => i.dados.agendamento_id === id);
  assert.ok(item, 'a confirmação de presença deveria ter sido reservada');
  const wamid = `wamid.p${++seq}`;
  await concluir(item.id, { status: 'aceito', wamid, wa_id: semNove(TEL[cliente]) });
  return { id, cliente, tel: TEL[cliente], conf: await confirmacao(id), wamid };
}
const tocarNao = (p, ev = evento()) => responder(ev, p.tel, 'botao', { payload: `VB_NAO:${p.conf.id}`, contexto: p.wamid });
const tocarSim = (p, ev = evento()) => responder(ev, p.tel, 'botao', { payload: `VB_SIM:${p.conf.id}`, contexto: p.wamid });

// NAO + segunda mensagem aceita pela Meta
async function segundaEnviada(p) {
  assert.equal((await tocarNao(p)).resultado, 'cancelamento_solicitado');
  const item = (await reservar()).find((i) => i.tipo === 'confirmacao_cancelamento' && i.dados.agendamento_id === p.id);
  assert.ok(item, 'a segunda mensagem deveria ter sido reservada');
  const wamid2 = `wamid.c${++seq}`;
  assert.deepEqual(await concluir(item.id, { status: 'aceito', wamid: wamid2, wa_id: semNove(p.tel) }), { status: 'enviada' });
  return { ...p, sol: await solicitacao(p.id), wamid2, item };
}
const tocarCancelar = (s, ev = evento(), de = s.tel) =>
  responder(ev, de, 'botao', { payload: `VB_CANCELAR:${s.sol.id}`, contexto: s.wamid2 });
const tocarManter = (s, ev = evento(), de = s.tel) =>
  responder(ev, de, 'botao', { payload: `VB_MANTER:${s.sol.id}`, contexto: s.wamid2 });

// Situacao mostrada nas telas, como o usuario `uid` (RLS e permissoes reais)
async function situacao(uid, ids) {
  await db.query("SELECT set_config('test.uid', $1, false)", [uid]);
  await db.exec('SET ROLE authenticated');
  try {
    return await q('SELECT agendamento_id, situacao FROM public.presenca_dos_agendamentos($1) ORDER BY agendamento_id', [ids]);
  } finally {
    await db.exec('RESET ROLE');
    await db.query("SELECT set_config('test.uid', '', false)");
  }
}
const situacaoDe = async (id, uid = USUARIO_JOAO) => (await situacao(uid, [id]))[0]?.situacao ?? null;

// Prazo da solicitacao vencido (o gatilho de historico nao deixa mudar o
// prazo; so neste ajuste de teste ele fica desligado)
async function vencerPrazo(solicitacaoId) {
  await db.exec('ALTER TABLE public.solicitacoes_cancelamento DISABLE TRIGGER solicitacao_cancelamento_transicao');
  try {
    await db.query("UPDATE public.solicitacoes_cancelamento SET expira_em = now() - interval '1 second' WHERE id = $1", [solicitacaoId]);
  } finally {
    await db.exec('ALTER TABLE public.solicitacoes_cancelamento ENABLE TRIGGER solicitacao_cancelamento_transicao');
  }
}

// ---------------------------------------------------------------
// Fluxo principal
// ---------------------------------------------------------------
test('01. SIM na primeira mensagem confirma a presença e não abre solicitação', async () => {
  const p = await pedidoEnviado();
  const r = await tocarSim(p);
  assert.deepEqual([r.resultado, r.agendamento_id], ['confirmada', p.id]);
  assert.equal((await confirmacao(p.id)).estado, 'confirmada');
  assert.equal(await statusDo(p.id), 'confirmado');
  assert.equal(await solicitacao(p.id), undefined);
  assert.deepEqual(await avisos('confirmacao_cancelamento'), []);
  assert.equal(await situacaoDe(p.id), 'confirmada');
});

test('02. NÃO abre a solicitação e gera a segunda mensagem para o cliente, ligada a este agendamento', async () => {
  const p = await pedidoEnviado();
  const r = await tocarNao(p);
  assert.equal(r.resultado, 'cancelamento_solicitado');
  const s = await solicitacao(p.id);
  assert.equal(r.solicitacao_id, s.id);
  assert.deepEqual(
    [s.estado, s.confirmacao_id, s.cliente_id, s.origem_pedido, s.cancelamento_origem, s.cancelado_em],
    ['pendente', p.conf.id, CLIENTE_A, 'botao', null, null]);
  assert.equal(s.expira_em.getTime(), s.data_hora.getTime(), 'vale até o horário do atendimento');

  const [n] = await avisos('confirmacao_cancelamento');
  assert.deepEqual([n.canal, n.destinatario_id, n.agendamento_id, n.id], ['whatsapp', CLIENTE_A, p.id, s.notificacao_id]);
  assert.deepEqual({ sol: n.dados.solicitacao_id, servico: n.dados.servico, barbeiro: n.dados.barbeiro_nome },
    { sol: s.id, servico: 'Corte', barbeiro: 'João' });

  // Reserva devolve a segunda mensagem com o telefone; aceita, a solicitação fica aguardando
  const itens = await reservar();
  assert.deepEqual(itens.map((i) => [i.tipo, i.telefone]), [['confirmacao_cancelamento', TEL[CLIENTE_A]]]);
  await concluir(itens[0].id, { status: 'aceito', wamid: 'wamid.seg', wa_id: semNove(TEL[CLIENTE_A]) });
  const depois = await solicitacao(p.id);
  assert.equal(depois.estado, 'aguardando');
  assert.ok(depois.enviada_em);
});

test('03. o primeiro NÃO não cancela nada', async () => {
  const p = await pedidoEnviado();
  await tocarNao(p);
  assert.equal(await statusDo(p.id), 'confirmado');
  assert.equal((await confirmacao(p.id)).estado, 'recusada');
  assert.equal(await situacaoDe(p.id), 'cancelamento_pendente');
  // Rodar a rotina e a fila nao muda o agendamento
  await um('SELECT public.rotina_notificacoes() AS r');
  await reservar();
  assert.equal(await statusDo(p.id), 'confirmado');
});

test('04. o primeiro NÃO não libera o horário', async () => {
  const p = await pedidoEnviado();
  const outro = () => db.query(
    'INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora) SELECT $1, barbeiro_id, servico_id, data_hora FROM public.agendamentos WHERE id = $2',
    [CLIENTE_B, p.id]);
  await tocarNao(p);
  assert.equal((await recusa(outro())).code, '23505', 'pendente: horário continua ocupado');
  const itens = await reservar();
  await concluir(itens[0].id, { status: 'aceito', wamid: 'wamid.x4', wa_id: semNove(p.tel) });
  assert.equal((await solicitacao(p.id)).estado, 'aguardando');
  assert.equal((await recusa(outro())).code, '23505', 'aguardando: horário continua ocupado');
});

test('05. SIM, CANCELAR na segunda mensagem cancela este agendamento, com origem e hora registradas', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  const r = await tocarCancelar(s, 'in.cancela5');
  assert.deepEqual([r.resultado, r.agendamento_id], ['cancelamento_confirmado', s.id]);
  assert.equal(await statusDo(s.id), 'cancelado');
  const sol = await solicitacao(s.id);
  assert.deepEqual([sol.estado, sol.cancelamento_origem, sol.evento_resposta], ['confirmada', 'whatsapp_resposta_negativa', 'in.cancela5']);
  assert.ok(sol.cancelado_em && sol.respondida_em);
  // Barbeiro, cliente e admin veem "cancelado pelo WhatsApp"; outra pessoa nao ve nada
  for (const uid of [USUARIO_JOAO, CLIENTE_A, ADMIN]) assert.equal(await situacaoDe(s.id, uid), 'cancelada_whatsapp', uid);
  assert.deepEqual(await situacao(CLIENTE_B, [s.id]), []);
});

test('06. NÃO, MANTER: o agendamento continua e a desistência fica registrada', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  assert.equal((await tocarManter(s)).resultado, 'cancelamento_desistido');
  assert.equal(await statusDo(s.id), 'confirmado');
  const sol = await solicitacao(s.id);
  assert.deepEqual([sol.estado, sol.cancelamento_origem], ['desistiu', null]);
  assert.ok(sol.respondida_em);
  assert.equal(await situacaoDe(s.id), 'cancelamento_desistido');
});

test('07. sem resposta à segunda mensagem: nada é cancelado, nem automaticamente', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  await vencerPrazo(s.sol.id);
  // A fila marca como expirada; a rotina de cada minuto e a fila nunca cancelam
  await reservar();
  await um('SELECT public.rotina_notificacoes() AS r');
  await reservar();
  assert.equal((await solicitacao(s.id)).estado, 'expirada');
  assert.equal(await statusDo(s.id), 'confirmado');
  assert.equal(await situacaoDe(s.id), 'cancelamento_nao_confirmado');
  assert.deepEqual(await avisos('cancelamento_whatsapp'), []);
});

test('08. dois toques em SIM, CANCELAR: um cancelamento só; o segundo só informa', async () => {
  await consentir(USUARIO_JOAO);
  const s = await segundaEnviada(await pedidoEnviado());
  assert.equal((await tocarCancelar(s)).resultado, 'cancelamento_confirmado');
  const segundo = await tocarCancelar(s);
  assert.deepEqual([segundo.resultado, segundo.estado], ['solicitacao_encerrada', 'confirmada']);
  assert.equal(await statusDo(s.id), 'cancelado');
  assert.equal((await avisos('cancelamento_whatsapp')).length, 1, 'o barbeiro é avisado uma vez');
  assert.equal((await q('SELECT 1 FROM public.solicitacoes_cancelamento')).length, 1);
});

test('09. botões antigos não cancelam nada', async () => {
  // a) depois de desistir, o SIM, CANCELAR da mesma mensagem
  const s = await segundaEnviada(await pedidoEnviado());
  await tocarManter(s);
  const r = await tocarCancelar(s);
  assert.deepEqual([r.resultado, r.estado], ['solicitacao_encerrada', 'desistiu']);
  assert.equal(await statusDo(s.id), 'confirmado');
  // b) os botões da primeira mensagem, de novo: não abrem outra solicitação
  const nao = await tocarNao(s);
  assert.deepEqual([nao.resultado, nao.estado, nao.cancelamento], ['ja_respondida', 'recusada', 'desistiu']);
  assert.equal((await tocarSim(s)).resultado, 'ja_respondida');
  assert.equal((await avisos('confirmacao_cancelamento')).length, 1);

  // c) o agendamento mudou de horário depois do pedido: o botão antigo não vale
  const t = await segundaEnviada(await pedidoEnviado(CLIENTE_B, { minutos: 110 }));
  await db.query("UPDATE public.agendamentos SET data_hora = data_hora + interval '15 minutes' WHERE id = $1", [t.id]);
  assert.deepEqual([(await solicitacao(t.id)).estado, (await solicitacao(t.id)).motivo], ['invalidada', 'horario_alterado']);
  const c = await tocarCancelar(t);
  assert.deepEqual([c.resultado, c.estado], ['solicitacao_encerrada', 'invalidada']);
  assert.equal(await statusDo(t.id), 'confirmado');

  // d) o botão de uma solicitação com o contexto (mensagem) de outra
  const u = await segundaEnviada(await pedidoEnviado(CLIENTE_A, { minutos: 115 }));
  const cruzado = await responder(evento(), u.tel, 'botao', { payload: `VB_CANCELAR:${u.sol.id}`, contexto: s.wamid2 });
  assert.deepEqual([cruzado.resultado, cruzado.etapa], ['invalida', 'cancelamento']);
  assert.equal(await statusDo(u.id), 'confirmado');
});

test('10. botão depois do prazo: expirada, sem cancelar', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  await vencerPrazo(s.sol.id);
  assert.equal((await tocarCancelar(s)).resultado, 'cancelamento_expirado');
  assert.equal((await solicitacao(s.id)).estado, 'expirada');
  assert.equal(await statusDo(s.id), 'confirmado');
  // Outro toque depois disso só informa
  const de_novo = await tocarCancelar(s);
  assert.deepEqual([de_novo.resultado, de_novo.estado], ['solicitacao_encerrada', 'expirada']);
});

test('11. cancelado pelo aplicativo enquanto a confirmação estava pendente', async () => {
  // Já com a segunda mensagem enviada
  const s = await segundaEnviada(await pedidoEnviado());
  // O mesmo UPDATE do app (só muda se ainda não estiver cancelado)
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1 AND status <> 'cancelado'", [s.id]);
  assert.deepEqual([(await solicitacao(s.id)).estado, (await solicitacao(s.id)).motivo], ['invalidada', 'agendamento_cancelado']);
  for (const tocar of [tocarCancelar, tocarManter]) {
    const r = await tocar(s);
    assert.deepEqual([r.resultado, r.estado], ['solicitacao_encerrada', 'invalidada']);
  }
  assert.deepEqual(await avisos('cancelamento_whatsapp'), [], 'não foi cancelado pelo WhatsApp');
  assert.equal(await situacaoDe(s.id), 'recusada');

  // Antes de a segunda mensagem sair: ela é descartada
  const p = await pedidoEnviado(CLIENTE_B, { minutos: 110 });
  await tocarNao(p);
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1 AND status <> 'cancelado'", [p.id]);
  assert.equal((await solicitacao(p.id)).estado, 'invalidada');
  const n = await um('SELECT status, motivo FROM public.notificacoes WHERE id = $1', [(await solicitacao(p.id)).notificacao_id]);
  assert.deepEqual(n, { status: 'ignorada', motivo: 'agendamento_cancelado' });
  assert.deepEqual(await reservar(), []);
});

test('12. agendamento concluído: a solicitação deixa de valer e nada muda', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  await db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [s.id]);
  assert.deepEqual([(await solicitacao(s.id)).estado, (await solicitacao(s.id)).motivo], ['invalidada', 'agendamento_concluido']);
  const r = await tocarCancelar(s);
  assert.deepEqual([r.resultado, r.estado], ['solicitacao_encerrada', 'invalidada']);
  assert.equal(await statusDo(s.id), 'concluido');
});

test('12b. mesmo se o gatilho de invalidação falhar, a reconferência sob a trava impede cancelar', async () => {
  // O gatilho so registra erro (nunca impede o app de cancelar). Sem ele, a
  // solicitacao fica "aguardando", mas o toque reconfere o agendamento.
  const s = await segundaEnviada(await pedidoEnviado());
  const t = await segundaEnviada(await pedidoEnviado(CLIENTE_B, { minutos: 110 }));
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER invalidar_confirmacao_presenca');
  try {
    await db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [s.id]);
    await db.query("UPDATE public.agendamentos SET data_hora = data_hora + interval '20 minutes' WHERE id = $1", [t.id]);
  } finally {
    await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER invalidar_confirmacao_presenca');
  }
  assert.deepEqual([(await solicitacao(s.id)).estado, (await solicitacao(t.id)).estado], ['aguardando', 'aguardando']);
  assert.equal((await tocarCancelar(s)).resultado, 'agendamento_invalido');
  assert.equal((await tocarCancelar(t)).resultado, 'agendamento_invalido');
  assert.deepEqual([await statusDo(s.id), await statusDo(t.id)], ['concluido', 'confirmado']);
  assert.deepEqual([(await solicitacao(s.id)).motivo, (await solicitacao(t.id)).motivo], ['agendamento_concluido', 'horario_alterado']);
});

test('12c. a segunda mensagem só sai com a solicitação ainda pendente (conferido na hora do envio)', async () => {
  const p = await pedidoEnviado();
  await tocarNao(p);
  // Encerrada por outro caminho (ex.: correção manual) com o aviso ainda na fila
  await db.query("UPDATE public.solicitacoes_cancelamento SET estado = 'invalidada', motivo = 'teste' WHERE agendamento_id = $1", [p.id]);
  assert.deepEqual(await reservar(), []);
  const n = await um('SELECT status, motivo FROM public.notificacoes WHERE id = $1', [(await solicitacao(p.id)).notificacao_id]);
  assert.deepEqual(n, { status: 'ignorada', motivo: 'solicitacao_encerrada' });
  assert.equal(await statusDo(p.id), 'confirmado');
});

test('13. cliente com vários agendamentos: só o da solicitação é cancelado', async () => {
  const a1 = await pedidoEnviado(CLIENTE_A, { minutos: 100 });
  const a2 = await pedidoEnviado(CLIENTE_A, { minutos: 115 });
  const s1 = await segundaEnviada(a1);
  // Texto "sim" com uma solicitação aguardando: não confirma a presença do outro, só orienta
  assert.equal((await responder(evento(), a2.tel, 'texto', { texto: 'sim' })).resultado, 'usar_botao');
  assert.equal((await confirmacao(a2.id)).estado, 'enviada');
  // O botão de cancelar da solicitação 1 com a mensagem do agendamento 2: não vale
  const cruzado = await responder(evento(), a1.tel, 'botao', { payload: `VB_CANCELAR:${s1.sol.id}`, contexto: a2.wamid });
  assert.deepEqual([cruzado.resultado, cruzado.etapa], ['invalida', 'cancelamento']);

  assert.equal((await tocarCancelar(s1)).resultado, 'cancelamento_confirmado');
  assert.deepEqual([await statusDo(a1.id), await statusDo(a2.id)], ['cancelado', 'confirmado']);
  assert.equal(await solicitacao(a2.id), undefined);
  // O segundo continua com o próprio fluxo
  assert.equal((await tocarSim(a2)).resultado, 'confirmada');
});

test('14. respostas quase simultâneas (em sequência no PGlite): só a primeira vale', async () => {
  // SIM, CANCELAR e NÃO, MANTER tocados um logo depois do outro
  const s = await segundaEnviada(await pedidoEnviado());
  assert.equal((await tocarManter(s)).resultado, 'cancelamento_desistido');
  assert.equal((await tocarCancelar(s)).resultado, 'solicitacao_encerrada');
  assert.equal(await statusDo(s.id), 'confirmado');

  // App primeiro, WhatsApp depois
  const t = await segundaEnviada(await pedidoEnviado(CLIENTE_B, { minutos: 110 }));
  assert.equal((await q("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1 AND status <> 'cancelado' RETURNING id", [t.id])).length, 1);
  assert.equal((await tocarCancelar(t)).resultado, 'solicitacao_encerrada');

  // WhatsApp primeiro, app depois: o app não encontra o que cancelar (e não dá erro)
  const u = await segundaEnviada(await pedidoEnviado(CLIENTE_A, { minutos: 115 }));
  assert.equal((await tocarCancelar(u)).resultado, 'cancelamento_confirmado');
  assert.equal((await q("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1 AND status <> 'cancelado' RETURNING id", [u.id])).length, 0);
  assert.equal((await solicitacao(u.id)).estado, 'confirmada');
});

test('15. a Meta entrega o mesmo evento duas vezes: processado uma vez só', async () => {
  await consentir(USUARIO_JOAO);
  const p = await pedidoEnviado();
  assert.equal((await tocarNao(p, 'in.dup.nao')).resultado, 'cancelamento_solicitado');
  assert.equal((await tocarNao(p, 'in.dup.nao')).resultado, 'duplicada');
  assert.equal((await q('SELECT 1 FROM public.solicitacoes_cancelamento')).length, 1);
  assert.equal((await avisos('confirmacao_cancelamento')).length, 1);

  const item = (await reservar())[0];
  await concluir(item.id, { status: 'aceito', wamid: 'wamid.dup', wa_id: semNove(p.tel) });
  const s = { ...p, sol: await solicitacao(p.id), wamid2: 'wamid.dup' };
  assert.equal((await tocarCancelar(s, 'in.dup.sim')).resultado, 'cancelamento_confirmado');
  assert.equal((await tocarCancelar(s, 'in.dup.sim')).resultado, 'duplicada');
  assert.equal((await avisos('cancelamento_whatsapp')).length, 1);
});

// A segunda mensagem do agendamento `ag` entre os itens reservados agora
const segundaReservada = async (ag) => (await reservar())
  .find((i) => i.tipo === 'confirmacao_cancelamento' && i.dados.agendamento_id === ag);

test('16. falha no envio da segunda mensagem: o agendamento continua ativo', async () => {
  // Recusa definitiva da Meta
  const p = await pedidoEnviado();
  await tocarNao(p);
  const item = await segundaReservada(p.id);
  assert.equal((await concluir(item.id, { status: 'recusado', erro: 'janela_fechada:131047' })).status, 'falhou');
  const s = await solicitacao(p.id);
  assert.deepEqual([s.estado, s.motivo], ['nao_enviada', 'janela_fechada:131047']);
  assert.equal(await statusDo(p.id), 'confirmado');
  assert.equal(await situacaoDe(p.id), 'cancelamento_nao_confirmado');
  const de_novo = await tocarNao(p);
  assert.deepEqual([de_novo.resultado, de_novo.cancelamento], ['ja_respondida', 'nao_enviada']);

  // Erro temporário: tenta de novo e, aceita, segue normalmente
  const t = await pedidoEnviado(CLIENTE_B, { minutos: 110 });
  await tocarNao(t);
  const i2 = await segundaReservada(t.id);
  assert.equal((await concluir(i2.id, { status: 'erro', erro: 'temporario:130429' })).status, 'pendente');
  assert.equal((await solicitacao(t.id)).estado, 'pendente');
  await db.query('UPDATE public.notificacoes SET proxima_tentativa = now() WHERE id = $1', [i2.id]);
  const i3 = await segundaReservada(t.id);
  assert.equal(i3.tentativas, 2);
  await concluir(i3.id, { status: 'aceito', wamid: 'wamid.t2', wa_id: semNove(t.tel) });
  assert.equal((await solicitacao(t.id)).estado, 'aguardando');
  // A Meta informa depois que não entregou: o cliente não recebeu os botões
  assert.equal((await um("SELECT public.whatsapp_registrar_status('wamid.t2', 'falhou', 'destinatario:131026') AS r")).r, 'falhou');
  assert.equal((await solicitacao(t.id)).estado, 'nao_enviada');
  assert.equal(await statusDo(t.id), 'confirmado');

  // Resultado incerto: nunca é reenviado
  const u = await pedidoEnviado(CLIENTE_A, { minutos: 115 });
  await tocarNao(u);
  const i4 = await segundaReservada(u.id);
  await concluir(i4.id, { status: 'incerto', erro: 'incerto:timeout' });
  assert.equal((await solicitacao(u.id)).estado, 'nao_enviada');
  assert.equal(await segundaReservada(u.id), undefined);
  // Os dois agendamentos com falha definitiva continuam confirmados
  assert.deepEqual([await statusDo(p.id), await statusDo(t.id), await statusDo(u.id)], ['confirmado', 'confirmado', 'confirmado']);
});

test('17. falha ao gravar no banco: nada fica pela metade e a Meta pode entregar de novo', async () => {
  await consentir(USUARIO_JOAO);
  const s = await segundaEnviada(await pedidoEnviado());
  await db.exec(`
    CREATE FUNCTION public.falha_simulada() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$;
    CREATE TRIGGER falha_simulada BEFORE UPDATE OF status ON public.agendamentos
      FOR EACH ROW WHEN (NEW.status = 'cancelado') EXECUTE FUNCTION public.falha_simulada();`);
  try {
    assert.match((await recusa(tocarCancelar(s, 'in.falha'))).message, /falha simulada/);
  } finally {
    await db.exec('DROP TRIGGER falha_simulada ON public.agendamentos; DROP FUNCTION public.falha_simulada();');
  }
  assert.equal(await statusDo(s.id), 'confirmado');
  assert.equal((await solicitacao(s.id)).estado, 'aguardando');
  assert.deepEqual(await q("SELECT 1 FROM public.whatsapp_eventos WHERE chave = 'msg:in.falha'"), [], 'o evento não fica marcado');
  assert.deepEqual(await avisos('cancelamento_whatsapp'), []);
  // A Meta entrega de novo o mesmo evento: agora vale
  assert.equal((await tocarCancelar(s, 'in.falha')).resultado, 'cancelamento_confirmado');
  assert.equal(await statusDo(s.id), 'cancelado');
});

test('17b. toque na segunda mensagem antes de o envio ser gravado: erro temporário, sem efeito', async () => {
  const p = await pedidoEnviado();
  await tocarNao(p);
  const [item] = await reservar();
  const sol = await solicitacao(p.id);
  const tocar = () => responder('in.cedo', p.tel, 'botao', { payload: `VB_CANCELAR:${sol.id}`, contexto: 'wamid.ainda' });
  const erro = await recusa(tocar());
  assert.deepEqual([erro.code, erro.detail], ['PT503', 'ENVIO_SEM_REGISTRO']);
  assert.equal(await statusDo(p.id), 'confirmado');
  await concluir(item.id, { status: 'aceito', wamid: 'wamid.ainda', wa_id: semNove(p.tel) });
  assert.equal((await tocar()).resultado, 'cancelamento_confirmado');
});

test('18. cancelamento confirmado avisa o barbeiro que autorizou (e só ele)', async () => {
  await consentir(USUARIO_JOAO);
  const s = await segundaEnviada(await pedidoEnviado());
  await tocarCancelar(s);
  const [n] = await avisos('cancelamento_whatsapp');
  assert.deepEqual([n.canal, n.destinatario_id, n.ator_id, n.agendamento_id], ['whatsapp', USUARIO_JOAO, CLIENTE_A, s.id]);
  assert.deepEqual([n.dados.cliente_nome, n.dados.servico, n.dados.solicitacao_id], ['Ana', 'Corte', s.sol.id]);
  // Sai mesmo com o agendamento cancelado (é justamente o aviso do cancelamento)
  const itens = await reservar();
  assert.deepEqual(itens.map((i) => [i.tipo, i.telefone]), [['cancelamento_whatsapp', TEL_JOAO]]);
  // Na agenda: cancelado pelo WhatsApp, com a hora do cancelamento
  const [linha] = await (async () => {
    await db.query("SELECT set_config('test.uid', $1, false)", [USUARIO_JOAO]);
    await db.exec('SET ROLE authenticated');
    try {
      return await q('SELECT situacao, respondida_em FROM public.presenca_dos_agendamentos($1)', [[s.id]]);
    } finally {
      await db.exec('RESET ROLE');
    }
  })();
  assert.equal(linha.situacao, 'cancelada_whatsapp');
  assert.equal(linha.respondida_em.getTime(), (await solicitacao(s.id)).cancelado_em.getTime());
});

test('18b. barbeiro sem autorização (ou com a do aviso anterior) não recebe WhatsApp: vê só na agenda', async () => {
  await consentir(USUARIO_JOAO, '2026-11-13');
  const s = await segundaEnviada(await pedidoEnviado());
  assert.equal((await tocarCancelar(s)).resultado, 'cancelamento_confirmado');
  assert.deepEqual(await avisos('cancelamento_whatsapp'), []);
  assert.equal(await situacaoDe(s.id), 'cancelada_whatsapp');
});

test('19. horário liberado: antes da confirmação ninguém agenda; depois, outro cliente consegue', async () => {
  // Minutos a partir de agora em que o atendimento cabe no mesmo dia (expediente)
  let minutos = 61;
  while ((await um(`SELECT ((date_trunc('minute', now()) + make_interval(mins => $1)) AT TIME ZONE 'America/Sao_Paulo')::date
                        <> ((date_trunc('minute', now()) + make_interval(mins => $1 + 31)) AT TIME ZONE 'America/Sao_Paulo')::date AS cruza`,
  [minutos])).cruza) minutos += 1;
  const s = await segundaEnviada(await pedidoEnviado(CLIENTE_A, { minutos }));
  const { data_hora: dataHora } = await um('SELECT data_hora FROM public.agendamentos WHERE id = $1', [s.id]);
  await db.exec(`
    INSERT INTO public.horarios_disponiveis SELECT '${JOAO}', d, '00:00', '23:59:59' FROM generate_series(0, 6) d;
    ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;`);
  try {
    const reservarMesmoHorario = () => db.query(
      'INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora) VALUES ($1, $2, $3, $4) RETURNING id',
      [CLIENTE_B, JOAO, CORTE_30, dataHora]);
    // As regras atuais de disponibilidade: ocupado enquanto não confirmar
    assert.equal((await recusa(reservarMesmoHorario())).detail, 'CONFLITO_BARBEIRO');
    assert.equal((await tocarCancelar(s)).resultado, 'cancelamento_confirmado');
    const { rows } = await reservarMesmoHorario();
    assert.equal(rows.length, 1);
    assert.equal(await statusDo(rows[0].id), 'confirmado');
  } finally {
    await db.exec(`
      ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
      DELETE FROM public.horarios_disponiveis WHERE barbeiro_id = '${JOAO}' AND hora_inicio = '00:00';`);
  }
});

// Outro cliente tenta o mesmo horario com as regras atuais de disponibilidade
// (o mesmo caminho do teste 19). Devolve o detalhe da recusa, ou 'aceito'.
async function outroClienteNoHorario(dataHora) {
  await db.exec(`
    INSERT INTO public.horarios_disponiveis SELECT '${JOAO}', d, '00:00', '23:59:59' FROM generate_series(0, 6) d;
    ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;`);
  try {
    await db.query('INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora) VALUES ($1, $2, $3, $4)',
      [CLIENTE_B, JOAO, CORTE_30, dataHora]);
    return 'aceito';
  } catch (e) {
    return e.detail ?? e.code;
  } finally {
    await db.exec(`
      ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
      DELETE FROM public.horarios_disponiveis WHERE barbeiro_id = '${JOAO}' AND hora_inicio = '00:00';`);
  }
}

test('21. backend desligado: a rotina do pg_cron registra a expiração, sem cancelar, sem liberar o horário e sem aviso', async () => {
  // a) a segunda mensagem chegou e o cliente não respondeu
  const s = await segundaEnviada(await pedidoEnviado());
  // b) o cliente tocou em NÃO e a segunda mensagem nem saiu (backend desligado)
  const p = await pedidoEnviado(CLIENTE_B, { minutos: 110 });
  await tocarNao(p);
  const solP = await solicitacao(p.id);
  await vencerPrazo(s.sol.id);
  await vencerPrazo(solP.id);
  const avisosAntes = await q('SELECT id, tipo, status FROM public.notificacoes ORDER BY id');

  // SÓ o que o pg_cron roda a cada minuto (job notificacoes-rotina): nenhuma
  // chamada do backend (nem reservar_whatsapp)
  const r = (await um('SELECT public.rotina_notificacoes() AS r')).r;
  assert.equal(r.solicitacoes_expiradas, 2);
  const [es, ep] = [await solicitacao(s.id), await solicitacao(p.id)];
  assert.deepEqual([es.estado, es.motivo], ['expirada', 'prazo']);
  assert.deepEqual([ep.estado, ep.motivo], ['nao_enviada', 'prazo']);
  // Nada cancelado; o horário continua ocupado
  assert.deepEqual([await statusDo(s.id), await statusDo(p.id)], ['confirmado', 'confirmado']);
  const { data_hora: dataHora } = await um('SELECT data_hora FROM public.agendamentos WHERE id = $1', [s.id]);
  assert.equal(await outroClienteNoHorario(dataHora), 'CONFLITO_BARBEIRO');
  // Nenhum aviso novo (nem ao cliente, nem ao barbeiro)
  assert.deepEqual(await q('SELECT id, tipo, status FROM public.notificacoes ORDER BY id'), avisosAntes);
  // Telas: pedido não confirmado, agendamento mantido
  assert.equal(await situacaoDe(s.id), 'cancelamento_nao_confirmado');
  assert.equal(await situacaoDe(p.id), 'cancelamento_nao_confirmado');
  // De novo: nada muda
  assert.equal((await um('SELECT public.rotina_notificacoes() AS r')).r.solicitacoes_expiradas, 0);
  // Quando o backend acorda, a segunda mensagem que ficou na fila não sai mais
  assert.equal(await segundaReservada(p.id), undefined);
  const segundaDeP = await um('SELECT status, motivo FROM public.notificacoes WHERE id = $1', [solP.notificacao_id]);
  assert.deepEqual(segundaDeP, { status: 'ignorada', motivo: 'solicitacao_encerrada' });
  // E o botão dela, se chegar, não cancela
  const tarde = await tocarCancelar({ ...s });
  assert.deepEqual([tarde.resultado, tarde.estado], ['solicitacao_encerrada', 'expirada']);
  assert.equal(await statusDo(s.id), 'confirmado');
});

test('22. concluído depois do horário: a solicitação vencida fica expirada (prazo), não invalidada', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  await vencerPrazo(s.sol.id);
  await db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [s.id]);
  const e = await solicitacao(s.id);
  assert.deepEqual([e.estado, e.motivo], ['expirada', 'prazo']);
  // Pendente (a segunda mensagem não saiu) e vencida: nao_enviada, prazo
  const p = await pedidoEnviado(CLIENTE_B, { minutos: 110 });
  await tocarNao(p);
  await vencerPrazo((await solicitacao(p.id)).id);
  await db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [p.id]);
  const ep = await solicitacao(p.id);
  assert.deepEqual([ep.estado, ep.motivo], ['nao_enviada', 'prazo']);
  // A segunda mensagem pendente foi descartada junto
  assert.equal((await um('SELECT status FROM public.notificacoes WHERE id = $1', [ep.notificacao_id])).status, 'ignorada');
});

test('23. aviso de cancelamento não concluído: um só, só para falha definitiva e só com o agendamento de pé', async () => {
  // a) recusa definitiva da segunda mensagem: um aviso ao cliente
  const p = await pedidoEnviado();
  await tocarNao(p);
  const seg = await segundaReservada(p.id);
  assert.deepEqual(await concluir(seg.id, { status: 'recusado', erro: 'destinatario:131026' }),
    { status: 'falhou', motivo: 'destinatario:131026', novo_aviso: true });
  const sol = await solicitacao(p.id);
  let lista = await avisos('cancelamento_nao_concluido');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].destinatario_id, CLIENTE_A);
  assert.equal(lista[0].canal, 'whatsapp');
  assert.deepEqual([lista[0].dados.solicitacao_id, lista[0].dados.falha], [sol.id, 'destinatario:131026']);
  assert.equal(lista[0].expira_em.getTime(), sol.data_hora.getTime(), 'vale até o horário do atendimento');
  // Gravar o mesmo resultado de novo não duplica
  assert.equal((await concluir(seg.id, { status: 'recusado', erro: 'destinatario:131026' })).ja_concluido, true);
  // Sai para o celular do cliente; a falha do próprio aviso não gera outro
  const item = (await reservar()).find((i) => i.tipo === 'cancelamento_nao_concluido');
  assert.equal(item.telefone, TEL[CLIENTE_A]);
  await concluir(item.id, { status: 'aceito', wamid: 'wamid.aviso', wa_id: semNove(TEL[CLIENTE_A]) });
  await um("SELECT public.whatsapp_registrar_status('wamid.aviso', 'falhou', 'destinatario:131026') AS r");
  assert.equal((await avisos('cancelamento_nao_concluido')).length, 1);
  assert.equal(await statusDo(p.id), 'confirmado');

  // b) incerto (pode ter chegado) e temporário com tentativas: nenhum aviso
  const u = await pedidoEnviado(CLIENTE_B, { minutos: 110 });
  await tocarNao(u);
  await concluir((await segundaReservada(u.id)).id, { status: 'incerto', erro: 'incerto:timeout' });
  const v = await pedidoEnviado(CLIENTE_A, { minutos: 115 });
  await tocarNao(v);
  const sv = await segundaReservada(v.id);
  assert.equal((await concluir(sv.id, { status: 'erro', erro: 'temporario:131000' })).status, 'pendente');
  assert.equal((await avisos('cancelamento_nao_concluido')).length, 1);

  // c) tentativas esgotadas (a mensagem nunca saiu): aviso
  await db.query('UPDATE public.notificacoes SET tentativas = 3, proxima_tentativa = now() WHERE id = $1', [sv.id]);
  const ultima = await segundaReservada(v.id);
  assert.equal(ultima.tentativas, 4);
  const fim = await concluir(ultima.id, { status: 'erro', erro: 'temporario:131000' });
  assert.deepEqual([fim.status, fim.motivo, fim.novo_aviso], ['falhou', 'tentativas_esgotadas: temporario:131000', true]);
  lista = await avisos('cancelamento_nao_concluido');
  assert.equal(lista.length, 2);

  // d) cancelado pelo app antes de o aviso sair: o aviso é descartado
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1 AND status <> 'cancelado'", [v.id]);
  const doV = (await avisos('cancelamento_nao_concluido')).find((a) => a.agendamento_id === v.id);
  assert.deepEqual([doV.status, doV.motivo], ['ignorada', 'agendamento_cancelado']);

  // e) falha informada depois de o agendamento mudar de horário: sem aviso
  const w = await segundaEnviada(await pedidoEnviado(CLIENTE_B, { minutos: 118 }));
  await db.query("UPDATE public.agendamentos SET data_hora = data_hora + interval '20 minutes' WHERE id = $1", [w.id]);
  await um('SELECT public.whatsapp_registrar_status($1, $2, $3) AS r', [w.wamid2, 'falhou', 'destinatario:131026']);
  assert.equal((await avisos('cancelamento_nao_concluido')).filter((a) => a.agendamento_id === w.id).length, 0);

  // f) mesmo se o gatilho de invalidação falhar (como no 12b), a falha
  //    informada depois do cancelamento pelo app não gera aviso
  const x = await segundaEnviada(await pedidoEnviado(CLIENTE_A, { minutos: 119 }));
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER invalidar_confirmacao_presenca');
  try {
    await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [x.id]);
  } finally {
    await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER invalidar_confirmacao_presenca');
  }
  assert.equal((await solicitacao(x.id)).estado, 'aguardando', 'o gatilho não rodou');
  await um('SELECT public.whatsapp_registrar_status($1, $2, $3) AS r', [x.wamid2, 'falhou', 'destinatario:131026']);
  assert.equal((await solicitacao(x.id)).estado, 'nao_enviada');
  assert.equal((await avisos('cancelamento_nao_concluido')).filter((a) => a.agendamento_id === x.id).length, 0);
});

test('23b. ordem das travas: a falha da segunda mensagem trava o agendamento antes da solicitação', async () => {
  // O aviso de cancelamento nao concluido referencia o agendamento; travando a
  // solicitacao antes, havia impasse com o toque e com o app (achado no
  // PostgreSQL real: o PGlite, com uma conexao, nao mostra impasse)
  for (const f of ['concluir_envio_whatsapp(uuid,jsonb)', 'whatsapp_registrar_status(text,text,text)']) {
    const def = (await um('SELECT pg_get_functiondef($1::regprocedure) AS d', [`public.${f}`])).d;
    const trava = def.search(/FROM public\.agendamentos ag WHERE ag\.id = \w+(\.agendamento_id)? FOR UPDATE/);
    const solicitacao = def.indexOf("SET estado = 'nao_enviada', motivo = v_motivo", def.indexOf('UPDATE public.solicitacoes_cancelamento', trava));
    const aviso = def.indexOf('whatsapp_avisar_cancelamento_nao_concluido');
    assert.ok(trava > 0 && trava < solicitacao && solicitacao < aviso, f);
  }
});

test('20. cancelamento pelo WhatsApp não gera comissão nem estorno automático', async () => {
  const rpc = async (nome, args) => {
    const chaves = Object.keys(args);
    const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
    return (await um(`SELECT public.${nome}(${chaves.map((k, i) => `${k} => $${i + 1}`).join(', ')}) AS r`, valores)).r;
  };
  async function pagarPix(agendamento, cliente) {
    const { pagamento } = await rpc('iniciar_pagamento', { p_agendamento_id: agendamento, p_cliente_id: cliente, p_metodo: 'pix' });
    await rpc('registrar_cobranca', { p_pagamento_id: pagamento.id, p_dados: { provedor_pagamento_id: `mp-${agendamento}`, pix_copia_cola: '000201', expira_em: new Date(Date.now() + 1800e3).toISOString() } });
    await rpc('aplicar_estado_pagamento', { p_pagamento_id: pagamento.id, p_estado: {
      status: 'approved', provedor_pagamento_id: `mp-${agendamento}`, valor: Number(pagamento.valor), taxa: 0, valor_reembolsado: 0,
      aprovado_em: new Date().toISOString(), reembolsos: [] } });
    return pagamento.id;
  }
  await db.query("SELECT set_config('test.uid', $1, false)", [ADMIN]);
  await rpc('configurar_comissao', { p_barbeiro_id: JOAO, p_percentual: 60 });
  await db.query("SELECT set_config('test.uid', '', false)");

  const s = await segundaEnviada(await pedidoEnviado());
  const pagamento = await pagarPix(s.id, CLIENTE_A);
  assert.equal((await tocarCancelar(s)).resultado, 'cancelamento_confirmado');
  assert.deepEqual(await q('SELECT tipo FROM public.lancamentos_financeiros WHERE agendamento_id = $1', [s.id]), []);
  const pag = await um('SELECT status::text AS status, valor_reembolsado FROM public.pagamentos WHERE id = $1', [pagamento]);
  assert.deepEqual([pag.status, Number(pag.valor_reembolsado)], ['approved', 0]);
  assert.deepEqual(await q('SELECT 1 FROM public.pagamento_reembolsos WHERE pagamento_id = $1', [pagamento]), []);

  // Controle: no mesmo banco, um atendimento pago e concluído gera comissão
  // (a regra financeira está ativa; o cancelamento é que não gera)
  const outro = await agendar(CLIENTE_B, 300);
  await pagarPix(outro, CLIENTE_B);
  await db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [outro]);
  const [l] = await q('SELECT tipo, valor_comissao FROM public.lancamentos_financeiros WHERE agendamento_id = $1', [outro]);
  assert.deepEqual([l.tipo, Number(l.valor_comissao)], ['servico', 24]);
});

// ---------------------------------------------------------------
// Texto livre, consentimento, histórico, acesso, migration e rollback
// ---------------------------------------------------------------
test('texto: "não" com um único pedido abre a solicitação (sem cancelar); com solicitação aguardando, texto só orienta', async () => {
  const p = await pedidoEnviado();
  assert.equal((await responder(evento(), semNove(p.tel), 'texto', { texto: ' Não. ' })).resultado, 'cancelamento_solicitado');
  assert.equal((await solicitacao(p.id)).origem_pedido, 'texto');
  assert.equal(await statusDo(p.id), 'confirmado');
  const [item] = await reservar();
  await concluir(item.id, { status: 'aceito', wamid: 'wamid.txt', wa_id: semNove(p.tel) });
  for (const texto of ['sim', 'SIM!', 'não', 'nao']) {
    assert.equal((await responder(evento(), p.tel, 'texto', { texto })).resultado, 'usar_botao', texto);
  }
  // Citando a segunda mensagem: também só orienta
  assert.equal((await responder(evento(), p.tel, 'texto', { texto: 'sim', contexto: 'wamid.txt' })).resultado, 'usar_botao');
  assert.equal(await statusDo(p.id), 'confirmado');
  assert.equal((await solicitacao(p.id)).estado, 'aguardando');
  // PARAR continua valendo
  assert.equal((await responder(evento(), p.tel, 'texto', { texto: 'parar' })).resultado, 'descadastro');
});

test('botão de cancelar vindo de outro número ou sem a mensagem respondida não vale', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  const tentativas = [
    [TEL[CLIENTE_B], { payload: `VB_CANCELAR:${s.sol.id}`, contexto: s.wamid2 }],
    [s.tel, { payload: `VB_CANCELAR:${s.sol.id}` }],
    [s.tel, { payload: `VB_CANCELAR:${s.sol.id}`, contexto: 'wamid.outra' }],
    [s.tel, { payload: `VB_CANCELAR:${s.conf.id}`, contexto: s.wamid2 }],
    [s.tel, { payload: 'VB_APAGAR:' + s.sol.id, contexto: s.wamid2 }],
  ];
  for (const [de, extra] of tentativas) {
    assert.equal((await responder(evento(), de, 'botao', extra)).resultado, 'invalida', JSON.stringify(extra));
  }
  assert.equal(await statusDo(s.id), 'confirmado');
  assert.equal((await solicitacao(s.id)).estado, 'aguardando');
});

test('consentimento: só a autorização da versão nova do aviso recebe mensagens', async () => {
  assert.equal((await um('SELECT public.whatsapp_versao_aviso() AS v')).v, VERSAO);
  const backend = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'consentimento.js'), 'utf8');
  assert.match(backend, new RegExp(`whatsapp_avisos: \\{ versaoAviso: '${VERSAO}' \\}`));

  await consentir(CLIENTE_A, '2026-11-13');
  await agendar(CLIENTE_A, 100);
  assert.equal(await enfileirar(), 0, 'autorização do aviso anterior não vale');
  await consentir(CLIENTE_A, VERSAO);
  assert.equal(await enfileirar(), 1);
  // PARAR revoga as duas
  await reservar();
  assert.equal((await responder(evento(), TEL[CLIENTE_A], 'texto', { texto: 'PARAR' })).revogados, 2);
});

test('histórico: solicitação encerrada não muda; a limpeza de avisos antigos continua funcionando', async () => {
  const s = await segundaEnviada(await pedidoEnviado());
  await tocarCancelar(s);
  for (const sql of [
    "UPDATE public.solicitacoes_cancelamento SET estado = 'desistiu' WHERE id = $1",
    "UPDATE public.solicitacoes_cancelamento SET motivo = 'x' WHERE id = $1",
    'UPDATE public.solicitacoes_cancelamento SET agendamento_id = gen_random_uuid() WHERE id = $1',
  ]) {
    assert.equal((await recusa(db.query(sql, [s.sol.id]))).code, 'PT409', sql);
  }
  // Só anda para frente: aguardando nao volta a pendente
  const t = await segundaEnviada(await pedidoEnviado(CLIENTE_B, { minutos: 110 }));
  assert.equal((await recusa(db.query("UPDATE public.solicitacoes_cancelamento SET estado = 'pendente' WHERE id = $1", [t.sol.id]))).detail, 'TRANSICAO_INVALIDA');
  // Confirmada sem origem: recusada pelo banco
  assert.equal((await recusa(db.query("UPDATE public.solicitacoes_cancelamento SET estado = 'confirmada' WHERE id = $1", [t.sol.id]))).code, '23514');

  await db.query("UPDATE public.notificacoes SET criada_em = now() - interval '200 days' WHERE status NOT IN ('pendente', 'enviando')");
  const r = (await um('SELECT public.limpar_notificacoes_antigas(90) AS r')).r;
  assert.ok(r.avisos >= 2);
  const depois = await solicitacao(s.id);
  assert.deepEqual([depois.estado, depois.notificacao_id, depois.cancelamento_origem], ['confirmada', null, 'whatsapp_resposta_negativa']);
});

test('acesso: o app e o site não leem as solicitações nem chamam as funções novas', async () => {
  await db.query("SELECT set_config('test.uid', $1, false)", [CLIENTE_A]);
  await db.exec('SET ROLE authenticated');
  try {
    for (const sql of [
      'SELECT * FROM public.solicitacoes_cancelamento',
      'SELECT public.whatsapp_versao_aviso()',
      "UPDATE public.solicitacoes_cancelamento SET estado = 'confirmada'",
      "SELECT public.whatsapp_registrar_resposta('e', '5511987654321', 'botao', 'VB_CANCELAR:00000000-0000-4000-8000-000000000000', 'w', NULL)",
      'SELECT public.reservar_whatsapp(1)',
      'SELECT public.whatsapp_consentiu(gen_random_uuid())',
      'SELECT public.whatsapp_expirar_solicitacoes()',
      "SELECT public.whatsapp_avisar_cancelamento_nao_concluido(gen_random_uuid(), 'x')",
      'SELECT public.rotina_notificacoes()',
    ]) {
      assert.equal((await recusa(db.query(sql))).code, '42501', sql);
    }
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('migration: sem a 25 para com mensagem clara e não cria nada', async () => {
  const sem25 = await criarBanco({ migracoes: MIGRATIONS_AGENDA });
  const r = await recusa(sem25.exec(migration(M26)));
  assert.match(r.message, /Rode antes a migration 20261113000025/);
  await sem25.exec('ROLLBACK');
  assert.equal((await sem25.query("SELECT to_regclass('public.solicitacoes_cancelamento') IS NULL AS ok")).rows[0].ok, true);
});

test('migration: sem a 27 (com o gatilho de INSERT na fila) para com mensagem clara e não cria nada', async () => {
  const sem27 = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP });
  const r = await recusa(sem27.exec(migration(M26)));
  assert.match(r.message, /Rode antes a migration 20261115000027_despertar_so_whatsapp\.sql/);
  await sem27.exec('ROLLBACK');
  assert.equal((await sem27.query("SELECT to_regclass('public.solicitacoes_cancelamento') IS NULL AS ok")).rows[0].ok, true);
});

test('rollback: volta às funções exatas da 25 (rotina da 27), guarda o histórico e não reativa agendamentos', async () => {
  const FUNCOES = ['whatsapp_consentiu', 'whatsapp_motivo_para_nao_enviar', 'reservar_whatsapp', 'concluir_envio_whatsapp',
    'whatsapp_registrar_status', 'whatsapp_registrar_resposta', 'invalidar_confirmacao_presenca', 'presenca_dos_agendamentos',
    'rotina_notificacoes'];
  const definicoes = async (banco) => (await banco.query(
    `SELECT p.proname, pg_get_functiondef(p.oid) AS def, coalesce(p.proacl::text, '') AS acl
       FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = ANY ($1) ORDER BY p.proname`, [FUNCOES])).rows
    // Finais de linha (CRLF/LF) dependem do checkout do arquivo, não do conteúdo
    .map((r) => ({ ...r, def: r.def.replace(/\r\n/g, '\n') }));
  const gatilho = async (banco) => (await banco.query(
    "SELECT pg_get_triggerdef(t.oid) AS def FROM pg_trigger t WHERE t.tgname = 'invalidar_confirmacao_presenca'")).rows;

  // Referência: o estado antes da 26 (a 25 com a 27)
  const so25 = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_27, antesDasMigrations: PERMISSOES });
  const referencia = await definicoes(so25);
  assert.equal(referencia.length, FUNCOES.length);

  // Banco com a 26 e dados: um cancelado pelo WhatsApp e um aguardando
  const principal = db;
  db = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26, antesDasMigrations: PERMISSOES });
  try {
    await db.exec(PERFIS);
    const cancelado = await segundaEnviada(await pedidoEnviado());
    await tocarCancelar(cancelado);
    const aberto = await segundaEnviada(await pedidoEnviado(CLIENTE_B, { minutos: 110 }));
    assert.notDeepEqual(await definicoes(db), referencia);

    await db.exec(ROLLBACK);
    await db.exec(ROLLBACK); // pode rodar de novo
    assert.deepEqual(await definicoes(db), referencia);
    assert.deepEqual(await gatilho(db), await gatilho(so25));
    assert.equal((await um("SELECT to_regprocedure('public.whatsapp_versao_aviso()') IS NULL AS ok")).ok, true);
    // As funções só da 26 saem; a rotina de cada minuto volta a ser a da 27
    // (com o filtro de canal) e o gatilho de INSERT removido pela 27 não volta
    for (const f of ['whatsapp_expirar_solicitacoes()', 'whatsapp_avisar_cancelamento_nao_concluido(uuid,text)',
      'despertar_backend_apos_aviso()']) {
      assert.equal((await um('SELECT to_regprocedure($1) IS NULL AS ok', [`public.${f}`])).ok, true, f);
    }
    assert.equal((await um("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'despertar_backend'")).n, 0);
    assert.ok((await um('SELECT public.rotina_notificacoes() AS r')).r, 'a rotina da 27 roda depois do rollback');

    // Histórico guardado; nada reativado; o que estava aberto não vale mais
    assert.equal((await q('SELECT 1 FROM public.solicitacoes_cancelamento')).length, 2);
    assert.equal(await statusDo(cancelado.id), 'cancelado');
    assert.equal((await solicitacao(cancelado.id)).cancelamento_origem, 'whatsapp_resposta_negativa');
    assert.deepEqual([(await solicitacao(aberto.id)).estado, (await solicitacao(aberto.id)).motivo], ['invalidada', 'rollback_26']);
    // O botão antigo não cancela (a 25 não conhece VB_CANCELAR)
    assert.equal((await tocarCancelar(aberto)).resultado, 'invalida');
    assert.equal(await statusDo(aberto.id), 'confirmado');

    // E a 26 pode ser aplicada de novo depois
    await db.exec(migration(M26));
    assert.notDeepEqual(await definicoes(db), referencia);
    assert.equal((await q('SELECT 1 FROM public.solicitacoes_cancelamento')).length, 2);
  } finally {
    db = principal;
  }
});
