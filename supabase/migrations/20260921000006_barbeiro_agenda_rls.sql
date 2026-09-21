-- =====================================================================
-- Agenda do barbeiro: garantir leitura dos agendamentos e do nome do cliente
-- Execute no Supabase Dashboard > SQL Editor
-- Seguro para re-executar (DROP IF EXISTS antes de cada CREATE)
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Barbeiro le os agendamentos da propria agenda
--    Sem isso: "Nenhum agendamento neste dia" mesmo com agendamento criado
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Barbeiro le seus agendamentos" ON public.agendamentos;
CREATE POLICY "Barbeiro le seus agendamentos" ON public.agendamentos
  FOR SELECT TO authenticated
  USING (
    barbeiro_id IN (SELECT id FROM public.barbeiros WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------
-- 2. Barbeiro atualiza o status dos proprios agendamentos
--    (CONFIRMAR / CONCLUIR / CANCELAR na tela de agenda)
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Barbeiro atualiza seus agendamentos" ON public.agendamentos;
CREATE POLICY "Barbeiro atualiza seus agendamentos" ON public.agendamentos
  FOR UPDATE TO authenticated
  USING (
    barbeiro_id IN (SELECT id FROM public.barbeiros WHERE user_id = auth.uid())
  )
  WITH CHECK (
    barbeiro_id IN (SELECT id FROM public.barbeiros WHERE user_id = auth.uid())
  );

-- ---------------------------------------------------------------
-- 3. Barbeiro le o perfil dos clientes que tem agendamento com ele
--    Sem isso: o cartao da agenda aparece sem nome/telefone do cliente
--    Atencao: agendamentos.cliente_id aponta para auth.users, logo casa com
--    profiles.user_id (profiles.id e uma PK propria da tabela).
-- ---------------------------------------------------------------
DROP POLICY IF EXISTS "Barbeiro le perfis dos seus clientes" ON public.profiles;
CREATE POLICY "Barbeiro le perfis dos seus clientes" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    user_id IN (
      SELECT a.cliente_id
      FROM public.agendamentos a
      JOIN public.barbeiros b ON b.id = a.barbeiro_id
      WHERE b.user_id = auth.uid()
    )
  );
