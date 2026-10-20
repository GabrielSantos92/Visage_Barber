-- Telefone do barbeiro para o botao WHATSAPP em "Meus Agendamentos".
-- O numero ja e informado pelo admin ao criar o barbeiro e fica em
-- public.profiles.telefone (ligado por barbeiros.user_id = profiles.user_id);
-- nenhuma coluna nova e criada aqui.
-- O RLS de profiles nao deixa o cliente ler o perfil do barbeiro, entao a
-- funcao roda como SECURITY DEFINER, mas devolve apenas o telefone e apenas
-- dos barbeiros com quem quem chama tem agendamento nao cancelado.
-- Telefones vazios ou com menos de 10 digitos (DDD + numero) nao sao devolvidos.

CREATE OR REPLACE FUNCTION public.telefones_barbeiros_do_cliente()
RETURNS TABLE (barbeiro_id uuid, telefone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT b.id, p.telefone
    FROM public.agendamentos a
    JOIN public.barbeiros b ON b.id = a.barbeiro_id
    JOIN public.profiles p ON p.user_id = b.user_id
   WHERE a.cliente_id = auth.uid()
     AND a.status <> 'cancelado'
     AND length(regexp_replace(coalesce(p.telefone, ''), '\D', '', 'g')) >= 10;
$$;

REVOKE ALL ON FUNCTION public.telefones_barbeiros_do_cliente() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.telefones_barbeiros_do_cliente() TO authenticated;
