-- =====================================================================
-- WhatsApp (4): aviso de cancelamento para o cliente e o barbeiro
--
-- NAO execute sem aprovacao. Requer a migration
-- 20261113000025_whatsapp_confirmacao_presenca.sql (e, em producao, a
-- 20261115000027_despertar_so_whatsapp.sql). Funciona com ou sem a 26 e com
-- ou sem a 28. Pode ser executada de novo. Tudo numa unica transacao.
-- Rollback: supabase/rollbacks/20261118000029_rollback.sql.
--
-- O que faz: quando um agendamento passa de confirmado para cancelado (e o
-- cancelamento foi gravado), grava na fila um aviso do canal whatsapp (tipo
-- cancelamento) para o cliente e outro para o barbeiro, cada um so se a
-- pessoa autorizou o WhatsApp e tem celular valido.
--   * So o cancelamento efetivado gera aviso: pedido de cancelamento (26),
--     desistencia ou falha nao mudam o status, entao nada e gravado.
--   * Cancelado pela confirmacao dupla do WhatsApp (26): sem aviso aqui; a 26
--     ja avisa o barbeiro (cancelamento_whatsapp) e responde ao cliente.
--   * Depois do horario (falta) nao ha aviso.
--   * Um aviso por agendamento, pessoa e horario (chave unica): cancelamento
--     repetido ou simultaneo nunca duplica (o banco serializa o UPDATE do
--     agendamento, e so a passagem confirmado -> cancelado dispara).
--   * Vale por no maximo 30 minutos (e nunca depois do horario).
--   * Erro aqui so e registrado: nunca impede o cancelamento.
-- A conferencia na hora do envio (whatsapp_motivo_para_nao_enviar) e trocada
-- pela MESMA versao da migration 26 ajustada (texto identico), que aceita o
-- tipo cancelamento so com o agendamento cancelado, no mesmo horario, para o
-- cliente ou o barbeiro dele. Sem ela, a versao da 25 descartaria o aviso
-- (exige agendamento confirmado). Se a 26 for revertida depois desta, rode
-- esta migration de novo (o rollback da 26 volta a versao da 25).
-- O texto e o template ficam no backend (WHATSAPP_TEMPLATE_CANCELAMENTO_*).
-- Nada aqui envia mensagem. Execute no Supabase Dashboard > SQL Editor, como postgres.
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.whatsapp_consentiu(uuid)') IS NULL
     OR to_regprocedure('public.whatsapp_telefone(text)') IS NULL
     OR to_regprocedure('public.primeiro_nome(text,text)') IS NULL
     OR to_regprocedure('public.whatsapp_motivo_para_nao_enviar(public.notificacoes)') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a migration 20261113000025_whatsapp_confirmacao_presenca.sql. Nada foi alterado.';
  END IF;
END $$;

-- 1. Conferencia na hora do envio: o mesmo texto da migration 26 ajustada
CREATE OR REPLACE FUNCTION public.whatsapp_motivo_para_nao_enviar(n public.notificacoes)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  a record;
BEGIN
  IF n.expira_em <= now() THEN
    RETURN 'prazo';
  END IF;
  -- novo_agendamento e cancelamento: migrations 28 e 29 (cliente e barbeiro
  -- do proprio agendamento). A 29 instala esta mesma funcao (texto igual).
  IF n.tipo NOT IN ('confirmacao_presenca', 'presenca_negada', 'confirmacao_cancelamento', 'cancelamento_whatsapp',
                    'cancelamento_nao_concluido', 'novo_agendamento', 'cancelamento') THEN
    RETURN 'tipo_invalido';
  END IF;
  IF NOT public.whatsapp_consentiu(n.destinatario_id) THEN
    RETURN 'sem_consentimento';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = n.destinatario_id AND public.whatsapp_telefone(p.telefone) IS NOT NULL) THEN
    RETURN 'sem_telefone';
  END IF;

  SELECT ag.status::text AS status, ag.data_hora, ag.cliente_id, b.user_id AS barbeiro_user
    INTO a
    FROM public.agendamentos ag
    JOIN public.barbeiros b ON b.id = ag.barbeiro_id
   WHERE ag.id = n.agendamento_id;
  IF NOT FOUND THEN
    RETURN 'agendamento_removido';
  END IF;
  IF (n.tipo IN ('confirmacao_presenca', 'confirmacao_cancelamento', 'cancelamento_nao_concluido')
      AND n.destinatario_id IS DISTINCT FROM a.cliente_id)
     OR (n.tipo IN ('presenca_negada', 'cancelamento_whatsapp') AND n.destinatario_id IS DISTINCT FROM a.barbeiro_user)
     OR (n.tipo IN ('novo_agendamento', 'cancelamento') AND n.destinatario_id IS DISTINCT FROM a.cliente_id
         AND n.destinatario_id IS DISTINCT FROM a.barbeiro_user) THEN
    RETURN 'destinatario_mudou';
  END IF;

  -- Aviso de cancelamento (migration 29): so com o agendamento cancelado, no
  -- mesmo horario do aviso e antes do atendimento
  IF n.tipo = 'cancelamento' THEN
    IF a.status <> 'cancelado' THEN
      RETURN 'agendamento_' || a.status;
    END IF;
    IF a.data_hora <= now() THEN
      RETURN 'horario_passou';
    END IF;
    IF a.data_hora IS DISTINCT FROM (n.dados ->> 'data_hora')::timestamptz THEN
      RETURN 'horario_alterado';
    END IF;
    RETURN NULL;
  END IF;

  -- Aviso ao barbeiro: so para o cancelamento confirmado pelo cliente
  IF n.tipo = 'cancelamento_whatsapp' THEN
    IF NOT EXISTS (SELECT 1 FROM public.solicitacoes_cancelamento s
                    WHERE s.agendamento_id = n.agendamento_id AND s.estado = 'confirmada'
                      AND s.data_hora = a.data_hora AND s.id::text = n.dados ->> 'solicitacao_id') THEN
      RETURN 'cancelamento_nao_confirmado';
    END IF;
    IF a.status <> 'cancelado' THEN
      RETURN 'agendamento_' || a.status;
    END IF;
    IF a.data_hora <= now() THEN
      RETURN 'horario_passou';
    END IF;
    RETURN NULL;
  END IF;

  IF a.status <> 'confirmado' THEN
    RETURN 'agendamento_' || a.status;
  END IF;
  IF a.data_hora <= now() THEN
    RETURN 'horario_passou';
  END IF;
  IF a.data_hora IS DISTINCT FROM (n.dados ->> 'data_hora')::timestamptz THEN
    RETURN 'horario_alterado';
  END IF;
  -- Segunda mensagem: so enquanto a solicitacao dela estiver pendente e no prazo
  IF n.tipo = 'confirmacao_cancelamento'
     AND NOT EXISTS (SELECT 1 FROM public.solicitacoes_cancelamento s
                      WHERE s.notificacao_id = n.id AND s.estado = 'pendente' AND s.expira_em > now()) THEN
    RETURN 'solicitacao_encerrada';
  END IF;
  -- Aviso de cancelamento nao concluido: so enquanto a solicitacao dele
  -- continuar 'nao_enviada' (o agendamento confirmado e no horario ja foi
  -- conferido acima)
  IF n.tipo = 'cancelamento_nao_concluido'
     AND NOT EXISTS (SELECT 1 FROM public.solicitacoes_cancelamento s
                      WHERE s.id::text = n.dados ->> 'solicitacao_id' AND s.agendamento_id = n.agendamento_id
                        AND s.estado = 'nao_enviada') THEN
    RETURN 'solicitacao_mudou';
  END IF;
  RETURN NULL;
END;
$$;

-- 2. Aviso de cancelamento
CREATE OR REPLACE FUNCTION public.whatsapp_avisar_cancelamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_pelo_whatsapp boolean := false;
BEGIN
  IF NEW.data_hora <= now() THEN
    RETURN NULL;
  END IF;
  BEGIN
    -- Cancelado pela confirmacao dupla do WhatsApp (26): a 26 ja avisa
    IF to_regclass('public.solicitacoes_cancelamento') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.solicitacoes_cancelamento s
                 WHERE s.agendamento_id = $1 AND s.estado = ''confirmada'' AND s.data_hora = $2)'
        INTO v_pelo_whatsapp USING NEW.id, NEW.data_hora;
    END IF;
    IF v_pelo_whatsapp THEN
      RETURN NULL;
    END IF;
    INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, agendamento_id, dados, expira_em)
    SELECT 'cancelamento', 'whatsapp',
           format('whatsapp:cancelamento:%s:%s:%s', NEW.id, d.uid, extract(epoch FROM NEW.data_hora)::bigint),
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
    RAISE WARNING 'whatsapp: aviso de cancelamento nao registrado (%)', SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

-- Nome depois de invalidar_confirmacao_presenca (gatilhos rodam em ordem
-- alfabetica): aquele ignora os avisos pendentes do agendamento antes deste
-- gravar os de cancelamento
DROP TRIGGER IF EXISTS whatsapp_aviso_cancelamento ON public.agendamentos;
CREATE TRIGGER whatsapp_aviso_cancelamento
  AFTER UPDATE OF status ON public.agendamentos
  FOR EACH ROW WHEN (OLD.status = 'confirmado' AND NEW.status = 'cancelado')
  EXECUTE FUNCTION public.whatsapp_avisar_cancelamento();

REVOKE ALL ON FUNCTION public.whatsapp_avisar_cancelamento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_motivo_para_nao_enviar(public.notificacoes) FROM PUBLIC, anon, authenticated;

COMMIT;
