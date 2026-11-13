-- =====================================================================
-- WhatsApp (1): confirmacao de presenca 2 horas antes do atendimento
--
-- NAO execute antes da aprovacao. Rode depois das migrations
-- 20261104000016_consentimentos.sql, 20261109000021_notificacoes.sql e
-- 20261109000022_notificacoes_eventos.sql. Pode ser executada de novo.
--
-- O que faz:
--   * a fila public.notificacoes ganha a coluna "canal" (push ou whatsapp) e
--     os tipos confirmacao_presenca e presenca_negada. A reserva do push passa
--     a ler so o canal push;
--   * 2 horas antes de um agendamento confirmado, o job de cada minuto grava
--     um pedido de confirmacao para o cliente que autorizou o WhatsApp e tem
--     celular valido. Um por agendamento e horario (chave unica): nunca dois;
--   * quem agendou (ou mudou o horario) com menos de 2 horas nao recebe;
--   * o backend reserva, envia pela Cloud API da Meta e grava o resultado. Cada
--     tentativa e gravada ANTES da chamada; resultado incerto nao e reenviado;
--   * a resposta SIM ou NAO (botao ou texto) chega pelo webhook do backend e e
--     gravada aqui, depois de reconferir o agendamento. A primeira resposta
--     valida e a definitiva. NAO nao cancela nada: so registra e avisa o
--     barbeiro (na agenda e, se ele autorizou, pelo WhatsApp);
--   * cancelar ou mudar o horario invalida o pedido antigo: nada e enviado e
--     respostas atrasadas nao valem;
--   * PARAR, SAIR ou STOP revoga a autorizacao.
--
-- Nada aqui envia mensagem: o envio e do backend, e so com
-- NOTIFICACOES_WHATSAPP_ATIVO=true e as credenciais da Meta.
-- Funcoes novas: SECURITY DEFINER com search_path = pg_catalog, pg_temp (todo
-- nome vem com o schema). Tabelas novas: RLS ligado, sem policies e sem
-- permissao para o app ou o site.
-- Tudo roda numa unica transacao (BEGIN ... COMMIT): se algo falhar, nada fica.
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- Tudo numa unica transacao: qualquer erro desfaz tudo
BEGIN;

-- ---------------------------------------------------------------
-- 0. Pre-requisitos: se faltar algo, para aqui sem criar nada
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.notificacoes') IS NULL
     OR to_regprocedure('public.rotina_notificacoes()') IS NULL
     OR to_regprocedure('public.reservar_notificacoes(integer)') IS NULL
     OR to_regprocedure('public.primeiro_nome(text,text)') IS NULL THEN
    RAISE EXCEPTION 'Rode antes as migrations 20261109000021 e 20261109000022. Nada foi criado.';
  END IF;
  IF to_regclass('public.consentimentos') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a 20261104000016_consentimentos.sql. Nada foi criado.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'telefone') THEN
    RAISE EXCEPTION 'A coluna public.profiles.telefone nao existe. Nada foi criado.';
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Fila: canal e tipos novos
-- ---------------------------------------------------------------
ALTER TABLE public.notificacoes ADD COLUMN IF NOT EXISTS canal text NOT NULL DEFAULT 'push';

DO $$
DECLARE
  r record;
BEGIN
  -- Troca os CHECKs de tipo e de canal (qualquer que seja o nome deles)
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.notificacoes'::regclass AND c.contype = 'c'
       AND (pg_get_constraintdef(c.oid) LIKE '%novo_agendamento%' OR pg_get_constraintdef(c.oid) LIKE '%canal%')
  LOOP
    EXECUTE format('ALTER TABLE public.notificacoes DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.notificacoes ADD CONSTRAINT notificacoes_tipo_check
    CHECK (tipo IN ('cancelamento', 'mensagem', 'novo_agendamento', 'lembrete', 'teste',
                    'confirmacao_presenca', 'presenca_negada'));
  ALTER TABLE public.notificacoes ADD CONSTRAINT notificacoes_canal_check
    CHECK (canal IN ('push', 'whatsapp'));
END $$;

CREATE INDEX IF NOT EXISTS notificacoes_fila_canal ON public.notificacoes (canal, proxima_tentativa)
  WHERE status IN ('pendente', 'enviando');

-- ---------------------------------------------------------------
-- 2. Agendamento: quando o horario atual foi definido (criacao ou mudanca).
--    Sem preencher os antigos (evita disparar os triggers de regra): onde
--    estiver vazio vale created_at.
-- ---------------------------------------------------------------
ALTER TABLE public.agendamentos ADD COLUMN IF NOT EXISTS horario_definido_em timestamptz;

CREATE OR REPLACE FUNCTION public.agendamento_marcar_horario_definido()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.data_hora IS DISTINCT FROM OLD.data_hora THEN
    NEW.horario_definido_em := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agendamento_horario_definido ON public.agendamentos;
CREATE TRIGGER agendamento_horario_definido
  BEFORE INSERT OR UPDATE OF data_hora ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.agendamento_marcar_horario_definido();

-- ---------------------------------------------------------------
-- 3. Consentimento: nova finalidade e a revogacao pelo proprio WhatsApp
-- ---------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.consentimentos'::regclass AND c.contype = 'c'
       AND (pg_get_constraintdef(c.oid) LIKE '%visagismo_foto%'
            OR pg_get_constraintdef(c.oid) LIKE '%revogado_origem = ANY%'
            OR pg_get_constraintdef(c.oid) LIKE '%revogado_origem IN%')
  LOOP
    EXECUTE format('ALTER TABLE public.consentimentos DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.consentimentos ADD CONSTRAINT consentimentos_finalidade_check
    CHECK (finalidade IN ('visagismo_foto', 'whatsapp_avisos'));
  ALTER TABLE public.consentimentos ADD CONSTRAINT consentimentos_revogado_origem_check
    CHECK (revogado_origem IN ('web', 'mobile', 'whatsapp'));
END $$;

-- ---------------------------------------------------------------
-- 4. Tabelas novas
-- ---------------------------------------------------------------
-- Um pedido de confirmacao por agendamento e horario.
--   pendente     gravado, ainda nao enviado
--   enviada      aceito pela Meta, sem resposta (o barbeiro ve "Sem resposta")
--   confirmada   o cliente respondeu SIM
--   recusada     o cliente respondeu NAO (o agendamento continua ativo)
--   nao_enviada  nao deu para enviar (motivo)
--   invalidada   o agendamento foi cancelado ou mudou de horario
CREATE TABLE IF NOT EXISTS public.confirmacoes_presenca (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id  uuid NOT NULL REFERENCES public.agendamentos(id) ON DELETE CASCADE,
  -- Horario a que o pedido se refere: resposta para outro horario nao vale
  data_hora       timestamptz NOT NULL,
  cliente_id      uuid NOT NULL,
  notificacao_id  uuid REFERENCES public.notificacoes(id) ON DELETE SET NULL,
  estado          text NOT NULL DEFAULT 'pendente'
                    CHECK (estado IN ('pendente', 'enviada', 'confirmada', 'recusada', 'nao_enviada', 'invalidada')),
  motivo          text,
  enviada_em      timestamptz,
  respondida_em   timestamptz,
  resposta_origem text CHECK (resposta_origem IN ('botao', 'texto')),
  criada_em       timestamptz NOT NULL DEFAULT now(),
  atualizada_em   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (agendamento_id, data_hora)
);
CREATE INDEX IF NOT EXISTS confirmacoes_presenca_notificacao ON public.confirmacoes_presenca (notificacao_id);
CREATE INDEX IF NOT EXISTS confirmacoes_presenca_abertas ON public.confirmacoes_presenca (cliente_id)
  WHERE estado = 'enviada';

-- Uma linha por tentativa de envio, gravada antes de chamar a Meta.
--   iniciado  reservado para envio, sem resultado ainda
--   aceito    a Meta aceitou (wamid); enviado, entregue e lido vem do webhook
--   falhou    a Meta recusou ou informou falha
--   incerto   nao se sabe se saiu (sem resposta da Meta): nunca e reenviado
CREATE TABLE IF NOT EXISTS public.whatsapp_mensagens (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id uuid NOT NULL REFERENCES public.notificacoes(id) ON DELETE CASCADE,
  tentativa      integer NOT NULL,
  estado         text NOT NULL DEFAULT 'iniciado'
                   CHECK (estado IN ('iniciado', 'aceito', 'enviado', 'entregue', 'lido', 'falhou', 'incerto')),
  -- Identificador da mensagem na Meta e o numero (wa_id) que ela devolveu
  wamid          text UNIQUE,
  wa_id          text,
  erro           text,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notificacao_id, tentativa)
);

-- Mensagens recebidas ja processadas (a Meta pode entregar a mesma duas vezes)
CREATE TABLE IF NOT EXISTS public.whatsapp_eventos (
  chave       text PRIMARY KEY,
  recebido_em timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.confirmacoes_presenca ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whatsapp_eventos ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.confirmacoes_presenca, public.whatsapp_mensagens, public.whatsapp_eventos
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------
-- 5. Auxiliares
-- ---------------------------------------------------------------
-- Celular brasileiro no formato da Cloud API (55 + DDD + 9 digitos), ou NULL.
-- Fixo nao entra: nao recebe WhatsApp pelo numero cadastrado.
CREATE OR REPLACE FUNCTION public.whatsapp_telefone(p_telefone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN x.d ~ '^[1-9][1-9]9[0-9]{8}$' THEN '55' || x.d END
    FROM (SELECT regexp_replace(
                   regexp_replace(regexp_replace(coalesce(p_telefone, ''), '\D', '', 'g'), '^0+', ''),
                   '^55([1-9][1-9]9[0-9]{8})$', '\1') AS d) x
$$;

-- Numero para comparacao: a Meta pode devolver o celular brasileiro sem o 9
-- inicial (55 + DDD + 8 digitos). Os dois formatos viram a mesma chave.
CREATE OR REPLACE FUNCTION public.whatsapp_chave_numero(p_numero text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT CASE WHEN x.d ~ '^55[1-9][1-9]9[0-9]{8}$' THEN substr(x.d, 1, 4) || substr(x.d, 6)
              WHEN x.d = '' THEN NULL
              ELSE x.d END
    FROM (SELECT regexp_replace(coalesce(p_numero, ''), '\D', '', 'g') AS d) x
$$;

-- O usuario autorizou os avisos pelo WhatsApp e nao revogou
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

-- ---------------------------------------------------------------
-- 6. Pedidos de confirmacao (o job do pg_cron chama a cada minuto)
--    Entre 120 e 60 minutos antes; depois disso nao vale mais pedir.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enfileirar_confirmacoes_presenca()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  r record;
  v_confirmacao uuid;
  v_notificacao uuid;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT ag.id, ag.data_hora, ag.cliente_id, s.nome AS servico,
           public.primeiro_nome(b.nome, 'Barbeiro') AS barbeiro_nome,
           public.primeiro_nome(pr.nome, 'Cliente') AS cliente_nome
      FROM public.agendamentos ag
      JOIN public.barbeiros b ON b.id = ag.barbeiro_id
      JOIN public.servicos s ON s.id = ag.servico_id
      JOIN public.profiles pr ON pr.user_id = ag.cliente_id
     WHERE ag.status = 'confirmado'
       AND ag.data_hora > now() + interval '60 minutes'
       AND ag.data_hora <= now() + interval '120 minutes'
       -- Quem definiu o horario com menos de 2 horas nao recebe o pedido
       AND coalesce(ag.horario_definido_em, ag.created_at) <= ag.data_hora - interval '120 minutes'
       AND public.whatsapp_telefone(pr.telefone) IS NOT NULL
       AND public.whatsapp_consentiu(ag.cliente_id)
       AND NOT EXISTS (SELECT 1 FROM public.confirmacoes_presenca c
                        WHERE c.agendamento_id = ag.id AND c.data_hora = ag.data_hora)
  LOOP
    v_confirmacao := gen_random_uuid();
    INSERT INTO public.confirmacoes_presenca (id, agendamento_id, data_hora, cliente_id)
    VALUES (v_confirmacao, r.id, r.data_hora, r.cliente_id)
    ON CONFLICT (agendamento_id, data_hora) DO NOTHING;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_notificacao := NULL;
    INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, agendamento_id, dados, expira_em)
    VALUES ('confirmacao_presenca', 'whatsapp',
            format('whatsapp:confirmacao:%s:%s', r.id, extract(epoch FROM r.data_hora)::bigint),
            r.cliente_id, r.id,
            jsonb_build_object(
              'agendamento_id', r.id, 'confirmacao_id', v_confirmacao, 'data_hora', r.data_hora,
              'servico', r.servico, 'cliente_nome', r.cliente_nome, 'barbeiro_nome', r.barbeiro_nome),
            r.data_hora - interval '60 minutes')
    ON CONFLICT (chave) DO NOTHING
    RETURNING id INTO v_notificacao;

    IF v_notificacao IS NULL THEN
      UPDATE public.confirmacoes_presenca
         SET estado = 'nao_enviada', motivo = 'aviso_ja_existia', atualizada_em = now()
       WHERE id = v_confirmacao;
    ELSE
      UPDATE public.confirmacoes_presenca SET notificacao_id = v_notificacao WHERE id = v_confirmacao;
      v_total := v_total + 1;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$;

-- Confere, na hora de enviar, se o aviso do WhatsApp ainda vale. NULL = pode.
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

-- ---------------------------------------------------------------
-- 7. Envio (backend): reservar e concluir
-- ---------------------------------------------------------------
-- Reserva ate p_limite avisos do WhatsApp e devolve so os que ainda valem:
--   [{ id, tipo, destinatario_id, tentativas, dados, telefone }]
-- Cada item devolvido ja tem a tentativa gravada em whatsapp_mensagens.
-- Reserva vencida sem resultado NAO volta para a fila: vira "resultado
-- incerto" (nao se sabe se a mensagem saiu, e a Meta nao tem como evitar a
-- repeticao).
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

-- Grava o resultado de um envio. p_resultado:
--   { status: 'aceito', wamid, wa_id }   a Meta aceitou
--   { status: 'recusado', erro }         recusa definitiva (ex.: numero sem WhatsApp)
--   { status: 'erro', erro }             a Meta respondeu que nao enviou: tenta de
--                                        novo (30 s, 2 e 8 min), dentro do prazo
--   { status: 'incerto', erro }          sem resposta: nao tenta de novo
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

-- ---------------------------------------------------------------
-- 8. Webhook (backend): estado da entrega e resposta do cliente
-- ---------------------------------------------------------------
-- Estado informado pela Meta para uma mensagem enviada: enviado, entregue,
-- lido ou falhou. So avanca (um "enviado" atrasado nao desfaz um "lido").
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

-- Resposta recebida pelo webhook. Devolve { resultado, ... }:
--   confirmada | recusada      gravou a resposta (a primeira valida e a definitiva)
--   ja_respondida              ja havia resposta: nada muda
--   agendamento_invalido       cancelado, concluido, com outro horario ou ja passou
--   ambigua                    texto "sim"/"nao" com mais de um pedido aberto
--   sem_pedido                 nenhum pedido aberto para esse numero
--   invalida                   botao que nao confere com o numero ou a mensagem
--   descadastro                PARAR, SAIR ou STOP: autorizacao revogada
--   nao_reconhecida            outro texto
--   duplicada                  a mesma mensagem ja foi processada
-- Botao: exige o identificador do pedido (payload), a mensagem respondida
-- (contexto) e o numero do destinatario. Texto: so "sim", "nao" ou "não", e
-- so quando o numero tem exatamente um pedido aberto.
-- Travas: primeiro o agendamento, depois o pedido.
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

-- ---------------------------------------------------------------
-- 9. Cancelamento ou mudanca de horario: o pedido antigo deixa de valer
--    (nada e enviado e resposta atrasada nao e aceita). Erro aqui so e
--    registrado: nunca impede cancelar ou alterar o agendamento.
-- ---------------------------------------------------------------
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

DROP TRIGGER IF EXISTS invalidar_confirmacao_presenca ON public.agendamentos;
CREATE TRIGGER invalidar_confirmacao_presenca
  AFTER UPDATE OF status, data_hora ON public.agendamentos
  FOR EACH ROW
  EXECUTE FUNCTION public.invalidar_confirmacao_presenca();

-- ---------------------------------------------------------------
-- 10. Tela do barbeiro (e do cliente e do admin): situacao da confirmacao
--     dos agendamentos pedidos, so dos que quem chama pode ver.
--       confirmada | recusada | sem_resposta | pendente | nao_enviada
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- 11. Funcoes existentes: a reserva do push le so o canal push, e a rotina de
--     cada minuto tambem gera os pedidos de confirmacao
-- ---------------------------------------------------------------
-- Copia da funcao da migration 21; a unica mudanca e o filtro canal = 'push'
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
  SELECT EXISTS (
    SELECT 1 FROM public.notificacoes
     WHERE (status = 'pendente' AND proxima_tentativa <= now())
        OR (status = 'enviando' AND reservada_ate < now())
  ) INTO v_pendentes;
  IF v_pendentes THEN
    v_despertou := public.despertar_backend();
  END IF;
  RETURN jsonb_build_object(
    'lembretes', v_lembretes, 'confirmacoes', v_confirmacoes, 'expiradas', v_expiradas,
    'pendentes', v_pendentes, 'despertou', v_despertou);
END;
$$;

-- ---------------------------------------------------------------
-- 12. Permissoes
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.agendamento_marcar_horario_definido() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.invalidar_confirmacao_presenca() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_telefone(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_chave_numero(text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_consentiu(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enfileirar_confirmacoes_presenca() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_motivo_para_nao_enviar(public.notificacoes) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_whatsapp(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_envio_whatsapp(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_registrar_status(text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_registrar_resposta(text, text, text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_notificacoes(integer) FROM PUBLIC, anon, authenticated;
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
    GRANT EXECUTE ON FUNCTION public.reservar_notificacoes(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.rotina_notificacoes() TO service_role;
  END IF;
END $$;

COMMIT;
