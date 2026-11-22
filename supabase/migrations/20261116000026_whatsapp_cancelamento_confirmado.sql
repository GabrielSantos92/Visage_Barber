-- =====================================================================
-- WhatsApp (2): cancelamento pelo WhatsApp com confirmacao dupla
--
-- NAO execute sem aprovacao. Ordem: primeiro no projeto Supabase de TESTE
-- (marcado com supabase/teste/marcar_banco_de_teste.sql); so depois, com nova
-- autorizacao, no de producao. Requer as migrations
-- 20261113000025_whatsapp_confirmacao_presenca.sql e
-- 20261115000027_despertar_so_whatsapp.sql aplicadas (a 27 vem ANTES desta;
-- sem ela, esta migration para sem mudar nada). Pode ser executada de novo.
-- Tudo numa unica transacao: se algo falhar, nada fica.
-- Rollback: supabase/rollbacks/20261116000026_rollback.sql (volta ao estado
-- da 27). Depois desta migration, NAO reexecute a 27 (ela para), a 21, a 22
-- nem a 25 (trariam de volta o gatilho de INSERT ou a rotina sem o filtro).
--
-- Fluxo:
--   1. Duas horas antes, o cliente recebe a confirmacao de presenca (migration
--      25), com os botoes SIM e NAO.
--   2. SIM: a presenca fica confirmada (igual a 25).
--   3. NAO: NADA e cancelado e o horario continua reservado. O pedido de
--      presenca fica 'recusada' e nasce uma solicitacao de cancelamento
--      (public.solicitacoes_cancelamento), que gera uma SEGUNDA mensagem:
--      "Tem certeza de que deseja cancelar?", com os botoes SIM, CANCELAR e
--      NAO, MANTER.
--   4. SIM, CANCELAR: cancela SO o agendamento dessa solicitacao, e so se o
--      botao for da segunda mensagem, vier do numero que a recebeu, chegar
--      antes do prazo e o agendamento continuar confirmado no mesmo horario.
--      Grava a origem 'whatsapp_resposta_negativa' e a hora, e avisa o
--      barbeiro (na agenda e, se ele autorizou, pelo WhatsApp).
--   5. NAO, MANTER: a solicitacao termina como 'desistiu'; nada muda.
--   6. Sem resposta ate o horario do atendimento: a solicitacao expira e nada
--      muda. Nada e cancelado automaticamente. Quem registra a expiracao e o
--      proprio banco: a rotina de cada minuto do pg_cron
--      (rotina_notificacoes, migration 22) chama
--      whatsapp_expirar_solicitacoes; o backend nao precisa estar acordado.
--      Expirar nao cancela, nao libera o horario e nao gera aviso.
--   7. A segunda mensagem nao chegou ao cliente (a Meta recusou de vez ou
--      informou falha na entrega): NADA e cancelado e o cliente recebe UM
--      aviso (cancelamento_nao_concluido): o pedido foi recebido, o
--      cancelamento nao foi feito, o horario continua reservado e, para
--      cancelar, ele deve usar o app, o site ou falar com a barbearia. Nunca
--      para resultado incerto (a mensagem pode ter chegado) nem depois do
--      horario.
--   Texto livre nunca cancela: "nao" digitado (com um unico pedido aberto,
--   como na 25) so abre a solicitacao, e "sim"/"nao" digitados enquanto ha
--   uma solicitacao aguardando so recebem a orientacao de usar os botoes.
--
-- Protecoes:
--   * cada mensagem da Meta e processada uma vez (whatsapp_eventos, da 25);
--   * travas sempre na mesma ordem do cancelamento pelo app: agendamento,
--     pedido de presenca, solicitacao. Tudo e reconferido sob a trava;
--   * uma solicitacao por pedido de presenca e no maximo uma aberta por
--     agendamento (indices unicos);
--   * a solicitacao so anda para frente (gatilho): encerrada, nao muda mais;
--   * cancelar pelo app, mudar o horario ou concluir invalida a solicitacao
--     aberta (o gatilho da 25 passa a cuidar dela tambem).
--
-- O que NAO muda: pagamentos (nenhum estorno automatico: gerar_lancamentos
-- so gera comissao de servico concluido), validar_agendamento, os indices de
-- horario e a tabela agendamentos (nenhuma coluna nova). O horario fica livre
-- como em qualquer cancelamento: agendamentos_horario_unico e
-- conflito_agendamento ja ignoram cancelados.
--
-- Consentimento: o aviso do WhatsApp mudou (agora da para cancelar por la),
-- entao so vale a autorizacao dada na versao nova do aviso
-- (public.whatsapp_versao_aviso, igual a FINALIDADES.whatsapp_avisos em
-- backend/src/services/consentimento.js). Quem autorizou a versao anterior
-- deixa de receber ate autorizar de novo no Perfil.
--
-- Efeito colateral conhecido (o mesmo de qualquer cancelamento feito pelo
-- backend): o gatilho notificar_cancelamento (migration 22) grava avisos do
-- canal push com ator "barbearia". O push esta desligado; nada e enviado.
--
-- Nada aqui envia mensagem: o envio e do backend, e so com
-- NOTIFICACOES_WHATSAPP_ATIVO=true e as credenciais da Meta.
-- Execute no Supabase Dashboard > SQL Editor.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------
-- 0. Pre-requisitos: se faltar algo, para aqui sem mudar nada
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.confirmacoes_presenca') IS NULL
     OR to_regclass('public.whatsapp_mensagens') IS NULL
     OR to_regclass('public.whatsapp_eventos') IS NULL
     OR to_regprocedure('public.whatsapp_registrar_resposta(text,text,text,text,text,text)') IS NULL
     OR to_regprocedure('public.whatsapp_motivo_para_nao_enviar(public.notificacoes)') IS NULL
     OR to_regprocedure('public.reservar_whatsapp(integer)') IS NULL
     OR to_regprocedure('public.concluir_envio_whatsapp(uuid,jsonb)') IS NULL
     OR to_regprocedure('public.whatsapp_registrar_status(text,text,text)') IS NULL
     OR to_regprocedure('public.presenca_dos_agendamentos(uuid[])') IS NULL
     OR to_regprocedure('public.invalidar_confirmacao_presenca()') IS NULL
     OR to_regprocedure('public.whatsapp_consentiu(uuid)') IS NULL
     OR to_regprocedure('public.rotina_notificacoes()') IS NULL
     OR to_regprocedure('public.expirar_notificacoes()') IS NULL
     OR to_regprocedure('public.enfileirar_confirmacoes_presenca()') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a migration 20261113000025_whatsapp_confirmacao_presenca.sql. Nada foi alterado.';
  END IF;
  -- A 27 vem antes: a rotina desta migration mantem o filtro de canal dela, e
  -- o gatilho de INSERT que ela removeu nao pode ter voltado
  IF EXISTS (SELECT 1 FROM pg_trigger t
              WHERE t.tgrelid = 'public.notificacoes'::regclass AND t.tgname = 'despertar_backend')
     OR to_regprocedure('public.despertar_backend_apos_aviso()') IS NOT NULL THEN
    RAISE EXCEPTION 'Rode antes a migration 20261115000027_despertar_so_whatsapp.sql. Nada foi alterado.';
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Fila: tres tipos novos do canal whatsapp
--    confirmacao_cancelamento    segunda mensagem ao cliente (com os botoes)
--    cancelamento_whatsapp       aviso ao barbeiro: o cliente cancelou
--    cancelamento_nao_concluido  aviso ao cliente: a segunda mensagem nao
--                                chegou; nada foi cancelado
-- ---------------------------------------------------------------
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
      FROM pg_constraint c
     WHERE c.conrelid = 'public.notificacoes'::regclass AND c.contype = 'c'
       AND pg_get_constraintdef(c.oid) LIKE '%novo_agendamento%'
  LOOP
    EXECUTE format('ALTER TABLE public.notificacoes DROP CONSTRAINT %I', r.conname);
  END LOOP;
  ALTER TABLE public.notificacoes ADD CONSTRAINT notificacoes_tipo_check
    CHECK (tipo IN ('cancelamento', 'mensagem', 'novo_agendamento', 'lembrete', 'teste',
                    'confirmacao_presenca', 'presenca_negada',
                    'confirmacao_cancelamento', 'cancelamento_whatsapp', 'cancelamento_nao_concluido'));
END $$;

-- ---------------------------------------------------------------
-- 2. Solicitacoes de cancelamento (uma por resposta NAO)
--   pendente     gravada; a segunda mensagem ainda nao saiu
--   aguardando   a Meta aceitou a segunda mensagem; esperando o cliente
--   confirmada   o cliente tocou em SIM, CANCELAR: agendamento cancelado
--   desistiu     o cliente tocou em NAO, MANTER: agendamento mantido
--   expirada     sem resposta ate o horario: agendamento mantido
--   nao_enviada  a segunda mensagem nao saiu (motivo): agendamento mantido
--   invalidada   o agendamento foi cancelado por outro caminho, concluido
--                ou mudou de horario antes da resposta
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.solicitacoes_cancelamento (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Pedido de presenca respondido com NAO: no maximo uma solicitacao por pedido
  confirmacao_id      uuid NOT NULL UNIQUE REFERENCES public.confirmacoes_presenca(id) ON DELETE CASCADE,
  agendamento_id      uuid NOT NULL REFERENCES public.agendamentos(id) ON DELETE CASCADE,
  -- Horario a que a solicitacao se refere: com outro horario, ela nao vale
  data_hora           timestamptz NOT NULL,
  cliente_id          uuid NOT NULL,
  -- Segunda mensagem na fila
  notificacao_id      uuid REFERENCES public.notificacoes(id) ON DELETE SET NULL,
  estado              text NOT NULL DEFAULT 'pendente'
                        CHECK (estado IN ('pendente', 'aguardando', 'confirmada', 'desistiu',
                                          'expirada', 'nao_enviada', 'invalidada')),
  motivo              text,
  -- Como o cliente respondeu NAO na primeira mensagem
  origem_pedido       text NOT NULL CHECK (origem_pedido IN ('botao', 'texto')),
  -- Ate quando a confirmacao vale: o horario do atendimento
  expira_em           timestamptz NOT NULL,
  enviada_em          timestamptz,
  respondida_em       timestamptz,
  -- Identificadores das mensagens recebidas da Meta (auditoria)
  evento_pedido       text NOT NULL,
  evento_resposta     text,
  -- So quando o cliente confirma o cancelamento
  cancelamento_origem text,
  cancelado_em        timestamptz,
  criada_em           timestamptz NOT NULL DEFAULT now(),
  atualizada_em       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT solicitacoes_cancelamento_origem_check CHECK (
    (estado = 'confirmada' AND cancelamento_origem = 'whatsapp_resposta_negativa' AND cancelado_em IS NOT NULL)
    OR (estado <> 'confirmada' AND cancelamento_origem IS NULL AND cancelado_em IS NULL)),
  CONSTRAINT solicitacoes_cancelamento_resposta_check CHECK (
    estado NOT IN ('confirmada', 'desistiu') OR (respondida_em IS NOT NULL AND evento_resposta IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS solicitacoes_cancelamento_notificacao ON public.solicitacoes_cancelamento (notificacao_id);
CREATE INDEX IF NOT EXISTS solicitacoes_cancelamento_agendamento ON public.solicitacoes_cancelamento (agendamento_id);
CREATE INDEX IF NOT EXISTS solicitacoes_cancelamento_abertas_cliente ON public.solicitacoes_cancelamento (cliente_id)
  WHERE estado IN ('pendente', 'aguardando');
-- No maximo uma solicitacao aberta por agendamento
CREATE UNIQUE INDEX IF NOT EXISTS solicitacoes_cancelamento_aberta_unica ON public.solicitacoes_cancelamento (agendamento_id)
  WHERE estado IN ('pendente', 'aguardando');

ALTER TABLE public.solicitacoes_cancelamento ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.solicitacoes_cancelamento FROM PUBLIC, anon, authenticated;

-- Historico: a solicitacao so anda para frente e, encerrada, nao muda mais.
-- Unica excecao: a limpeza de avisos antigos (limpar_notificacoes_antigas)
-- apaga o aviso e o ON DELETE SET NULL esvazia notificacao_id.
CREATE OR REPLACE FUNCTION public.solicitacao_cancelamento_transicao()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, pg_temp
AS $$
BEGIN
  IF NEW.notificacao_id IS NULL AND OLD.notificacao_id IS NOT NULL
     AND (to_jsonb(NEW) - 'notificacao_id' - 'atualizada_em') = (to_jsonb(OLD) - 'notificacao_id' - 'atualizada_em') THEN
    RETURN NEW;
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.confirmacao_id IS DISTINCT FROM OLD.confirmacao_id
     OR NEW.agendamento_id IS DISTINCT FROM OLD.agendamento_id OR NEW.data_hora IS DISTINCT FROM OLD.data_hora
     OR NEW.cliente_id IS DISTINCT FROM OLD.cliente_id OR NEW.origem_pedido IS DISTINCT FROM OLD.origem_pedido
     OR NEW.expira_em IS DISTINCT FROM OLD.expira_em OR NEW.evento_pedido IS DISTINCT FROM OLD.evento_pedido
     OR NEW.criada_em IS DISTINCT FROM OLD.criada_em
     OR (OLD.notificacao_id IS NOT NULL AND NEW.notificacao_id IS DISTINCT FROM OLD.notificacao_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'SOLICITACAO_IMUTAVEL',
      MESSAGE = 'Os dados da solicitação de cancelamento não podem ser alterados.';
  END IF;
  IF OLD.estado IN ('confirmada', 'desistiu', 'expirada', 'nao_enviada', 'invalidada') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'SOLICITACAO_ENCERRADA',
      MESSAGE = 'A solicitação de cancelamento já foi encerrada.';
  END IF;
  IF NEW.estado IS DISTINCT FROM OLD.estado AND NOT (
       (OLD.estado = 'pendente' AND NEW.estado IN ('aguardando', 'nao_enviada', 'invalidada'))
    OR (OLD.estado = 'aguardando' AND NEW.estado IN ('confirmada', 'desistiu', 'expirada', 'nao_enviada', 'invalidada'))) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'TRANSICAO_INVALIDA',
      MESSAGE = 'Mudança de situação inválida na solicitação de cancelamento.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS solicitacao_cancelamento_transicao ON public.solicitacoes_cancelamento;
CREATE TRIGGER solicitacao_cancelamento_transicao
  BEFORE UPDATE ON public.solicitacoes_cancelamento
  FOR EACH ROW
  EXECUTE FUNCTION public.solicitacao_cancelamento_transicao();

-- ---------------------------------------------------------------
-- 3. Consentimento: so vale a autorizacao dada na versao atual do aviso
-- ---------------------------------------------------------------
-- Versao do aviso do WhatsApp em vigor. Igual a
-- FINALIDADES.whatsapp_avisos.versaoAviso (backend) e VERSAO_AVISO_WHATSAPP
-- (site e app). Mudou o texto: nova migration com a nova versao.
CREATE OR REPLACE FUNCTION public.whatsapp_versao_aviso()
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT '2026-11-16'::text
$$;

CREATE OR REPLACE FUNCTION public.whatsapp_consentiu(p_user uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.consentimentos c
     WHERE c.user_id = p_user AND c.finalidade = 'whatsapp_avisos' AND c.revogado_em IS NULL
       AND c.versao_aviso = public.whatsapp_versao_aviso())
$$;

-- ---------------------------------------------------------------
-- 4. Envio: o que ainda vale na hora de enviar. NULL = pode.
-- ---------------------------------------------------------------
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

-- Prazo vencido (o horario do atendimento chegou): a solicitacao fecha sem
-- cancelar nada, sem liberar o horario e sem gerar aviso.
--   aguardando (o cliente recebeu e nao respondeu)  -> expirada
--   pendente   (a segunda mensagem nao chegou a sair) -> nao_enviada
-- Roda pela rotina de cada minuto do pg_cron (rotina_notificacoes) e tambem
-- quando o backend le a fila; nao depende do backend estar acordado.
-- Pula a solicitacao travada por uma resposta sendo gravada agora (essa
-- resposta reconfere o prazo sob a trava); a proxima rodada pega.
CREATE OR REPLACE FUNCTION public.whatsapp_expirar_solicitacoes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  v_total integer;
BEGIN
  WITH vencidas AS (
    SELECT q.id
      FROM public.solicitacoes_cancelamento q
     WHERE q.estado IN ('pendente', 'aguardando') AND q.expira_em <= now()
     FOR UPDATE SKIP LOCKED
  )
  UPDATE public.solicitacoes_cancelamento s
     SET estado = CASE WHEN s.estado = 'aguardando' THEN 'expirada' ELSE 'nao_enviada' END,
         motivo = 'prazo', atualizada_em = now()
    FROM vencidas v
   WHERE s.id = v.id;
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

-- A segunda mensagem nao chegou ao cliente: um aviso unico (chave por
-- solicitacao) dizendo que o pedido foi recebido, que nada foi cancelado, que
-- o horario continua reservado e que, para cancelar, ele deve usar o app, o
-- site ou falar com a barbearia. Chamada so por concluir_envio_whatsapp e
-- whatsapp_registrar_status, nunca para resultado incerto. Sem aviso se a
-- solicitacao nao estiver 'nao_enviada' ou se o agendamento mudou ou ja
-- comecou. O envio reconfere tudo (whatsapp_motivo_para_nao_enviar).
-- `p_falha`: categoria e codigo do erro (ex.: janela_fechada:131047). Com a
-- janela fechada, so um template aprovado chega ao cliente; sem ele, o
-- backend registra o aviso como nao enviado sem chamar a Meta.
CREATE OR REPLACE FUNCTION public.whatsapp_avisar_cancelamento_nao_concluido(p_solicitacao uuid, p_falha text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
  s public.solicitacoes_cancelamento%ROWTYPE;
  a record;
  v_id uuid;
BEGIN
  SELECT * INTO s FROM public.solicitacoes_cancelamento q WHERE q.id = p_solicitacao;
  IF NOT FOUND OR s.estado <> 'nao_enviada' THEN
    RETURN NULL;
  END IF;
  SELECT ag.status::text AS status, ag.data_hora, ag.barbeiro_id, ag.servico_id
    INTO a
    FROM public.agendamentos ag
   WHERE ag.id = s.agendamento_id;
  IF NOT FOUND OR a.status <> 'confirmado' OR a.data_hora IS DISTINCT FROM s.data_hora OR a.data_hora <= now() THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, ator_id, agendamento_id, dados, expira_em)
  SELECT 'cancelamento_nao_concluido', 'whatsapp', 'whatsapp:cancelamento_nao_concluido:' || s.id::text,
         s.cliente_id, NULL, s.agendamento_id,
         jsonb_build_object(
           'agendamento_id', s.agendamento_id, 'solicitacao_id', s.id, 'data_hora', s.data_hora,
           'servico', sv.nome, 'cliente_nome', public.primeiro_nome(pr.nome, 'Cliente'),
           'barbeiro_nome', public.primeiro_nome(b.nome, 'Barbeiro'),
           'falha', left(coalesce(p_falha, ''), 80)),
         s.data_hora
    FROM public.barbeiros b
    JOIN public.servicos sv ON sv.id = a.servico_id
    LEFT JOIN public.profiles pr ON pr.user_id = s.cliente_id
   WHERE b.id = a.barbeiro_id
  ON CONFLICT (chave) DO NOTHING
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

-- Reserva (copia da 25 com as solicitacoes de cancelamento)
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
  -- Solicitacao de cancelamento: segunda mensagem que nao saiu, ou prazo vencido
  UPDATE public.solicitacoes_cancelamento s
     SET estado = 'nao_enviada', motivo = coalesce(x.motivo, x.status), atualizada_em = now()
    FROM public.notificacoes x
   WHERE x.id = s.notificacao_id AND s.estado = 'pendente'
     AND x.status IN ('falhou', 'expirada', 'ignorada');
  PERFORM public.whatsapp_expirar_solicitacoes();

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
      UPDATE public.solicitacoes_cancelamento
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

-- Resultado de um envio (copia da 25 com as solicitacoes de cancelamento):
-- aceita, a segunda mensagem deixa a solicitacao 'aguardando'; recusada de
-- vez (nunca incerta), gera o aviso de cancelamento nao concluido.
-- Devolve novo_aviso = true quando esse aviso entrou na fila.
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
  v_solicitacao uuid;
  v_aviso uuid;
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
    UPDATE public.solicitacoes_cancelamento
       SET estado = 'aguardando', motivo = NULL, enviada_em = now(), atualizada_em = now()
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
  -- Segunda mensagem: trava o agendamento ANTES da solicitacao (a ordem do
  -- toque e do cancelamento pelo app). O aviso abaixo referencia o
  -- agendamento; sem esta trava, o INSERT esperava o agendamento ja segurando
  -- a solicitacao e fechava um impasse (visto no PostgreSQL real em 17/11).
  IF n.tipo = 'confirmacao_cancelamento' THEN
    PERFORM 1 FROM public.agendamentos ag WHERE ag.id = n.agendamento_id FOR UPDATE;
  END IF;
  UPDATE public.solicitacoes_cancelamento
     SET estado = 'nao_enviada', motivo = v_motivo, atualizada_em = now()
   WHERE notificacao_id = n.id AND estado = 'pendente'
  RETURNING id INTO v_solicitacao;
  -- Recusa definitiva (ou tentativas esgotadas) da segunda mensagem: o
  -- cliente tocou em NAO e nao recebeu nada. Incerto nunca: pode ter chegado.
  IF v_solicitacao IS NOT NULL AND v_status <> 'incerto' THEN
    v_aviso := public.whatsapp_avisar_cancelamento_nao_concluido(v_solicitacao, v_erro);
  END IF;
  RETURN jsonb_build_object('status', v_novo, 'motivo', v_motivo)
         || CASE WHEN v_aviso IS NOT NULL THEN jsonb_build_object('novo_aviso', true) ELSE '{}'::jsonb END;
END;
$$;

-- Estado de entrega informado pela Meta (copia da 25): falha da segunda
-- mensagem deixa a solicitacao 'nao_enviada' (o cliente nao a recebeu) e
-- gera o aviso de cancelamento nao concluido
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
  v_solicitacao uuid;
  v_tipo text;
  v_agendamento uuid;
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
    -- Segunda mensagem: agendamento antes da solicitacao (ver
    -- concluir_envio_whatsapp)
    SELECT x.tipo, x.agendamento_id INTO v_tipo, v_agendamento
      FROM public.notificacoes x WHERE x.id = m.notificacao_id;
    IF v_tipo = 'confirmacao_cancelamento' THEN
      PERFORM 1 FROM public.agendamentos ag WHERE ag.id = v_agendamento FOR UPDATE;
    END IF;
    UPDATE public.solicitacoes_cancelamento
       SET estado = 'nao_enviada', motivo = v_motivo, atualizada_em = now()
     WHERE notificacao_id = m.notificacao_id AND estado = 'aguardando'
    RETURNING id INTO v_solicitacao;
    IF v_solicitacao IS NOT NULL THEN
      PERFORM public.whatsapp_avisar_cancelamento_nao_concluido(v_solicitacao, p_erro);
    END IF;
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

-- ---------------------------------------------------------------
-- 5. Resposta recebida pelo webhook. Devolve { resultado, ... }:
--   confirmada                SIM na primeira mensagem
--   cancelamento_solicitado   NAO na primeira: abriu a solicitacao (nada cancelado)
--   cancelamento_confirmado   SIM, CANCELAR: agendamento cancelado agora
--   cancelamento_desistido    NAO, MANTER: agendamento mantido
--   cancelamento_expirado     botao da segunda mensagem depois do prazo
--   solicitacao_encerrada     botao de uma solicitacao ja encerrada (estado)
--   usar_botao                texto com uma solicitacao aguardando: nada muda
--   ja_respondida             a primeira mensagem ja tinha resposta (estado e,
--                             se houver, a situacao do cancelamento)
--   agendamento_invalido      cancelado, concluido, com outro horario ou ja passou
--   ambigua                   texto "sim"/"nao" com mais de um pedido aberto
--   sem_pedido                nenhum pedido aberto para esse numero
--   invalida                  botao que nao confere com o numero ou a mensagem
--                             (etapa = 'cancelamento' nos botoes da segunda)
--   descadastro               PARAR, SAIR ou STOP: autorizacao revogada
--   nao_reconhecida           outro texto
--   duplicada                 a mesma mensagem ja foi processada
-- Botao: exige o identificador (payload), a mensagem respondida (contexto) e
-- o numero do destinatario. Travas: agendamento, pedido de presenca,
-- solicitacao (a mesma ordem do cancelamento pelo app).
-- ---------------------------------------------------------------
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
  v_acao text;
  v_id uuid;
  v_total integer;
  v_agendamento uuid;
  v_confirmacao uuid;
  v_situacao text;
  v_solicitacao uuid;
  v_notificacao uuid;
  v_barbeiro uuid;
  v_confere boolean;
  v_registrando boolean;
  c public.confirmacoes_presenca%ROWTYPE;
  s public.solicitacoes_cancelamento%ROWTYPE;
  a record;
  v_dados jsonb;
BEGIN
  IF p_evento IS NULL OR btrim(p_evento) = '' OR v_chave IS NULL OR p_tipo IS NULL OR p_tipo NOT IN ('botao', 'texto') THEN
    RETURN jsonb_build_object('resultado', 'invalida');
  END IF;
  -- Idempotencia: a mesma mensagem da Meta so e processada uma vez. Se algo
  -- abaixo falhar, a transacao inteira e desfeita (inclusive esta linha) e a
  -- Meta entrega de novo.
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

    -- Texto nunca confirma nem desiste de um cancelamento: com uma solicitacao
    -- aguardando para esse numero (e sem citar outra mensagem), so orienta
    IF EXISTS (
      SELECT 1 FROM public.solicitacoes_cancelamento q
       WHERE q.estado = 'aguardando' AND q.expira_em > now()
         AND (EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                       WHERE m.notificacao_id = q.notificacao_id
                         AND public.whatsapp_chave_numero(m.wa_id) = v_chave)
              OR EXISTS (SELECT 1 FROM public.profiles p
                          WHERE p.user_id = q.cliente_id
                            AND public.whatsapp_chave_numero(public.whatsapp_telefone(p.telefone)) = v_chave))
         AND (p_contexto IS NULL
              OR EXISTS (SELECT 1 FROM public.whatsapp_mensagens m
                          WHERE m.notificacao_id = q.notificacao_id AND m.wamid = p_contexto))) THEN
      RETURN jsonb_build_object('resultado', 'usar_botao');
    END IF;
    v_acao := v_texto;

    -- Pedidos de presenca abertos desse numero (como na 25); com contexto, so
    -- o da mensagem respondida
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
       OR p_payload !~ '^VB_(SIM|NAO|CANCELAR|MANTER):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      RETURN jsonb_build_object('resultado', 'invalida');
    END IF;
    v_acao := lower(substr(split_part(p_payload, ':', 1), 4));
    v_id := split_part(p_payload, ':', 2)::uuid;

    IF v_acao IN ('sim', 'nao') THEN
      -- Botao da primeira mensagem: da mensagem respondida e do numero que a recebeu
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
    ELSE
      -- Botao da segunda mensagem: da mensagem dessa solicitacao e do numero
      -- que a recebeu. As duas conferencias vem do MESMO comando (a mesma
      -- foto do banco): o registro do envio, gravado ao mesmo tempo por outra
      -- conexao, aparece nas duas ou em nenhuma.
      SELECT coalesce(bool_or(m.wamid = p_contexto
                              AND (public.whatsapp_chave_numero(m.wa_id) = v_chave
                                   OR EXISTS (SELECT 1 FROM public.profiles p
                                               WHERE p.user_id = q.cliente_id
                                                 AND public.whatsapp_chave_numero(public.whatsapp_telefone(p.telefone)) = v_chave))),
                      false),
             coalesce(bool_or(q.estado = 'pendente' AND m.estado = 'iniciado'), false)
        INTO v_confere, v_registrando
        FROM public.solicitacoes_cancelamento q
        JOIN public.whatsapp_mensagens m ON m.notificacao_id = q.notificacao_id
       WHERE q.id = v_id;
      IF NOT v_confere THEN
        -- O toque chegou antes de o backend gravar o envio da segunda
        -- mensagem: erro temporario (tudo desfeito; a Meta entrega de novo)
        IF v_registrando THEN
          RAISE EXCEPTION USING ERRCODE = 'PT503', DETAIL = 'ENVIO_SEM_REGISTRO',
            MESSAGE = 'O envio da confirmação de cancelamento ainda não foi registrado.';
        END IF;
        RETURN jsonb_build_object('resultado', 'invalida', 'etapa', 'cancelamento');
      END IF;
    END IF;
  END IF;

  -- Travas: agendamento, depois o pedido de presenca, depois a solicitacao
  IF v_acao IN ('sim', 'nao') THEN
    v_confirmacao := v_id;
  ELSE
    SELECT q.confirmacao_id INTO v_confirmacao FROM public.solicitacoes_cancelamento q WHERE q.id = v_id;
  END IF;
  SELECT q.agendamento_id INTO v_agendamento FROM public.confirmacoes_presenca q WHERE q.id = v_confirmacao;
  SELECT ag.id, ag.status::text AS status, ag.data_hora, ag.barbeiro_id, ag.servico_id, ag.cliente_id
    INTO a
    FROM public.agendamentos ag
   WHERE ag.id = v_agendamento
     FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('resultado', 'agendamento_invalido');
  END IF;
  SELECT * INTO c FROM public.confirmacoes_presenca q WHERE q.id = v_confirmacao FOR UPDATE;

  -- ---- Primeira mensagem: SIM ou NAO ----
  IF v_acao IN ('sim', 'nao') THEN
    v_dados := jsonb_build_object('agendamento_id', a.id, 'data_hora', c.data_hora);
    IF c.estado IN ('confirmada', 'recusada') THEN
      SELECT CASE WHEN q.estado IN ('pendente', 'aguardando') AND q.expira_em <= now() THEN 'expirada' ELSE q.estado END
        INTO v_situacao
        FROM public.solicitacoes_cancelamento q WHERE q.confirmacao_id = c.id;
      RETURN v_dados || jsonb_build_object('resultado', 'ja_respondida', 'estado', c.estado, 'cancelamento', v_situacao);
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

    IF v_acao = 'sim' THEN
      UPDATE public.confirmacoes_presenca
         SET estado = 'confirmada', respondida_em = now(), resposta_origem = p_tipo, atualizada_em = now()
       WHERE id = c.id;
      RETURN v_dados || jsonb_build_object('resultado', 'confirmada');
    END IF;

    -- NAO: registra a resposta e abre a solicitacao. NADA e cancelado aqui e
    -- o horario continua reservado.
    UPDATE public.confirmacoes_presenca
       SET estado = 'recusada', respondida_em = now(), resposta_origem = p_tipo, atualizada_em = now()
     WHERE id = c.id;
    INSERT INTO public.solicitacoes_cancelamento
      (confirmacao_id, agendamento_id, data_hora, cliente_id, origem_pedido, expira_em, evento_pedido)
    VALUES (c.id, a.id, a.data_hora, a.cliente_id, p_tipo, a.data_hora, left(p_evento, 200))
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_solicitacao;
    IF v_solicitacao IS NULL THEN
      -- Ja havia uma solicitacao aberta para o agendamento: nao abre outra
      RETURN v_dados || jsonb_build_object('resultado', 'ja_respondida', 'estado', 'recusada');
    END IF;

    INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, ator_id, agendamento_id, dados, expira_em)
    SELECT 'confirmacao_cancelamento', 'whatsapp', 'whatsapp:confirmacao_cancelamento:' || v_solicitacao::text,
           a.cliente_id, a.cliente_id, a.id,
           jsonb_build_object(
             'agendamento_id', a.id, 'solicitacao_id', v_solicitacao, 'data_hora', a.data_hora,
             'servico', sv.nome, 'cliente_nome', public.primeiro_nome(pr.nome, 'Cliente'),
             'barbeiro_nome', public.primeiro_nome(b.nome, 'Barbeiro')),
           a.data_hora
      FROM public.barbeiros b
      JOIN public.servicos sv ON sv.id = a.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = a.cliente_id
     WHERE b.id = a.barbeiro_id
    ON CONFLICT (chave) DO NOTHING
    RETURNING id INTO v_notificacao;

    IF v_notificacao IS NULL THEN
      UPDATE public.solicitacoes_cancelamento
         SET estado = 'nao_enviada', motivo = 'aviso_nao_criado', atualizada_em = now()
       WHERE id = v_solicitacao;
    ELSE
      UPDATE public.solicitacoes_cancelamento
         SET notificacao_id = v_notificacao, atualizada_em = now()
       WHERE id = v_solicitacao;
    END IF;
    RETURN v_dados || jsonb_build_object('resultado', 'cancelamento_solicitado', 'solicitacao_id', v_solicitacao);
  END IF;

  -- ---- Segunda mensagem: SIM, CANCELAR ou NAO, MANTER ----
  SELECT * INTO s FROM public.solicitacoes_cancelamento q WHERE q.id = v_id FOR UPDATE;
  v_dados := jsonb_build_object('agendamento_id', a.id, 'data_hora', s.data_hora);

  IF s.estado = 'aguardando' AND s.expira_em <= now() THEN
    UPDATE public.solicitacoes_cancelamento
       SET estado = 'expirada', motivo = 'prazo', atualizada_em = now()
     WHERE id = s.id;
    RETURN v_dados || jsonb_build_object('resultado', 'cancelamento_expirado');
  END IF;
  IF s.estado <> 'aguardando' THEN
    RETURN v_dados || jsonb_build_object('resultado', 'solicitacao_encerrada', 'estado', s.estado);
  END IF;
  -- O agendamento mudou desde o pedido (cancelado, concluido, outro horario)
  -- ou o horario ja passou: nada e cancelado
  IF a.status <> 'confirmado' OR a.data_hora IS DISTINCT FROM s.data_hora OR a.data_hora <= now() THEN
    UPDATE public.solicitacoes_cancelamento
       SET estado = 'invalidada',
           motivo = CASE WHEN a.status <> 'confirmado' THEN 'agendamento_' || a.status
                         WHEN a.data_hora IS DISTINCT FROM s.data_hora THEN 'horario_alterado'
                         ELSE 'horario_passou' END,
           atualizada_em = now()
     WHERE id = s.id;
    RETURN v_dados || jsonb_build_object('resultado', 'agendamento_invalido');
  END IF;

  IF v_acao = 'manter' THEN
    UPDATE public.solicitacoes_cancelamento
       SET estado = 'desistiu', respondida_em = now(), evento_resposta = left(p_evento, 200), atualizada_em = now()
     WHERE id = s.id;
    RETURN v_dados || jsonb_build_object('resultado', 'cancelamento_desistido');
  END IF;

  -- SIM, CANCELAR: primeiro a solicitacao (o gatilho de invalidacao, disparado
  -- pelo cancelamento abaixo, so mexe em solicitacoes abertas), depois o
  -- agendamento: so este, so se ainda estiver confirmado no mesmo horario
  UPDATE public.solicitacoes_cancelamento
     SET estado = 'confirmada', respondida_em = now(), evento_resposta = left(p_evento, 200),
         cancelamento_origem = 'whatsapp_resposta_negativa', cancelado_em = now(), atualizada_em = now()
   WHERE id = s.id;
  UPDATE public.agendamentos
     SET status = 'cancelado'
   WHERE id = a.id AND status = 'confirmado' AND data_hora = s.data_hora;
  GET DIAGNOSTICS v_total = ROW_COUNT;
  IF v_total <> 1 THEN
    -- Nao deveria acontecer (o agendamento esta travado): desfaz tudo
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'CANCELAMENTO_NAO_APLICADO',
      MESSAGE = 'O agendamento não pôde ser cancelado pela confirmação do WhatsApp.';
  END IF;

  -- Aviso ao barbeiro pelo WhatsApp (se ele autorizou e tem celular). Depois
  -- do cancelamento: o gatilho de invalidacao nao descarta este tipo.
  SELECT b.user_id INTO v_barbeiro FROM public.barbeiros b WHERE b.id = a.barbeiro_id;
  IF v_barbeiro IS NOT NULL AND public.whatsapp_consentiu(v_barbeiro)
     AND EXISTS (SELECT 1 FROM public.profiles p
                  WHERE p.user_id = v_barbeiro AND public.whatsapp_telefone(p.telefone) IS NOT NULL) THEN
    INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, ator_id, agendamento_id, dados, expira_em)
    SELECT 'cancelamento_whatsapp', 'whatsapp', 'whatsapp:cancelamento_whatsapp:' || s.id::text,
           v_barbeiro, a.cliente_id, a.id,
           jsonb_build_object(
             'agendamento_id', a.id, 'solicitacao_id', s.id, 'data_hora', a.data_hora, 'servico', sv.nome,
             'cliente_nome', public.primeiro_nome(pr.nome, 'Cliente'),
             'barbeiro_nome', public.primeiro_nome(b.nome, 'Barbeiro')),
           a.data_hora
      FROM public.barbeiros b
      JOIN public.servicos sv ON sv.id = a.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = a.cliente_id
     WHERE b.id = a.barbeiro_id
    ON CONFLICT (chave) DO NOTHING;
  END IF;

  RETURN v_dados || jsonb_build_object('resultado', 'cancelamento_confirmado');
END;
$$;

-- ---------------------------------------------------------------
-- 6. Cancelamento por outro caminho, conclusao ou mudanca de horario: o
--    pedido de presenca e a solicitacao abertos deixam de valer. Erro aqui so
--    e registrado: nunca impede cancelar, concluir ou alterar o agendamento.
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
  ELSIF NEW.status IS DISTINCT FROM OLD.status AND NEW.status <> 'confirmado' THEN
    v_motivo := 'agendamento_' || NEW.status::text;
  ELSE
    RETURN NULL;
  END IF;
  BEGIN
    UPDATE public.confirmacoes_presenca
       SET estado = 'invalidada', motivo = v_motivo, atualizada_em = now()
     WHERE agendamento_id = NEW.id AND estado IN ('pendente', 'enviada');
    -- Solicitacao com o prazo ja vencido (ex.: concluido depois do horario)
    -- fecha como expirou: expirada (ou nao_enviada, se a segunda mensagem
    -- nao saiu), motivo 'prazo'. No prazo, deixa de valer: invalidada.
    UPDATE public.solicitacoes_cancelamento
       SET estado = CASE WHEN expira_em > now() THEN 'invalidada'
                         WHEN estado = 'aguardando' THEN 'expirada'
                         ELSE 'nao_enviada' END,
           motivo = CASE WHEN expira_em > now() THEN v_motivo ELSE 'prazo' END,
           atualizada_em = now()
     WHERE agendamento_id = NEW.id AND estado IN ('pendente', 'aguardando');
    UPDATE public.notificacoes
       SET status = 'ignorada', motivo = v_motivo, atualizada_em = now()
     WHERE agendamento_id = NEW.id AND canal = 'whatsapp' AND status = 'pendente'
       AND tipo IN ('confirmacao_presenca', 'confirmacao_cancelamento', 'cancelamento_nao_concluido');
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
-- 7. Telas (agenda do barbeiro, historico do cliente, painel do admin):
--    situacao do WhatsApp de cada agendamento, so dos que quem chama pode ver.
--    Mesmas colunas e permissoes da 25.
--      confirmada | sem_resposta | pendente | nao_enviada | recusada
--      cancelamento_pendente        pediu para cancelar; falta confirmar
--      cancelamento_desistido       pediu e desistiu: agendamento mantido
--      cancelamento_nao_confirmado  pediu e nao confirmou: agendamento mantido
--      cancelada_whatsapp           cancelado pelo cliente pelo WhatsApp
--    respondida_em: a hora da ultima resposta (no cancelado, a do cancelamento)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.presenca_dos_agendamentos(p_ids uuid[])
RETURNS TABLE (agendamento_id uuid, situacao text, respondida_em timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
  SELECT ag.id,
         CASE
           WHEN s.estado = 'confirmada' THEN
             CASE WHEN ag.status = 'cancelado' THEN 'cancelada_whatsapp' ELSE 'recusada' END
           WHEN s.estado IN ('pendente', 'aguardando') AND s.expira_em > now() AND ag.status = 'confirmado'
             THEN 'cancelamento_pendente'
           WHEN s.estado = 'desistiu' THEN 'cancelamento_desistido'
           WHEN s.estado IN ('pendente', 'aguardando', 'expirada', 'nao_enviada') THEN 'cancelamento_nao_confirmado'
           WHEN c.estado = 'enviada' THEN 'sem_resposta'
           ELSE c.estado
         END,
         coalesce(s.cancelado_em, s.respondida_em, c.respondida_em)
    FROM public.agendamentos ag
    JOIN public.barbeiros b ON b.id = ag.barbeiro_id
    JOIN public.confirmacoes_presenca c ON c.agendamento_id = ag.id AND c.data_hora = ag.data_hora
    LEFT JOIN public.solicitacoes_cancelamento s ON s.confirmacao_id = c.id
   WHERE ag.id = ANY (p_ids)
     AND c.estado <> 'invalidada'
     AND auth.uid() IS NOT NULL
     AND (ag.cliente_id = auth.uid() OR b.user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'))
$$;

-- ---------------------------------------------------------------
-- 8. Rotina de cada minuto (pg_cron, job notificacoes-rotina da migration
--    22): a mesma da 27 (a da 25 em que so o canal whatsapp acorda o
--    backend), mais a expiracao das solicitacoes de cancelamento.
--    Depois de expirar_notificacoes (a mesma ordem de travas da fila:
--    avisos, depois solicitacoes). Erro na expiracao so e registrado: nunca
--    para o resto da rotina; a proxima rodada tenta de novo.
-- ---------------------------------------------------------------
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

-- ---------------------------------------------------------------
-- 9. Permissoes
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.solicitacao_cancelamento_transicao() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_versao_aviso() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_consentiu(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_motivo_para_nao_enviar(public.notificacoes) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_expirar_solicitacoes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.whatsapp_avisar_cancelamento_nao_concluido(uuid, text) FROM PUBLIC, anon, authenticated;
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
