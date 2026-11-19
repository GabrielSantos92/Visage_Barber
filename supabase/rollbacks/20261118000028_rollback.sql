-- =====================================================================
-- ROLLBACK da migration 20261118000028_whatsapp_novo_agendamento.sql
--
-- NAO execute sem aprovacao. Pode ser executado de novo.
-- Remove o gatilho e a funcao; os avisos de novo agendamento do WhatsApp que
-- ainda estiverem na fila deixam de sair (ignorada, motivo rollback_28). O
-- historico fica. Nao mexe em agendamentos, consentimentos nem outras filas.
-- =====================================================================
BEGIN;

DROP TRIGGER IF EXISTS whatsapp_novo_agendamento ON public.agendamentos;
DROP FUNCTION IF EXISTS public.whatsapp_avisar_novo_agendamento();

UPDATE public.notificacoes
   SET status = 'ignorada', motivo = 'rollback_28', atualizada_em = now()
 WHERE canal = 'whatsapp' AND tipo = 'novo_agendamento' AND status = 'pendente';

COMMIT;
