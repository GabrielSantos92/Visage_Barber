-- =====================================================================
-- Notificacoes push (3): segredo na chamada do banco ao backend
--
-- PROPOSTA DA ETAPA 2: nao execute antes da aprovacao.
--
-- Por que: a rota POST /api/notificacoes/processar exige o cabecalho
-- X-Notificacoes-Segredo. A funcao public.despertar_backend() da migration 22
-- chama o backend sem cabecalho nenhum, entao toda chamada seria recusada
-- (401) e o backend, dormindo no Render gratuito, nunca seria acordado.
--
-- O que muda: so a funcao public.despertar_backend() (mesma assinatura e mesmas
-- permissoes). A chamada passa a levar o segredo, lido do Supabase Vault
-- (guardado criptografado). Sem o segredo no Vault, sem URL https ou sem
-- pg_net, ela nao chama ninguem. Nao muda tabela, dado, trigger nem regra.
--
-- Rode depois da 20261109000022_notificacoes_eventos.sql. Pode ser executada
-- de novo.
--
-- Antes de ligar a chamada (uma vez, no SQL Editor), guarde no Vault o MESMO
-- valor de NOTIFICACOES_SEGREDO do backend (minimo 32 caracteres):
--   SELECT vault.create_secret('<segredo>', 'notificacoes_segredo_backend',
--                              'Cabecalho X-Notificacoes-Segredo da chamada ao backend');
-- Para trocar depois:
--   SELECT vault.update_secret(
--     (SELECT id FROM vault.secrets WHERE name = 'notificacoes_segredo_backend'), '<novo>');
-- O segredo nunca fica neste arquivo nem no Git.
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

DO $$
BEGIN
  IF to_regprocedure('public.despertar_backend()') IS NULL OR to_regclass('public.notificacao_config') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a 20261109000022_notificacoes_eventos.sql. Nada foi alterado.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.despertar_backend()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_segredo text;
BEGIN
  SELECT url_backend INTO v_url FROM public.notificacao_config WHERE id;
  IF v_url IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'http_post' AND pronamespace = to_regnamespace('net')
  ) THEN
    RETURN false;
  END IF;
  -- O segredo so viaja criptografado
  IF v_url !~ '^https://' THEN
    RAISE WARNING 'notificacoes: url_backend precisa ser https; o backend nao foi chamado';
    RETURN false;
  END IF;
  IF to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_segredo USING 'notificacoes_segredo_backend';
  END IF;
  IF coalesce(length(v_segredo), 0) < 32 THEN
    RAISE WARNING 'notificacoes: segredo do backend ausente no Vault; o backend nao foi chamado';
    RETURN false;
  END IF;

  EXECUTE 'SELECT net.http_post(url := $1, body := ''{}''::jsonb, headers := $2, timeout_milliseconds := 5000)'
    USING rtrim(v_url, '/') || '/api/notificacoes/processar',
          jsonb_build_object('Content-Type', 'application/json', 'X-Notificacoes-Segredo', v_segredo);
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  -- Sem SQLERRM: a mensagem de erro poderia repetir os parametros da chamada
  RAISE WARNING 'notificacoes: nao foi possivel chamar o backend (%)', SQLSTATE;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.despertar_backend() FROM PUBLIC, anon, authenticated;
