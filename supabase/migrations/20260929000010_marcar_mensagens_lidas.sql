-- Marca como lidas as mensagens recebidas em uma conversa.
-- O UPDATE direto em public.mensagens feito pelos apps era barrado pelo RLS
-- (sem policy de UPDATE), falhando em silencio: o contador de "nao lidas"
-- nunca zerava mesmo depois de o usuario abrir o chat.
-- A funcao roda como SECURITY DEFINER, mas so atua se quem chama for
-- participante da conversa (o cliente ou o barbeiro dono dela), e so altera
-- mensagens enviadas pelo outro participante.

CREATE OR REPLACE FUNCTION public.marcar_mensagens_lidas(p_conversa_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_total integer;
BEGIN
  IF v_uid IS NULL THEN
    RETURN 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public.conversas c
      LEFT JOIN public.barbeiros b ON b.id = c.barbeiro_id
     WHERE c.id = p_conversa_id
       AND (c.cliente_id = v_uid OR b.user_id = v_uid)
  ) THEN
    RETURN 0;
  END IF;

  UPDATE public.mensagens
     SET lida = true
   WHERE conversa_id = p_conversa_id
     AND remetente_id <> v_uid
     AND lida = false;

  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

REVOKE ALL ON FUNCTION public.marcar_mensagens_lidas(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.marcar_mensagens_lidas(uuid) TO authenticated;
