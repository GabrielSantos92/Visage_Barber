-- Consentimentos do titular (LGPD), comecando pelo envio de foto ao visagismo.
-- Execute no Supabase Dashboard > SQL Editor. Seguro para re-executar.
--
-- Cada manifestacao e uma linha: conceder insere, revogar preenche revogado_em.
-- Nada e apagado nem reescrito, para demonstrar as manifestacoes anteriores
-- (art. 8, par. 2 da LGPD: o onus da prova do consentimento e do controlador).
--
-- Quem grava e apenas o backend (service role), que confere a sessao e a versao
-- do aviso. O app so le os proprios registros: um cliente nao consegue criar,
-- alterar ou ver o consentimento de outro.

CREATE TABLE IF NOT EXISTS public.consentimentos (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Finalidade especifica (art. 8, par. 4): uma autorizacao por finalidade
  finalidade      text NOT NULL CHECK (finalidade IN ('visagismo_foto')),
  -- Versao do Aviso de Privacidade apresentado no momento da concordancia
  versao_aviso    text NOT NULL,
  origem          text NOT NULL CHECK (origem IN ('web', 'mobile')),
  concedido_em    timestamptz NOT NULL DEFAULT now(),
  revogado_em     timestamptz,
  revogado_origem text CHECK (revogado_origem IN ('web', 'mobile')),
  CHECK (revogado_em IS NULL OR revogado_em >= concedido_em),
  CHECK ((revogado_em IS NULL) = (revogado_origem IS NULL))
);

-- No maximo um consentimento vigente por usuario, finalidade e versao
CREATE UNIQUE INDEX IF NOT EXISTS consentimentos_vigente_unico
  ON public.consentimentos (user_id, finalidade, versao_aviso)
  WHERE revogado_em IS NULL;

CREATE INDEX IF NOT EXISTS consentimentos_user_idx
  ON public.consentimentos (user_id, finalidade, concedido_em DESC);

-- Historico imutavel: a unica alteracao aceita e registrar a revogacao, uma vez.
CREATE OR REPLACE FUNCTION public.consentimentos_preservar_historico()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.revogado_em IS NOT NULL THEN
    RAISE EXCEPTION 'Consentimento já revogado não pode ser alterado.';
  END IF;
  IF NEW.id <> OLD.id OR NEW.user_id <> OLD.user_id OR NEW.finalidade <> OLD.finalidade
     OR NEW.versao_aviso <> OLD.versao_aviso OR NEW.origem <> OLD.origem
     OR NEW.concedido_em <> OLD.concedido_em THEN
    RAISE EXCEPTION 'O registro do consentimento não pode ser alterado; apenas revogado.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consentimentos_preservar_historico ON public.consentimentos;
CREATE TRIGGER consentimentos_preservar_historico
  BEFORE UPDATE ON public.consentimentos
  FOR EACH ROW EXECUTE FUNCTION public.consentimentos_preservar_historico();

ALTER TABLE public.consentimentos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Titular le seus consentimentos" ON public.consentimentos;
CREATE POLICY "Titular le seus consentimentos" ON public.consentimentos
  FOR SELECT TO authenticated USING (user_id = auth.uid());

-- Sem policies de escrita, e sem o privilegio, para nao depender so do RLS
REVOKE INSERT, UPDATE, DELETE ON public.consentimentos FROM anon, authenticated;
