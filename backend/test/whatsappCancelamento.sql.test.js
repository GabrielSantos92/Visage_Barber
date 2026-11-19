// Migration 29: aviso de cancelamento efetivado pelo WhatsApp (cliente e
// barbeiro), direto no banco (PGlite, UMA conexao: cancelamentos simultaneos
// de verdade nao sao testados aqui; a garantia e a trava de linha do UPDATE e
// a chave unica) e no envio do backend. Nada sai para a rede.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  criarBanco, migration, recusa, MIGRATIONS_AGENDA, MIGRATIONS_WHATSAPP_27, MIGRATIONS_WHATSAPP_26,
  JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');
const { montarEnvio, criarConfirmacaoPresenca } = require('../src/services/confirmacaoPresenca');

const M26 = '20261116000026_whatsapp_cancelamento_confirmado.sql';
const M28 = '20261118000028_whatsapp_novo_agendamento.sql';
const M29 = '20261118000029_whatsapp_aviso_cancelamento.sql';
const ROLLBACK29 = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'rollbacks', '20261118000029_rollback.sql'), 'utf8');
const PRODUCAO = [...MIGRATIONS_WHATSAPP_27, M28, M29]; // 25 + 27 + 28 + 29, sem a 26
const DADOS = `
  INSERT INTO public.profiles (user_id, nome, telefone) VALUES
    ('${CLIENTE_A}', 'Ana Paula', '11987654321'), ('${CLIENTE_B}', 'Bruno', '21998765432'),
    ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
  ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;`;

async function banco(migracoes = PRODUCAO, { consentidos = [CLIENTE_A, USUARIO_JOAO] } = {}) {
  const db = await criarBanco({ migracoes });
  await db.exec(DADOS);
  for (const uid of consentidos) await consentir(db, uid);
  return db;
}
const consentir = (db, uid) => db.query(
  "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', '2026-11-16', 'web')", [uid]);
let minutos = 180;
const agendar = async (db, cliente = CLIENTE_A, status = 'confirmado') => (await db.query(
  `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
   VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4), $5) RETURNING id`,
  [cliente, JOAO, CORTE_30, (minutos += 60), status])).rows[0].id;
const cancelar = (db, ag) => db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [ag]);
const avisos = async (db, ag, tipo = 'cancelamento') => (await db.query(
  `SELECT dados ->> 'papel' AS papel, status, motivo FROM public.notificacoes
    WHERE canal = 'whatsapp' AND tipo = $2 AND agendamento_id = $1 ORDER BY dados ->> 'papel'`, [ag, tipo])).rows;
const papeis = async (db, ag) => (await avisos(db, ag)).map((a) => a.papel);
const reservar = async (db) => (await db.query('SELECT public.reservar_whatsapp(20) AS r')).rows[0].r;

test('cancelamento efetivado: um aviso para o cliente e um para o barbeiro, entregues pela reserva', async () => {
  const db = await banco();
  const ag = await agendar(db);
  assert.deepEqual(await papeis(db, ag), []);
  await cancelar(db, ag);
  assert.deepEqual(await avisos(db, ag), [
    { papel: 'barbeiro', status: 'pendente', motivo: null }, { papel: 'cliente', status: 'pendente', motivo: null }]);
  const itens = (await reservar(db)).filter((i) => i.tipo === 'cancelamento');
  assert.deepEqual(itens.map((i) => [i.dados.papel, i.telefone]).sort(),
    [['barbeiro', '5511912345678'], ['cliente', '5511987654321']]);
});

test('sem autorização (cliente ou barbeiro) ou com celular inválido, aquela pessoa não recebe', async () => {
  const soBarbeiro = await banco(PRODUCAO, { consentidos: [USUARIO_JOAO] });
  const a1 = await agendar(soBarbeiro);
  await cancelar(soBarbeiro, a1);
  assert.deepEqual(await papeis(soBarbeiro, a1), ['barbeiro']);

  const soCliente = await banco(PRODUCAO, { consentidos: [CLIENTE_A] });
  const a2 = await agendar(soCliente);
  await cancelar(soCliente, a2);
  assert.deepEqual(await papeis(soCliente, a2), ['cliente']);

  const celular = await banco();
  await celular.query("UPDATE public.profiles SET telefone = '1133334444' WHERE user_id = $1", [CLIENTE_A]); // fixo
  const a3 = await agendar(celular);
  await cancelar(celular, a3);
  assert.deepEqual(await papeis(celular, a3), ['barbeiro']);
});

test('já cancelado, cancelado de novo, reativado e cancelado outra vez: nunca duplica', async () => {
  const db = await banco();
  const jaCancelado = await agendar(db, CLIENTE_A, 'cancelado');
  await cancelar(db, jaCancelado);
  assert.deepEqual(await papeis(db, jaCancelado), []);

  const ag = await agendar(db);
  await cancelar(db, ag);
  await cancelar(db, ag);
  await db.query("UPDATE public.agendamentos SET status = 'confirmado' WHERE id = $1", [ag]);
  await cancelar(db, ag);
  assert.deepEqual(await papeis(db, ag), ['barbeiro', 'cliente']);
});

test('falha ao gravar o aviso nunca impede o cancelamento; cancelamento desfeito não deixa aviso', async () => {
  const db = await banco();
  const ag = await agendar(db);
  await db.exec(`CREATE OR REPLACE FUNCTION public.whatsapp_consentiu(p_user uuid) RETURNS boolean LANGUAGE plpgsql
    AS $$ BEGIN RAISE EXCEPTION 'falha simulada'; END $$;`);
  await cancelar(db, ag);
  assert.equal((await db.query('SELECT status::text AS s FROM public.agendamentos WHERE id = $1', [ag])).rows[0].s, 'cancelado');
  assert.deepEqual(await papeis(db, ag), []);

  const ok = await banco();
  const ag2 = await agendar(ok);
  await ok.exec('BEGIN');
  await cancelar(ok, ag2);
  await ok.exec('ROLLBACK');
  assert.deepEqual(await papeis(ok, ag2), []);
});

test('na hora do envio: destinatário fora do agendamento ou agendamento reativado não recebem', async () => {
  const db = await banco();
  await consentir(db, CLIENTE_B);
  const ag = await agendar(db);
  await cancelar(db, ag);
  await db.query(`UPDATE public.notificacoes SET destinatario_id = $1
                   WHERE agendamento_id = $2 AND tipo = 'cancelamento' AND dados ->> 'papel' = 'cliente'`, [CLIENTE_B, ag]);
  const reativado = await agendar(db);
  await cancelar(db, reativado);
  await db.query("UPDATE public.agendamentos SET status = 'confirmado' WHERE id = $1", [reativado]);
  const itens = (await reservar(db)).filter((i) => i.tipo === 'cancelamento');
  assert.deepEqual(itens.map((i) => i.dados.agendamento_id + ':' + i.dados.papel), [`${ag}:barbeiro`]);
  assert.deepEqual((await avisos(db, ag)).map((a) => a.motivo), [null, 'destinatario_mudou']);
  assert.ok((await avisos(db, reativado)).every((a) => a.motivo === 'agendamento_confirmado'));
});

test('com a 28: os avisos de novo agendamento pendentes não saem e os de cancelamento sim', async () => {
  for (const migracoes of [PRODUCAO, [...MIGRATIONS_WHATSAPP_26, M28, M29]]) {
    const db = await banco(migracoes);
    const ag = await agendar(db);
    assert.deepEqual((await avisos(db, ag, 'novo_agendamento')).length, 2);
    await cancelar(db, ag);
    const itens = await reservar(db);
    assert.deepEqual(itens.map((i) => i.tipo), ['cancelamento', 'cancelamento']);
    assert.ok((await avisos(db, ag, 'novo_agendamento')).every((a) => a.status === 'ignorada'));
  }
});

test('26: pedido de cancelamento e desistência não geram aviso; cancelado pelo WhatsApp não duplica o da 26', async () => {
  const db = await banco([...MIGRATIONS_WHATSAPP_26, M28, M29]);
  const ag = await agendar(db);
  const [{ id: conf }] = (await db.query(`INSERT INTO public.confirmacoes_presenca (agendamento_id, data_hora, cliente_id, estado)
    SELECT id, data_hora, cliente_id, 'recusada' FROM public.agendamentos WHERE id = $1 RETURNING id`, [ag])).rows;
  const [{ id: sol }] = (await db.query(`INSERT INTO public.solicitacoes_cancelamento
      (confirmacao_id, agendamento_id, data_hora, cliente_id, estado, origem_pedido, expira_em, evento_pedido)
    SELECT $1, id, data_hora, cliente_id, 'aguardando', 'botao', data_hora, 'ev-pedido'
      FROM public.agendamentos WHERE id = $2 RETURNING id`, [conf, ag])).rows;
  assert.deepEqual(await papeis(db, ag), [], 'pedido aberto não cancela nem avisa');

  // Cliente confirma pelo WhatsApp: solicitação confirmada e agendamento cancelado na mesma transação
  await db.exec('BEGIN');
  await db.query(`UPDATE public.solicitacoes_cancelamento SET estado = 'confirmada', respondida_em = now(),
    evento_resposta = 'ev-resp', cancelamento_origem = 'whatsapp_resposta_negativa', cancelado_em = now() WHERE id = $1`, [sol]);
  await cancelar(db, ag);
  await db.exec('COMMIT');
  assert.deepEqual(await papeis(db, ag), [], 'a 26 já avisa: sem aviso duplicado');

  // Desistência: nada muda no agendamento, nada é avisado
  const ag2 = await agendar(db);
  assert.deepEqual(await papeis(db, ag2), []);
});

test('ordem: 29 antes ou depois da 26 deixa a mesma conferência de envio; sem a 25 para; rollback limpa', async () => {
  const definicao = async (db) => (await db.query(
    "SELECT pg_get_functiondef('public.whatsapp_motivo_para_nao_enviar(public.notificacoes)'::regprocedure) AS d")).rows[0].d;
  const producao = await banco();
  const comA26Depois = await banco();
  await comA26Depois.exec(migration(M26));
  const comA26Antes = await banco([...MIGRATIONS_WHATSAPP_26, M28, M29]);
  assert.equal(await definicao(producao), await definicao(comA26Antes));
  assert.equal(await definicao(comA26Depois), await definicao(comA26Antes));
  const ag = await agendar(comA26Depois);
  await cancelar(comA26Depois, ag);
  assert.deepEqual((await reservar(comA26Depois)).filter((i) => i.tipo === 'cancelamento').length, 2);

  const sem25 = await criarBanco({ migracoes: MIGRATIONS_AGENDA });
  assert.match((await recusa(sem25.exec(migration(M29)))).message, /Rode antes a migration 20261113000025/);
  await sem25.exec('ROLLBACK');

  const ag2 = await agendar(producao);
  await cancelar(producao, ag2);
  await producao.exec(ROLLBACK29);
  await producao.exec(ROLLBACK29);
  assert.deepEqual((await avisos(producao, ag2)).map((a) => a.motivo), ['rollback_29', 'rollback_29']);
  const ag3 = await agendar(producao);
  await cancelar(producao, ag3);
  assert.deepEqual(await papeis(producao, ag3), []);
});

test('backend: templates do cancelamento por destinatário; sem template, nada é enviado', async () => {
  const config = { templateCancelamentoCliente: 'canc_cli', templateCancelamentoBarbeiro: 'canc_barb' };
  const dados = { data_hora: '2026-11-20T17:30:00Z', servico: 'Corte', cliente_nome: 'Ana', barbeiro_nome: 'João' };
  assert.deepEqual(montarEnvio({ tipo: 'cancelamento', dados: { ...dados, papel: 'cliente' } }, config),
    { modo: 'template', template: 'canc_cli', parametros: ['Ana', 'Corte', 'João', '20/11', '14h30'], botoes: [] });
  assert.deepEqual(montarEnvio({ tipo: 'cancelamento', dados: { ...dados, papel: 'barbeiro' } }, config),
    { modo: 'template', template: 'canc_barb', parametros: ['Ana', 'Corte', '20/11', '14h30'], botoes: [] });

  // Sem template: o resultado gravado e "template_nao_configurado" e a Meta nao e chamada
  const gravados = [];
  let enviados = 0;
  let entregue = false;
  const servico = criarConfirmacaoPresenca({
    chamar: async (nome, args) => {
      if (nome === 'reservar_whatsapp') {
        if (entregue) return [];
        entregue = true;
        return [{ id: 'n1', tipo: 'cancelamento', destinatario_id: CLIENTE_A, telefone: '5511987654321',
          dados: { ...dados, papel: 'cliente' } }];
      }
      if (nome === 'concluir_envio_whatsapp') gravados.push(args.p_resultado);
      return { status: 'falhou' };
    },
    whatsapp: { enviarTemplate: async () => { enviados++; return { status: 'aceito', wamid: 'x' }; } },
    config: {},
    log: { error() {}, warn() {}, info() {} },
  });
  await servico.processarFila();
  assert.equal(enviados, 0);
  assert.deepEqual(gravados, [{ status: 'recusado', erro: 'template_nao_configurado' }]);
});
