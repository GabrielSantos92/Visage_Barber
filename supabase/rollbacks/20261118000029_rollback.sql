-- =====================================================================
-- ROLLBACK da migration 20261118000029_whatsapp_aviso_cancelamento.sql
--
-- NAO execute sem aprovacao. Pode ser executado de novo.
-- Remove o gatilho e a funcao do aviso; os avisos de cancelamento do WhatsApp
-- ainda na fila deixam de sair (ignorada, motivo rollback_29). O historico
-- fica. whatsapp_motivo_para_nao_enviar NAO e revertida de proposito: a
-- versao instalada (igual a da 26 ajustada) confere os tipos da 25 e da 28
-- do mesmo jeito, e sem o gatilho nenhum aviso de cancelamento nasce.
-- =====================================================================
BEGIN;

DROP TRIGGER IF EXISTS whatsapp_aviso_cancelamento ON public.agendamentos;
DROP FUNCTION IF EXISTS public.whatsapp_avisar_cancelamento();

UPDATE public.notificacoes
   SET status = 'ignorada', motivo = 'rollback_29', atualizada_em = now()
 WHERE canal = 'whatsapp' AND tipo = 'cancelamento' AND status = 'pendente';

COMMIT;
