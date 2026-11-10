-- =====================================================================
-- Notificacoes push (2/2): eventos
--
-- Rode depois da 20261109000021_notificacoes.sql (usa as tabelas e funcoes
-- dela). Pode ser executada de novo.
--
-- Quando um agendamento e criado ou cancelado, ou uma mensagem e enviada (pelo
-- app ou pelo site), um trigger grava o aviso na fila public.notificacoes na
-- MESMA transacao:
--   * se a operacao for desfeita, o aviso some junto;
--   * o mesmo evento nunca gera dois avisos (chave unica);
--   * erro ao gravar o aviso e so registrado (WARNING): nunca impede o
--     agendamento, o cancelamento ou a mensagem.
-- Os triggers rodam DEPOIS das regras atuais e nao recusam nada:
-- disponibilidade, conflitos, limite diario, financeiro e chat continuam iguais.
--
-- Quem recebe:
--   * novo agendamento: o barbeiro (se nao foi ele mesmo quem agendou);
--   * cancelamento: o outro lado (cliente <-> barbeiro); cancelado por outra
--     pessoa (ex.: admin), os dois. Depois do horario e falta (mesma regra do
--     botao "Cliente faltou"): ninguem e avisado;
--   * mensagem: o outro participante da conversa, nunca o remetente. O aviso
--     nao leva o texto da mensagem;
--   * lembrete: X minutos antes (30 por padrao), para quem tiver o lembrete
--     ligado (padrao: clientes sim, barbeiros nao). Nao vale para agendamento
--     cancelado nem para quem agendou ja dentro da janela do lembrete.
--
-- O envio e do backend. Para acorda-lo (no Render gratuito ele dorme), o banco
-- chama POST <url_backend>/api/notificacoes/processar pelo pg_net depois de
-- cada aviso; um job do pg_cron, a cada minuto, gera os lembretes e chama de
-- novo se algo ficou pendente. Sem pg_net/pg_cron tudo continua funcionando,
-- mas o backend so envia (e gera lembretes) enquanto estiver acordado.
--
-- Depois de rodar, informe a URL publica do backend (nao e segredo):
--   UPDATE public.notificacao_config SET url_backend = 'https://SEU-BACKEND';
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------
-- 0. A 21 precisa ter rodado antes; se nao, para aqui sem criar nada
-- ---------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('public.notificacoes') IS NULL
     OR to_regclass('public.dispositivos_push') IS NULL
     OR to_regprocedure('public.expirar_notificacoes()') IS NULL THEN
    RAISE EXCEPTION 'Rode antes a 20261109000021_notificacoes.sql. Nada foi criado.';
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Configuracao: endereco do backend para acorda-lo
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notificacao_config (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  url_backend   text CHECK (url_backend IS NULL OR url_backend ~ '^https?://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$'),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.notificacao_config (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.notificacao_config ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notificacao_config FROM anon, authenticated;

-- ---------------------------------------------------------------
-- 2. Auxiliares
-- ---------------------------------------------------------------

-- So o primeiro nome vai para o aviso
CREATE OR REPLACE FUNCTION public.primeiro_nome(p_nome text, p_padrao text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT coalesce(nullif(left(split_part(btrim(coalesce(p_nome, '')), ' ', 1), 40), ''), p_padrao)
$$;

-- Grava um aviso na fila; devolve false se ele ja existia (mesma chave)
CREATE OR REPLACE FUNCTION public.inserir_notificacao(
  p_tipo text,
  p_chave text,
  p_destinatario uuid,
  p_ator uuid,
  p_dados jsonb,
  p_expira_em timestamptz,
  p_agendamento_id uuid DEFAULT NULL,
  p_conversa_id uuid DEFAULT NULL,
  p_mensagem_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_destinatario IS NULL OR p_expira_em <= now() THEN
    RETURN false;
  END IF;
  INSERT INTO public.notificacoes
    (tipo, chave, destinatario_id, ator_id, agendamento_id, conversa_id, mensagem_id, dados, expira_em)
  VALUES
    (p_tipo, p_chave, p_destinatario, p_ator, p_agendamento_id, p_conversa_id, p_mensagem_id,
     coalesce(p_dados, '{}'::jsonb), p_expira_em)
  ON CONFLICT (chave) DO NOTHING;
  RETURN FOUND;
END;
$$;

-- Avisos de um agendamento ('novo_agendamento' ou 'cancelamento'). Quem fez
-- (p_ator) nunca e avisado do que fez. Devolve quantos avisos gravou.
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

-- ---------------------------------------------------------------
-- 3. Novo agendamento
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notificar_novo_agendamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    PERFORM public.avisar_agendamento('novo_agendamento', NEW.id, auth.uid());
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notificacoes: aviso de novo agendamento % nao registrado: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notificar_novo_agendamento ON public.agendamentos;
CREATE TRIGGER notificar_novo_agendamento
  AFTER INSERT ON public.agendamentos
  FOR EACH ROW WHEN (NEW.status = 'confirmado')
  EXECUTE FUNCTION public.notificar_novo_agendamento();

-- ---------------------------------------------------------------
-- 4. Cancelamento (confirmado -> cancelado antes do horario)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notificar_cancelamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  BEGIN
    -- Depois do horario e falta (como o botao "Cliente faltou"): sem aviso
    IF NEW.data_hora > now() THEN
      PERFORM public.avisar_agendamento('cancelamento', NEW.id, auth.uid());
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notificacoes: aviso de cancelamento % nao registrado: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notificar_cancelamento ON public.agendamentos;
CREATE TRIGGER notificar_cancelamento
  AFTER UPDATE OF status ON public.agendamentos
  FOR EACH ROW WHEN (OLD.status = 'confirmado' AND NEW.status = 'cancelado')
  EXECUTE FUNCTION public.notificar_cancelamento();

-- ---------------------------------------------------------------
-- 5. Nova mensagem no chat
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.notificar_mensagem()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_dest uuid;
  v_papel text;
  v_nome text;
BEGIN
  BEGIN
    -- Ja lida, ou gravada por outra pessoa em nome do remetente: sem aviso
    IF NEW.lida OR (auth.uid() IS NOT NULL AND auth.uid() <> NEW.remetente_id) THEN
      RETURN NULL;
    END IF;

    SELECT cv.id, cv.cliente_id, cv.barbeiro_id, b.user_id AS barbeiro_user,
           public.primeiro_nome(b.nome, 'Barbeiro') AS barbeiro_nome,
           public.primeiro_nome(pr.nome, 'Cliente') AS cliente_nome
      INTO c
      FROM public.conversas cv
      LEFT JOIN public.barbeiros b ON b.id = cv.barbeiro_id
      LEFT JOIN public.profiles pr ON pr.user_id = cv.cliente_id
     WHERE cv.id = NEW.conversa_id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;

    IF NEW.remetente_id = c.cliente_id THEN
      v_dest := c.barbeiro_user; v_papel := 'barbeiro'; v_nome := c.cliente_nome;
    ELSIF NEW.remetente_id = c.barbeiro_user THEN
      v_dest := c.cliente_id; v_papel := 'cliente'; v_nome := c.barbeiro_nome;
    ELSE
      RETURN NULL;
    END IF;
    -- O remetente nunca recebe o aviso da propria mensagem
    IF v_dest IS NULL OR v_dest = NEW.remetente_id THEN
      RETURN NULL;
    END IF;

    PERFORM public.inserir_notificacao(
      'mensagem',
      format('mensagem:%s:%s', NEW.id, v_dest),
      v_dest,
      NEW.remetente_id,
      jsonb_build_object(
        'conversa_id', c.id, 'mensagem_id', NEW.id, 'barbeiro_id', c.barbeiro_id,
        'cliente_id', c.cliente_id, 'outro_nome', v_nome, 'papel', v_papel),
      now() + interval '24 hours',
      NULL,
      c.id,
      NEW.id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'notificacoes: aviso da mensagem % nao registrado: %', NEW.id, SQLERRM;
  END;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS notificar_mensagem ON public.mensagens;
CREATE TRIGGER notificar_mensagem
  AFTER INSERT ON public.mensagens
  FOR EACH ROW
  EXECUTE FUNCTION public.notificar_mensagem();

-- ---------------------------------------------------------------
-- 6. Lembretes (o job do pg_cron chama a cada minuto)
--    Um por agendamento, destinatario e horario: rodar de novo nao duplica;
--    se o horario mudar, o antigo e descartado no envio e sai um novo.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enfileirar_lembretes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_total integer := 0;
BEGIN
  FOR r IN
    SELECT ag.id, ag.data_hora, d.uid, d.papel, coalesce(p.lembrete_minutos, 30) AS minutos, s.nome AS servico,
           public.primeiro_nome(b.nome, 'Barbeiro') AS barbeiro_nome,
           public.primeiro_nome(pr.nome, 'Cliente') AS cliente_nome
      FROM public.agendamentos ag
      JOIN public.barbeiros b ON b.id = ag.barbeiro_id
      JOIN public.servicos s ON s.id = ag.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = ag.cliente_id
      CROSS JOIN LATERAL (VALUES (ag.cliente_id, 'cliente'), (b.user_id, 'barbeiro')) AS d(uid, papel)
      LEFT JOIN public.notificacao_preferencias p ON p.user_id = d.uid
     WHERE ag.status = 'confirmado'
       AND d.uid IS NOT NULL
       -- Faltando 5 minutos ou menos, o lembrete ja nao ajuda
       AND ag.data_hora > now() + interval '5 minutes'
       AND ag.data_hora <= now() + interval '60 minutes'
       AND ag.data_hora <= now() + make_interval(mins => coalesce(p.lembrete_minutos, 30))
       -- Quem agendou ja dentro da janela do lembrete nao precisa dele
       AND ag.created_at <= ag.data_hora - make_interval(mins => coalesce(p.lembrete_minutos, 30))
       AND coalesce(p.lembretes, NOT public.has_role(d.uid, 'barbeiro'))
  LOOP
    IF public.inserir_notificacao(
         'lembrete',
         format('lembrete:%s:%s:%s', r.id, r.uid, extract(epoch FROM r.data_hora)::bigint),
         r.uid,
         NULL,
         jsonb_build_object(
           'agendamento_id', r.id, 'data_hora', r.data_hora, 'servico', r.servico,
           'cliente_nome', r.cliente_nome, 'barbeiro_nome', r.barbeiro_nome,
           'papel', r.papel, 'minutos', r.minutos),
         r.data_hora,
         r.id) THEN
      v_total := v_total + 1;
    END IF;
  END LOOP;
  RETURN v_total;
END;
$$;

-- ---------------------------------------------------------------
-- 7. Acordar o backend (pg_net). Sem URL ou sem pg_net, nao faz nada.
--    A chamada so sai depois do commit: operacao desfeita nao chama ninguem.
--    O endpoint nao recebe nem devolve dados: so faz o backend ler a fila.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.despertar_backend()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
BEGIN
  SELECT url_backend INTO v_url FROM public.notificacao_config WHERE id;
  IF v_url IS NULL OR NOT EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = 'http_post' AND pronamespace = to_regnamespace('net')
  ) THEN
    RETURN false;
  END IF;
  EXECUTE 'SELECT net.http_post(url := $1, body := ''{}''::jsonb, timeout_milliseconds := 5000)'
    USING rtrim(v_url, '/') || '/api/notificacoes/processar';
  RETURN true;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'notificacoes: nao foi possivel chamar o backend: %', SQLERRM;
  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.despertar_backend_apos_aviso()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.despertar_backend();
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS despertar_backend ON public.notificacoes;
CREATE TRIGGER despertar_backend
  AFTER INSERT ON public.notificacoes
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.despertar_backend_apos_aviso();

-- ---------------------------------------------------------------
-- 8. Rotina de cada minuto (pg_cron; o backend tambem chama enquanto esta
--    acordado): gera lembretes, expira o que venceu e, se houver aviso
--    esperando, acorda o backend.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rotina_notificacoes()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lembretes integer;
  v_expiradas integer;
  v_pendentes boolean;
  v_despertou boolean := false;
BEGIN
  v_lembretes := public.enfileirar_lembretes();
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
    'lembretes', v_lembretes, 'expiradas', v_expiradas,
    'pendentes', v_pendentes, 'despertou', v_despertou);
END;
$$;

-- Historico: avisos finalizados e aparelhos desativados ha mais de p_dias
CREATE OR REPLACE FUNCTION public.limpar_notificacoes_antigas(p_dias integer DEFAULT 90)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limite timestamptz := now() - make_interval(days => greatest(coalesce(p_dias, 90), 7));
  v_avisos integer;
  v_aparelhos integer;
BEGIN
  DELETE FROM public.notificacoes
   WHERE criada_em < v_limite AND status NOT IN ('pendente', 'enviando');
  GET DIAGNOSTICS v_avisos = ROW_COUNT;
  DELETE FROM public.dispositivos_push
   WHERE NOT ativo AND desativado_em < v_limite;
  GET DIAGNOSTICS v_aparelhos = ROW_COUNT;
  RETURN jsonb_build_object('avisos', v_avisos, 'aparelhos', v_aparelhos);
END;
$$;

-- ---------------------------------------------------------------
-- 9. App: notificacao de teste para o proprio aparelho (no maximo uma por
--    minuto). Devolve se foi criada e quantos aparelhos ativos a pessoa tem.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.pedir_notificacao_teste()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_aparelhos integer;
  v_criada boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', DETAIL = 'NAO_AUTENTICADO',
      MESSAGE = 'Faça login para continuar.';
  END IF;
  SELECT count(*) INTO v_aparelhos FROM public.dispositivos_push WHERE user_id = v_uid AND ativo;
  v_criada := public.inserir_notificacao(
    'teste',
    format('teste:%s:%s', v_uid, to_char(date_trunc('minute', now()), 'YYYYMMDDHH24MI')),
    v_uid,
    v_uid,
    '{}'::jsonb,
    now() + interval '10 minutes');
  RETURN jsonb_build_object('criada', v_criada, 'aparelhos', v_aparelhos);
END;
$$;

-- ---------------------------------------------------------------
-- 10. Permissoes
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.primeiro_nome(text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.inserir_notificacao(text, text, uuid, uuid, jsonb, timestamptz, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.avisar_agendamento(text, uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notificar_novo_agendamento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notificar_cancelamento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.notificar_mensagem() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enfileirar_lembretes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.despertar_backend() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.despertar_backend_apos_aviso() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.rotina_notificacoes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.limpar_notificacoes_antigas(integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.pedir_notificacao_teste() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pedir_notificacao_teste() TO authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    -- O backend tambem roda a rotina enquanto esta acordado (sem pg_cron, e
    -- assim que os lembretes saem)
    GRANT EXECUTE ON FUNCTION public.rotina_notificacoes() TO service_role;
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 11. Extensoes (opcionais: sem elas o restante funciona)
-- ---------------------------------------------------------------
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_net indisponivel (%). Ative em Database > Extensions e rode este bloco de novo; sem ele o backend so envia quando estiver acordado.', SQLERRM;
END $$;

DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.unschedule(jobid) FROM cron.job
   WHERE jobname IN ('notificacoes-rotina', 'notificacoes-limpeza');
  PERFORM cron.schedule('notificacoes-rotina', '* * * * *', 'SELECT public.rotina_notificacoes();');
  -- 03:30 em Brasilia
  PERFORM cron.schedule('notificacoes-limpeza', '30 6 * * *', 'SELECT public.limpar_notificacoes_antigas();');
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel (%). Ative em Database > Extensions e rode este bloco de novo; sem ele os lembretes so saem com o backend acordado.', SQLERRM;
END $$;
