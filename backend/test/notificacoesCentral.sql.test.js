// Migration 30: central de notificacoes (so as proprias, so o push, sem o tipo
// teste), marcador do push no banco (desligado nao acorda o backend nem
// reserva), avisos antigos nunca saem ao ligar, e o rollback (volta exata ao
// estado C). PGlite; nada sai para a rede.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  criarBanco, migration, MIGRATIONS_WHATSAPP_26, MIGRATIONS_PUSH_30, JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

const M30 = '20261119000030_central_notificacoes_push.sql';
const ROLLBACK30 = fs.readFileSync(path.join(__dirname, '..', '..', 'supabase', 'rollbacks', '20261119000030_rollback.sql'), 'utf8');
const MD5_26 = 'd7292c319cc19a4318f90c845a0b0832';
const MD5_30 = '0f8ac1055d747bd708c1b6211a2d8500';
const TOKEN = 'ExponentPushToken[aparelho-do-joao]';

const banco = () => criarBanco({ migracoes: MIGRATIONS_PUSH_30 });
const um = async (db, sql, p = []) => (await db.query(sql, p)).rows[0];
// Chamadas como o usuario logado (auth.uid() do esquema de teste)
async function como(db, uid, sql, p = []) {
  await db.query("SELECT set_config('test.uid', $1, false)", [uid ?? '']);
  try {
    return (await db.query(sql, p)).rows;
  } finally {
    await db.query("SELECT set_config('test.uid', '', false)");
  }
}
let seq = 0;
const aviso = (db, { para, canal = 'push', tipo = 'mensagem', status = 'pendente', dados = {} }) => db.query(
  `INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, dados, status, expira_em)
   VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 day') RETURNING id`,
  [tipo, canal, `t:${++seq}`, para, JSON.stringify(dados), status]).then((r) => r.rows[0].id);
const ligar = (db, valor = true) => db.query('UPDATE public.notificacao_config SET push_ativo = $1 WHERE id', [valor]);
const hashRotina = async (db) => (await um(db,
  "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('public.rotina_notificacoes()')")).h;
const agendarComoCliente = async (db, minutos = 240) => {
  await db.query('ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento');
  const [{ id }] = await como(db, CLIENTE_A,
    `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
     VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4), 'confirmado') RETURNING id`,
    [CLIENTE_A, JOAO, CORTE_30, minutos]);
  return id;
};

test('estado de produção + 30: rotina com o md5 esperado, colunas novas e push DESLIGADO por padrão', async () => {
  const db = await banco();
  assert.equal(await hashRotina(db), MD5_30);
  assert.deepEqual(await um(db, 'SELECT push_ativo, push_ativado_em FROM public.notificacao_config WHERE id'),
    { push_ativo: false, push_ativado_em: null });
  assert.equal((await um(db, "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'notificacoes' AND column_name = 'lida_em'")).n, 1);
});

test('central: cada um só vê as próprias, só do push e sem o tipo teste; campos internos não saem', async () => {
  const db = await banco();
  const minha = await aviso(db, { para: CLIENTE_A, dados: { conversa_id: 'c1', outro_nome: 'João', mensagem_id: 'interno', token: 'x' } });
  await aviso(db, { para: CLIENTE_A, canal: 'whatsapp', tipo: 'novo_agendamento' });
  await aviso(db, { para: CLIENTE_A, tipo: 'teste' });
  const deOutro = await aviso(db, { para: CLIENTE_B });

  const lista = await como(db, CLIENTE_A, 'SELECT * FROM public.minhas_notificacoes()');
  assert.deepEqual(lista.map((l) => l.id), [minha]);
  assert.deepEqual(lista[0].dados, { conversa_id: 'c1', outro_nome: 'João' });
  assert.equal(lista[0].lida_em, null);
  assert.deepEqual((await como(db, CLIENTE_B, 'SELECT id FROM public.minhas_notificacoes()')).map((l) => l.id), [deOutro]);
  // Sem login: nada
  assert.deepEqual(await como(db, null, 'SELECT id FROM public.minhas_notificacoes()'), []);
  assert.equal((await como(db, null, 'SELECT public.contar_notificacoes_nao_lidas() AS n'))[0].n, 0);
});

test('central: contar, marcar as próprias (as de outro são ignoradas) e marcar todas', async () => {
  const db = await banco();
  const a1 = await aviso(db, { para: CLIENTE_A });
  const a2 = await aviso(db, { para: CLIENTE_A, tipo: 'cancelamento' });
  await aviso(db, { para: CLIENTE_A, tipo: 'teste' });
  const b1 = await aviso(db, { para: CLIENTE_B });
  const contar = async (uid) => (await como(db, uid, 'SELECT public.contar_notificacoes_nao_lidas() AS n'))[0].n;
  assert.equal(await contar(CLIENTE_A), 2);

  // A tenta marcar a de B junto com a sua: so a sua muda
  assert.equal((await como(db, CLIENTE_A, 'SELECT public.marcar_notificacoes_lidas($1) AS n', [[a1, b1]]))[0].n, 1);
  assert.equal(await contar(CLIENTE_A), 1);
  assert.equal(await contar(CLIENTE_B), 1);
  assert.equal((await um(db, 'SELECT lida_em FROM public.notificacoes WHERE id = $1', [b1])).lida_em, null);
  // De novo: ja lida, nada muda
  assert.equal((await como(db, CLIENTE_A, 'SELECT public.marcar_notificacoes_lidas($1) AS n', [[a1]]))[0].n, 0);

  assert.equal((await como(db, CLIENTE_A, 'SELECT public.marcar_todas_notificacoes_lidas() AS n'))[0].n, 1);
  assert.equal(await contar(CLIENTE_A), 0);
  assert.equal(await contar(CLIENTE_B), 1);
  assert.notEqual((await um(db, 'SELECT lida_em FROM public.notificacoes WHERE id = $1', [a2])).lida_em, null);

  // Sem login: recusa
  await assert.rejects(como(db, null, 'SELECT public.marcar_todas_notificacoes_lidas()'), /login/);
  await assert.rejects(como(db, null, 'SELECT public.marcar_notificacoes_lidas($1)', [[a1]]), /login/);
});

test('central: paginação pela data e limite', async () => {
  const db = await banco();
  for (let i = 0; i < 5; i++) {
    const id = await aviso(db, { para: CLIENTE_A });
    await db.query("UPDATE public.notificacoes SET criada_em = now() - make_interval(mins => $2) WHERE id = $1", [id, i]);
  }
  const p1 = await como(db, CLIENTE_A, 'SELECT id, criada_em FROM public.minhas_notificacoes(2)');
  assert.equal(p1.length, 2);
  const p2 = await como(db, CLIENTE_A, 'SELECT id FROM public.minhas_notificacoes(10, $1)', [p1[1].criada_em]);
  assert.equal(p2.length, 3);
  assert.equal(new Set([...p1, ...p2].map((l) => l.id)).size, 5);
});

test('permissões: a central é do usuário logado; anon não executa; nada de acesso direto à tabela', async () => {
  const db = await banco();
  const pode = async (papel, fn) => (await um(db, 'SELECT has_function_privilege($1, $2, \'EXECUTE\') AS p', [papel, fn])).p;
  for (const fn of ['public.minhas_notificacoes(integer,timestamptz)', 'public.contar_notificacoes_nao_lidas()',
    'public.marcar_notificacoes_lidas(uuid[])', 'public.marcar_todas_notificacoes_lidas()']) {
    assert.equal(await pode('authenticated', fn), true, fn);
    assert.equal(await pode('anon', fn), false, fn);
  }
  for (const fn of ['public.push_ao_ativar()', 'public.central_dados(jsonb)', 'public.reservar_notificacoes(integer)', 'public.rotina_notificacoes()']) {
    assert.equal(await pode('authenticated', fn), false, fn);
    assert.equal(await pode('anon', fn), false, fn);
  }
  assert.equal((await um(db, "SELECT has_table_privilege('authenticated', 'public.notificacoes', 'SELECT,UPDATE') AS p")).p, false);
});

test('push desligado no banco: não acorda o backend e a reserva não entrega nada (nem com aparelho)', async () => {
  const db = await banco();
  await db.query('INSERT INTO public.dispositivos_push (user_id, token) VALUES ($1, $2)', [USUARIO_JOAO, TOKEN]);
  const ag = await agendarComoCliente(db);
  assert.equal((await um(db, "SELECT count(*)::int AS n FROM public.notificacoes WHERE agendamento_id = $1 AND canal = 'push'", [ag])).n, 1);
  assert.equal((await um(db, 'SELECT public.rotina_notificacoes() AS r')).r.pendentes, false);
  assert.deepEqual((await um(db, 'SELECT public.reservar_notificacoes(50) AS r')).r, []);
  assert.equal((await um(db, "SELECT status FROM public.notificacoes WHERE agendamento_id = $1 AND canal = 'push'", [ag])).status, 'pendente');
});

test('ligar o push: os pendentes de antes viram ignorados (continuam na central); os novos saem', async () => {
  const db = await banco();
  await db.query('INSERT INTO public.dispositivos_push (user_id, token) VALUES ($1, $2)', [USUARIO_JOAO, TOKEN]);
  const antigo = await agendarComoCliente(db, 240);
  const jaEnviado = await aviso(db, { para: USUARIO_JOAO, status: 'enviada' });
  const doWhatsapp = await aviso(db, { para: USUARIO_JOAO, canal: 'whatsapp', tipo: 'novo_agendamento' });

  await ligar(db);
  const cfg = await um(db, 'SELECT push_ativo, push_ativado_em FROM public.notificacao_config WHERE id');
  assert.equal(cfg.push_ativo, true);
  assert.ok(cfg.push_ativado_em);
  assert.deepEqual(await um(db, "SELECT status, motivo FROM public.notificacoes WHERE agendamento_id = $1 AND canal = 'push'", [antigo]),
    { status: 'ignorada', motivo: 'antes_da_ativacao' });
  assert.equal((await um(db, 'SELECT status FROM public.notificacoes WHERE id = $1', [jaEnviado])).status, 'enviada');
  assert.equal((await um(db, 'SELECT status FROM public.notificacoes WHERE id = $1', [doWhatsapp])).status, 'pendente');
  // Continua na central do barbeiro
  const central = await como(db, USUARIO_JOAO, 'SELECT agendamento_id FROM public.minhas_notificacoes()');
  assert.ok(central.some((l) => l.agendamento_id === antigo));
  // Nada antigo e reservado
  assert.deepEqual((await um(db, 'SELECT public.reservar_notificacoes(50) AS r')).r, []);

  // Aviso novo: acorda o backend e e entregue uma vez
  const novo = await agendarComoCliente(db, 300);
  assert.equal((await um(db, 'SELECT public.rotina_notificacoes() AS r')).r.pendentes, true);
  const itens = (await um(db, 'SELECT public.reservar_notificacoes(50) AS r')).r;
  assert.deepEqual(itens.map((i) => [i.tipo, i.dados.agendamento_id, i.dispositivos.length]), [['novo_agendamento', novo, 1]]);
  assert.deepEqual((await um(db, 'SELECT public.reservar_notificacoes(50) AS r')).r, [], 'reservado uma vez so');

  // Desligar de novo: efeito imediato; religar ignora o que ficou pendente
  await ligar(db, false);
  const enquantoDesligado = await agendarComoCliente(db, 360);
  assert.deepEqual((await um(db, 'SELECT public.reservar_notificacoes(50) AS r')).r, []);
  await ligar(db);
  assert.equal((await um(db, "SELECT motivo FROM public.notificacoes WHERE agendamento_id = $1 AND canal = 'push'", [enquantoDesligado])).motivo,
    'antes_da_ativacao');
});

test('migration 30: recusa sem a 26 ou com rotina desconhecida, sem alterar nada', async () => {
  const sem26 = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26.slice(0, -1) });
  await assert.rejects(sem26.exec(migration(M30)), /Rode antes/);
  await sem26.exec('ROLLBACK');
  const alterada = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26 });
  await alterada.exec(`CREATE OR REPLACE FUNCTION public.rotina_notificacoes() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`);
  await assert.rejects(alterada.exec(migration(M30)), /nao e a da migration 26/);
  await alterada.exec('ROLLBACK');
  assert.equal((await um(alterada, "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'notificacao_config' AND column_name = 'push_ativo'")).n, 0);
});

test('rollback: recusa com o push ligado; depois volta exatamente ao estado C, sem apagar avisos', async () => {
  const definicoes = async (db) => (await db.query(
    `SELECT p.proname, pg_get_functiondef(p.oid) AS def FROM pg_proc p
      WHERE p.oid IN (to_regprocedure('public.reservar_notificacoes(integer)'), to_regprocedure('public.rotina_notificacoes()'))
      ORDER BY 1`)).rows.map((r) => ({ ...r, def: r.def.replace(/\r\n/g, '\n') }));
  const so26 = await criarBanco({ migracoes: MIGRATIONS_WHATSAPP_26 });
  const referencia = await definicoes(so26);

  const db = await banco();
  const pendente = await aviso(db, { para: CLIENTE_A });
  await ligar(db);
  await assert.rejects(db.exec(ROLLBACK30), /push esta ligado/);
  await db.exec('ROLLBACK');
  assert.equal(await hashRotina(db), MD5_30, 'nada mudou');
  await ligar(db, false);
  const outro = await aviso(db, { para: CLIENTE_A });

  await db.exec(ROLLBACK30);
  await db.exec(ROLLBACK30); // pode rodar de novo
  assert.equal(await hashRotina(db), MD5_26);
  assert.deepEqual(await definicoes(db), referencia);
  for (const fn of ['minhas_notificacoes(integer,timestamptz)', 'contar_notificacoes_nao_lidas()', 'marcar_notificacoes_lidas(uuid[])',
    'marcar_todas_notificacoes_lidas()', 'push_ao_ativar()', 'central_dados(jsonb)']) {
    assert.equal((await um(db, 'SELECT to_regprocedure($1) IS NULL AS ok', [`public.${fn}`])).ok, true, fn);
  }
  assert.equal((await um(db, `SELECT count(*)::int AS n FROM information_schema.columns
    WHERE (table_name = 'notificacoes' AND column_name = 'lida_em')
       OR (table_name = 'notificacao_config' AND column_name IN ('push_ativo', 'push_ativado_em'))`)).n, 0);
  // Avisos continuam; o que estava pendente nao sai mais pelo push
  assert.equal((await um(db, 'SELECT count(*)::int AS n FROM public.notificacoes WHERE id = ANY ($1)', [[pendente, outro]])).n, 2);
  assert.deepEqual(await um(db, 'SELECT status, motivo FROM public.notificacoes WHERE id = $1', [outro]),
    { status: 'ignorada', motivo: 'rollback_30' });

  // E a 30 pode ser aplicada de novo depois do rollback
  await db.exec(migration(M30));
  assert.equal(await hashRotina(db), MD5_30);
});
