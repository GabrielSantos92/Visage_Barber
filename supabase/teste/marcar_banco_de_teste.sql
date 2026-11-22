-- =====================================================================
-- Marca ESTE banco como banco de TESTE.
--
-- Rode SOMENTE no projeto Supabase exclusivo de teste, logo depois de aplicar
-- as migrations (antes de criar contas e agendamentos de teste). NUNCA no
-- projeto de producao. NAO fica em supabase/migrations de proposito: aplicar
-- todas as migrations em producao nunca cria esta marca.
--
-- O backend em BACKEND_AMBIENTE=teste chama public.ambiente_do_banco() pelo
-- MESMO cliente que todas as rotas usam (backend/src/services/
-- ambienteServidor.js e supabaseServico.js), antes de atender qualquer
-- pedido. Se a resposta nao for 'teste' (funcao inexistente, chave de outro
-- projeto, banco de producao), o backend de teste nao atende nada. Em
-- producao acontece o contrario: banco com esta marca bloqueia o backend de
-- producao.
--
-- Protecao contra rodar no lugar errado: se o banco ainda nao tem a marca e
-- ja tem agendamentos ou pagamentos, para sem criar nada.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.ambiente_banco') IS NULL
     AND ((to_regclass('public.agendamentos') IS NOT NULL AND EXISTS (SELECT 1 FROM public.agendamentos))
          OR (to_regclass('public.pagamentos') IS NOT NULL AND EXISTS (SELECT 1 FROM public.pagamentos))) THEN
    RAISE EXCEPTION 'Este banco ja tem agendamentos ou pagamentos: parece ser o de producao. Nada foi criado.';
  END IF;
END $$;

-- Uma linha so, e o unico valor possivel e 'teste'
CREATE TABLE IF NOT EXISTS public.ambiente_banco (
  unico      boolean PRIMARY KEY DEFAULT true CHECK (unico),
  ambiente   text NOT NULL CHECK (ambiente = 'teste'),
  marcado_em timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ambiente_banco ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ambiente_banco FROM PUBLIC, anon, authenticated;
INSERT INTO public.ambiente_banco (ambiente) VALUES ('teste') ON CONFLICT (unico) DO NOTHING;

CREATE OR REPLACE FUNCTION public.ambiente_do_banco()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT a.ambiente FROM public.ambiente_banco a WHERE a.unico
$$;

REVOKE ALL ON FUNCTION public.ambiente_do_banco() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.ambiente_do_banco() TO service_role;
  END IF;
END $$;

COMMIT;

-- Conferencia (somente leitura), nos DOIS projetos:
--   SELECT to_regprocedure('public.ambiente_do_banco()') IS NOT NULL AS tem_marca;
-- Teste: true. Producao: false.
