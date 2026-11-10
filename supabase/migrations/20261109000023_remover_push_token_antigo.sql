-- =====================================================================
-- Remove as colunas antigas push_token (barbeiros e profiles), se existirem
--
-- Independente das migrations 21 e 22: pode rodar antes ou depois delas.
-- Antes, rode supabase/verificacoes/notificacoes_pre_requisitos.sql (so
-- leitura) e confira as linhas "Migration 23".
--
-- Por que remover: as colunas eram do envio antigo, em que o proprio celular
-- mandava o push lendo o token da outra pessoa. Nenhuma migration as cria, os
-- tipos do app e do site nao as tem, nenhum codigo grava nelas (o registro de
-- token do app estava vazio) e os unicos usos sao tres leituras desse envio
-- antigo, que o app novo deixa de fazer. Em barbeiros, que qualquer visitante
-- pode ler, um token ali ficaria exposto.
--
-- Por que os tokens nao sao guardados: o cadastro novo (dispositivos_push) e
-- feito pelo proprio app a cada login, ligado ao aparelho e a conta certos. Um
-- token antigo nao diz de que aparelho e, pode ser do Expo Go (outro projeto,
-- recusado pela Expo) e, misturado aos novos, faria a Expo recusar o lote
-- inteiro de envios.
--
-- Seguranca:
--   * a coluna nao existe: nada a fazer;
--   * alguma funcao do banco ainda cita push_token: para e nada e removido;
--   * uma view ou policy usa a coluna: o banco recusa (sem CASCADE) e nada e
--     removido, nem a outra coluna.
-- Apps antigos que ainda leem a coluna nao quebram: a leitura falha em
-- silencio e eles so deixam de tentar o envio antigo (que ja nao funcionava).
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================
DO $$
DECLARE
  v_funcoes text;
  v_tabela text;
  v_preenchidos bigint;
BEGIN
  SELECT string_agg(DISTINCT format('%I.%I', n.nspname, p.proname), ', ')
    INTO v_funcoes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosrc ILIKE '%push_token%'
     AND n.nspname NOT IN ('pg_catalog', 'information_schema');
  IF v_funcoes IS NOT NULL THEN
    RAISE EXCEPTION 'Nada foi removido: estas funcoes ainda citam push_token: %. Revise-as antes.', v_funcoes;
  END IF;

  FOREACH v_tabela IN ARRAY ARRAY['barbeiros', 'profiles'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = v_tabela AND column_name = 'push_token'
    ) THEN
      EXECUTE format('SELECT count(push_token) FROM public.%I', v_tabela) INTO v_preenchidos;
      -- Sem CASCADE: se uma view ou policy usar a coluna, o banco recusa
      EXECUTE format('ALTER TABLE public.%I DROP COLUMN push_token', v_tabela);
      RAISE NOTICE 'public.%.push_token removida (% tokens antigos descartados).', v_tabela, v_preenchidos;
    ELSE
      RAISE NOTICE 'public.%.push_token nao existe: nada a fazer.', v_tabela;
    END IF;
  END LOOP;
END $$;
