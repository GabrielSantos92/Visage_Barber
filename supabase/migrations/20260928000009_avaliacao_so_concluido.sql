-- =====================================================================
-- Avaliacao so para atendimento que aconteceu
-- - Cliente so avalia agendamento PROPRIO e CONCLUIDO.
-- - Se o barbeiro marcar "cliente faltou" (agendamento -> cancelado),
--   a avaliacao que existir e removida e nao pode mais ser criada.
-- Execute no Supabase Dashboard > SQL Editor (depois da migration 000008)
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Insert de avaliacao: o agendamento tem que ser do cliente,
--    estar concluido e o barbeiro tem que ser o do agendamento
--    (antes bastava cliente_id = auth.uid()).
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Cliente insere propria avaliacao" ON public.avaliacoes;
CREATE POLICY "Cliente insere propria avaliacao" ON public.avaliacoes
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.uid() = cliente_id
    AND EXISTS (
      SELECT 1 FROM public.agendamentos a
      WHERE a.id = agendamento_id
        AND a.cliente_id = auth.uid()
        AND a.barbeiro_id = avaliacoes.barbeiro_id
        AND a.status = 'concluido'
    )
  );

-- ---------------------------------------------------------------
-- 2. Cliente faltou: ao cancelar um agendamento, apaga a avaliacao dele
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remover_avaliacao_se_cancelado()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.avaliacoes WHERE agendamento_id = NEW.id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_remover_avaliacao_se_cancelado ON public.agendamentos;
CREATE TRIGGER trg_remover_avaliacao_se_cancelado
  AFTER UPDATE OF status ON public.agendamentos
  FOR EACH ROW
  WHEN (NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM 'cancelado')
  EXECUTE FUNCTION public.remover_avaliacao_se_cancelado();

-- Limpa avaliacoes que ja existam em agendamentos cancelados
DELETE FROM public.avaliacoes av
USING public.agendamentos a
WHERE a.id = av.agendamento_id AND a.status = 'cancelado';
