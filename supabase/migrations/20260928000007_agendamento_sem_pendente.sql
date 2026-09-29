-- =====================================================================
-- Agendamento sem aprovacao do barbeiro
-- Regra nova: se o horario esta livre, o agendamento ja nasce CONFIRMADO.
-- O status 'pendente' deixa de existir.
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------
-- 1. Agendamentos que estavam aguardando o barbeiro viram confirmados
-- ---------------------------------------------------------------
UPDATE public.agendamentos SET status = 'confirmado' WHERE status = 'pendente';

-- ---------------------------------------------------------------
-- 2. Remove 'pendente' do enum (Postgres nao tem DROP VALUE,
--    entao o tipo e recriado) e troca o default para 'confirmado'
-- ---------------------------------------------------------------
ALTER TABLE public.agendamentos ALTER COLUMN status DROP DEFAULT;

CREATE TYPE public.agendamento_status_novo AS ENUM ('confirmado', 'cancelado', 'concluido');

ALTER TABLE public.agendamentos
  ALTER COLUMN status TYPE public.agendamento_status_novo
  USING status::text::public.agendamento_status_novo;

DROP TYPE public.agendamento_status;
ALTER TYPE public.agendamento_status_novo RENAME TO agendamento_status;

ALTER TABLE public.agendamentos ALTER COLUMN status SET DEFAULT 'confirmado';

COMMIT;

-- ---------------------------------------------------------------
-- 3. Impede dois agendamentos ativos no mesmo horario do mesmo barbeiro.
--    Antes o barbeiro "filtrava" isso ao confirmar; agora quem garante e o banco
--    (evita que dois clientes reservem o mesmo horario ao mesmo tempo).
--    Se ja existirem horarios duplicados, o indice nao e criado e um aviso
--    lista o problema — cancele os duplicados e rode este bloco de novo.
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.agendamentos
    WHERE status <> 'cancelado'
    GROUP BY barbeiro_id, data_hora
    HAVING COUNT(*) > 1
  ) THEN
    RAISE NOTICE 'Existem agendamentos duplicados no mesmo horario; indice unico NAO criado.';
  ELSE
    CREATE UNIQUE INDEX IF NOT EXISTS agendamentos_horario_unico
      ON public.agendamentos (barbeiro_id, data_hora)
      WHERE status <> 'cancelado';
  END IF;
END $$;
