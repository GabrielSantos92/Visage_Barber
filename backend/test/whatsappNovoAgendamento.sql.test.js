// Migration 28: confirmacao de novo agendamento pelo WhatsApp (cliente e
// barbeiro), direto no banco (PGlite) e na montagem da mensagem do backend.
// Nada sai para a rede: so a fila e conferida.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  criarBanco, migration, recusa, MIGRATIONS_WHATSAPP, MIGRATIONS_WHATSAPP_27, MIGRATIONS_WHATSAPP_26,
  JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');
const { montarEnvio } = require('../src/services/confirmacaoPresenca');

const M28 = '20261118000028_whatsapp_novo_agendamento.sql';
const ROLLBACK28 = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'rollbacks', '20261118000028_rollback.sql'), 'utf8');
const DADOS = `
  INSERT INTO public.profiles (user_id, nome, telefone) VALUES
    ('${CLIENTE_A}', 'Ana Paula', '11987654321'), ('${CLIENTE_B}', 'Bruno', NULL),
    ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
  ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;`;

async function banco(migracoes = [...MIGRATIONS_WHATSAPP_27, M28]) {
  const db = await criarBanco({ migracoes });
  await db.exec(DADOS);
  return db;
}
const consentir = (db, uid) => db.query(
  "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', '2026-11-16', 'web')", [uid]);
const agendar = async (db, cliente, { minutos = 180, status = 'confirmado' } = {}) => (await db.query(
  `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
   VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4), $5) RETURNING id`,
  [cliente, JOAO, CORTE_30, minutos, status])).rows[0].id;
const avisos = async (db, ag) => (await db.query(
  `SELECT destinatario_id, status, motivo, dados ->> 'papel' AS papel, expira_em <= now() + interval '30 minutes' AS curto
     FROM public.notificacoes WHERE canal = 'whatsapp' AND tipo = 'novo_agendamento' AND agendamento_id = $1
    ORDER BY dados ->> 'papel'`, [ag])).rows;
const reservar = async (db) => (await db.query('SELECT public.reservar_whatsapp(20) AS r')).rows[0].r;

test('cliente e barbeiro autorizados: um aviso para cada, de vida curta, e a reserva entrega com o celular', async () => {
  const db = await banco();
  await consentir(db, CLIENTE_A);
  await consentir(db, USUARIO_JOAO);
  const ag = await agendar(db, CLIENTE_A);
  assert.deepEqual(await avisos(db, ag), [
    { destinatario_id: USUARIO_JOAO, status: 'pendente', motivo: null, papel: 'barbeiro', curto: true },
    { destinatario_id: CLIENTE_A, status: 'pendente', motivo: null, papel: 'cliente', curto: true },
  ]);
  const itens = await reservar(db);
  assert.deepEqual(itens.map((i) => [i.tipo, i.dados.papel, i.telefone]).sort(),
    [['novo_agendamento', 'barbeiro', '5511912345678'], ['novo_agendamento', 'cliente', '5511987654321']]);
  assert.deepEqual(await reservar(db), [], 'reservado uma vez só');
});

test('só quem autorizou e tem celular recebe; sem ninguém, o agendamento é criado e nada vai para a fila', async () => {
  const db = await banco();
  await consentir(db, USUARIO_JOAO);
  await consentir(db, CLIENTE_B); // autorizou, mas sem celular
  const soBarbeiro = await agendar(db, CLIENTE_A);
  assert.deepEqual((await avisos(db, soBarbeiro)).map((a) => a.papel), ['barbeiro']);
  const ninguemCliente = await agendar(db, CLIENTE_B, { minutos: 240 });
  assert.deepEqual((await avisos(db, ninguemCliente)).map((a) => a.papel), ['barbeiro']);
  await db.exec(`DELETE FROM public.consentimentos`);
  const ninguem = await agendar(db, CLIENTE_A, { minutos: 300 });
  assert.deepEqual(await avisos(db, ninguem), []);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.agendamentos')).rows[0].n, 3);
});

test('agendamento já cancelado ou no passado não gera aviso; cancelado antes do envio não sai', async () => {
  const db = await banco();
  await consentir(db, CLIENTE_A);
  await consentir(db, USUARIO_JOAO);
  assert.deepEqual(await avisos(db, await agendar(db, CLIENTE_A, { status: 'cancelado' })), []);
  assert.deepEqual(await avisos(db, await agendar(db, CLIENTE_A, { minutos: -30 })), []);
  const ag = await agendar(db, CLIENTE_A, { minutos: 400 });
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [ag]);
  assert.deepEqual(await reservar(db), []);
  assert.ok((await avisos(db, ag)).every((a) => a.status === 'ignorada'));
});

test('erro ao gravar o aviso nunca impede criar o agendamento', async () => {
  const db = await banco();
  await db.exec(`CREATE OR REPLACE FUNCTION public.whatsapp_consentiu(p_user uuid) RETURNS boolean LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$;`);
  const ag = await agendar(db, CLIENTE_A);
  assert.ok(ag);
  assert.deepEqual(await avisos(db, ag), []);
});

test('com a 26 ajustada: o tipo novo é aceito na hora do envio e o destinatário é conferido', async () => {
  const db = await banco([...MIGRATIONS_WHATSAPP_26, M28]);
  await consentir(db, CLIENTE_A);
  await consentir(db, USUARIO_JOAO);
  const ag = await agendar(db, CLIENTE_A);
  await db.query(`UPDATE public.notificacoes SET destinatario_id = $1
                   WHERE agendamento_id = $2 AND dados ->> 'papel' = 'cliente'`, [CLIENTE_B, ag]);
  await consentir(db, CLIENTE_B);
  await db.query("UPDATE public.profiles SET telefone = '21998765432' WHERE user_id = $1", [CLIENTE_B]);
  const itens = await reservar(db);
  assert.deepEqual(itens.map((i) => i.dados.papel), ['barbeiro']);
  const desviado = (await avisos(db, ag)).find((a) => a.papel === 'cliente');
  assert.deepEqual([desviado.status, desviado.motivo], ['ignorada', 'destinatario_mudou']);
});

test('sem a 25 a migration para; o rollback tira o gatilho e encerra os avisos pendentes', async () => {
  const sem25 = await criarBanco();
  assert.match((await recusa(sem25.exec(migration(M28)))).message, /Rode antes a migration 20261113000025/);
  await sem25.exec('ROLLBACK');

  const db = await banco([...MIGRATIONS_WHATSAPP, M28]); // estado A (sem a 27) também funciona
  await consentir(db, CLIENTE_A);
  const ag = await agendar(db, CLIENTE_A);
  await db.exec(ROLLBACK28);
  await db.exec(ROLLBACK28);
  assert.deepEqual((await avisos(db, ag)).map((a) => [a.status, a.motivo]), [['ignorada', 'rollback_28']]);
  assert.deepEqual(await avisos(db, await agendar(db, CLIENTE_A, { minutos: 500 })), []);
  const perm = await db.query("SELECT to_regprocedure('public.whatsapp_avisar_novo_agendamento()') IS NULL AS ok");
  assert.equal(perm.rows[0].ok, true);
});

test('backend: mensagem do cliente e do barbeiro com os templates próprios; papel inválido não envia', () => {
  const config = { templateNovoAgendamentoCliente: 'novo_cli', templateNovoAgendamentoBarbeiro: 'novo_barb' };
  const dados = { data_hora: '2026-11-20T17:30:00Z', servico: 'Corte', cliente_nome: 'Ana', barbeiro_nome: 'João' };
  assert.deepEqual(montarEnvio({ tipo: 'novo_agendamento', dados: { ...dados, papel: 'cliente' } }, config),
    { modo: 'template', template: 'novo_cli', parametros: ['Ana', 'Corte', 'João', '20/11', '14h30'], botoes: [] });
  assert.deepEqual(montarEnvio({ tipo: 'novo_agendamento', dados: { ...dados, papel: 'barbeiro' } }, config),
    { modo: 'template', template: 'novo_barb', parametros: ['Ana', 'Corte', '20/11', '14h30'], botoes: [] });
  assert.ok(!montarEnvio({ tipo: 'novo_agendamento', dados: { ...dados, papel: 'cliente' } }, {}).template, 'sem template: não envia');
  assert.throws(() => montarEnvio({ tipo: 'novo_agendamento', dados: { ...dados, papel: 'outro' } }, config), /papel invalido/);
});
