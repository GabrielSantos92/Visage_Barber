-- =====================================================================
-- ROLLBACK da migration 20261116000026_whatsapp_cancelamento_confirmado.sql
--
-- NAO execute sem aprovacao. Antes: desligue o WhatsApp no backend
-- (NOTIFICACOES_WHATSAPP_ATIVO vazio) e volte o backend, o site e o app para a
-- versao sem a confirmacao dupla. Pode ser executado de novo.
--
-- Volta ao estado da migration 27 sobre a 25 (NAO so registra e avisa; nao
-- cancela; so o canal whatsapp acorda o backend). As funcoes da secao 2 sao
-- copia EXATA da migration 25, exceto rotina_notificacoes, copia EXATA da 27
-- (geradas por script; nao editar a mao). Nao recria o gatilho de INSERT que
-- a 27 removeu. Depois deste rollback, o da 27
-- (supabase/rollbacks/20261115000027_rollback.sql) pode ser executado.
--
-- O que NAO faz:
--   * nao apaga o historico: a tabela solicitacoes_cancelamento, o gatilho
--     que a protege e os tipos novos da fila ficam (os registros continuam
--     consultaveis pela secao 4);
--   * nao reativa agendamentos cancelados pela confirmacao do WhatsApp (a
--     secao 4 os lista, para decisao manual);
--   * nao revoga nem altera consentimentos.
-- A rotina de cada minuto (rotina_notificacoes) volta a ser a da 27 (sem a
-- expiracao das solicitacoes, com o filtro de canal): as solicitacoes que
-- ficarem abertas nao existem mais (a secao 1 as encerra).
-- =====================================================================

BEGIN;

DO $$
BEGIN
  IF to_regclass('public.solicitacoes_cancelamento') IS NULL THEN
    RAISE EXCEPTION 'A migration 20261116000026 nao esta aplicada neste banco. Nada foi alterado.';
  END IF;
END $$;

-- 1. Encerra o que estava aberto: nenhuma segunda mensagem sai e nenhum
--    botao antigo cancela depois do rollback
UPDATE public.solicitacoes_cancelamento
   SET estado = 'invalidada', motivo = 'rollback_26', atualizada_em = now()
 WHERE estado IN ('pendente', 'aguardando');
UPDATE public.notificacoes
   SET status = 'ignorada', motivo = 'rollback_26', atualizada_em = now()
 WHERE canal = 'whatsapp' AND status = 'pendente'
   AND tipo IN ('confirmacao_cancelamento', 'cancelamento_whatsapp', 'cancelamento_nao_concluido');

-- 2. Funcoes da migration 25 (e a rotina da 27)
CREATE OR REPLACE FUNCTION public.whatsapp_consentiu(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consentimentos c
     WHERE c.user_id = p_user AND c.finalidade = 'whatsapp_avisos' AND c.revogado_em IS NULL)
$$;

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
  IF (n.tipo = 'confirmacao_presenca' AND n.destinatario_id IS DISTINCT FROM a.cliente_id)
     OR (n.tipo = 'presenca_negada' AND n.destinatario_id IS DISTINCT FROM a.barbeiro_user) THEN
    RETURN 'destinatario_mudou';
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
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.reservar_whatsapp(p_limite integer DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_ids uuid[];
  n public.notificacoes%ROWTYPE;
  v_motivo text;
  v_telefone text;
  v_saida jsonb := '[]'::jsonb;
BEGIN
  UPDATE public.whatsapp_mensagens m
     SET estado = 'incerto', atualizado_em = now()
    FROM public.notificacoes x
   WHERE x.id = m.notificacao_id AND m.estado = 'iniciado'
     AND (x.status <> 'enviando' OR x.reservada_ate < now());
  UPDATE public.notificacoes
     SET status = 'falhou', motivo = 'resultado_incerto', reservada_ate = NULL, atualizada_em = now()
   WHERE canal = 'whatsapp' AND status = 'enviando' AND reservada_ate < now();
  UPDATE public.notificacoes
     SET status = 'expirada', motivo = 'prazo', atualizada_em = now()
   WHERE canal = 'whatsapp' AND status = 'pendente' AND expira_em <= now();
  -- Pedido cujo aviso terminou sem envio
  UPDATE public.confirmacoes_presenca c
     SET estado = 'nao_enviada', motivo = coalesce(x.motivo, x.status), atualizada_em = now()
    FROM public.notificacoes x
   WHERE x.id = c.notificacao_id AND c.estado = 'pendente'
     AND x.status IN ('falhou', 'expirada', 'ignorada');

  WITH livres AS (
    SELECT f.id
      FROM public.notificacoes f
     WHERE f.canal = 'whatsapp' AND f.status = 'pendente' AND f.proxima_tentativa <= now()
     ORDER BY f.proxima_tentativa, f.criada_em
     LIMIT greatest(1, least(coalesce(p_limite, 20), 50))
     FOR UPDATE SKIP LOCKED
  ), reservadas AS (
    UPDATE public.notificacoes x
       SET status = 'enviando',
           tentativas = x.tentativas + 1,
           reservada_ate = now() + interval '2 minutes',
           atualizada_em = now()
      FROM livres
     WHERE x.id = livres.id
    RETURNING x.id
  )
  SELECT coalesce(array_agg(r.id), ARRAY[]::uuid[]) INTO v_ids FROM reservadas r;

  FOR n IN
    SELECT * FROM public.notificacoes q WHERE q.id = ANY (v_ids) ORDER BY q.proxima_tentativa, q.criada_em
  LOOP
    v_motivo := public.whatsapp_motivo_para_nao_enviar(n);
    IF v_motivo IS NOT NULL THEN
      UPDATE public.notificacoes
         SET status = CASE WHEN v_motivo = 'prazo' THEN 'expirada' ELSE 'ignorada' END,
             motivo = v_motivo, reservada_ate = NULL, atualizada_em = now()
       WHERE id = n.id;
      UPDATE public.confirmacoes_presenca
         SET estado = CASE WHEN v_motivo LIKE 'agendamento_%' OR v_motivo LIKE 'horario_%'
                           THEN 'invalidada' ELSE 'nao_enviada' END,
             motivo = v_motivo, atualizada_em = now()
       WHERE notificacao_id = n.id AND estado = 'pendente';
      CONTINUE;
    END IF;

    SELECT public.whatsapp_telefone(p.telefone) INTO v_telefone
      FROM public.profiles p WHERE p.user_id = n.destinatario_id;
    INSERT INTO public.whatsapp_mensagens (notificacao_id, tentativa) VALUES (n.id, n.tentativas);
    v_saida := v_saida || jsonb_build_array(jsonb_build_object(
      'id', n.id, 'tipo', n.tipo, 'destinatario_id', n.destinatario_id, 'tentativas', n.tentativas,
      'dados', n.dados, 'telefone', v_telefone));
  END LOOP;

  RETURN v_saida;
END;
$$;

CREATE OR REPLACE FUNCTION public.concluir_envio_whatsapp(p_notificacao_id uuid, p_resultado jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  n public.notificacoes%ROWTYPE;
  v_status text := p_resultado ->> 'status';
  v_erro text := nullif(left(coalesce(p_resultado ->> 'erro', ''), 200), '');
  v_espera interval;
  v_novo text;
  v_motivo text;
BEGIN
  IF v_status IS NULL OR v_status NOT IN ('aceito', 'recusado', 'erro', 'incerto') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'RESULTADO_INVALIDO', MESSAGE = 'Resultado de envio inválido.';
  END IF;
  SELECT * INTO n FROM public.notificacoes q WHERE q.id = p_notificacao_id AND q.canal = 'whatsapp' FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'AVISO_NAO_ENCONTRADO', MESSAGE = 'Aviso não encontrado.';
  END IF;
  -- Ja concluido (ex.: a reserva venceu e virou resultado incerto): nao muda
  IF n.status <> 'enviando' THEN
    RETURN jsonb_build_object('status', n.status, 'ja_concluido', true);
  END IF;

  UPDATE public.whatsapp_mensagens
     SET estado = CASE v_status WHEN 'aceito' THEN 'aceito' WHEN 'incerto' THEN 'incerto' ELSE 'falhou' END,
         wamid = CASE WHEN v_status = 'aceito' THEN nullif(left(p_resultado ->> 'wamid', 200), '') END,
         wa_id = CASE WHEN v_status = 'aceito' THEN nullif(left(p_resultado ->> 'wa_id', 30), '') END,
         erro = v_erro, atualizado_em = now()
   WHERE notificacao_id = n.id AND tentativa = n.tentativas AND estado = 'iniciado';

  IF v_status = 'aceito' THEN
    UPDATE public.notificacoes
       SET status = 'enviada', motivo = NULL, reservada_ate = NULL, enviada_em = now(), atualizada_em = now()
     WHERE id = n.id;
    UPDATE public.confirmacoes_presenca
       SET estado = 'enviada', motivo = NULL, enviada_em = now(), atualizada_em = now()
     WHERE notificacao_id = n.id AND estado = 'pendente';
    RETURN jsonb_build_object('status', 'enviada');
  END IF;

  v_espera := make_interval(secs => 30 * power(4, greatest(n.tentativas, 1) - 1));
  IF v_status = 'erro' AND n.tentativas < 4 AND now() + v_espera < n.expira_em THEN
    UPDATE public.notificacoes
       SET status = 'pendente', motivo = v_erro, reservada_ate = NULL,
           proxima_tentativa = now() + v_espera, atualizada_em = now()
     WHERE id = n.id;
    RETURN jsonb_build_object('status', 'pendente', 'proxima_tentativa', now() + v_espera);
  END IF;

  v_novo := 'falhou';
  v_motivo := CASE v_status WHEN 'incerto' THEN 'resultado_incerto'
                            WHEN 'erro' THEN 'tentativas_esgotadas: ' || coalesce(v_erro, '?')
                            ELSE coalesce(v_erro, 'recusado') END;
  UPDATE public.notificacoes
     SET status = v_novo, motivo = v_motivo, reservada_ate = NULL, atualizada_em = now()
   WHERE id = n.id;
  UPDATE public.confirmacoes_presenca
     SET estado = 'nao_enviada', motivo = v_motivo, atualizada_em = now()
   WHERE notificacao_id = n.id AND estado = 'pendente';
  RETURN jsonb_build_object('status', v_novo, 'motivo', v_motivo);
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_registrar_status(p_wamid text, p_status text, p_erro text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  m public.whatsapp_mensagens%ROWTYPE;
  v_ordem CONSTANT text[] := ARRAY['aceito', 'enviado', 'entregue', 'lido'];
  v_motivo text;
BEGIN
  IF p_status IS NULL OR p_status NOT IN ('enviado', 'entregue', 'lido', 'falhou') THEN
    RETURN 'status_invalido';
  END IF;
  SELECT * INTO m FROM public.whatsapp_mensagens q WHERE q.wamid = p_wamid FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'desconhecida';
  END IF;

  IF p_status = 'falhou' THEN
    IF m.estado NOT IN ('aceito', 'enviado') THEN
      RETURN 'ignorado';
    END IF;
    v_motivo := 'meta: ' || coalesce(nullif(left(coalesce(p_erro, ''), 150), ''), 'falha');
    UPDATE public.whatsapp_mensagens SET estado = 'falhou', erro = v_motivo, atualizado_em = now() WHERE id = m.id;
    UPDATE public.notificacoes
       SET status = 'falhou', motivo = v_motivo, atualizada_em = now()
     WHERE id = m.notificacao_id AND status = 'enviada';
    -- Sem entrega nao ha o que responder
    UPDATE public.confirmacoes_presenca
       SET estado = 'nao_enviada', motivo = v_motivo, atualizada_em = now()
     WHERE notificacao_id = m.notificacao_id AND estado = 'enviada';
    RETURN 'falhou';
  END IF;

  IF array_position(v_ordem, m.estado) IS NULL
     OR array_position(v_ordem, p_status) <= array_position(v_ordem, m.estado) THEN
    RETURN 'ignorado';
  END IF;
  UPDATE public.whatsapp_mensagens SET estado = p_status, atualizado_em = now() WHERE id = m.id;
  RETURN p_status;
END;
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_registrar_resposta(
  p_evento text,
  p_de text,
  p_tipo text,
  p_payload text DEFAULT NULL,
  p_contexto text DEFAULT NULL,
  p_texto text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_chave text := public.whatsapp_chave_numero(p_de);
  v_texto text;
  v_resposta text;
  v_id uuid;
  v_total integer;
  c public.confirmacoes_presenca%ROWTYPE;
  a record;
  v_barbeiro uuid;
  v_dados jsonb;
BEGIN
  IF p_evento IS NULL OR btrim(p_evento) = '' OR v_chave IS NULL OR p_tipo IS NULL OR p_tipo NOT IN ('botao', 'texto') THEN
    RETURN jsonb_build_object('resultado', 'invalida');
  END IF;
  INSERT INTO public.whatsapp_eventos (chave) VALUES ('msg:' || left(p_evento, 200)) ON CONFLICT (chave) DO NOTHING;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('resultado', 'duplicada');
  END IF;

  IF p_tipo = 'texto' THEN
    v_texto := regexp_replace(
      translate(lower(btrim(coalesce(p_texto, ''))), 'ãáâàéêíóôõúç', 'aaaaeeiooouc'), '[\s.!]+$', '');
    IF v_texto IN ('parar', 'sair', 'stop') THEN
      UPDATE public.consentimentos k
         SET revogado_em = now(), revogado_origem = 'whatsapp'
       WHERE k.finalidade = 'whatsapp_avisos' AND k.revogado_em IS NULL
         AND k.user_id IN (
           SELECT p.user_id FROM public.profiles p
            WHERE public.whatsapp_chave_numero(public.whatsapp_telefone(p.telefone)) = v_chave);
      GET DIAGNOSTICS v_total = ROW_COUNT;
      RETURN jsonb_build_object('resultado', 'descadastro', 'revogados', v_total);
    END IF;
    IF v_texto NOT IN ('sim', 'nao') THEN
      RETURN jsonb_build_object('resultado', 'nao_reconhecida');
    END IF;
    v_resposta := v_texto;

    -- Pedidos abertos desse numero (pelo numero que a Meta devolveu no envio
    -- ou pelo telefone do cadastro); com contexto, so o da mensagem respondida
    SELECT count(*), (array_agg(q.id))[1] INTO v_total, v_id
      FROM public.confirmacoes_presenca q
     WHERE q.estado = 'enviada' AND q.data_hora > now()
       AND (EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                     WHERE m.notificacao_id = q.notificacao_id
                       AND public.whatsapp_chave_numero(m.wa_id) = v_chave)
            OR EXISTS (SELECT 1 FROM public.profiles p
                        WHERE p.user_id = q.cliente_id
                          AND public.whatsapp_chave_numero(public.whatsapp_telefone(p.telefone)) = v_chave))
       AND (p_contexto IS NULL
            OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                        WHERE m.notificacao_id = q.notificacao_id AND m.wamid = p_contexto));
    IF v_total = 0 THEN
      RETURN jsonb_build_object('resultado', 'sem_pedido');
    END IF;
    IF v_total > 1 THEN
      RETURN jsonb_build_object('resultado', 'ambigua', 'abertos', v_total);
    END IF;
  ELSE
    IF p_payload IS NULL OR p_contexto IS NULL
       OR p_payload !~ '^VB_(SIM|NAO):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('resultado', 'invalida');
    END IF;
    v_resposta := CASE WHEN p_payload LIKE 'VB_SIM:%' THEN 'sim' ELSE 'nao' END;
    v_id := substr(p_payload, 8)::uuid;
    -- O botao tem de ser da mensagem respondida e do numero que a recebeu
    IF NOT EXISTS (
      SELECT 1
        FROM public.confirmacoes_presenca q
        JOIN public.whatsapp_mensagens m ON m.notificacao_id = q.notificacao_id AND m.wamid = p_contexto
       WHERE q.id = v_id
         AND (public.whatsapp_chave_numero(m.wa_id) = v_chave
              OR EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id = q.cliente_id
                            AND public.whatsapp_chave_numero(public.whatsapp_telefone(p.telefone)) = v_chave))) THEN
      RETURN jsonb_build_object('resultado', 'invalida');
    END IF;
  END IF;

  -- Travas: agendamento, depois o pedido
  SELECT ag.id, ag.status::text AS status, ag.data_hora, ag.barbeiro_id, ag.servico_id, ag.cliente_id
    INTO a
    FROM public.agendamentos ag
   WHERE ag.id = (SELECT q.agendamento_id FROM public.confirmacoes_presenca q WHERE q.id = v_id)
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('resultado', 'agendamento_invalido');
  END IF;
  SELECT * INTO c FROM public.confirmacoes_presenca q WHERE q.id = v_id FOR UPDATE;

  v_dados := jsonb_build_object('agendamento_id', a.id, 'data_hora', c.data_hora);
  IF c.estado IN ('confirmada', 'recusada') THEN
    RETURN v_dados || jsonb_build_object('resultado', 'ja_respondida', 'estado', c.estado);
  END IF;
  IF c.estado <> 'enviada' THEN
    RETURN v_dados || jsonb_build_object('resultado', 'agendamento_invalido');
  END IF;
  IF a.status <> 'confirmado' OR a.data_hora IS DISTINCT FROM c.data_hora OR a.data_hora <= now() THEN
    UPDATE public.confirmacoes_presenca
       SET estado = 'invalidada',
           motivo = CASE WHEN a.status <> 'confirmado' THEN 'agendamento_' || a.status
                         WHEN a.data_hora IS DISTINCT FROM c.data_hora THEN 'horario_alterado'
                         ELSE 'horario_passou' END,
           atualizada_em = now()
     WHERE id = c.id;
    RETURN v_dados || jsonb_build_object('resultado', 'agendamento_invalido');
  END IF;

  UPDATE public.confirmacoes_presenca
     SET estado = CASE WHEN v_resposta = 'sim' THEN 'confirmada' ELSE 'recusada' END,
         respondida_em = now(), resposta_origem = p_tipo, atualizada_em = now()
   WHERE id = c.id;

  -- NAO: o agendamento continua ativo; o barbeiro e avisado (na agenda e, se
  -- autorizou e tem celular, pelo WhatsApp)
  IF v_resposta = 'nao' THEN
    SELECT b.user_id INTO v_barbeiro FROM public.barbeiros b WHERE b.id = a.barbeiro_id;
    IF v_barbeiro IS NOT NULL AND public.whatsapp_consentiu(v_barbeiro)
       AND EXISTS (SELECT 1 FROM public.profiles p
                    WHERE p.user_id = v_barbeiro AND public.whatsapp_telefone(p.telefone) IS NOT NULL) THEN
      INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, ator_id, agendamento_id, dados, expira_em)
      SELECT 'presenca_negada', 'whatsapp', 'whatsapp:presenca_negada:' || c.id::text, v_barbeiro, a.cliente_id, a.id,
             jsonb_build_object(
               'agendamento_id', a.id, 'data_hora', a.data_hora, 'servico', s.nome,
               'cliente_nome', public.primeiro_nome(pr.nome, 'Cliente'),
               'barbeiro_nome', public.primeiro_nome(b.nome, 'Barbeiro')),
             a.data_hora
        FROM public.barbeiros b
        JOIN public.servicos s ON s.id = a.servico_id
        LEFT JOIN public.profiles pr ON pr.user_id = a.cliente_id
       WHERE b.id = a.barbeiro_id
      ON CONFLICT (chave) DO NOTHING;
    END IF;
  END IF;

  RETURN v_dados || jsonb_build_object('resultado', CASE WHEN v_resposta = 'sim' THEN 'confirmada' ELSE 'recusada' END);
END;
$$;

CREATE OR REPLACE FUNCTION public.invalidar_confirmacao_presenca()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_motivo text;
BEGIN
  IF NEW.data_hora IS DISTINCT FROM OLD.data_hora THEN
    v_motivo := 'horario_alterado';
  ELSIF NEW.status = 'cancelado' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_motivo := 'agendamento_cancelado';
  ELSE
    RETURN NULL;
  END IF;
  BEGIN
    UPDATE public.confirmacoes_presenca
       SET estado = 'invalidada', motivo = v_motivo, atualizada_em = now()
     WHERE agendamento_id = NEW.id AND estado IN ('pendente', 'enviada');
    UPDATE public.notificacoes
       SET status = 'ignorada', motivo = v_motivo, atualizada_em = now()
     WHERE agendamento_id = NEW.id AND canal = 'whatsapp' AND status = 'pendente';
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whatsapp: nao foi possivel invalidar a confirmacao de presenca (%)', SQLSTATE;
  END;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.presenca_dos_agendamentos(p_ids uuid[])
RETURNS TABLE (agendamento_id uuid, situacao text, respondida_em timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT ag.id,
         CASE c.estado WHEN 'enviada' THEN 'sem_resposta' ELSE c.estado END,
         c.respondida_em
    FROM public.agendamentos ag
    JOIN public.barbeiros b ON b.id = ag.barbeiro_id
    JOIN public.confirmacoes_presenca c ON c.agendamento_id = ag.id AND c.data_hora = ag.data_hora
   WHERE ag.id = ANY (p_ids)
     AND c.estado <> 'invalidada'
     AND auth.uid() IS NOT NULL
     AND (ag.cliente_id = auth.uid() OR b.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
$$;

CREATE OR REPLACE FUNCTION public.rotina_notificacoes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lembretes integer;
  v_confirmacoes integer := 0;
  v_expiradas integer;
  v_pendentes boolean;
  v_despertou boolean := false;
BEGIN
  v_lembretes := public.enfileirar_lembretes();
  -- Erro nos pedidos de confirmacao nao pode parar o resto da rotina
  BEGIN
    v_confirmacoes := public.enfileirar_confirmacoes_presenca();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whatsapp: nao foi possivel gerar os pedidos de confirmacao (%)', SQLSTATE;
  END;
  v_expiradas := public.expirar_notificacoes();
  -- So o canal whatsapp acorda o backend (migration 27): avisos do push
  -- (desligado) nunca chamam o Render. Uma chamada no maximo por execucao.
  SELECT EXISTS (
    SELECT 1 FROM public.notificacoes
     WHERE canal = 'whatsapp'
       AND ((status = 'pendente' AND proxima_tentativa <= now())
            OR (status = 'enviando' AND reservada_ate < now()))
  ) INTO v_pendentes;
  IF v_pendentes THEN
    v_despertou := public.despertar_backend();
  END IF;
  RETURN jsonb_build_object(
    'lembretes', v_lembretes, 'confirmacoes', v_confirmacoes, 'expiradas', v_expiradas,
    'pendentes', v_pendentes, 'despertou', v_despertou);
END;
$$;

DROP TRIGGER IF EXISTS invalidar_confirmacao_presenca ON public.agendamentos;
CREATE TRIGGER invalidar_confirmacao_presenca
  AFTER UPDATE OF status, data_hora ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidar_confirmacao_presenca();

-- A versao do aviso deixa de ser exigida (a funcao da 25 nao a usa). As
-- funcoes so da 26 saem depois que nenhuma funcao da 25 as chama.
DROP FUNCTION IF EXISTS public.whatsapp_versao_aviso();
DROP FUNCTION IF EXISTS public.whatsapp_expirar_solicitacoes();
DROP FUNCTION IF EXISTS public.whatsapp_avisar_cancelamento_nao_concluido(uuid, text);

-- 3. Permissoes (as mesmas da 25)
REVOKE ALL ON FUNCTION public.whatsapp_consentiu(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_motivo_para_nao_enviar(public.notificacoes) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_whatsapp(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_envio_whatsapp(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_registrar_status(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_registrar_resposta(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidar_confirmacao_presenca() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotina_notificacoes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.presenca_dos_agendamentos(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.presenca_dos_agendamentos(uuid[]) TO authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.reservar_whatsapp(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.concluir_envio_whatsapp(uuid, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_status(text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.whatsapp_registrar_resposta(text, text, text, text, text, text) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rotina_notificacoes() TO service_role;
  END IF;
END $$;

COMMIT;

-- 4. Somente leitura: agendamentos cancelados pela confirmacao do WhatsApp
--    (para decisao manual; nada e reativado automaticamente)
-- SELECT s.agendamento_id, s.data_hora, s.cancelado_em, ag.status
--   FROM public.solicitacoes_cancelamento s
--   JOIN public.agendamentos ag ON ag.id = s.agendamento_id
--  WHERE s.estado = 'confirmada'
--  ORDER BY s.cancelado_em;
