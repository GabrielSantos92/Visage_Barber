-- Apaga 5 contas de cliente de teste (autorizado pelo usuário em 28/11/2026).
-- Rodar SEPARADO de 1_organizar.sql (se falhar, não desfaz a organização).
-- NÃO TEM VOLTA. Só apaga conta sem agendamento, sem pagamento, sem vínculo de
-- barbeiro e sem papel além de cliente; as outras são puladas e listadas no fim.
-- Tudo num bloco: se o banco recusar alguma, nenhuma é apagada.

DO $$
DECLARE
  v_contas constant uuid[] := ARRAY[
    'f3dac782-b0bd-41ee-a6c7-3421cbc7e972',  -- teste2@gmai.com
    'be307692-c40f-4eda-af3e-def0d0dc3b85',  -- gabriel@yahoo.com
    '4a80468d-63e0-445b-a527-f2fc2ade0864',  -- gabrielsantosalves1321@gmail.comg
    '88a751d2-b9e3-47a6-ac02-653c414b011a',  -- nj@yahoo.com
    '48874a4d-60dd-4c15-bfcd-2a9c5d7360e2'   -- gabriel@gmail.com
  ]::uuid[];
  v_apagar uuid[];
BEGIN
  SELECT coalesce(array_agg(u.id), '{}') INTO v_apagar
    FROM auth.users u
   WHERE u.id = ANY (v_contas)
     AND NOT EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.cliente_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.pagamentos p WHERE p.cliente_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.barbeiros b WHERE b.user_id = u.id)
     AND NOT EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text <> 'cliente');

  -- Perfil e papel saem junto (não ficam órfãos se não houver cascata)
  DELETE FROM public.user_roles WHERE user_id = ANY (v_apagar);
  DELETE FROM public.profiles WHERE user_id = ANY (v_apagar);
  DELETE FROM auth.users WHERE id = ANY (v_apagar);
END;
$$;

-- Contas da lista que continuam existindo (vazio = as 5 foram apagadas)
SELECT id, email FROM auth.users
 WHERE id IN ('f3dac782-b0bd-41ee-a6c7-3421cbc7e972', 'be307692-c40f-4eda-af3e-def0d0dc3b85',
              '4a80468d-63e0-445b-a527-f2fc2ade0864', '88a751d2-b9e3-47a6-ac02-653c414b011a',
              '48874a4d-60dd-4c15-bfcd-2a9c5d7360e2');
