-- =====================================================================
-- WhatsApp (3): confirmacao de novo agendamento para o cliente e o barbeiro
--
-- NAO execute sem aprovacao. Requer a migration
-- 20261113000025_whatsapp_confirmacao_presenca.sql (e, em producao, a
-- 20261115000027_despertar_so_whatsapp.sql). Funciona com ou sem a 26 (a 26
-- ajustada aceita o tipo novo na conferencia de envio). Pode ser executada de
-- novo. Tudo numa unica transacao: se algo falhar, nada fica.
-- Rollback: supabase/rollbacks/20261118000028_rollback.sql.
--
-- O que faz: ao criar um agendamento confirmado, grava na fila um aviso do
-- canal whatsapp (tipo novo_agendamento) para o cliente e outro para o
-- barbeiro, cada um so se a pessoa autorizou o WhatsApp e tem celular valido.
--   * Um aviso por agendamento, pessoa e horario (chave unica): nunca dois.
--   * Vale por no maximo 30 minutos (e nunca depois do horario): com o
--     WhatsApp desligado, o aviso vence logo e a rotina de cada minuto para de
--     acordar o backend por causa dele.
--   * Na hora de enviar, o banco reconfere tudo (whatsapp_motivo_para_nao_enviar):
--     agendamento cancelado ou com outro horario nao gera mensagem.
--   * Erro aqui so e registrado: nunca impede criar o agendamento.
-- O texto e o template ficam no backend (WHATSAPP_TEMPLATE_NOVO_AGENDAMENTO_*);
-- sem o template configurado, o aviso termina como nao enviado. Nada aqui
-- envia mensagem: o envio e do backend, e so com o WhatsApp ligado.
-- Execute no Supabase Dashboard > SQL Editor, como postgres.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.whatsapp_consentiu(uuid)') IS NULL
     OR to_regprocedure('public.whatsapp_telefone(text)') IS NULL
     OR to_regprocedure('public.primeiro_nome(text,text)') IS NULL
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_schema = 'public' AND table_name = 'notificacoes' AND column_name = 'canal') THEN
    RAISE EXCEPTION 'Rode antes a migration 20261113000025_whatsapp_confirmacao_presenca.sql. Nada foi alterado.';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.whatsapp_avisar_novo_agendamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.data_hora <= now() THEN
    RETURN NULL;
  END IF;
  BEGIN
    INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, agendamento_id, dados, expira_em)
    SELECT 'novo_agendamento', 'whatsapp',
           format('whatsapp:novo_agendamento:%s:%s:%s', NEW.id, d.uid, extract(epoch FROM NEW.data_hora)::bigint),
           d.uid, NEW.id,
           jsonb_build_object(
             'agendamento_id', NEW.id, 'data_hora', NEW.data_hora, 'servico', s.nome, 'papel', d.papel,
             'cliente_nome', public.primeiro_nome(pr.nome, 'Cliente'),
             'barbeiro_nome', public.primeiro_nome(b.nome, 'Barbeiro')),
           least(NEW.data_hora, now() + interval '30 minutes')
      FROM public.barbeiros b
      JOIN public.servicos s ON s.id = NEW.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = NEW.cliente_id
      CROSS JOIN LATERAL (VALUES (NEW.cliente_id, 'cliente'), (b.user_id, 'barbeiro')) AS d(uid, papel)
     WHERE b.id = NEW.barbeiro_id
       AND d.uid IS NOT NULL
       AND public.whatsapp_consentiu(d.uid)
       AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.user_id = d.uid AND public.whatsapp_telefone(p.telefone) IS NOT NULL)
    ON CONFLICT (chave) DO NOTHING;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whatsapp: aviso de novo agendamento nao registrado (%)', SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS whatsapp_novo_agendamento ON public.agendamentos;
CREATE TRIGGER whatsapp_novo_agendamento
  AFTER INSERT ON public.agendamentos
  FOR EACH ROW WHEN (NEW.status = 'confirmado')
  EXECUTE FUNCTION public.whatsapp_avisar_novo_agendamento();

REVOKE ALL ON FUNCTION public.whatsapp_avisar_novo_agendamento() FROM PUBLIC, anon, authenticated;

COMMIT;
