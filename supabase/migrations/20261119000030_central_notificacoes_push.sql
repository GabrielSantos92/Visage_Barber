-- =====================================================================
-- Notificacoes (5): central de notificacoes no app e push do Android de volta
--
-- NAO execute sem aprovacao. Requer as migrations 21 e 22 (push), a 25, a 27
-- e a 26 (estado C da auditoria). Pode ser executada de novo. Tudo numa unica
-- transacao: se algo falhar, nada fica.
-- Rollback: supabase/rollbacks/20261119000030_rollback.sql.
--
-- O que faz (so acrescenta; nenhum dado e apagado):
--   1. notificacoes.lida_em: a central marca o que o usuario ja viu.
--   2. Central (app): minhas_notificacoes, contar_notificacoes_nao_lidas,
--      marcar_notificacoes_lidas e marcar_todas_notificacoes_lidas. So o
--      proprio usuario logado (auth.uid()), so o canal push, nunca o tipo
--      teste. Nenhum acesso direto a tabela (continua sem policy).
--   3. Marcador do push NO BANCO: notificacao_config.push_ativo, DESLIGADO.
--      Desligado, o push nao acorda o backend (rotina_notificacoes) e
--      reservar_notificacoes nao entrega nada, mesmo com o backend ligado.
--   4. Ao ligar o marcador (UPDATE ... SET push_ativo = true), os avisos push
--      ainda pendentes viram 'ignorada' (motivo antes_da_ativacao): nada
--      antigo sai pelo push. Eles continuam na central.
-- A rotina de cada minuto e a da 26 com uma unica mudanca (quem acorda o
-- backend); a reserva do push e a da 25 com uma unica mudanca (o marcador).
-- Os avisos do WhatsApp (25 a 29) continuam como estao.
--
-- Ativacao (cada passo com autorizacao), so depois do APK com o push:
--   1. EXPO_ACCESS_TOKEN e NOTIFICACOES_PUSH_ATIVO=true no Render
--   2. UPDATE public.notificacao_config SET push_ativo = true WHERE id;
-- Para desligar: push_ativo = false (efeito imediato, sem deploy).
-- Execute no Supabase Dashboard > SQL Editor, como postgres.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_hash text;
BEGIN
  IF to_regprocedure('public.whatsapp_expirar_solicitacoes()') IS NULL
     OR to_regprocedure('public.enfileirar_confirmacoes_presenca()') IS NULL
     OR to_regprocedure('public.reservar_notificacoes(integer)') IS NULL
     OR to_regclass('public.notificacao_config') IS NULL THEN
    RAISE EXCEPTION 'Rode antes as migrations 21, 22, 25, 27 e 26. Nada foi alterado.';
  END IF;
  -- So sobre a rotina da 26 (estado C) ou a desta migration (reexecucao)
  SELECT md5(replace(p.prosrc, chr(13), '')) INTO v_hash
    FROM pg_proc p WHERE p.oid = to_regprocedure('public.rotina_notificacoes()');
  IF v_hash IS DISTINCT FROM 'd7292c319cc19a4318f90c845a0b0832' AND v_hash IS DISTINCT FROM '0f8ac1055d747bd708c1b6211a2d8500' THEN
    RAISE EXCEPTION 'rotina_notificacoes nao e a da migration 26 (md5 %). Rode a auditoria (supabase/verificacoes/notificacoes_auditoria.sql). Nada foi alterado.', v_hash;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Colunas
-- ---------------------------------------------------------------
ALTER TABLE public.notificacoes ADD COLUMN IF NOT EXISTS lida_em timestamptz;
CREATE INDEX IF NOT EXISTS notificacoes_central_nao_lidas ON public.notificacoes (destinatario_id)
  WHERE lida_em IS NULL AND canal = 'push';

ALTER TABLE public.notificacao_config ADD COLUMN IF NOT EXISTS push_ativo boolean NOT NULL DEFAULT false;
ALTER TABLE public.notificacao_config ADD COLUMN IF NOT EXISTS push_ativado_em timestamptz;

-- ---------------------------------------------------------------
-- 2. Central de notificacoes (usuario logado; so as proprias)
-- ---------------------------------------------------------------
-- So os campos que o app usa para montar o texto e abrir a tela certa
CREATE OR REPLACE FUNCTION public.central_dados(p_dados jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
    FROM jsonb_each(coalesce(p_dados, '{}'::jsonb)) e
   WHERE e.key IN ('agendamento_id', 'data_hora', 'servico', 'cliente_nome', 'barbeiro_nome', 'papel', 'ator',
                   'minutos', 'conversa_id', 'barbeiro_id', 'cliente_id', 'outro_nome')
$$;

-- Mais novas primeiro; p_antes pagina pela data (criada_em < p_antes)
CREATE OR REPLACE FUNCTION public.minhas_notificacoes(p_limite integer DEFAULT 30, p_antes timestamptz DEFAULT NULL)
RETURNS TABLE (id uuid, tipo text, dados jsonb, agendamento_id uuid, conversa_id uuid,
               criada_em timestamptz, lida_em timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT n.id, n.tipo, public.central_dados(n.dados), n.agendamento_id, n.conversa_id, n.criada_em, n.lida_em
    FROM public.notificacoes n
   WHERE n.destinatario_id = auth.uid()
     AND n.canal = 'push'
     AND n.tipo <> 'teste'
     AND (p_antes IS NULL OR n.criada_em < p_antes)
   ORDER BY n.criada_em DESC, n.id DESC
   LIMIT greatest(1, least(coalesce(p_limite, 30), 100))
$$;

CREATE OR REPLACE FUNCTION public.contar_notificacoes_nao_lidas()
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT count(*)::integer
    FROM public.notificacoes n
   WHERE n.destinatario_id = auth.uid()
     AND n.canal = 'push'
     AND n.tipo <> 'teste'
     AND n.lida_em IS NULL
$$;

-- Ids de outra pessoa (ou inexistentes) sao ignorados em silencio
CREATE OR REPLACE FUNCTION public.marcar_notificacoes_lidas(p_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', DETAIL = 'NAO_AUTENTICADO', MESSAGE = 'Faça login para continuar.';
  END IF;
  IF p_ids IS NULL OR cardinality(p_ids) = 0 THEN
    RETURN 0;
  END IF;
  IF cardinality(p_ids) > 200 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'MUITOS_IDS', MESSAGE = 'Muitas notificações de uma vez.';
  END IF;
  UPDATE public.notificacoes n
     SET lida_em = now()
   WHERE n.id = ANY (p_ids)
     AND n.destinatario_id = v_uid
     AND n.canal = 'push'
     AND n.lida_em IS NULL;
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

CREATE OR REPLACE FUNCTION public.marcar_todas_notificacoes_lidas()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', DETAIL = 'NAO_AUTENTICADO', MESSAGE = 'Faça login para continuar.';
  END IF;
  UPDATE public.notificacoes n
     SET lida_em = now()
   WHERE n.destinatario_id = v_uid
     AND n.canal = 'push'
     AND n.tipo <> 'teste'
     AND n.lida_em IS NULL;
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

-- ---------------------------------------------------------------
-- 3. Ligar o push: os avisos pendentes de antes nunca saem pelo push
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.push_ao_ativar()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.push_ativo AND NOT coalesce(OLD.push_ativo, false) THEN
    NEW.push_ativado_em := now();
    UPDATE public.notificacoes
       SET status = 'ignorada', motivo = 'antes_da_ativacao', reservada_ate = NULL, atualizada_em = now()
     WHERE canal = 'push' AND status IN ('pendente', 'enviando');
  END IF;
  NEW.atualizado_em := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS push_ao_ativar ON public.notificacao_config;
CREATE TRIGGER push_ao_ativar
  BEFORE UPDATE OF push_ativo ON public.notificacao_config
  FOR EACH ROW EXECUTE FUNCTION public.push_ao_ativar();

-- ---------------------------------------------------------------
-- 4. Reserva do push: a da migration 25 + o marcador
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.reservar_notificacoes(p_limite integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  n public.notificacoes%ROWTYPE;
  v_motivo text;
  v_dispositivos jsonb;
  v_item jsonb;
  v_saida jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.expirar_notificacoes();

  -- Push desligado no banco (migration 30): nada e reservado nem enviado,
  -- mesmo que o backend esteja ligado (NOTIFICACOES_PUSH_ATIVO)
  IF NOT coalesce((SELECT c.push_ativo FROM public.notificacao_config c WHERE c.id), false) THEN
    RETURN '[]'::jsonb;
  END IF;

  WITH livres AS (
    SELECT id
      FROM public.notificacoes
     WHERE canal = 'push'
       AND ((status = 'pendente' AND proxima_tentativa <= now())
            OR (status = 'enviando' AND reservada_ate < now()))
     ORDER BY proxima_tentativa, criada_em
     LIMIT greatest(1, least(coalesce(p_limite, 50), 100))
     FOR UPDATE SKIP LOCKED
  ), reservadas AS (
    UPDATE public.notificacoes x
       SET status = 'enviando',
           tentativas = x.tentativas + 1,
           reservada_ate = now() + interval '2 minutes',
           atualizada_em = now()
      FROM livres
     WHERE x.id = livres.id
    RETURNING x.id
  )
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_ids FROM reservadas;

  FOR n IN
    SELECT * FROM public.notificacoes WHERE id = ANY (v_ids) ORDER BY proxima_tentativa, criada_em
  LOOP
    v_motivo := public.motivo_para_nao_enviar(n);

    IF v_motivo IS NULL THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'token', d.token) ORDER BY d.criado_em), '[]'::jsonb)
        INTO v_dispositivos
        FROM public.dispositivos_push d
       WHERE d.user_id = n.destinatario_id
         AND d.ativo
         AND NOT EXISTS (
           SELECT 1 FROM public.notificacao_envios e
            WHERE e.notificacao_id = n.id AND e.dispositivo_id = d.id AND e.status <> 'erro');

      IF jsonb_array_length(v_dispositivos) = 0 THEN
        -- Todos os aparelhos ja receberam (ex.: retomada depois de uma queda)
        IF EXISTS (SELECT 1 FROM public.notificacao_envios e
                    WHERE e.notificacao_id = n.id AND e.status IN ('aceito', 'entregue')) THEN
          UPDATE public.notificacoes
             SET status = 'enviada', reservada_ate = NULL, enviada_em = coalesce(enviada_em, now()),
                 atualizada_em = now()
           WHERE id = n.id;
          CONTINUE;
        END IF;
        v_motivo := 'sem_aparelho';
      END IF;
    END IF;

    IF v_motivo IS NOT NULL THEN
      UPDATE public.notificacoes
         SET status = CASE WHEN v_motivo = 'prazo' THEN 'expirada' ELSE 'ignorada' END,
             motivo = v_motivo, reservada_ate = NULL, atualizada_em = now()
       WHERE id = n.id;
      CONTINUE;
    END IF;

    v_item := jsonb_build_object(
      'id', n.id,
      'tipo', n.tipo,
      'destinatario_id', n.destinatario_id,
      'tentativas', n.tentativas,
      'dados', n.dados,
      'dispositivos', v_dispositivos);
    IF n.tipo = 'mensagem' THEN
      -- O mesmo contador de nao lidas dos apps: mensagens do outro, nao lidas
      v_item := v_item || jsonb_build_object('nao_lidas', (
        SELECT count(*) FROM public.mensagens m
         WHERE m.conversa_id = n.conversa_id AND m.remetente_id <> n.destinatario_id AND NOT m.lida));
    END IF;
    v_saida := v_saida || jsonb_build_array(v_item);
  END LOOP;

  RETURN v_saida;
END;
$$;

-- ---------------------------------------------------------------
-- 5. Rotina de cada minuto: a da migration 26 + o push acordando o backend
--    so com o marcador ligado
-- ---------------------------------------------------------------
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
  v_solicitacoes integer := 0;
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
  BEGIN
    v_solicitacoes := public.whatsapp_expirar_solicitacoes();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whatsapp: nao foi possivel expirar as solicitacoes de cancelamento (%)', SQLSTATE;
  END;
  -- Acordam o backend: o canal whatsapp (migration 27) e o canal push SO com o
  -- push ligado no banco (notificacao_config.push_ativo, migration 30). Com ele
  -- desligado, avisos do push nunca chamam o Render. Uma chamada no maximo por
  -- execucao.
  SELECT EXISTS (
    SELECT 1 FROM public.notificacoes
     WHERE (canal = 'whatsapp'
            OR (canal = 'push'
                AND coalesce((SELECT c.push_ativo FROM public.notificacao_config c WHERE c.id), false)))
       AND ((status = 'pendente' AND proxima_tentativa <= now())
            OR (status = 'enviando' AND reservada_ate < now()))
  ) INTO v_pendentes;
  IF v_pendentes THEN
    v_despertou := public.despertar_backend();
  END IF;
  RETURN jsonb_build_object(
    'lembretes', v_lembretes, 'confirmacoes', v_confirmacoes, 'expiradas', v_expiradas,
    'solicitacoes_expiradas', v_solicitacoes, 'pendentes', v_pendentes, 'despertou', v_despertou);
END;
$$;

-- ---------------------------------------------------------------
-- 6. Permissoes
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.central_dados(jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.minhas_notificacoes(integer, timestamptz) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.contar_notificacoes_nao_lidas() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marcar_notificacoes_lidas(uuid[]) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marcar_todas_notificacoes_lidas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_notificacoes(integer, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.contar_notificacoes_nao_lidas() TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_notificacoes_lidas(uuid[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marcar_todas_notificacoes_lidas() TO authenticated;
REVOKE ALL ON FUNCTION public.push_ao_ativar() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_notificacoes(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotina_notificacoes() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.reservar_notificacoes(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rotina_notificacoes() TO service_role;
  END IF;
END $$;

COMMIT;
