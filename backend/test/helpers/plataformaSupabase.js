// Instalacao nova do banco, do zero, como num projeto Supabase recem-criado:
// a "plataforma" (o que o Supabase ja traz: auth, storage, pg_cron, pg_net,
// Vault, papeis) simulada no PGlite, e as migrations do repositorio aplicadas
// em ordem de versao, uma por uma.
//
// A plataforma aqui e uma SIMULACAO minima (so o que as migrations usam): nao
// substitui o teste no projeto Supabase de teste. O PGlite nao tem as
// extensoes pg_cron e pg_net; as duas instrucoes CREATE EXTENSION delas sao
// trocadas por NULL (contadas: se o texto mudar, o teste avisa), e os
// esquemas cron e net simulados registram os jobs e as chamadas.
const fs = require('node:fs');
const path = require('node:path');

const RAIZ = path.join(__dirname, '..', '..', '..');
const PASTAS_MIGRATIONS = [
  path.join(RAIZ, 'cut-advisor-pro', 'supabase', 'migrations'), // 3 migrations-base (Lovable)
  path.join(RAIZ, 'supabase', 'migrations'),
];
const MARCA_TESTE = path.join(RAIZ, 'supabase', 'teste', 'marcar_banco_de_teste.sql');
const PREPARACAO_CHAT = path.join(RAIZ, 'supabase', 'teste', '00_dependencias_chat.sql');

// Todas as migrations, na ordem em que o Supabase as aplicaria (pela versao,
// o numero no inicio do nome), com a pasta de cada uma
function migrationsEmOrdem() {
  const lista = [];
  for (const pasta of PASTAS_MIGRATIONS) {
    for (const nome of fs.readdirSync(pasta)) {
      if (nome.endsWith('.sql')) lista.push({ nome, versao: nome.split('_')[0], arquivo: path.join(pasta, nome) });
    }
  }
  lista.sort((a, b) => a.versao.localeCompare(b.versao) || a.nome.localeCompare(b.nome));
  return lista;
}

const PLATAFORMA = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN;

  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text,
    raw_user_meta_data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  -- Quem chama: nos testes, set_config('request.jwt.claim.sub', <uuid>)
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;

  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[], owner uuid,
    created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
  CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), bucket_id text REFERENCES storage.buckets(id),
    name text, owner uuid, metadata jsonb, created_at timestamptz DEFAULT now());
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.foldername(name text) RETURNS text[] LANGUAGE sql IMMUTABLE
    AS $$ SELECT (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)] $$;

  CREATE SCHEMA extensions;

  -- pg_cron simulado: so registra os jobs
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (
    jobid bigserial PRIMARY KEY, jobname text UNIQUE, schedule text NOT NULL, command text NOT NULL,
    active boolean NOT NULL DEFAULT true);
  CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql
    AS $$ INSERT INTO cron.job (jobname, schedule, command) VALUES (job_name, schedule, command)
          ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command
          RETURNING jobid $$;
  CREATE FUNCTION cron.unschedule(job_id bigint) RETURNS boolean LANGUAGE sql
    AS $$ WITH d AS (DELETE FROM cron.job WHERE jobid = job_id RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $$;
  CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql
    AS $$ WITH d AS (DELETE FROM cron.job WHERE jobname = job_name RETURNING 1) SELECT EXISTS (SELECT 1 FROM d) $$;

  -- pg_net simulado: so registra as chamadas (nada sai da maquina)
  CREATE SCHEMA net;
  CREATE TABLE net.chamadas (id bigserial PRIMARY KEY, url text, headers jsonb, criada_em timestamptz DEFAULT now());
  CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
                                headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb,
                                timeout_milliseconds integer DEFAULT 5000) RETURNS bigint LANGUAGE sql
    AS $$ INSERT INTO net.chamadas (url, headers) VALUES (url, headers) RETURNING id $$;

  -- Vault simulado
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, description text, secret text);
  CREATE VIEW vault.decrypted_secrets AS SELECT id, name, description, secret AS decrypted_secret FROM vault.secrets;
  CREATE FUNCTION vault.create_secret(new_secret text, new_name text DEFAULT NULL, new_description text DEFAULT '')
    RETURNS uuid LANGUAGE sql
    AS $$ INSERT INTO vault.secrets (secret, name, description) VALUES (new_secret, new_name, new_description) RETURNING id $$;

  CREATE PUBLICATION supabase_realtime;
`;

// As unicas instrucoes que o PGlite nao executa (extensoes do Supabase)
const EXTENSOES = [
  'CREATE EXTENSION IF NOT EXISTS pg_cron;',
  'CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;',
];

function textoParaPglite(texto) {
  let trocas = 0;
  let saida = texto;
  for (const instrucao of EXTENSOES) {
    const partes = saida.split(instrucao);
    trocas += partes.length - 1;
    saida = partes.join('NULL; -- (PGlite) ' + instrucao.replace(';', ''));
  }
  return { texto: saida, trocas };
}

// Banco vazio com a plataforma simulada
async function bancoVazio() {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(PLATAFORMA);
  return db;
}

// Aplica as migrations em ordem, cada uma numa execucao propria (como no SQL
// Editor). Para na primeira que falhar e devolve onde parou.
//   preparacao: SQL rodado antes da primeira migration
//   ate:        versao da ultima migration a aplicar (inclusive)
async function instalar(db, { preparacao = null, ate = null } = {}) {
  const aplicadas = [];
  let extensoesTrocadas = 0;
  if (preparacao) await db.exec(preparacao);
  for (const m of migrationsEmOrdem()) {
    if (ate && m.versao > ate) break;
    const { texto, trocas } = textoParaPglite(fs.readFileSync(m.arquivo, 'utf8'));
    extensoesTrocadas += trocas;
    try {
      await db.exec(texto);
    } catch (e) {
      // Migration com BEGIN/COMMIT que falhou deixa a transacao aberta
      await db.exec('ROLLBACK').catch(() => {});
      return { ok: false, aplicadas, falhou: m.nome, erro: e.message, extensoesTrocadas };
    }
    aplicadas.push(m.nome);
  }
  return { ok: true, aplicadas, falhou: null, erro: null, extensoesTrocadas };
}

// Aplica so as migrations com versao no intervalo (desde, ate], em ordem
async function aplicarFaixa(db, { desde = '', ate = '99999999999999' } = {}) {
  for (const m of migrationsEmOrdem()) {
    if (m.versao > desde && m.versao <= ate) await db.exec(textoParaPglite(fs.readFileSync(m.arquivo, 'utf8')).texto);
  }
}

module.exports = {
  migrationsEmOrdem, bancoVazio, instalar, aplicarFaixa, textoParaPglite, PLATAFORMA, MARCA_TESTE, PREPARACAO_CHAT, EXTENSOES,
};
