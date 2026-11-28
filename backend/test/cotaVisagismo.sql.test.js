// Migration 31 (limite de uso do visagismo) num Postgres embutido (PGlite):
// contagem por usuario e do sistema, quando a vaga abre, permissoes e limpeza.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { criarBanco, CLIENTE_A, CLIENTE_B } = require('./helpers/bancoAgenda');

const MIGRATION = '20261126000031_cota_visagismo.sql';
const ROLLBACK = path.join(__dirname, '..', '..', 'supabase', 'rollbacks', '20261126000031_rollback.sql');

let db;
before(async () => {
  // Aplicada duas vezes (criarBanco reexecuta cada migration)
  db = await criarBanco({ migracoes: [MIGRATION] });
});

const consumir = async (user, tipo, porHora, porDia, total) => (await db.query(
  'SELECT public.consumir_cota_visagismo($1, $2, $3, $4, $5) AS r', [user, tipo, porHora, porDia, total])).rows[0].r;
const limpar = () => db.exec('DELETE FROM public.visagismo_uso');
const usoAntigo = (user, tipo, intervalo) => db.query(
  `INSERT INTO public.visagismo_uso (user_id, tipo, criado_em) VALUES ($1, $2, clock_timestamp() - $3::interval)`, [user, tipo, intervalo]);

test('C1. tabela com RLS, sem acesso para anon/authenticated; função não liberada a eles', async () => {
  const t = (await db.query("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.visagismo_uso'::regclass")).rows[0];
  assert.equal(t.relrowsecurity, true);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policy WHERE polrelid = 'public.visagismo_uso'::regclass")).rows[0].n, 0);
  for (const papel of ['anon', 'authenticated']) {
    const { rows: [p] } = await db.query(
      `SELECT has_table_privilege($1, 'public.visagismo_uso', 'SELECT,INSERT,UPDATE,DELETE') AS tabela,
              has_function_privilege($1, 'public.consumir_cota_visagismo(uuid, text, integer, integer, integer)', 'EXECUTE') AS funcao`, [papel]);
    assert.deepEqual(p, { tabela: false, funcao: false }, papel);
  }
});

test('C2. por hora: libera até o limite e diz quando a próxima vaga abre', async () => {
  await limpar();
  assert.equal((await consumir(CLIENTE_A, 'analise', 2, 10, 100)).permitido, true);
  assert.equal((await consumir(CLIENTE_A, 'analise', 2, 10, 100)).permitido, true);
  const r = await consumir(CLIENTE_A, 'analise', 2, 10, 100);
  assert.equal(r.permitido, false);
  assert.equal(r.motivo, 'HORA');
  assert.equal(r.limite, 2);
  const falta = new Date(r.liberar_em).getTime() - Date.now();
  assert.ok(falta > 59 * 60e3 && falta <= 60 * 60e3, `vaga em ~1h (${falta} ms)`);
  // Outro tipo e outro usuário não são afetados
  assert.equal((await consumir(CLIENTE_A, 'imagem', 2, 10, 100)).permitido, true);
  assert.equal((await consumir(CLIENTE_B, 'analise', 2, 10, 100)).permitido, true);
  // A recusa não grava uso
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.visagismo_uso WHERE tipo = 'analise'")).rows[0].n, 3);
});

test('C3. por dia: usos de mais de 1 h ainda contam até completar 24 h', async () => {
  await limpar();
  await usoAntigo(CLIENTE_A, 'imagem', '23 hours');
  await usoAntigo(CLIENTE_A, 'imagem', '5 hours');
  await usoAntigo(CLIENTE_A, 'imagem', '25 hours'); // fora da janela
  const r = await consumir(CLIENTE_A, 'imagem', 5, 2, 100);
  assert.equal(r.motivo, 'DIA');
  const falta = new Date(r.liberar_em).getTime() - Date.now();
  assert.ok(falta > 59 * 60e3 && falta <= 60 * 60e3, 'o uso de 23 h atrás libera em ~1 h');
});

test('C4. total do sistema: vale para todos os usuários; 0 desliga o tipo', async () => {
  await limpar();
  assert.equal((await consumir(CLIENTE_A, 'imagem', 5, 5, 2)).permitido, true);
  assert.equal((await consumir(CLIENTE_B, 'imagem', 5, 5, 2)).permitido, true);
  const r = await consumir('c0000000-0000-4000-8000-00000000000c', 'imagem', 5, 5, 2);
  assert.deepEqual([r.permitido, r.motivo, r.limite], [false, 'TOTAL', 2]);
  const zero = await consumir(CLIENTE_A, 'analise', 5, 5, 0);
  assert.deepEqual([zero.permitido, zero.motivo, zero.liberar_em], [false, 'TOTAL', null]);
});

test('C5. parâmetros inválidos são recusados', async () => {
  for (const args of [[null, 'analise', 1, 1, 1], [CLIENTE_A, 'video', 1, 1, 1], [CLIENTE_A, 'analise', -1, 1, 1], [CLIENTE_A, 'imagem', 1, null, 1]]) {
    await assert.rejects(consumir(...args), /Parâmetros da cota do visagismo inválidos/, JSON.stringify(args));
  }
});

test('C6. apaga usos com mais de 3 dias; usuário excluído leva os usos junto', async () => {
  await limpar();
  await usoAntigo(CLIENTE_B, 'analise', '4 days');
  await usoAntigo(CLIENTE_B, 'analise', '2 days');
  await consumir(CLIENTE_A, 'analise', 5, 5, 50);
  const { rows } = await db.query('SELECT user_id FROM public.visagismo_uso ORDER BY criado_em');
  assert.deepEqual(rows.map((r) => r.user_id), [CLIENTE_B, CLIENTE_A]);
  await db.query('DELETE FROM auth.users WHERE id = $1', [CLIENTE_B]);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM public.visagismo_uso WHERE user_id = $1', [CLIENTE_B])).rows[0].n, 0);
});

test('C7. rollback remove a função e a tabela', async () => {
  const outro = await criarBanco({ migracoes: [MIGRATION] });
  await outro.exec(fs.readFileSync(ROLLBACK, 'utf8'));
  const { rows: [r] } = await outro.query(
    "SELECT to_regclass('public.visagismo_uso') AS t, to_regprocedure('public.consumir_cota_visagismo(uuid, text, integer, integer, integer)') AS f");
  assert.deepEqual(r, { t: null, f: null });
});
