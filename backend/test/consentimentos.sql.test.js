// Regras da tabela public.consentimentos direto no banco (PGlite), como usuario
// autenticado do Supabase: le so os proprios registros, nao grava nada e o
// historico nao pode ser reescrito.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const { migration, recusa } = require('./helpers/bancoAgenda');

const ANA = 'c0000000-0000-4000-8000-0000000000a1';
const BIA = 'c0000000-0000-4000-8000-0000000000b1';
const MIGRATION = '20261104000016_consentimentos.sql';

let db;

before(async () => {
  const { PGlite } = await import('@electric-sql/pglite');
  db = new PGlite();
  await db.exec(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users (id uuid PRIMARY KEY);
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth, public TO authenticated, anon;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
    -- Como no Supabase: tabelas novas do schema public ja nascem com GRANT ALL
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon;
    INSERT INTO auth.users VALUES ('${ANA}'), ('${BIA}');
  `);
  await db.exec(migration(MIGRATION));
  await db.exec(migration(MIGRATION)); // pode ser executada de novo
});

// Executa como o servico (dono das tabelas) ou como um cliente autenticado
async function comoServico(sql, params) {
  await db.exec('RESET ROLE');
  return db.query(sql, params);
}
async function comoCliente(uid, sql, params) {
  await db.exec('RESET ROLE');
  await db.query("SELECT set_config('test.uid', $1, false)", [uid]);
  await db.exec('SET ROLE authenticated');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('RESET ROLE');
  }
}

const conceder = (uid, versao = 'v1', origem = 'web') => comoServico(
  "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'visagismo_foto', $2, $3) RETURNING id",
  [uid, versao, origem],
).then((r) => r.rows[0].id);

test('cliente le apenas os proprios consentimentos', async () => {
  await conceder(ANA, 'ler');
  await conceder(BIA, 'ler');
  const r = await comoCliente(ANA, "SELECT user_id FROM public.consentimentos WHERE versao_aviso = 'ler'");
  assert.deepEqual(r.rows.map((x) => x.user_id), [ANA]);
});

test('cliente nao consegue registrar consentimento direto no banco', async () => {
  const erro = await recusa(comoCliente(ANA,
    "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'visagismo_foto', 'forjado', 'web')",
    [ANA]));
  assert.match(erro.message, /permission denied/);
});

test('cliente nao consegue alterar nem apagar registros', async () => {
  await conceder(ANA, 'mexer');
  const upd = await recusa(comoCliente(ANA, "UPDATE public.consentimentos SET versao_aviso = 'x' WHERE user_id = $1", [ANA]));
  assert.match(upd.message, /permission denied/);
  const del = await recusa(comoCliente(ANA, 'DELETE FROM public.consentimentos WHERE user_id = $1', [ANA]));
  assert.match(del.message, /permission denied/);
});

test('so um consentimento vigente por usuario, finalidade e versao', async () => {
  await conceder(ANA, 'unico');
  const erro = await recusa(conceder(ANA, 'unico'));
  assert.equal(erro.code, '23505');
});

test('revogacao preserva o registro e permite nova concordancia', async () => {
  const id = await conceder(BIA, 'revogar', 'mobile');
  await comoServico(
    "UPDATE public.consentimentos SET revogado_em = now(), revogado_origem = 'web' WHERE id = $1", [id]);
  await conceder(BIA, 'revogar', 'web');

  const r = await comoServico(
    "SELECT origem, revogado_em IS NOT NULL AS revogado FROM public.consentimentos WHERE user_id = $1 AND versao_aviso = 'revogar' ORDER BY concedido_em, revogado_em NULLS LAST",
    [BIA]);
  assert.deepEqual(r.rows, [{ origem: 'mobile', revogado: true }, { origem: 'web', revogado: false }]);
});

test('historico imutavel: nao reescreve dados nem desfaz revogacao', async () => {
  const id = await conceder(ANA, 'imutavel');
  const reescrita = await recusa(comoServico("UPDATE public.consentimentos SET versao_aviso = 'outra' WHERE id = $1", [id]));
  assert.match(reescrita.message, /apenas revogado/);

  await comoServico("UPDATE public.consentimentos SET revogado_em = now(), revogado_origem = 'web' WHERE id = $1", [id]);
  const desfazer = await recusa(comoServico('UPDATE public.consentimentos SET revogado_em = NULL, revogado_origem = NULL WHERE id = $1', [id]));
  assert.match(desfazer.message, /já revogado/);
});

test('rejeita finalidade e origem fora da lista', async () => {
  const fin = await recusa(comoServico(
    "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'marketing', 'v1', 'web')", [ANA]));
  assert.equal(fin.code, '23514');
  const orig = await recusa(comoServico(
    "INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'visagismo_foto', 'v1', 'desktop')", [ANA]));
  assert.equal(orig.code, '23514');
});
