// Postgres embutido (PGlite) com o esquema minimo equivalente ao do Supabase e
// as migrations de agendamento aplicadas, para testar as regras direto no banco.
// As de notificacao entram junto: assim todos os testes rodam com os triggers
// de aviso ativos, como no banco real.
const fs = require('node:fs');
const path = require('node:path');

const MIGRATIONS = path.join(__dirname, '..', '..', '..', 'supabase', 'migrations');
const migration = (nome) => fs.readFileSync(path.join(MIGRATIONS, nome), 'utf8');

const MIGRATIONS_AGENDA = [
  '20261009000013_barbeiro_sem_cascata_agendamentos.sql',
  '20261009000014_conflito_horarios.sql',
  '20261014000015_agenda_com_pausa.sql',
  '20261105000017_limite_diario_servicos.sql',
  '20261105000018_financeiro.sql',
  '20261105000019_pagamentos_duplicidade_auditoria.sql',
  '20261109000020_meu_desempenho.sql',
  '20261109000021_notificacoes.sql',
  '20261109000022_notificacoes_eventos.sql',
];

// Com a confirmacao de presenca pelo WhatsApp (consentimentos + migration 25)
const MIGRATIONS_WHATSAPP = [
  ...MIGRATIONS_AGENDA,
  '20261104000016_consentimentos.sql',
  '20261113000025_whatsapp_confirmacao_presenca.sql',
];

const JOAO = 'b0000000-0000-4000-8000-000000000001';
const PEDRO = 'b0000000-0000-4000-8000-000000000002';
const INATIVO = 'b0000000-0000-4000-8000-000000000003';
const CORTE_30 = '50000000-0000-4000-8000-000000000001';
const COMBO_60 = '50000000-0000-4000-8000-000000000002';
const SEM_VINCULO = '50000000-0000-4000-8000-000000000003';
const BARBA_30 = '50000000-0000-4000-8000-000000000004';
const SOBRANCELHA_30 = '50000000-0000-4000-8000-000000000005';
const CLIENTE_A = 'c0000000-0000-4000-8000-00000000000a';
const CLIENTE_B = 'c0000000-0000-4000-8000-00000000000b';
const CLIENTE_C = 'c0000000-0000-4000-8000-00000000000c';
const ADMIN = 'a0000000-0000-4000-8000-0000000000ad';
const USUARIO_JOAO = 'a0000000-0000-4000-8000-00000000001b';

// Uma quarta-feira futura; os horarios sao hora local da barbearia
const DIA = (() => {
  const d = new Date(Date.now() + 7 * 86400000);
  while (d.getUTCDay() !== 3) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
})();
const as = (hhmm) => `${DIA} ${hhmm} America/Sao_Paulo`;

const ESQUEMA = `
  CREATE ROLE authenticated;
  CREATE ROLE anon;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;

  CREATE TYPE public.app_role AS ENUM ('cliente', 'barbeiro', 'admin');
  CREATE TABLE public.profiles (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid UNIQUE, nome text, telefone text);
  CREATE TABLE public.user_roles (user_id uuid NOT NULL, role public.app_role NOT NULL);
  CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role) RETURNS boolean
    LANGUAGE sql STABLE AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role) $$;

  CREATE TABLE public.barbeiros (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid, nome text NOT NULL, ativo boolean NOT NULL DEFAULT true);
  CREATE TABLE public.servicos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), nome text NOT NULL, preco numeric(10,2) NOT NULL,
    duracao_min integer NOT NULL DEFAULT 30, ativo boolean NOT NULL DEFAULT true);
  CREATE TABLE public.barbeiro_servicos (
    barbeiro_id uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
    servico_id uuid NOT NULL REFERENCES public.servicos(id) ON DELETE CASCADE);
  CREATE TABLE public.horarios_disponiveis (
    barbeiro_id uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
    dia_semana integer NOT NULL, hora_inicio time NOT NULL, hora_fim time NOT NULL);
  CREATE TYPE public.agendamento_status AS ENUM ('confirmado', 'cancelado', 'concluido');
  CREATE TABLE public.agendamentos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    barbeiro_id uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE,
    servico_id uuid NOT NULL REFERENCES public.servicos(id) ON DELETE CASCADE,
    data_hora timestamptz NOT NULL,
    status public.agendamento_status NOT NULL DEFAULT 'confirmado',
    created_at timestamptz NOT NULL DEFAULT now());
  CREATE UNIQUE INDEX agendamentos_horario_unico
    ON public.agendamentos (barbeiro_id, data_hora) WHERE status <> 'cancelado';
  -- Chat (no Supabase tambem foi criado fora das migrations)
  CREATE TABLE public.conversas (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cliente_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    barbeiro_id uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE CASCADE);
  CREATE TABLE public.mensagens (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversa_id uuid NOT NULL REFERENCES public.conversas(id) ON DELETE CASCADE,
    remetente_id uuid NOT NULL,
    conteudo text NOT NULL,
    lida boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now());

  INSERT INTO auth.users VALUES ('${CLIENTE_A}'), ('${CLIENTE_B}'), ('${CLIENTE_C}'), ('${ADMIN}'), ('${USUARIO_JOAO}');
  INSERT INTO public.user_roles VALUES ('${ADMIN}', 'admin'), ('${USUARIO_JOAO}', 'barbeiro');
  INSERT INTO public.barbeiros (id, user_id, nome, ativo) VALUES
    ('${JOAO}', '${USUARIO_JOAO}', 'João', true), ('${PEDRO}', NULL, 'Pedro', true), ('${INATIVO}', NULL, 'Inativo', false);
  INSERT INTO public.servicos (id, nome, preco, duracao_min) VALUES
    ('${CORTE_30}', 'Corte', 40, 30), ('${COMBO_60}', 'Corte + Barba', 70, 60), ('${SEM_VINCULO}', 'Outro', 10, 30),
    ('${BARBA_30}', 'Barba completa', 35, 30), ('${SOBRANCELHA_30}', 'Sobrancelha', 20, 30);
  INSERT INTO public.barbeiro_servicos
    SELECT b.id, s.id FROM public.barbeiros b, public.servicos s WHERE s.id <> '${SEM_VINCULO}';
  -- Quarta: 09:00-12:00 e 13:00-18:00 (almoco no meio)
  INSERT INTO public.horarios_disponiveis
    SELECT b.id, 3, p.i::time, p.f::time FROM public.barbeiros b, (VALUES ('09:00','12:00'), ('13:00','18:00')) p(i, f);
`;

// `antesDasMigrations` roda SQL sobre o esquema antigo (ex.: agendamentos legados);
// `migracoes` troca a lista aplicada (ex.: para testar uma migration isolada)
async function criarBanco({ antesDasMigrations = '', migracoes = MIGRATIONS_AGENDA } = {}) {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite();
  await db.exec(ESQUEMA);
  if (antesDasMigrations) await db.exec(antesDasMigrations);
  for (const nome of migracoes) await db.exec(migration(nome));
  // As migrations precisam poder ser executadas de novo
  for (const nome of migracoes) await db.exec(migration(nome));
  return db;
}

function auxiliares(db) {
  return {
    async limpar() {
      await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento; DELETE FROM public.agendamentos; ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;');
    },
    async agendar(cliente, barbeiro, servico, hhmm, status = 'confirmado') {
      const r = await db.query(
        'INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status) VALUES ($1, $2, $3, $4, $5) RETURNING id',
        [cliente, barbeiro, servico, hhmm.includes(' ') ? hhmm : as(hhmm), status],
      );
      return r.rows[0].id;
    },
    async total() {
      return Number((await db.query('SELECT count(*) AS n FROM public.agendamentos')).rows[0].n);
    },
    async comoUsuario(uid) {
      await db.query("SELECT set_config('test.uid', $1, false)", [uid ?? '']);
    },
  };
}

// Espera a recusa do banco e devolve { code, detail, message }
async function recusa(promessa) {
  try {
    await promessa;
  } catch (e) {
    return { code: e.code, detail: e.detail, message: e.message };
  }
  throw new Error('o banco aceitou uma operação que deveria ser recusada');
}

module.exports = {
  criarBanco, auxiliares, recusa, migration, as, DIA, MIGRATIONS_AGENDA, MIGRATIONS_WHATSAPP,
  JOAO, PEDRO, INATIVO, CORTE_30, COMBO_60, SEM_VINCULO, BARBA_30, SOBRANCELHA_30, CLIENTE_A, CLIENTE_B, CLIENTE_C, ADMIN, USUARIO_JOAO,
};
