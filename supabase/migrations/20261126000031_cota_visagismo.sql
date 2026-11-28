-- =====================================================================
-- 31. Limite de uso do visagismo (análise por foto e simulação do corte)
-- =====================================================================
-- Cada análise e cada simulação chamam provedores de IA pagos (Replicate ou
-- Google). Esta migration guarda cada uso e conta, numa única transação, quanto
-- o usuário já usou na última hora e nas últimas 24 horas e quanto o sistema
-- inteiro usou nas últimas 24 horas. Como a contagem fica no banco, o limite vale
-- para todas as instâncias do backend ao mesmo tempo.
--
-- Só o backend usa (service_role). Nem o site nem o app leem ou gravam aqui:
-- a tabela tem RLS sem policies e a função não é liberada para anon/authenticated.
-- Os limites vêm do backend a cada chamada (variáveis VISAGISMO_* do Render).
--
-- Depende só de auth.users. Pode ser executada de novo.
-- Rollback: supabase/rollbacks/20261126000031_rollback.sql
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.visagismo_uso (
  id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo      text NOT NULL CHECK (tipo IN ('analise', 'imagem')),
  criado_em timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.visagismo_uso IS
  'Usos da análise por foto e da simulação (limite de custo da IA). Só o backend acessa; guarda 3 dias.';

CREATE INDEX IF NOT EXISTS visagismo_uso_usuario_idx ON public.visagismo_uso (user_id, tipo, criado_em);
CREATE INDEX IF NOT EXISTS visagismo_uso_tipo_idx    ON public.visagismo_uso (tipo, criado_em);

ALTER TABLE public.visagismo_uso ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.visagismo_uso FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------
-- consumir_cota_visagismo: confere os três limites e, se couber, registra o uso.
--   p_por_hora  máximo do usuário na última hora
--   p_por_dia   máximo do usuário nas últimas 24 horas
--   p_total_dia máximo do sistema inteiro nas últimas 24 horas
-- Limite 0 bloqueia o tipo inteiro (serve de chave para desligar a IA).
-- Devolve { permitido, motivo (TOTAL | DIA | HORA), limite, liberar_em }.
-- liberar_em é quando a próxima vaga abre (null se o limite for 0).
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consumir_cota_visagismo(
  p_user_id uuid, p_tipo text, p_por_hora integer, p_por_dia integer, p_total_dia integer)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_agora   timestamptz := clock_timestamp();
  v_hora    integer;
  v_dia     integer;
  v_total   integer;
  v_liberar timestamptz;
BEGIN
  IF p_user_id IS NULL OR p_tipo IS NULL OR p_tipo NOT IN ('analise', 'imagem')
     OR p_por_hora IS NULL OR p_por_dia IS NULL OR p_total_dia IS NULL
     OR p_por_hora < 0 OR p_por_dia < 0 OR p_total_dia < 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'COTA_PARAMETRO_INVALIDO',
      MESSAGE = 'Parâmetros da cota do visagismo inválidos.';
  END IF;

  -- Uma contagem por vez, valendo para todas as instâncias do backend: duas
  -- análises simultâneas não passam juntas pela última vaga.
  PERFORM pg_advisory_xact_lock(hashtextextended('visagismo:cota', 0));

  -- Só as últimas 24 horas importam; guarda 3 dias para conferência
  DELETE FROM public.visagismo_uso WHERE criado_em < v_agora - interval '3 days';

  SELECT count(*) INTO v_total
    FROM public.visagismo_uso
   WHERE tipo = p_tipo AND criado_em > v_agora - interval '24 hours';

  IF v_total >= p_total_dia THEN
    SELECT criado_em + interval '24 hours' INTO v_liberar
      FROM public.visagismo_uso
     WHERE tipo = p_tipo AND criado_em > v_agora - interval '24 hours'
     ORDER BY criado_em
    OFFSET v_total - p_total_dia LIMIT 1;
    RETURN jsonb_build_object('permitido', false, 'motivo', 'TOTAL', 'limite', p_total_dia, 'liberar_em', v_liberar);
  END IF;

  SELECT count(*) FILTER (WHERE criado_em > v_agora - interval '1 hour'), count(*)
    INTO v_hora, v_dia
    FROM public.visagismo_uso
   WHERE user_id = p_user_id AND tipo = p_tipo AND criado_em > v_agora - interval '24 hours';

  IF v_dia >= p_por_dia THEN
    SELECT criado_em + interval '24 hours' INTO v_liberar
      FROM public.visagismo_uso
     WHERE user_id = p_user_id AND tipo = p_tipo AND criado_em > v_agora - interval '24 hours'
     ORDER BY criado_em
    OFFSET v_dia - p_por_dia LIMIT 1;
    RETURN jsonb_build_object('permitido', false, 'motivo', 'DIA', 'limite', p_por_dia, 'liberar_em', v_liberar);
  END IF;

  IF v_hora >= p_por_hora THEN
    SELECT criado_em + interval '1 hour' INTO v_liberar
      FROM public.visagismo_uso
     WHERE user_id = p_user_id AND tipo = p_tipo AND criado_em > v_agora - interval '1 hour'
     ORDER BY criado_em
    OFFSET v_hora - p_por_hora LIMIT 1;
    RETURN jsonb_build_object('permitido', false, 'motivo', 'HORA', 'limite', p_por_hora, 'liberar_em', v_liberar);
  END IF;

  INSERT INTO public.visagismo_uso (user_id, tipo, criado_em) VALUES (p_user_id, p_tipo, v_agora);
  RETURN jsonb_build_object('permitido', true, 'usados_hora', v_hora + 1, 'usados_dia', v_dia + 1, 'total_dia', v_total + 1);
END;
$$;

REVOKE ALL ON FUNCTION public.consumir_cota_visagismo(uuid, text, integer, integer, integer) FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.visagismo_uso TO service_role;
    GRANT EXECUTE ON FUNCTION public.consumir_cota_visagismo(uuid, text, integer, integer, integer) TO service_role;
  END IF;
END;
$$;
