-- =================================================================
-- SEED: Dados de demonstração para o TCC BarberPro
-- Execute via Supabase Dashboard > SQL Editor
-- =================================================================

-- Barbeiros (sem user_id = não vinculados a conta ainda)
INSERT INTO public.barbeiros (nome, especialidade, ativo) VALUES
  ('João Silva', 'Degradê e Navalhado', true),
  ('Pedro Costa', 'Corte Clássico e Barba', true),
  ('Rafael Souza', 'Coloração e Afros', true)
ON CONFLICT DO NOTHING;

-- Serviços
INSERT INTO public.servicos (nome, descricao, preco, duracao_min, ativo) VALUES
  ('Corte Simples', 'Corte tradicional com tesoura ou máquina', 25.00, 30, true),
  ('Degradê', 'Corte degradê nas laterais com acabamento', 35.00, 45, true),
  ('Barba Completa', 'Aparar, modelar e hidratar a barba', 20.00, 30, true),
  ('Corte + Barba', 'Combo completo de corte e barba', 50.00, 60, true),
  ('Navalhado', 'Corte com navalha para acabamento premium', 45.00, 50, true),
  ('Coloração', 'Tintura e tratamento capilar', 80.00, 90, true)
ON CONFLICT DO NOTHING;

-- Associações barbeiro -> serviços (todos os barbeiros com todos os serviços base)
DO $$
DECLARE
  b_id UUID;
  s_id UUID;
BEGIN
  FOR b_id IN SELECT id FROM public.barbeiros LOOP
    FOR s_id IN SELECT id FROM public.servicos WHERE nome IN ('Corte Simples', 'Degradê', 'Barba Completa', 'Corte + Barba') LOOP
      INSERT INTO public.barbeiro_servicos (barbeiro_id, servico_id)
      VALUES (b_id, s_id)
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;

-- Horários disponíveis: seg(1) a sáb(6), 09:00-18:00
DO $$
DECLARE
  b_id UUID;
  dia INTEGER;
BEGIN
  FOR b_id IN SELECT id FROM public.barbeiros LOOP
    FOR dia IN 1..6 LOOP
      INSERT INTO public.horarios_disponiveis (barbeiro_id, dia_semana, hora_inicio, hora_fim)
      VALUES (b_id, dia, '09:00', '18:00')
      ON CONFLICT DO NOTHING;
    END LOOP;
  END LOOP;
END $$;
