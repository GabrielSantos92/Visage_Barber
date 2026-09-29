-- =====================================================================
-- Conclusao automatica de agendamentos
-- Regra: quando passa o horario + a duracao do servico, o agendamento
-- CONFIRMADO vira CONCLUIDO sozinho. O barbeiro so intervem para cancelar
-- (cliente faltou).
-- Execute no Supabase Dashboard > SQL Editor (depois da migration 000007)
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Funcao que conclui os agendamentos que ja terminaram.
--    SECURITY DEFINER: roda com permissao do dono, entao o cliente pode
--    chamar via RPC sem precisar de permissao de UPDATE. Ela so mexe em
--    agendamentos confirmados cujo horario ja acabou — nada mais.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.concluir_agendamentos_passados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer;
BEGIN
  UPDATE public.agendamentos a
     SET status = 'concluido'
    FROM public.servicos s
   WHERE s.id = a.servico_id
     AND a.status = 'confirmado'
     AND a.data_hora + make_interval(mins => COALESCE(s.duracao_min, 30)) <= now();

  GET DIAGNOSTICS total = ROW_COUNT;
  RETURN total;
END;
$$;

REVOKE ALL ON FUNCTION public.concluir_agendamentos_passados() FROM public;
GRANT EXECUTE ON FUNCTION public.concluir_agendamentos_passados() TO authenticated;

-- Conclui o que ja passou
SELECT public.concluir_agendamentos_passados();

-- ---------------------------------------------------------------
-- 2. Agenda a funcao para rodar a cada 5 minutos (pg_cron).
--    Se o pg_cron nao estiver disponivel, o app continua funcionando:
--    as telas chamam a funcao ao carregar.
-- ---------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;

  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'concluir-agendamentos';
  PERFORM cron.schedule(
    'concluir-agendamentos',
    '*/5 * * * *',
    'SELECT public.concluir_agendamentos_passados();'
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel (%). Ative em Database > Extensions e rode este bloco de novo.', SQLERRM;
END $$;
