-- =====================================================================
-- Admin: acesso total a horarios_disponiveis e barbeiro_servicos
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Admin gerencia agenda de qualquer barbeiro
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admin acessa horarios_disponiveis" ON public.horarios_disponiveis;
CREATE POLICY "Admin acessa horarios_disponiveis" ON public.horarios_disponiveis
  FOR ALL TO authenticated
  USING  (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------
-- 2. Admin vincula/desvincula serviços de qualquer barbeiro
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Admin acessa barbeiro_servicos" ON public.barbeiro_servicos;
CREATE POLICY "Admin acessa barbeiro_servicos" ON public.barbeiro_servicos
  FOR ALL TO authenticated
  USING  (has_role(auth.uid(), 'admin'))
  WITH CHECK (has_role(auth.uid(), 'admin'));
