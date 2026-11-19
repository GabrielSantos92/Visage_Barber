// Instalacao nova do banco, do zero (PGlite com a plataforma Supabase SIMULADA:
// test/helpers/plataformaSupabase.js). Nao substitui a instalacao no projeto
// Supabase de teste; serve para provar a ordem, as dependencias e os scripts
// antes de qualquer acesso a um Supabase de verdade.
//
// As tabelas do chat (conversas e mensagens) foram criadas FORA das
// migrations, e o repositorio nao tem a definicao real delas. Enquanto
// supabase/teste/00_dependencias_chat.sql (gerado da consulta de metadados de
// producao, com autorizacao) nao existir, os testes usam CHAT_DO_TESTE: so as
// colunas que o codigo e as migrations usam. NAO e o esquema real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  migrationsEmOrdem, bancoVazio, instalar, aplicarFaixa, MARCA_TESTE, PREPARACAO_CHAT,
} = require('./helpers/plataformaSupabase');

const RAIZ = path.join(__dirname, '..', '..');
const CONSULTAS = fs.readFileSync(path.join(RAIZ, 'supabase', 'verificacoes', 'esquema_chat_producao.sql'), 'utf8');

const CHAT_DO_TESTE = `
  -- SO PARA OS TESTES: o minimo que o codigo e as migrations usam (nao e o esquema real)
  CREATE TABLE public.conversas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL,
    barbeiro_id uuid NOT NULL);
  CREATE TABLE public.mensagens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversa_id uuid NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
    remetente_id uuid NOT NULL,
    conteudo text,
    lida boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now());`;
const PREPARACAO = fs.existsSync(PREPARACAO_CHAT) ? fs.readFileSync(PREPARACAO_CHAT, 'utf8') : CHAT_DO_TESTE;
const ULTIMA_ANTES_DO_CHAT = '20260929000010';

// Consulta N do arquivo de verificacao (sem os comentarios)
function consulta(n) {
  const ini = CONSULTAS.indexOf(`-- Consulta ${n}:`);
  const fim = CONSULTAS.indexOf(`-- Consulta ${n + 1}`, ini);
  const trecho = CONSULTAS.slice(ini, fim < 0 ? undefined : fim);
  return trecho.split('\n').filter((l) => !/^\s*--/.test(l)).join('\n').trim().replace(/;\s*$/, '');
}

// Tabelas e funcoes que o site, o app e o backend usam (lidas do codigo)
function usadosPeloCodigo() {
  const pastas = ['cut-advisor-pro/src', 'barber-mobile/src', 'backend/src'].map((p) => path.join(RAIZ, p));
  const tabelas = new Set();
  const funcoes = new Set();
  const andar = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'test' && e.name !== 'node_modules') andar(p); continue; }
      if (!/\.(ts|tsx|js)$/.test(e.name)) continue;
      const t = fs.readFileSync(p, 'utf8');
      for (const m of t.matchAll(/(?<!storage)\.from\(\s*['"]([a-z_]+)['"]/g)) tabelas.add(m[1]);
      for (const m of t.matchAll(/\b(?:rpc|chamar|banco)\(\s*['"]([a-z_]+)['"]/g)) funcoes.add(m[1]);
    }
  };
  pastas.forEach(andar);
  funcoes.delete('ambiente_do_banco'); // marca do banco de teste: fora das migrations de proposito
  return { tabelas: [...tabelas].sort(), funcoes: [...funcoes].sort() };
}

test('N1. ordem: as 33 migrations (3 de base + 30) aplicadas pela versão, sem versão repetida; a 27 antes da 26', () => {
  const lista = migrationsEmOrdem();
  assert.equal(lista.length, 33);
  assert.equal(new Set(lista.map((m) => m.versao)).size, lista.length);
  assert.ok(lista.slice(0, 2).every((m) => m.arquivo.includes(path.join('cut-advisor-pro', 'supabase'))), 'as duas primeiras são as de base');
  assert.equal(lista.at(-1).nome, '20261118000029_whatsapp_aviso_cancelamento.sql');
  const pos = (v) => lista.findIndex((m) => m.versao === v);
  assert.ok(pos('20261105000018') < pos('20261105000019'));
  assert.ok(pos('20261109000021') < pos('20261109000022'));
  // A 26 exige a 27 (só o WhatsApp acorda o backend): o prefixo de data a põe antes
  assert.ok(pos('20261113000025') < pos('20261115000027') && pos('20261115000027') < pos('20261116000026'));
});

test('N2. sem as tabelas do chat, a instalação nova para na migration 11 (as anteriores entram)', async () => {
  const db = await bancoVazio();
  const r = await instalar(db);
  assert.equal(r.ok, false);
  assert.equal(r.falhou, '20261001000011_visagismo_salvos.sql');
  assert.match(r.erro, /relation "public\.mensagens" does not exist/);
  assert.equal(r.aplicadas.length, 13);
  assert.equal(r.aplicadas.at(-1).split('_')[0], ULTIMA_ANTES_DO_CHAT);
});

test('N3. com a preparação do chat: as 33 migrations entram em ordem e tudo que o código usa existe', async () => {
  const db = await bancoVazio();
  const r = await instalar(db, { preparacao: PREPARACAO });
  assert.equal(r.ok, true, `${r.falhou}: ${r.erro}`);
  assert.equal(r.aplicadas.length, 33);
  assert.equal(r.extensoesTrocadas, 3, 'pg_cron (08 e 22) e pg_net (22)');

  const { tabelas, funcoes } = usadosPeloCodigo();
  assert.ok(tabelas.length >= 15 && funcoes.length >= 25, `${tabelas.length} tabelas, ${funcoes.length} funções`);
  const faltam = [];
  for (const t of tabelas) {
    if (!(await db.query('SELECT to_regclass($1) AS r', [`public.${t}`])).rows[0].r) faltam.push(`tabela ${t}`);
  }
  for (const f of funcoes) {
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = $1", [f]);
    if (!rows[0].n) faltam.push(`função ${f}`);
  }
  assert.deepEqual(faltam, []);
  assert.deepEqual((await db.query("SELECT id FROM storage.buckets ORDER BY id")).rows.map((b) => b.id), ['visagismo']);

  // Jobs do pg_cron criados pelas migrations (nenhum novo pela 26)
  assert.deepEqual((await db.query('SELECT jobname, schedule, command FROM cron.job ORDER BY jobname')).rows.map((j) => [j.jobname, j.schedule]), [
    ['concluir-agendamentos', '*/5 * * * *'], ['notificacoes-limpeza', '30 6 * * *'], ['notificacoes-rotina', '* * * * *']]);
  // Expiração sem o backend: o job de cada minuto chama a rotina, e a rotina
  // chama a expiração das solicitações
  const { command } = (await db.query("SELECT command FROM cron.job WHERE jobname = 'notificacoes-rotina'")).rows[0];
  assert.equal(command, 'SELECT public.rotina_notificacoes();');
  const def = (await db.query("SELECT pg_get_functiondef('public.rotina_notificacoes()'::regprocedure) AS d")).rows[0].d;
  assert.match(def, /public\.whatsapp_expirar_solicitacoes\(\)/);
  // Migration 27 (mantida pela 26): só o canal whatsapp acorda o backend, e não
  // há gatilho de INSERT na fila
  assert.match(def, /canal = 'whatsapp'/);
  assert.equal((await db.query(
    "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'despertar_backend' AND tgrelid = 'public.notificacoes'::regclass")).rows[0].n, 0);
  assert.equal((await db.query("SELECT to_regprocedure('public.despertar_backend_apos_aviso()') AS f")).rows[0].f, null);
  const saida = (await db.query(command.replace(/;$/, ''))).rows[0].rotina_notificacoes;
  assert.equal(saida.solicitacoes_expiradas, 0);

  // A marca de teste NÃO vem das migrations; o script dela entra depois
  assert.equal((await db.query("SELECT to_regprocedure('public.ambiente_do_banco()') AS f")).rows[0].f, null);
  await db.exec(fs.readFileSync(MARCA_TESTE, 'utf8'));
  await db.exec(fs.readFileSync(MARCA_TESTE, 'utf8'));
  assert.equal((await db.query('SELECT public.ambiente_do_banco() AS a')).rows[0].a, 'teste');
});

test('N4. consulta de metadados: só lê o catálogo, roda em transação somente leitura e não cita tabela de dados', async () => {
  for (const n of [1, 2]) {
    const sql = consulta(n);
    const semTextos = sql.replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(semTextos, /\bpublic\./, `consulta ${n}: nenhuma tabela do esquema public`);
    assert.doesNotMatch(semTextos, /\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP|GRANT|REVOKE|TRUNCATE|COPY|SET\s+ROLE)\b/i, `consulta ${n}: só SELECT`);
    for (const m of semTextos.matchAll(/\b(?:FROM|JOIN)\s+(?!LATERAL\b)([a-z_][\w.]*)/gi)) {
      assert.ok(/^pg_catalog\./.test(m[1]) || ['tabelas', 'tipos', 'partes', 'unnest', 'aclexplode'].includes(m[1]), `consulta ${n}: ${m[1]}`);
    }
  }
  // A consulta 3 (opcional, linhas de configuração) fica comentada
  assert.equal(consulta(3), '');

  const db = await bancoVazio();
  assert.equal((await instalar(db, { preparacao: PREPARACAO })).ok, true);
  await db.exec('BEGIN READ ONLY');
  try {
    const def = (await db.query(consulta(1))).rows[0].definicao_chat;
    assert.match(def, /-- Tabelas encontradas: conversas, mensagens/);
    const inv = JSON.parse((await db.query(consulta(2))).rows[0].inventario);
    assert.ok(inv.tabelas.conversas && inv.tabelas.mensagens && inv.tabelas.agendamentos);
    assert.ok(inv.funcoes.includes('rotina_notificacoes()'));
  } finally {
    await db.exec('ROLLBACK');
  }
});

// Impressao digital de conversas e mensagens no catalogo (para comparar bancos)
const DIGITAL = `
  SELECT c.relname,
    (SELECT string_agg(a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull::text || ':'
                       || coalesce(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attnum)
       FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped) AS colunas,
    (SELECT string_agg(k.conname || ':' || pg_get_constraintdef(k.oid), ',' ORDER BY k.conname)
       FROM pg_constraint k WHERE k.conrelid = c.oid AND k.contype IN ('p', 'u', 'f', 'c', 'x')) AS restricoes,
    (SELECT string_agg(pg_get_indexdef(i.indexrelid), ',' ORDER BY pg_get_indexdef(i.indexrelid))
       FROM pg_index i WHERE i.indrelid = c.oid) AS indices,
    c.relrowsecurity AS rls,
    (SELECT string_agg(p.polname || ':' || p.polcmd::text || ':' || p.polpermissive::text || ':' || coalesce(pg_get_expr(p.polqual, p.polrelid), '')
                       || ':' || coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') || ':'
                       || coalesce((SELECT string_agg(r.rolname, '+' ORDER BY r.rolname) FROM pg_roles r WHERE r.oid = ANY (p.polroles)), 'public'),
                       ',' ORDER BY p.polname)
       FROM pg_policy p WHERE p.polrelid = c.oid) AS policies,
    coalesce(c.relacl::text, '') AS acl,
    (SELECT string_agg(t.tgname, ',' ORDER BY t.tgname) FROM pg_trigger t WHERE t.tgrelid = c.oid AND NOT t.tgisinternal) AS gatilhos
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relname IN ('conversas', 'mensagens') ORDER BY 1`;

test('N5. a saída da consulta 1 recria as tabelas do chat iguais (colunas, chaves, índices, RLS, policies, permissões)', async () => {
  // Um esquema de EXERCICIO, mais completo que o do teste, so para provar a
  // consulta (tipo proprio, chaves estrangeiras, unica, check, indice, RLS,
  // policies, permissoes e um gatilho que nao vem das migrations)
  const EXERCICIO = `
    CREATE TYPE public.tipo_exercicio AS ENUM ('texto', 'imagem');
    CREATE TABLE public.conversas (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      cliente_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
      barbeiro_id uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
      criada_em timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT conversas_par_unico UNIQUE (cliente_id, barbeiro_id));
    CREATE TABLE public.mensagens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      conversa_id uuid NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
      remetente_id uuid NOT NULL,
      conteudo text CHECK (length(conteudo) <= 2000),
      tipo public.tipo_exercicio NOT NULL DEFAULT 'texto',
      lida boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now());
    CREATE INDEX mensagens_conversa_data ON public.mensagens (conversa_id, created_at);
    ALTER TABLE public.conversas ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public.mensagens ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Participantes veem a conversa" ON public.conversas FOR SELECT TO authenticated
      USING (cliente_id = auth.uid() OR barbeiro_id IN (SELECT b.id FROM public.barbeiros b WHERE b.user_id = auth.uid()));
    CREATE POLICY "Cliente abre conversa" ON public.conversas FOR INSERT TO authenticated WITH CHECK (cliente_id = auth.uid());
    CREATE POLICY "Participantes enviam" ON public.mensagens FOR INSERT TO authenticated WITH CHECK (remetente_id = auth.uid());
    GRANT SELECT, INSERT ON public.conversas, public.mensagens TO authenticated;
    CREATE FUNCTION public.gatilho_exercicio() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
    CREATE TRIGGER gatilho_exercicio BEFORE INSERT ON public.mensagens FOR EACH ROW EXECUTE FUNCTION public.gatilho_exercicio();`;

  // "Producao" de exercicio: o chat entra depois das migrations de base (usa
  // barbeiros) e as demais depois dele, como aconteceu de verdade
  const BASE = '20260414205318';
  const original = await bancoVazio();
  await aplicarFaixa(original, { ate: BASE });
  await original.exec(EXERCICIO);
  await aplicarFaixa(original, { desde: BASE });

  await original.exec('BEGIN READ ONLY');
  const def = (await original.query(consulta(1))).rows[0].definicao_chat;
  await original.exec('ROLLBACK');
  // Gatilhos saem comentados, para revisao (o da 22 e o que nao vem de migration)
  assert.match(def, /-- GATILHO: CREATE TRIGGER gatilho_exercicio/);
  assert.match(def, /-- GATILHO: CREATE TRIGGER notificar_mensagem/);
  assert.match(def, /CREATE TYPE public\.tipo_exercicio AS ENUM \('texto', 'imagem'\);/);

  // Projeto novo: as migrations ate a 10, a saida da consulta no lugar da
  // preparacao, e as demais
  const novo = await bancoVazio();
  await aplicarFaixa(novo, { ate: ULTIMA_ANTES_DO_CHAT });
  await novo.exec(def);
  await aplicarFaixa(novo, { desde: ULTIMA_ANTES_DO_CHAT });

  const a = (await original.query(DIGITAL)).rows;
  const b = (await novo.query(DIGITAL)).rows;
  // O gatilho de exercicio fica so no original (sai comentado); o resto e igual
  assert.deepEqual(a.map((x) => x.gatilhos), [null, 'gatilho_exercicio,notificar_mensagem']);
  assert.deepEqual(b.map((x) => x.gatilhos), [null, 'notificar_mensagem']);
  assert.deepEqual(b.map(({ gatilhos, ...x }) => x), a.map(({ gatilhos, ...x }) => x));
});
