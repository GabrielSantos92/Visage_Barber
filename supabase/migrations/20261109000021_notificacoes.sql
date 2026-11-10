-- =====================================================================
-- Notificacoes push (1/2): estrutura
--
-- Rode depois da 20261109000020_meu_desempenho.sql e ANTES da
-- 20261109000022_notificacoes_eventos.sql. Pode ser executada de novo.
-- So cria o que e novo: nao altera tabela existente nem regra de agendamento,
-- disponibilidade, chat ou financeiro. Sozinha, nao gera nenhum aviso (quem
-- gera e a 22).
--
--   * dispositivos_push: aparelhos (token Expo) de cada usuario. Um usuario
--     pode ter varios; o mesmo aparelho passa para quem entrou por ultimo nele.
--   * notificacao_preferencias: o que cada usuario quer receber. Sem linha,
--     vale o padrao: tudo ligado, menos lembretes para barbeiros.
--   * notificacoes: fila e historico. Um aviso por evento e destinatario
--     (coluna chave, unica): o mesmo evento nunca gera dois avisos.
--   * notificacao_envios: resultado de cada aviso em cada aparelho.
--
-- Acesso: app e site nao leem nem gravam essas tabelas. O app registra e
-- remove so o proprio aparelho e le/salva so as proprias preferencias, pelas
-- funcoes abaixo (presas ao login). O backend, com a service role, reserva os
-- avisos, grava o resultado e desativa tokens invalidos. Ninguem le o token de
-- outra pessoa.
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------
-- 0. Confere o esquema que ja existe (parte dele foi criada fora das
--    migrations). Se algo estiver diferente do esperado, para aqui e nada
--    e criado.
-- ---------------------------------------------------------------
DO $$
DECLARE
  v_problemas text[] := ARRAY[]::text[];
  r record;
BEGIN
  FOR r IN
    SELECT e.tabela, e.coluna, e.tipo, c.data_type AS atual
      FROM (VALUES
        ('agendamentos', 'id', 'uuid'),
        ('agendamentos', 'cliente_id', 'uuid'),
        ('agendamentos', 'barbeiro_id', 'uuid'),
        ('agendamentos', 'servico_id', 'uuid'),
        ('agendamentos', 'data_hora', 'timestamp with time zone'),
        ('agendamentos', 'created_at', 'timestamp with time zone'),
        ('agendamentos', 'status', NULL),
        ('barbeiros', 'id', 'uuid'),
        ('barbeiros', 'user_id', 'uuid'),
        ('barbeiros', 'nome', NULL),
        ('servicos', 'id', 'uuid'),
        ('servicos', 'nome', NULL),
        ('profiles', 'user_id', 'uuid'),
        ('profiles', 'nome', NULL),
        ('conversas', 'id', 'uuid'),
        ('conversas', 'cliente_id', 'uuid'),
        ('conversas', 'barbeiro_id', 'uuid'),
        ('mensagens', 'id', 'uuid'),
        ('mensagens', 'conversa_id', 'uuid'),
        ('mensagens', 'remetente_id', 'uuid'),
        ('mensagens', 'lida', 'boolean')
      ) AS e(tabela, coluna, tipo)
      LEFT JOIN information_schema.columns c
        ON c.table_schema = 'public' AND c.table_name = e.tabela AND c.column_name = e.coluna
  LOOP
    IF r.atual IS NULL THEN
      v_problemas := v_problemas || format('%s.%s nao existe', r.tabela, r.coluna);
    ELSIF r.tipo IS NOT NULL AND r.atual <> r.tipo THEN
      v_problemas := v_problemas || format('%s.%s e %s (esperado %s)', r.tabela, r.coluna, r.atual, r.tipo);
    END IF;
  END LOOP;

  -- Os avisos do chat apontam para conversas e mensagens (chave estrangeira)
  FOR r IN SELECT t AS tabela FROM unnest(ARRAY['conversas', 'mensagens']) AS t LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_constraint k
        JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attname = 'id'
       WHERE k.conrelid = to_regclass('public.' || r.tabela)
         AND k.contype IN ('p', 'u')
         AND k.conkey = ARRAY[a.attnum]
    ) THEN
      v_problemas := v_problemas || format('%s.id nao e chave primaria', r.tabela);
    END IF;
  END LOOP;

  -- Tabela com um dos nomes novos so pode ser desta mesma migration
  FOR r IN
    SELECT * FROM (VALUES
      ('dispositivos_push', 'token'),
      ('notificacao_preferencias', 'lembrete_minutos'),
      ('notificacoes', 'chave'),
      ('notificacao_envios', 'ticket_id')
    ) AS t(tabela, marca)
  LOOP
    IF to_regclass('public.' || r.tabela) IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM information_schema.columns c
       WHERE c.table_schema = 'public' AND c.table_name = r.tabela AND c.column_name = r.marca
    ) THEN
      v_problemas := v_problemas || format('ja existe uma tabela public.%s diferente da esperada', r.tabela);
    END IF;
  END LOOP;

  IF cardinality(v_problemas) > 0 THEN
    RAISE EXCEPTION 'Notificacoes: o banco nao esta como esperado e nada foi criado. %',
      array_to_string(v_problemas, '; ');
  END IF;
END $$;

-- ---------------------------------------------------------------
-- 1. Aparelhos
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.dispositivos_push (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Token do servico de push da Expo (o mesmo formato que a Expo valida)
  token              text NOT NULL UNIQUE
                       CHECK (length(token) <= 200 AND token ~ '^Expo(nent)?PushToken\[.+\]$'),
  plataforma         text NOT NULL DEFAULT 'android' CHECK (plataforma IN ('android', 'ios')),
  -- false: a Expo avisou que o aparelho nao recebe mais (ex.: app desinstalado)
  ativo              boolean NOT NULL DEFAULT true,
  criado_em          timestamptz NOT NULL DEFAULT now(),
  atualizado_em      timestamptz NOT NULL DEFAULT now(),
  desativado_em      timestamptz,
  motivo_desativacao text
);

CREATE INDEX IF NOT EXISTS dispositivos_push_usuario ON public.dispositivos_push (user_id) WHERE ativo;

-- ---------------------------------------------------------------
-- 2. Preferencias (sem linha = padrao)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notificacao_preferencias (
  user_id            uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  cancelamentos      boolean NOT NULL DEFAULT true,
  mensagens          boolean NOT NULL DEFAULT true,
  novos_agendamentos boolean NOT NULL DEFAULT true,
  -- NULL = padrao do perfil: ligado para clientes, desligado para barbeiros
  lembretes          boolean,
  -- Antecedencia do lembrete. O app oferece 30 minutos por enquanto.
  lembrete_minutos   integer NOT NULL DEFAULT 30 CHECK (lembrete_minutos IN (15, 30, 60)),
  atualizado_em      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------
-- 3. Fila e historico dos avisos
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notificacoes (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo              text NOT NULL
                      CHECK (tipo IN ('cancelamento', 'mensagem', 'novo_agendamento', 'lembrete', 'teste')),
  -- Idempotencia: um aviso por evento e destinatario
  chave             text NOT NULL UNIQUE,
  destinatario_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  -- Quem causou o evento (NULL: sistema). So para registro.
  ator_id           uuid,
  agendamento_id    uuid REFERENCES public.agendamentos(id) ON DELETE CASCADE,
  conversa_id       uuid REFERENCES public.conversas(id) ON DELETE CASCADE,
  mensagem_id       uuid REFERENCES public.mensagens(id) ON DELETE CASCADE,
  -- Primeiro nome, servico e horario no momento do evento. Nunca o texto
  -- de uma mensagem.
  dados             jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- pendente -> enviando -> enviada | ignorada (motivo) | falhou | expirada
  status            text NOT NULL DEFAULT 'pendente'
                      CHECK (status IN ('pendente', 'enviando', 'enviada', 'ignorada', 'falhou', 'expirada')),
  motivo            text,
  tentativas        integer NOT NULL DEFAULT 0,
  proxima_tentativa timestamptz NOT NULL DEFAULT now(),
  -- Enquanto o backend envia: depois disso, outra execucao pode retomar
  reservada_ate     timestamptz,
  -- Depois disso o aviso perde o sentido e nao e mais enviado
  expira_em         timestamptz NOT NULL,
  criada_em         timestamptz NOT NULL DEFAULT now(),
  enviada_em        timestamptz,
  atualizada_em     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS notificacoes_fila ON public.notificacoes (proxima_tentativa)
  WHERE status IN ('pendente', 'enviando');
CREATE INDEX IF NOT EXISTS notificacoes_destinatario ON public.notificacoes (destinatario_id, criada_em DESC);
CREATE INDEX IF NOT EXISTS notificacoes_agendamento ON public.notificacoes (agendamento_id)
  WHERE agendamento_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notificacoes_conversa ON public.notificacoes (conversa_id)
  WHERE conversa_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notificacoes_mensagem ON public.notificacoes (mensagem_id)
  WHERE mensagem_id IS NOT NULL;

-- ---------------------------------------------------------------
-- 4. Resultado de cada aviso em cada aparelho
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.notificacao_envios (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  notificacao_id uuid NOT NULL REFERENCES public.notificacoes(id) ON DELETE CASCADE,
  dispositivo_id uuid REFERENCES public.dispositivos_push(id) ON DELETE SET NULL,
  -- aceito: a Expo recebeu (ticket); entregue: o Google confirmou (recibo);
  -- recusado: erro definitivo (ex.: app desinstalado); erro: falha temporaria
  status         text NOT NULL CHECK (status IN ('aceito', 'entregue', 'recusado', 'erro')),
  ticket_id      text,
  erro           text,
  enviado_em     timestamptz,
  recibo_em      timestamptz,
  criado_em      timestamptz NOT NULL DEFAULT now(),
  atualizado_em  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notificacao_id, dispositivo_id)
);

CREATE INDEX IF NOT EXISTS notificacao_envios_recibos ON public.notificacao_envios (enviado_em)
  WHERE status = 'aceito';
CREATE UNIQUE INDEX IF NOT EXISTS notificacao_envios_ticket ON public.notificacao_envios (ticket_id)
  WHERE ticket_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS notificacao_envios_dispositivo ON public.notificacao_envios (dispositivo_id);

-- ---------------------------------------------------------------
-- 5. Acesso: nenhuma policy. Apps e site nao leem nem gravam direto (nem com
--    a chave anon); tudo passa pelas funcoes abaixo.
-- ---------------------------------------------------------------
ALTER TABLE public.dispositivos_push        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacao_preferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacoes             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notificacao_envios       ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.dispositivos_push, public.notificacao_preferencias,
              public.notificacoes, public.notificacao_envios
  FROM anon, authenticated;

-- ---------------------------------------------------------------
-- 6. App: o proprio aparelho e as proprias preferencias
-- ---------------------------------------------------------------

-- Registra (ou renova) o aparelho de quem esta logado. O mesmo aparelho
-- passa para a conta que entrou por ultimo nele.
CREATE OR REPLACE FUNCTION public.registrar_dispositivo_push(p_token text, p_plataforma text DEFAULT 'android')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', DETAIL = 'NAO_AUTENTICADO',
      MESSAGE = 'Faça login para continuar.';
  END IF;
  IF p_token IS NULL OR length(p_token) > 200 OR p_token !~ '^Expo(nent)?PushToken\[.+\]$' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'TOKEN_INVALIDO',
      MESSAGE = 'Token de notificação inválido.';
  END IF;
  IF coalesce(p_plataforma, '') NOT IN ('android', 'ios') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PLATAFORMA_INVALIDA',
      MESSAGE = 'Plataforma inválida.';
  END IF;

  INSERT INTO public.dispositivos_push (user_id, token, plataforma)
  VALUES (v_uid, p_token, p_plataforma)
  ON CONFLICT (token) DO UPDATE
     SET user_id = EXCLUDED.user_id,
         plataforma = EXCLUDED.plataforma,
         ativo = true,
         desativado_em = NULL,
         motivo_desativacao = NULL,
         atualizado_em = now();
  RETURN true;
END;
$$;

-- Ao sair da conta: desvincula o aparelho, so se ele for de quem esta logado
CREATE OR REPLACE FUNCTION public.remover_dispositivo_push(p_token text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', DETAIL = 'NAO_AUTENTICADO',
      MESSAGE = 'Faça login para continuar.';
  END IF;
  DELETE FROM public.dispositivos_push WHERE token = p_token AND user_id = v_uid;
  RETURN FOUND;
END;
$$;

-- Preferencias de quem esta logado, ja com os padroes aplicados
CREATE OR REPLACE FUNCTION public.minhas_preferencias_notificacao()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_barbeiro boolean;
  p public.notificacao_preferencias%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', DETAIL = 'NAO_AUTENTICADO',
      MESSAGE = 'Faça login para continuar.';
  END IF;
  v_barbeiro := public.has_role(v_uid, 'barbeiro');
  SELECT * INTO p FROM public.notificacao_preferencias WHERE user_id = v_uid;

  RETURN jsonb_build_object(
    'cancelamentos', coalesce(p.cancelamentos, true),
    'mensagens', coalesce(p.mensagens, true),
    'novos_agendamentos', coalesce(p.novos_agendamentos, true),
    'lembretes', coalesce(p.lembretes, NOT v_barbeiro),
    'lembrete_minutos', coalesce(p.lembrete_minutos, 30),
    'perfil', CASE WHEN public.has_role(v_uid, 'admin') THEN 'admin'
                   WHEN v_barbeiro THEN 'barbeiro'
                   ELSE 'cliente' END);
END;
$$;

-- Salva so as chaves enviadas, ex.: {"mensagens": false}
CREATE OR REPLACE FUNCTION public.salvar_preferencias_notificacao(p_preferencias jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_chave text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT401', DETAIL = 'NAO_AUTENTICADO',
      MESSAGE = 'Faça login para continuar.';
  END IF;
  IF jsonb_typeof(p_preferencias) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PREFERENCIAS_INVALIDAS',
      MESSAGE = 'Preferências inválidas.';
  END IF;

  FOR v_chave IN SELECT jsonb_object_keys(p_preferencias) LOOP
    IF v_chave NOT IN ('cancelamentos', 'mensagens', 'novos_agendamentos', 'lembretes', 'lembrete_minutos') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PREFERENCIAS_INVALIDAS',
        MESSAGE = format('Preferência desconhecida: %s.', v_chave);
    END IF;
    IF v_chave <> 'lembrete_minutos' AND jsonb_typeof(p_preferencias -> v_chave) <> 'boolean' THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PREFERENCIAS_INVALIDAS',
        MESSAGE = format('A preferência %s deve ser ligada ou desligada.', v_chave);
    END IF;
  END LOOP;

  IF p_preferencias ? 'lembrete_minutos' AND (
       jsonb_typeof(p_preferencias -> 'lembrete_minutos') <> 'number'
       OR (p_preferencias ->> 'lembrete_minutos')::numeric NOT IN (15, 30, 60)) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'ANTECEDENCIA_INVALIDA',
      MESSAGE = 'Antecedência do lembrete inválida.';
  END IF;

  INSERT INTO public.notificacao_preferencias (user_id) VALUES (v_uid)
  ON CONFLICT (user_id) DO NOTHING;

  UPDATE public.notificacao_preferencias
     SET cancelamentos = coalesce((p_preferencias ->> 'cancelamentos')::boolean, cancelamentos),
         mensagens = coalesce((p_preferencias ->> 'mensagens')::boolean, mensagens),
         novos_agendamentos = coalesce((p_preferencias ->> 'novos_agendamentos')::boolean, novos_agendamentos),
         lembretes = CASE WHEN p_preferencias ? 'lembretes'
                          THEN (p_preferencias ->> 'lembretes')::boolean ELSE lembretes END,
         lembrete_minutos = coalesce((p_preferencias ->> 'lembrete_minutos')::integer, lembrete_minutos),
         atualizado_em = now()
   WHERE user_id = v_uid;

  RETURN public.minhas_preferencias_notificacao();
END;
$$;

-- ---------------------------------------------------------------
-- 7. Backend (service role): reservar, conferir, registrar o resultado
-- ---------------------------------------------------------------

-- Avisos que passaram do prazo deixam de ser enviados
CREATE OR REPLACE FUNCTION public.expirar_notificacoes()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total integer;
BEGIN
  UPDATE public.notificacoes
     SET status = 'expirada', motivo = 'prazo', reservada_ate = NULL, atualizada_em = now()
   WHERE expira_em <= now()
     AND (status = 'pendente' OR (status = 'enviando' AND reservada_ate < now()));
  GET DIAGNOSTICS v_total = ROW_COUNT;
  RETURN v_total;
END;
$$;

-- Confere, na hora de enviar, se o aviso ainda vale. NULL = pode enviar.
CREATE OR REPLACE FUNCTION public.motivo_para_nao_enviar(n public.notificacoes)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.notificacao_preferencias%ROWTYPE;
  a record;
  v_lida boolean;
BEGIN
  IF n.expira_em <= now() THEN
    RETURN 'prazo';
  END IF;
  IF n.tipo = 'teste' THEN
    RETURN NULL;
  END IF;

  -- Preferencias do destinatario (sem linha: padrao)
  SELECT * INTO p FROM public.notificacao_preferencias WHERE user_id = n.destinatario_id;
  IF (n.tipo = 'cancelamento' AND NOT coalesce(p.cancelamentos, true))
     OR (n.tipo = 'mensagem' AND NOT coalesce(p.mensagens, true))
     OR (n.tipo = 'novo_agendamento' AND NOT coalesce(p.novos_agendamentos, true))
     OR (n.tipo = 'lembrete' AND NOT coalesce(p.lembretes, NOT public.has_role(n.destinatario_id, 'barbeiro'))) THEN
    RETURN 'preferencia';
  END IF;

  IF n.tipo IN ('cancelamento', 'novo_agendamento', 'lembrete') THEN
    SELECT ag.status::text AS status, ag.data_hora, ag.cliente_id, b.user_id AS barbeiro_user
      INTO a
      FROM public.agendamentos ag
      JOIN public.barbeiros b ON b.id = ag.barbeiro_id
     WHERE ag.id = n.agendamento_id;
    IF NOT FOUND THEN
      RETURN 'agendamento_removido';
    END IF;
    -- O destinatario continua sendo o cliente ou o barbeiro do agendamento
    IF n.destinatario_id IS DISTINCT FROM a.cliente_id
       AND n.destinatario_id IS DISTINCT FROM a.barbeiro_user THEN
      RETURN 'destinatario_mudou';
    END IF;
    IF n.tipo = 'cancelamento' THEN
      IF a.status <> 'cancelado' THEN
        RETURN 'cancelamento_revertido';
      END IF;
    ELSE
      IF a.status <> 'confirmado' THEN
        RETURN 'agendamento_' || a.status;
      END IF;
      IF a.data_hora <= now() THEN
        RETURN 'horario_passou';
      END IF;
      IF n.tipo = 'lembrete' AND a.data_hora IS DISTINCT FROM (n.dados ->> 'data_hora')::timestamptz THEN
        RETURN 'horario_alterado';
      END IF;
    END IF;

  ELSIF n.tipo = 'mensagem' THEN
    SELECT m.lida INTO v_lida FROM public.mensagens m WHERE m.id = n.mensagem_id;
    IF NOT FOUND THEN
      RETURN 'mensagem_removida';
    END IF;
    IF v_lida THEN
      RETURN 'ja_lida';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM public.conversas c
        LEFT JOIN public.barbeiros b ON b.id = c.barbeiro_id
       WHERE c.id = n.conversa_id
         AND (c.cliente_id = n.destinatario_id OR b.user_id = n.destinatario_id)
    ) THEN
      RETURN 'destinatario_mudou';
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

-- Reserva ate p_limite avisos para envio (sem duplicar, mesmo com duas
-- execucoes ao mesmo tempo) e devolve so os que ainda valem, com os
-- aparelhos ativos do destinatario que ainda nao receberam o aviso:
--   [{ id, tipo, destinatario_id, tentativas, dados, dispositivos: [{id, token}],
--      nao_lidas (so mensagem) }]
-- Os que nao valem mais ficam como 'ignorada', com o motivo.
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
     WHERE (status = 'pendente' AND proxima_tentativa <= now())
        OR (status = 'enviando' AND reservada_ate < now())
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

-- Desativa um aparelho que nao recebe mais (devolve 1 se desativou)
CREATE OR REPLACE FUNCTION public.desativar_dispositivo_push(p_dispositivo_id uuid, p_motivo text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.dispositivos_push
     SET ativo = false, desativado_em = now(), motivo_desativacao = left(p_motivo, 100), atualizado_em = now()
   WHERE id = p_dispositivo_id AND ativo;
  RETURN CASE WHEN FOUND THEN 1 ELSE 0 END;
END;
$$;

-- Resultado do envio de um aviso, por aparelho:
--   p_resultados = [{ dispositivo_id, status: 'aceito'|'recusado'|'erro', ticket_id?, erro? }]
-- aceito: a Expo recebeu. recusado: erro definitivo (DeviceNotRegistered
-- desativa o aparelho). erro: falha temporaria; tenta de novo so nos aparelhos
-- que falharam, depois de 30 s, 2 min, 8 min e 32 min. Na 5a falha, desiste.
CREATE OR REPLACE FUNCTION public.concluir_envio_notificacao(p_notificacao_id uuid, p_resultados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n public.notificacoes%ROWTYPE;
  r jsonb;
  v_status text;
  v_erro text;
  v_temporario text;
  v_definitivo text;
  v_aceitos integer;
  v_novo text;
  v_proxima timestamptz;
BEGIN
  SELECT * INTO n FROM public.notificacoes WHERE id = p_notificacao_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'NOTIFICACAO_NAO_ENCONTRADA',
      MESSAGE = 'Notificação não encontrada.';
  END IF;
  IF jsonb_typeof(p_resultados) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'RESULTADOS_INVALIDOS',
      MESSAGE = 'Resultados de envio inválidos.';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_resultados) LOOP
    v_status := r ->> 'status';
    v_erro := left(r ->> 'erro', 300);
    IF v_status IS NULL OR v_status NOT IN ('aceito', 'recusado', 'erro') THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'RESULTADOS_INVALIDOS',
        MESSAGE = 'Resultado de envio inválido.';
    END IF;

    -- So aparelhos do proprio destinatario; um envio que ja deu certo nao
    -- e sobrescrito
    INSERT INTO public.notificacao_envios AS e (notificacao_id, dispositivo_id, status, ticket_id, erro, enviado_em)
    SELECT n.id, d.id, v_status, r ->> 'ticket_id', v_erro, CASE WHEN v_status = 'aceito' THEN now() END
      FROM public.dispositivos_push d
     WHERE d.id = (r ->> 'dispositivo_id')::uuid AND d.user_id = n.destinatario_id
    ON CONFLICT (notificacao_id, dispositivo_id) DO UPDATE
       SET status = EXCLUDED.status,
           ticket_id = EXCLUDED.ticket_id,
           erro = EXCLUDED.erro,
           enviado_em = EXCLUDED.enviado_em,
           atualizado_em = now()
     WHERE e.status = 'erro';
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_status = 'erro' THEN
      v_temporario := coalesce(v_temporario, v_erro, 'erro');
    ELSIF v_status = 'recusado' THEN
      v_definitivo := coalesce(v_definitivo, v_erro, 'recusado');
      IF v_erro = 'DeviceNotRegistered' THEN
        PERFORM public.desativar_dispositivo_push((r ->> 'dispositivo_id')::uuid, v_erro);
      END IF;
    END IF;
  END LOOP;

  SELECT count(*) INTO v_aceitos
    FROM public.notificacao_envios
   WHERE notificacao_id = n.id AND status IN ('aceito', 'entregue');

  IF v_temporario IS NOT NULL AND n.tentativas < 5 THEN
    v_novo := 'pendente';
    v_proxima := now() + make_interval(secs => 30 * power(4, greatest(n.tentativas, 1) - 1));
  ELSIF v_aceitos > 0 THEN
    v_novo := 'enviada';
  ELSE
    v_novo := 'falhou';
  END IF;

  UPDATE public.notificacoes
     SET status = v_novo,
         reservada_ate = NULL,
         proxima_tentativa = coalesce(v_proxima, proxima_tentativa),
         enviada_em = CASE WHEN v_aceitos > 0 THEN coalesce(enviada_em, now()) ELSE enviada_em END,
         motivo = CASE
           WHEN v_novo = 'pendente' THEN 'erro_temporario: ' || v_temporario
           WHEN v_novo = 'falhou' AND v_temporario IS NOT NULL THEN 'tentativas_esgotadas: ' || v_temporario
           WHEN v_novo = 'falhou' THEN 'recusado: ' || coalesce(v_definitivo, 'sem_resultado')
           WHEN v_definitivo IS NOT NULL THEN 'parcial: ' || v_definitivo
           ELSE NULL END,
         atualizada_em = now()
   WHERE id = n.id;

  RETURN jsonb_build_object('status', v_novo, 'proxima_tentativa', v_proxima);
END;
$$;

-- Tickets aceitos pela Expo ha pelo menos p_atraso_min minutos, ainda sem
-- recibo (a Expo guarda os recibos por 24 h)
CREATE OR REPLACE FUNCTION public.recibos_pendentes(p_atraso_min integer DEFAULT 15, p_limite integer DEFAULT 1000)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(q.ticket_id ORDER BY q.enviado_em), '[]'::jsonb)
    FROM (
      SELECT ticket_id, enviado_em
        FROM public.notificacao_envios
       WHERE status = 'aceito'
         AND ticket_id IS NOT NULL
         AND enviado_em <= now() - make_interval(mins => greatest(coalesce(p_atraso_min, 15), 0))
         AND enviado_em > now() - interval '23 hours'
       ORDER BY enviado_em
       LIMIT greatest(1, least(coalesce(p_limite, 1000), 1000))
    ) q;
$$;

-- Recibos da Expo: p_recibos = [{ ticket_id, status: 'ok'|'error', erro? }]
-- DeviceNotRegistered desativa o aparelho. Se nenhum aparelho recebeu, o
-- aviso passa a 'falhou'.
CREATE OR REPLACE FUNCTION public.registrar_recibos(p_recibos jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r jsonb;
  v_ok boolean;
  v_erro text;
  v_envio public.notificacao_envios%ROWTYPE;
  v_entregues integer := 0;
  v_recusados integer := 0;
  v_desativados integer := 0;
BEGIN
  IF jsonb_typeof(p_recibos) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'RECIBOS_INVALIDOS',
      MESSAGE = 'Recibos inválidos.';
  END IF;

  FOR r IN SELECT value FROM jsonb_array_elements(p_recibos) LOOP
    v_ok := (r ->> 'status') = 'ok';
    v_erro := CASE WHEN v_ok THEN NULL ELSE left(coalesce(r ->> 'erro', 'erro'), 300) END;

    UPDATE public.notificacao_envios
       SET status = CASE WHEN v_ok THEN 'entregue' ELSE 'recusado' END,
           erro = v_erro,
           recibo_em = now(),
           atualizado_em = now()
     WHERE ticket_id = r ->> 'ticket_id' AND status = 'aceito'
    RETURNING * INTO v_envio;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    IF v_ok THEN
      v_entregues := v_entregues + 1;
      CONTINUE;
    END IF;

    v_recusados := v_recusados + 1;
    IF v_erro = 'DeviceNotRegistered' AND v_envio.dispositivo_id IS NOT NULL THEN
      v_desativados := v_desativados + public.desativar_dispositivo_push(v_envio.dispositivo_id, v_erro);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM public.notificacao_envios
                    WHERE notificacao_id = v_envio.notificacao_id AND status IN ('aceito', 'entregue')) THEN
      UPDATE public.notificacoes
         SET status = 'falhou', motivo = 'recibo: ' || v_erro, atualizada_em = now()
       WHERE id = v_envio.notificacao_id AND status = 'enviada';
    END IF;
  END LOOP;

  RETURN jsonb_build_object('entregues', v_entregues, 'recusados', v_recusados, 'desativados', v_desativados);
END;
$$;

-- ---------------------------------------------------------------
-- 8. Permissoes
-- ---------------------------------------------------------------
-- App (usuario logado)
REVOKE ALL ON FUNCTION public.registrar_dispositivo_push(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_dispositivo_push(text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.remover_dispositivo_push(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remover_dispositivo_push(text) TO authenticated;
REVOKE ALL ON FUNCTION public.minhas_preferencias_notificacao() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.minhas_preferencias_notificacao() TO authenticated;
REVOKE ALL ON FUNCTION public.salvar_preferencias_notificacao(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.salvar_preferencias_notificacao(jsonb) TO authenticated;

-- So o backend (service role) e o proprio banco
REVOKE ALL ON FUNCTION public.expirar_notificacoes() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.motivo_para_nao_enviar(public.notificacoes) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reservar_notificacoes(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.desativar_dispositivo_push(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_envio_notificacao(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.recibos_pendentes(integer, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_recibos(jsonb) FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.reservar_notificacoes(integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.concluir_envio_notificacao(uuid, jsonb) TO service_role;
    GRANT EXECUTE ON FUNCTION public.recibos_pendentes(integer, integer) TO service_role;
    GRANT EXECUTE ON FUNCTION public.registrar_recibos(jsonb) TO service_role;
  END IF;
END $$;
