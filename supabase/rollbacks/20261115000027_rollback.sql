-- =====================================================================
-- ROLLBACK da migration 20261115000027_despertar_so_whatsapp.sql
--
-- NAO execute sem aprovacao. Se a 26 estiver aplicada, reverta-a antes
-- (supabase/rollbacks/20261116000026_rollback.sql); senao este rollback para
-- sem mudar nada. Pode ser executado de novo. Tudo numa unica transacao.
--
-- Volta ao estado da migration 25: rotina_notificacoes() e copia EXATA da 25;
-- o gatilho despertar_backend e a funcao despertar_backend_apos_aviso() sao
-- copia EXATA da 22 (gerados por script; nao editar a mao).
-- Efeito esperado: o banco volta a chamar o backend a cada aviso novo e a
-- cada minuto enquanto houver QUALQUER aviso pendente, inclusive do push (as
-- chamadas respondidas com 503 DESATIVADO voltam).
-- Nao mexe em tabelas, dados, consentimentos nem no job do pg_cron.
-- Execute no Supabase Dashboard > SQL Editor, como o dono das funcoes
-- (postgres).
-- =====================================================================

BEGIN;

SET LOCAL lock_timeout = '10s';

DO $$
BEGIN
  IF to_regprocedure('public.whatsapp_expirar_solicitacoes()') IS NOT NULL
     OR to_regprocedure('public.whatsapp_versao_aviso()') IS NOT NULL THEN
    RAISE EXCEPTION 'A migration 20261116000026 esta aplicada: reverta-a antes (supabase/rollbacks/20261116000026_rollback.sql). Nada foi alterado.';
  END IF;
  IF to_regclass('public.notificacoes') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'notificacoes' AND column_name = 'canal')
     OR to_regprocedure('public.rotina_notificacoes()') IS NULL
     OR to_regprocedure('public.enfileirar_lembretes()') IS NULL
     OR to_regprocedure('public.enfileirar_confirmacoes_presenca()') IS NULL
     OR to_regprocedure('public.expirar_notificacoes()') IS NULL
     OR to_regprocedure('public.despertar_backend()') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a migration 20261113000025_whatsapp_confirmacao_presenca.sql. Nada foi alterado.';
  END IF;
END $$;

-- 1. Rotina de cada minuto: a da 25
CREATE OR REPLACE FUNCTION public.rotina_notificacoes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lembretes integer;
  v_confirmacoes integer := 0;
  v_expiradas integer;
  v_pendentes boolean;
  v_despertou boolean := false;
BEGIN
  v_lembretes := public.enfileirar_lembretes();
  -- Erro nos pedidos de confirmacao nao pode parar o resto da rotina
  BEGIN
    v_confirmacoes := public.enfileirar_confirmacoes_presenca();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whatsapp: nao foi possivel gerar os pedidos de confirmacao (%)', SQLSTATE;
  END;
  v_expiradas := public.expirar_notificacoes();
  SELECT EXISTS (
    SELECT 1 FROM public.notificacoes
     WHERE (status = 'pendente' AND proxima_tentativa <= now())
        OR (status = 'enviando' AND reservada_ate < now())
  ) INTO v_pendentes;
  IF v_pendentes THEN
    v_despertou := public.despertar_backend();
  END IF;
  RETURN jsonb_build_object(
    'lembretes', v_lembretes, 'confirmacoes', v_confirmacoes, 'expiradas', v_expiradas,
    'pendentes', v_pendentes, 'despertou', v_despertou);
END;
$$;

-- 2. Gatilho de INSERT na fila: o da 22
CREATE OR REPLACE FUNCTION public.despertar_backend_apos_aviso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.despertar_backend();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS despertar_backend ON public.notificacoes;
CREATE TRIGGER despertar_backend
  AFTER INSERT ON public.notificacoes
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.despertar_backend_apos_aviso();

-- 3. Permissoes (as mesmas da 22 e da 25)
REVOKE ALL ON FUNCTION public.despertar_backend_apos_aviso() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotina_notificacoes() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.rotina_notificacoes() TO service_role;
  END IF;
END $$;

COMMIT;
