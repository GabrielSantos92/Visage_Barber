-- =====================================================================
-- ROLLBACK da migration 20261119000030_central_notificacoes_push.sql
--
-- NAO execute sem aprovacao. Volta ao estado C da auditoria: a rotina de cada
-- minuto volta a ser exatamente a da migration 26 e a reserva do push, a da
-- 25. Remove a central (funcoes e a coluna lida_em: as marcacoes de lido se
-- perdem) e o marcador push_ativo. Nenhum aviso e apagado.
-- So roda com o push DESLIGADO no banco (push_ativo = false): desligue antes.
-- Os avisos push ainda pendentes viram 'ignorada' (motivo rollback_30): sem o
-- marcador, a reserva da 25 nao tem trava, e nada antigo pode sair se o
-- backend estiver com NOTIFICACOES_PUSH_ATIVO=true (o que tambem deve ser
-- desligado antes). Pode ser executado de novo.
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_ligado boolean := false;
BEGIN
  -- Dinamico: na reexecucao a coluna ja nao existe
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'notificacao_config' AND column_name = 'push_ativo') THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.notificacao_config WHERE id AND push_ativo)' INTO v_ligado;
  END IF;
  IF v_ligado THEN
    RAISE EXCEPTION 'O push esta ligado no banco: rode antes UPDATE public.notificacao_config SET push_ativo = false WHERE id; (e desligue NOTIFICACOES_PUSH_ATIVO no Render). Nada foi alterado.';
  END IF;
END $$;

UPDATE public.notificacoes
   SET status = 'ignorada', motivo = 'rollback_30', reservada_ate = NULL, atualizada_em = now()
 WHERE canal = 'push' AND status IN ('pendente', 'enviando');

DROP TRIGGER IF EXISTS push_ao_ativar ON public.notificacao_config;
DROP FUNCTION IF EXISTS public.push_ao_ativar();
DROP FUNCTION IF EXISTS public.minhas_notificacoes(integer, timestamptz);
DROP FUNCTION IF EXISTS public.contar_notificacoes_nao_lidas();
DROP FUNCTION IF EXISTS public.marcar_notificacoes_lidas(uuid[]);
DROP FUNCTION IF EXISTS public.marcar_todas_notificacoes_lidas();
DROP FUNCTION IF EXISTS public.central_dados(jsonb);
DROP FUNCTION IF EXISTS public.central_desde();

-- Aviso de agendamento: exatamente o da migration 22
CREATE OR REPLACE FUNCTION public.avisar_agendamento(p_tipo text, p_agendamento_id uuid, p_ator uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  v_ator text;
  v_dest uuid;
  v_papel text;
  v_total integer := 0;
BEGIN
  SELECT ag.id, ag.cliente_id, ag.data_hora, b.user_id AS barbeiro_user, s.nome AS servico,
         public.primeiro_nome(b.nome, 'Barbeiro') AS barbeiro_nome,
         public.primeiro_nome(pr.nome, 'Cliente') AS cliente_nome
    INTO a
    FROM public.agendamentos ag
    JOIN public.barbeiros b ON b.id = ag.barbeiro_id
    JOIN public.servicos s ON s.id = ag.servico_id
    LEFT JOIN public.profiles pr ON pr.user_id = ag.cliente_id
   WHERE ag.id = p_agendamento_id;
  -- Horario ja passou: nao ha o que avisar (no cancelamento, e falta)
  IF NOT FOUND OR a.data_hora <= now() THEN
    RETURN 0;
  END IF;

  v_ator := CASE WHEN p_ator = a.cliente_id THEN 'cliente'
                 WHEN p_ator = a.barbeiro_user THEN 'barbeiro'
                 ELSE 'barbearia' END;

  FOR v_dest, v_papel IN
    SELECT d.uid, d.papel FROM (VALUES (a.cliente_id, 'cliente'), (a.barbeiro_user, 'barbeiro')) AS d(uid, papel)
  LOOP
    CONTINUE WHEN v_dest IS NULL OR v_dest = p_ator;
    CONTINUE WHEN p_tipo = 'novo_agendamento' AND v_papel <> 'barbeiro';
    IF public.inserir_notificacao(
         p_tipo,
         format('%s:%s:%s', p_tipo, a.id, v_dest),
         v_dest,
         p_ator,
         jsonb_build_object(
           'agendamento_id', a.id, 'data_hora', a.data_hora, 'servico', a.servico,
           'cliente_nome', a.cliente_nome, 'barbeiro_nome', a.barbeiro_nome,
           'papel', v_papel, 'ator', v_ator),
         a.data_hora,
         a.id) THEN
      v_total := v_total + 1;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$;
REVOKE ALL ON FUNCTION public.avisar_agendamento(text, uuid, uuid) FROM PUBLIC, anon, authenticated;

-- Reserva do push: exatamente a da migration 25
CREATE OR REPLACE FUNCTION public.reservar_notificacoes(p_limite integer DEFAULT 50)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ids uuid[];
  n public.notificacoes%ROWTYPE;
  v_motivo text;
  v_dispositivos jsonb;
  v_item jsonb;
  v_saida jsonb := '[]'::jsonb;
BEGIN
  PERFORM public.expirar_notificacoes();

  WITH livres AS (
    SELECT id
      FROM public.notificacoes
     WHERE canal = 'push'
       AND ((status = 'pendente' AND proxima_tentativa <= now())
            OR (status = 'enviando' AND reservada_ate < now()))
     ORDER BY proxima_tentativa, criada_em
     LIMIT greatest(1, least(coalesce(p_limite, 50), 100))
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
  SELECT coalesce(array_agg(id), ARRAY[]::uuid[]) INTO v_ids FROM reservadas;

  FOR n IN
    SELECT * FROM public.notificacoes WHERE id = ANY (v_ids) ORDER BY proxima_tentativa, criada_em
  LOOP
    v_motivo := public.motivo_para_nao_enviar(n);

    IF v_motivo IS NULL THEN
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'token', d.token) ORDER BY d.criado_em), '[]'::jsonb)
        INTO v_dispositivos
        FROM public.dispositivos_push d
       WHERE d.user_id = n.destinatario_id
         AND d.ativo
         AND NOT EXISTS (
           SELECT 1 FROM public.notificacao_envios e
            WHERE e.notificacao_id = n.id AND e.dispositivo_id = d.id AND e.status <> 'erro');

      IF jsonb_array_length(v_dispositivos) = 0 THEN
        -- Todos os aparelhos ja receberam (ex.: retomada depois de uma queda)
        IF EXISTS (SELECT 1 FROM public.notificacao_envios e
                    WHERE e.notificacao_id = n.id AND e.status IN ('aceito', 'entregue')) THEN
          UPDATE public.notificacoes
             SET status = 'enviada', reservada_ate = NULL, enviada_em = coalesce(enviada_em, now()),
                 atualizada_em = now()
           WHERE id = n.id;
          CONTINUE;
        END IF;
        v_motivo := 'sem_aparelho';
      END IF;
    END IF;

    IF v_motivo IS NOT NULL THEN
      UPDATE public.notificacoes
         SET status = CASE WHEN v_motivo = 'prazo' THEN 'expirada' ELSE 'ignorada' END,
             motivo = v_motivo, reservada_ate = NULL, atualizada_em = now()
       WHERE id = n.id;
      CONTINUE;
    END IF;

    v_item := jsonb_build_object(
      'id', n.id,
      'tipo', n.tipo,
      'destinatario_id', n.destinatario_id,
      'tentativas', n.tentativas,
      'dados', n.dados,
      'dispositivos', v_dispositivos);
    IF n.tipo = 'mensagem' THEN
      -- O mesmo contador de nao lidas dos apps: mensagens do outro, nao lidas
      v_item := v_item || jsonb_build_object('nao_lidas', (
        SELECT count(*) FROM public.mensagens m
         WHERE m.conversa_id = n.conversa_id AND m.remetente_id <> n.destinatario_id AND NOT m.lida));
    END IF;
    v_saida := v_saida || jsonb_build_array(v_item);
  END LOOP;

  RETURN v_saida;
END;
$$;

-- Rotina de cada minuto: exatamente a da migration 26
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
  v_solicitacoes integer := 0;
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
  BEGIN
    v_solicitacoes := public.whatsapp_expirar_solicitacoes();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whatsapp: nao foi possivel expirar as solicitacoes de cancelamento (%)', SQLSTATE;
  END;
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
    'solicitacoes_expiradas', v_solicitacoes, 'pendentes', v_pendentes, 'despertou', v_despertou);
END;
$$;

DROP INDEX IF EXISTS public.notificacoes_central_nao_lidas;
ALTER TABLE public.notificacoes DROP COLUMN IF EXISTS lida_em;
ALTER TABLE public.notificacao_config DROP COLUMN IF EXISTS push_ativado_em;
ALTER TABLE public.notificacao_config DROP COLUMN IF EXISTS push_ativo;

REVOKE ALL ON FUNCTION public.reservar_notificacoes(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotina_notificacoes() FROM PUBLIC, anon, authenticated;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.reservar_notificacoes(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rotina_notificacoes() TO service_role;
  END IF;
END $$;

COMMIT;
