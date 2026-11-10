// Seguranca das migrations de notificacao antes de rodar no Supabase: a 21
// confere o esquema antes de criar qualquer coisa; a 22 exige a 21; a 23 so
// remove as colunas antigas push_token se nada depender delas; e a
// pre-checagem (somente leitura) mostra tudo isso antes.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { criarBanco, auxiliares, migration, MIGRATIONS_AGENDA, JOAO, CORTE_30, CLIENTE_A } = require('./helpers/bancoAgenda');

const M21 = '20261109000021_notificacoes.sql';
const M22 = '20261109000022_notificacoes_eventos.sql';
const M23 = '20261109000023_remover_push_token_antigo.sql';
const M24 = '20261109000024_notificacoes_segredo.sql';
// pg_net e Vault falsos: registram as chamadas em vez de sair para a rede
const NET_E_VAULT_FALSOS = `
  CREATE SCHEMA net;
  CREATE TABLE net.chamadas (id bigserial PRIMARY KEY, url text, body jsonb, headers jsonb, timeout integer);
  CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
      headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
    RETURNS bigint LANGUAGE sql
    AS $$ INSERT INTO net.chamadas (url, body, headers, timeout) VALUES (url, body, headers, timeout_milliseconds) RETURNING id $$;
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text);
  CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
`;
const SEGREDO_BANCO = 'segredo-do-banco-com-mais-de-32-caracteres-xyz';
const ANTES_DAS_NOTIFICACOES = MIGRATIONS_AGENDA.filter((m) => m !== M21 && m !== M22);
const PRE_CHECAGEM = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'verificacoes', 'notificacoes_pre_requisitos.sql'), 'utf8');

const AUDITORIA = fs.readFileSync(
  path.join(__dirname, '..', '..', 'supabase', 'verificacoes', 'notificacoes_auditoria.sql'), 'utf8');
const somenteLeitura = (sql) => {
  const codigo = sql.replace(/--.*$/gm, '').replace(/\$q\$[\s\S]*?\$q\$/g, "''").replace(/'(?:[^']|'')*'/g, "''");
  assert.doesNotMatch(codigo, /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment|do|call|set|copy|vacuum|lock)\b/i);
  assert.equal(codigo.split(';').filter((parte) => parte.trim()).length, 1);
};

const checar = async (db) => (await db.query(PRE_CHECAGEM)).rows;
const bloqueios = (linhas) => linhas.filter((l) => l.situacao === 'BLOQUEIA').map((l) => l.item);
const linhasDe = (linhas, verificacao) => linhas.filter((l) => l.verificacao === verificacao);
const existe = async (db, tabela) => (await db.query('SELECT to_regclass($1) IS NOT NULL AS ok', [`public.${tabela}`])).rows[0].ok;
// So tabelas (uma view que use a coluna tambem aparece em information_schema.columns)
const colunasPushToken = async (db) => (await db.query(
  `SELECT c.table_name
     FROM information_schema.columns c
     JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'push_token' AND t.table_type = 'BASE TABLE'
    ORDER BY 1`,
)).rows.map((r) => r.table_name);
const COM_COLUNAS_ANTIGAS = `
  ALTER TABLE public.barbeiros ADD COLUMN push_token text;
  ALTER TABLE public.profiles ADD COLUMN push_token text;
`;

test('pré-checagem: é uma única consulta, sem nenhum comando que altere o banco', () => {
  const codigo = PRE_CHECAGEM
    .replace(/--.*$/gm, '') // comentarios
    .replace(/'(?:[^']|'')*'/g, "''"); // textos
  assert.doesNotMatch(codigo, /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment|do|call|set|copy|vacuum|lock)\b/i);
  assert.equal(codigo.split(';').filter((parte) => parte.trim()).length, 1);
  assert.match(codigo.trim(), /^with\b/i);
});

test('pré-checagem: no banco como o esperado, nada bloqueia', async () => {
  const db = await criarBanco({ migracoes: ANTES_DAS_NOTIFICACOES });
  const linhas = await checar(db);
  assert.deepEqual(bloqueios(linhas), []);
  assert.ok(linhasDe(linhas, 'Migration 21: coluna necessaria').every((l) => l.situacao === 'OK'));
  assert.deepEqual(linhasDe(linhas, 'Migration 21: chave primaria').map((l) => [l.item, l.situacao]),
    [['conversas.id', 'OK'], ['mensagens.id', 'OK']]);
  assert.deepEqual(linhasDe(linhas, 'Migrations 21 e 22: nome da tabela nova').map((l) => l.resultado), Array(5).fill('livre'));
  // O PGlite nao tem pg_cron nem pg_net: a checagem avisa, sem bloquear
  assert.deepEqual(linhasDe(linhas, 'Migration 22: extensao').map((l) => [l.item, l.situacao]),
    [['pg_cron', 'ATENCAO'], ['pg_net', 'ATENCAO']]);
  assert.equal(linhasDe(linhas, 'Migration 23: coluna antiga')[0].resultado, 'nao existe em nenhuma tabela: nada a remover');
  assert.deepEqual(linhasDe(linhas, 'Migration 23: tokens antigos guardados').map((l) => l.resultado), ['0', '0']);
  assert.equal(linhasDe(linhas, 'Migration 23: dependencias')[0].situacao, 'OK');
});

test('migration 21: com o esquema diferente do esperado, para sem criar nada', async () => {
  const db = await criarBanco({ migracoes: ANTES_DAS_NOTIFICACOES });
  await db.exec('ALTER TABLE public.mensagens DROP COLUMN lida');
  await db.exec('CREATE TABLE public.notificacoes (id integer)');
  assert.deepEqual(bloqueios(await checar(db)), ['mensagens.lida']);
  await assert.rejects(
    db.exec(migration(M21)),
    /nada foi criado\. mensagens\.lida nao existe; ja existe uma tabela public\.notificacoes diferente da esperada/,
  );
  for (const tabela of ['dispositivos_push', 'notificacao_preferencias', 'notificacao_envios']) {
    assert.equal(await existe(db, tabela), false, tabela);
  }
});

test('migration 22: exige a 21 e, sem ela, para sem criar nada', async () => {
  const db = await criarBanco({ migracoes: ANTES_DAS_NOTIFICACOES });
  await assert.rejects(db.exec(migration(M22)), /Rode antes a 20261109000021_notificacoes\.sql/);
  assert.equal(await existe(db, 'notificacao_config'), false);
  const triggers = await db.query("SELECT count(*)::int AS n FROM pg_trigger WHERE tgname LIKE 'notificar_%'");
  assert.equal(triggers.rows[0].n, 0);
});

test('auditoria: é uma única consulta somente leitura (inclusive as consultas internas ao pg_cron e ao pg_net)', () => {
  somenteLeitura(AUDITORIA);
  for (const interna of AUDITORIA.match(/\$q\$[\s\S]*?\$q\$/g)) {
    assert.doesNotMatch(interna.replace(/'(?:[^']|'')*'/g, "''"), /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/i);
  }
});

test('auditoria: com 21, 22 e 23 aplicadas só aponta o que falta no ambiente (extensões); acusa trigger desligado e permissão indevida', async () => {
  const db = await criarBanco();
  await db.exec(migration(M23));
  const problemas = (linhas) => linhas.filter((l) => l.situacao === 'PROBLEMA').map((l) => l.item).sort();
  const SEM_EXTENSOES = ['net.http_post (usada para acordar o backend)', 'notificacoes-limpeza', 'notificacoes-rotina', 'pg_cron', 'pg_net'];
  assert.deepEqual(problemas((await db.query(AUDITORIA)).rows), SEM_EXTENSOES);

  await db.exec('ALTER TABLE public.mensagens DISABLE TRIGGER notificar_mensagem');
  await db.exec('GRANT EXECUTE ON FUNCTION public.reservar_notificacoes(integer) TO authenticated');
  assert.deepEqual(problemas((await db.query(AUDITORIA)).rows),
    [...SEM_EXTENSOES, 'notificar_mensagem em mensagens', 'public.reservar_notificacoes(integer)'].sort());
});

test('migration 23: sem as colunas antigas, não faz nada (e pode rodar de novo)', async () => {
  const db = await criarBanco();
  await db.exec(migration(M23));
  await db.exec(migration(M23));
  assert.deepEqual(await colunasPushToken(db), []);
});

test('migration 23: remove push_token de barbeiros e profiles e descarta os tokens, sem tocar no resto', async () => {
  const db = await criarBanco({ antesDasMigrations: COM_COLUNAS_ANTIGAS });
  await db.query("UPDATE public.barbeiros SET push_token = 'ExponentPushToken[antigo]' WHERE id = $1", [JOAO]);
  await db.query("INSERT INTO public.profiles (user_id, nome, push_token) VALUES ($1, 'Ana', 'ExponentPushToken[antigo-ana]')", [CLIENTE_A]);

  const antes = await checar(db);
  assert.deepEqual(bloqueios(antes), []);
  assert.deepEqual(linhasDe(antes, 'Migration 23: coluna antiga').map((l) => l.item), ['barbeiros.push_token', 'profiles.push_token']);
  assert.deepEqual(linhasDe(antes, 'Migration 23: tokens antigos guardados').map((l) => [l.item, l.resultado]),
    [['barbeiros.push_token', '1'], ['profiles.push_token', '1']]);

  const barbeiros = (await db.query('SELECT id, nome, user_id, ativo FROM public.barbeiros ORDER BY id')).rows;
  await db.exec(migration(M23));
  assert.deepEqual(await colunasPushToken(db), []);
  assert.deepEqual((await db.query('SELECT id, nome, user_id, ativo FROM public.barbeiros ORDER BY id')).rows, barbeiros);
  assert.equal((await db.query('SELECT nome FROM public.profiles WHERE user_id = $1', [CLIENTE_A])).rows[0].nome, 'Ana');
});

test('migration 23: se uma view usa a coluna, nada é removido (nem a outra coluna)', async () => {
  const db = await criarBanco({ antesDasMigrations: COM_COLUNAS_ANTIGAS });
  await db.exec('CREATE VIEW public.tokens_clientes AS SELECT user_id, push_token FROM public.profiles');
  const travas = bloqueios(await checar(db));
  assert.equal(travas.length, 1);
  assert.match(travas[0], /tokens_clientes/);
  await assert.rejects(db.exec(migration(M23)), /depend/);
  assert.deepEqual(await colunasPushToken(db), ['barbeiros', 'profiles']);
});

test('migration 23: se uma função ainda cita push_token, nada é removido', async () => {
  const db = await criarBanco({ antesDasMigrations: COM_COLUNAS_ANTIGAS });
  await db.exec('CREATE FUNCTION public.token_do_barbeiro(p uuid) RETURNS text LANGUAGE sql AS $$ SELECT push_token FROM public.barbeiros WHERE id = p $$');
  assert.deepEqual(bloqueios(await checar(db)), ['public.token_do_barbeiro']);
  await assert.rejects(db.exec(migration(M23)), /public\.token_do_barbeiro/);
  assert.deepEqual(await colunasPushToken(db), ['barbeiros', 'profiles']);
});

// ---------------------------------------------------------------
// Proposta 24: segredo na chamada do banco ao backend
// ---------------------------------------------------------------
async function bancoComNetEVault() {
  const db = await criarBanco({ antesDasMigrations: NET_E_VAULT_FALSOS });
  await db.exec(migration(M24));
  await db.exec(migration(M24)); // pode ser executada de novo
  return db;
}
const chamadasAoBackend = async (db) => (await db.query('SELECT url, headers FROM net.chamadas ORDER BY id')).rows;
const despertar = async (db) => (await db.query('SELECT public.despertar_backend() AS r')).rows[0].r;

test('proposta 24: só chama o backend com URL https e segredo no Vault, e manda o segredo no cabeçalho', async () => {
  const db = await bancoComNetEVault();
  assert.equal(await despertar(db), false); // sem URL
  await db.query("UPDATE public.notificacao_config SET url_backend = 'http://backend.teste'");
  assert.equal(await despertar(db), false); // o segredo nao viaja sem https
  await db.query("UPDATE public.notificacao_config SET url_backend = 'https://backend.teste/'");
  assert.equal(await despertar(db), false); // sem segredo no Vault
  await db.query("INSERT INTO vault.secrets (name, secret) VALUES ('notificacoes_segredo_backend', 'curto')");
  assert.equal(await despertar(db), false); // segredo curto demais
  assert.deepEqual(await chamadasAoBackend(db), []);

  await db.query("UPDATE vault.secrets SET secret = $1 WHERE name = 'notificacoes_segredo_backend'", [SEGREDO_BANCO]);
  assert.equal(await despertar(db), true);
  assert.deepEqual(await chamadasAoBackend(db), [{
    url: 'https://backend.teste/api/notificacoes/processar',
    headers: { 'Content-Type': 'application/json', 'X-Notificacoes-Segredo': SEGREDO_BANCO },
  }]);
  // Continua fechada para o app e o site
  const perm = await db.query("SELECT has_function_privilege('authenticated', 'public.despertar_backend()', 'EXECUTE') AS logado");
  assert.equal(perm.rows[0].logado, false);
});

test('proposta 24: um evento real acorda o backend com o segredo; operação desfeita não chama ninguém', async () => {
  const db = await bancoComNetEVault();
  const { agendar } = auxiliares(db);
  await db.query("UPDATE public.notificacao_config SET url_backend = 'https://backend.teste'");
  await db.query("INSERT INTO vault.secrets (name, secret) VALUES ('notificacoes_segredo_backend', $1)", [SEGREDO_BANCO]);

  await db.exec('BEGIN');
  await agendar(CLIENTE_A, JOAO, CORTE_30, '10:00');
  await db.exec('ROLLBACK');
  assert.deepEqual(await chamadasAoBackend(db), []);

  await agendar(CLIENTE_A, JOAO, CORTE_30, '10:00');
  const chamadas = await chamadasAoBackend(db);
  assert.equal(chamadas.length, 1);
  assert.equal(chamadas[0].headers['X-Notificacoes-Segredo'], SEGREDO_BANCO);
});

test('proposta 24: exige a 22 e, sem ela, para sem alterar nada', async () => {
  const db = await criarBanco({ migracoes: ANTES_DAS_NOTIFICACOES });
  await assert.rejects(db.exec(migration(M24)), /Rode antes a 20261109000022_notificacoes_eventos\.sql/);
  assert.equal((await db.query("SELECT to_regprocedure('public.despertar_backend()') AS f")).rows[0].f, null);
});

test('auditoria: reconhece a 24 e o segredo no Vault (só pelo nome, sem ler o valor)', async () => {
  const linha = (linhas, item) => linhas.find((l) => l.item === item);
  const SEGREDO_ITEM = 'segredo do backend no Vault (notificacoes_segredo_backend)';
  const V24_ITEM = 'despertar_backend envia o segredo (migration 24)';

  const antes = (await (await criarBanco()).query(AUDITORIA)).rows;
  assert.deepEqual([linha(antes, SEGREDO_ITEM).resultado, linha(antes, V24_ITEM).resultado],
    ['Vault ausente', 'nao (migration 24 nao aplicada)']);

  const db = await bancoComNetEVault();
  await db.query("INSERT INTO vault.secrets (name, secret) VALUES ('notificacoes_segredo_backend', $1)", [SEGREDO_BANCO]);
  const depois = (await db.query(AUDITORIA)).rows;
  assert.deepEqual([linha(depois, SEGREDO_ITEM).situacao, linha(depois, V24_ITEM).situacao], ['OK', 'OK']);
  assert.ok(!JSON.stringify(depois).includes(SEGREDO_BANCO));
});
