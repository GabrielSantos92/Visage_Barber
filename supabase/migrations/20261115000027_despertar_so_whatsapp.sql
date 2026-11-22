-- =====================================================================
-- Notificacoes: so avisos do WhatsApp acordam o backend
--
-- NAO execute sem aprovacao. Requer a migration
-- 20261113000025_whatsapp_confirmacao_presenca.sql aplicada e a
-- 20261116000026_whatsapp_cancelamento_confirmado.sql NAO aplicada (com a 26
-- aplicada, para sem mudar nada). Pode ser executada de novo enquanto a 26 nao
-- estiver aplicada. Tudo numa unica transacao: se algo falhar, nada fica.
-- Rollback: supabase/rollbacks/20261115000027_rollback.sql.
--
-- Por que (diagnostico somente leitura de 17/11/2026): o push esta desligado,
-- mas os gatilhos da migration 22 continuam gravando avisos do canal push. A
-- rotina de cada minuto acordava o backend com QUALQUER aviso pendente e o
-- gatilho despertar_backend o chamava a cada INSERT na fila: o Render recebia
-- uma chamada por minuto (respondida com 503 DESATIVADO) sem nada a fazer.
--
-- O que muda (so isto):
--   1. rotina_notificacoes(): igual a da 25. A unica diferenca: so avisos do
--      canal whatsapp prontos para envio (pendente vencido, ou em envio com a
--      reserva vencida) acordam o backend. No maximo uma chamada por execucao.
--   2. Saem o gatilho despertar_backend (AFTER INSERT em public.notificacoes,
--      migration 22) e a funcao dele, despertar_backend_apos_aviso(). O job
--      notificacoes-rotina do pg_cron passa a ser o unico acionamento.
-- Por que o gatilho nao faz falta:
--   * pedidos de confirmacao criados pela rotina: a mesma execucao da rotina
--     acorda o backend logo depois de cria-los (uma chamada para todos);
--   * avisos gravados durante o webhook (whatsapp_registrar_resposta e, na 26,
--     whatsapp_avisar_cancelamento_nao_concluido): o backend esta acordado
--     tratando o evento e le a fila em seguida;
--   * qualquer outro INSERT do canal whatsapp: a proxima execucao do pg_cron
--     (cerca de 1 minuto, no maximo).
--
-- O que NAO muda: despertar_backend() (migration 24), o job do pg_cron,
-- tabelas, dados (os avisos do push que ja existem continuam como estao e
-- vencem sozinhos), consentimentos, RLS, as funcoes do WhatsApp e as demais
-- permissoes. Nada aqui envia mensagem nem liga canal.
--
-- Ordem: o prefixo de data (15/11) coloca este arquivo ANTES da 26 na ordem
-- por nome; ele foi criado em 17/11/2026. A 26 ajustada exige esta migration
-- e mantem o mesmo filtro na rotina dela.
-- NAO reexecute esta migration depois da 26: ela trocaria a rotina da 26 e
-- apagaria a expiracao das solicitacoes de cancelamento (por isso ela para).
-- NAO reexecute a 21, a 22 nem a 25 depois desta: a 22 recria o gatilho e uma
-- rotina sem os pedidos de confirmacao; a 25 recria a rotina sem o filtro.
-- Execute no Supabase Dashboard > SQL Editor, como o dono das funcoes
-- (postgres).
-- =====================================================================

BEGIN;

-- Remover o gatilho trava public.notificacoes por um instante: se outra
-- transacao a segurar por mais de 10 s, para sem mudar nada (rode de novo)
SET LOCAL lock_timeout = '10s';

-- ---------------------------------------------------------------
-- 0. Pre-requisitos: se faltar algo, para aqui sem mudar nada
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_outros text;
BEGIN
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
  IF to_regprocedure('public.whatsapp_expirar_solicitacoes()') IS NOT NULL
     OR to_regprocedure('public.whatsapp_versao_aviso()') IS NOT NULL THEN
    RAISE EXCEPTION 'A migration 20261116000026 ja esta aplicada neste banco: esta migration trocaria a rotina dela e apagaria a expiracao das solicitacoes de cancelamento. A 26 ajustada ja traz o filtro de canal. Nada foi alterado.';
  END IF;
  -- A funcao do gatilho so sai se nenhum outro gatilho a usar
  SELECT string_agg(format('%s em %s', t.tgname, t.tgrelid::regclass), ', ')
    INTO v_outros
    FROM pg_trigger t
   WHERE t.tgfoid = to_regprocedure('public.despertar_backend_apos_aviso()')
     AND NOT (t.tgname = 'despertar_backend' AND t.tgrelid = 'public.notificacoes'::regclass);
  IF v_outros IS NOT NULL THEN
    RAISE EXCEPTION 'despertar_backend_apos_aviso() tambem e usada por: %. Nada foi alterado.', v_outros;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Rotina de cada minuto (job notificacoes-rotina): a da 25 com o filtro
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
  -- So o canal whatsapp acorda o backend (migration 27): avisos do push
  -- (desligado) nunca chamam o Render. Uma chamada no maximo por execucao.
  SELECT EXISTS (
    SELECT 1 FROM public.notificacoes
     WHERE canal = 'whatsapp'
       AND ((status = 'pendente' AND proxima_tentativa <= now())
            OR (status = 'enviando' AND reservada_ate < now()))
  ) INTO v_pendentes;
  IF v_pendentes THEN
    v_despertou := public.despertar_backend();
  END IF;
  RETURN jsonb_build_object(
    'lembretes', v_lembretes, 'confirmacoes', v_confirmacoes, 'expiradas', v_expiradas,
    'pendentes', v_pendentes, 'despertou', v_despertou);
END;
$$;

-- ---------------------------------------------------------------
-- 2. Sem o gatilho de INSERT na fila (sem CASCADE: se algo mais dependesse
--    da funcao, o banco recusaria e nada ficaria)
-- ---------------------------------------------------------------
DROP TRIGGER IF EXISTS despertar_backend ON public.notificacoes;
DROP FUNCTION IF EXISTS public.despertar_backend_apos_aviso();

-- ---------------------------------------------------------------
-- 3. Permissoes (as mesmas da 25)
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.rotina_notificacoes() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.rotina_notificacoes() TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 4. Conferencia final, antes do COMMIT
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_rotina oid := to_regprocedure('public.rotina_notificacoes()');
  v_fonte text := (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.rotina_notificacoes()'));
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.notificacoes'::regclass AND t.tgname = 'despertar_backend')
     OR to_regprocedure('public.despertar_backend_apos_aviso()') IS NOT NULL
     OR position('canal = ''whatsapp''' IN v_fonte) = 0
     OR position('public.enfileirar_confirmacoes_presenca()' IN v_fonte) = 0
     OR NOT (SELECT prosecdef FROM pg_proc WHERE oid = v_rotina) THEN
    RAISE EXCEPTION 'Conferencia final da migration 27 falhou. Nada foi alterado.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles r
              WHERE r.rolname IN ('anon', 'authenticated') AND has_function_privilege(r.oid, v_rotina, 'EXECUTE')) THEN
    RAISE EXCEPTION 'Conferencia final da migration 27 falhou: anon ou authenticated executam a rotina. Nada foi alterado.';
  END IF;
END $$;

COMMIT;
