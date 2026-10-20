-- =====================================================================
-- Agenda com pausa (coloracao, tintura e servicos semelhantes)
--
-- Alguns servicos tem um periodo em que o produto age e o barbeiro nao precisa
-- ficar com o cliente. Esses servicos passam a ter tres etapas:
--   1. atendimento ativo inicial (preparacao e aplicacao) -> barbeiro ocupado
--   2. pausa (acao do produto)                            -> barbeiro livre
--   3. atendimento ativo final (enxague e finalizacao)    -> barbeiro ocupado
-- Na pausa o barbeiro pode atender outro cliente, desde que esse atendimento
-- caiba inteiro nela. A margem de seguranca encolhe a parte aproveitavel da
-- pausa (nos dois lados) e nao entra na duracao do servico.
--
-- A pausa so e aproveitada quando configurada explicitamente no servico
-- (com_pausa + os tres tempos). Os demais servicos, inclusive colorações ja
-- cadastradas, continuam ocupando o barbeiro do inicio ao fim.
--
-- O cliente continua com um unico agendamento e fica ocupado pelo intervalo
-- inteiro (ele esta com o produto no cabelo), mesmo com outro barbeiro.
--
-- Cada agendamento guarda uma copia dos tempos usados: mudar o cadastro do
-- servico nao altera agendamentos ja feitos. Os agendamentos existentes recebem
-- a duracao que ja tinham (servicos.duracao_min) e continuam como bloco unico.
--
-- Depende das migrations 20261009000013 e 20261009000014.
-- Seguro para re-executar. Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Configuracao das etapas no cadastro do servico
--    Nada muda nos servicos existentes: com_pausa nasce false, os tempos
--    nascem nulos e a margem 0 nao tem efeito.
-- ---------------------------------------------------------------
ALTER TABLE public.servicos
  ADD COLUMN IF NOT EXISTS com_pausa         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ativo_inicial_min integer,
  ADD COLUMN IF NOT EXISTS pausa_min         integer,
  ADD COLUMN IF NOT EXISTS ativo_final_min   integer,
  ADD COLUMN IF NOT EXISTS margem_min        integer NOT NULL DEFAULT 0;

-- Os tres tempos andam juntos: ou nenhum (servico continuo, ou com pausa ainda
-- sem configuracao, que fica fora do agendamento) ou todos, positivos, somando
-- a duracao e com pausa maior que as duas margens.
ALTER TABLE public.servicos DROP CONSTRAINT IF EXISTS servicos_etapas_validas;
ALTER TABLE public.servicos ADD CONSTRAINT servicos_etapas_validas CHECK (
  margem_min BETWEEN 0 AND 120
  AND (
    (ativo_inicial_min IS NULL AND pausa_min IS NULL AND ativo_final_min IS NULL)
    OR (
      -- IS NOT NULL explicito: um CHECK que da NULL e aceito pelo Postgres
      com_pausa
      AND ativo_inicial_min IS NOT NULL AND pausa_min IS NOT NULL AND ativo_final_min IS NOT NULL
      AND ativo_inicial_min BETWEEN 1 AND 480
      AND pausa_min         BETWEEN 1 AND 480
      AND ativo_final_min   BETWEEN 1 AND 480
      AND pausa_min > 2 * margem_min
      AND duracao_min = ativo_inicial_min + pausa_min + ativo_final_min
    )
  )
);

-- ---------------------------------------------------------------
-- 2. Copia dos tempos no agendamento (preenchida pelo trigger, nunca pelo app)
--    pausa_min nulo = atendimento continuo de duracao_min minutos.
-- ---------------------------------------------------------------
ALTER TABLE public.agendamentos
  ADD COLUMN IF NOT EXISTS duracao_min       integer,
  ADD COLUMN IF NOT EXISTS ativo_inicial_min integer,
  ADD COLUMN IF NOT EXISTS pausa_min         integer,
  ADD COLUMN IF NOT EXISTS ativo_final_min   integer,
  ADD COLUMN IF NOT EXISTS margem_min        integer;

-- Agendamentos existentes: grava a duracao que eles ja ocupavam hoje.
-- Os triggers ficam desligados so durante esta copia, para nao revalidar
-- agendamentos antigos nem mexer em updated_at.
DO $$
DECLARE
  v_triggers text[];
  v_t text;
BEGIN
  SELECT coalesce(array_agg(tgname::text), '{}') INTO v_triggers
    FROM pg_trigger
   WHERE tgrelid = 'public.agendamentos'::regclass AND NOT tgisinternal AND tgenabled <> 'D';

  FOREACH v_t IN ARRAY v_triggers LOOP
    EXECUTE format('ALTER TABLE public.agendamentos DISABLE TRIGGER %I', v_t);
  END LOOP;

  UPDATE public.agendamentos a
     SET duracao_min = s.duracao_min
    FROM public.servicos s
   WHERE s.id = a.servico_id
     AND a.duracao_min IS NULL;

  FOREACH v_t IN ARRAY v_triggers LOOP
    EXECUTE format('ALTER TABLE public.agendamentos ENABLE TRIGGER %I', v_t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------
-- 3. Periodos em que o barbeiro precisa estar presente
--    Continuo: o atendimento inteiro.
--    Com pausa: aplicacao (+ margem) e finalizacao (- margem). A margem fica
--    do lado da pausa, para o barbeiro terminar o outro cliente com folga.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.agenda_blocos_barbeiro(
  p_inicio        timestamptz,
  p_duracao       integer,
  p_ativo_inicial integer,
  p_pausa         integer,
  p_ativo_final   integer,
  p_margem        integer
)
RETURNS TABLE (inicio timestamptz, fim timestamptz)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT p_inicio, p_inicio + make_interval(mins => p_duracao)
   WHERE p_pausa IS NULL
  UNION ALL
  SELECT p_inicio, p_inicio + make_interval(mins => p_ativo_inicial + coalesce(p_margem, 0))
   WHERE p_pausa IS NOT NULL
  UNION ALL
  SELECT p_inicio + make_interval(mins => p_ativo_inicial + p_pausa - coalesce(p_margem, 0)),
         p_inicio + make_interval(mins => p_ativo_inicial + p_pausa + p_ativo_final)
   WHERE p_pausa IS NOT NULL;
$$;

-- ---------------------------------------------------------------
-- 4. Regra unica de disponibilidade, usada pelo trigger (ao gravar) e pela
--    funcao horarios_livres (ao oferecer horarios). Devolve NULL quando o
--    horario serve, ou o codigo do motivo da recusa.
--    Nao fica exposta aos apps: so as funcoes SECURITY DEFINER a chamam.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.conflito_agendamento(
  p_barbeiro_id   uuid,
  p_cliente_id    uuid,
  p_inicio        timestamptz,
  p_duracao       integer,
  p_ativo_inicial integer,
  p_pausa         integer,
  p_ativo_final   integer,
  p_margem        integer,
  p_ignorar_id    uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  -- Fuso da barbearia: o expediente (horarios_disponiveis) e hora local
  v_fuso      constant text := 'America/Sao_Paulo';
  v_fim       timestamptz := p_inicio + make_interval(mins => p_duracao);
  v_ini_local timestamp := p_inicio AT TIME ZONE v_fuso;
  v_fim_local timestamp := v_fim AT TIME ZONE v_fuso;
BEGIN
  IF p_inicio <= now() THEN
    RETURN 'HORARIO_PASSADO';
  END IF;

  -- O atendimento inteiro (pausa inclusa) precisa caber em um periodo do expediente
  IF v_ini_local::date <> v_fim_local::date OR NOT EXISTS (
    SELECT 1 FROM public.horarios_disponiveis h
     WHERE h.barbeiro_id = p_barbeiro_id
       AND h.dia_semana  = EXTRACT(dow FROM v_ini_local)::int
       AND h.hora_inicio <= v_ini_local::time
       AND h.hora_fim    >= v_fim_local::time
  ) THEN
    RETURN 'FORA_DO_EXPEDIENTE';
  END IF;

  -- Barbeiro: nenhum periodo de presenca do novo atendimento pode cruzar um
  -- periodo de presenca de outro. Pausas nao contam como ocupadas.
  IF EXISTS (
    SELECT 1
      FROM public.agendamentos a
      JOIN public.servicos s ON s.id = a.servico_id
     CROSS JOIN LATERAL public.agenda_blocos_barbeiro(
             a.data_hora, coalesce(a.duracao_min, s.duracao_min),
             a.ativo_inicial_min, a.pausa_min, a.ativo_final_min, a.margem_min) e
     CROSS JOIN LATERAL public.agenda_blocos_barbeiro(
             p_inicio, p_duracao, p_ativo_inicial, p_pausa, p_ativo_final, p_margem) n
     WHERE a.barbeiro_id = p_barbeiro_id
       AND a.id IS DISTINCT FROM p_ignorar_id
       AND a.status <> 'cancelado'
       AND a.data_hora < v_fim
       AND a.data_hora + make_interval(mins => coalesce(a.duracao_min, s.duracao_min)) > p_inicio
       AND e.inicio < n.fim
       AND e.fim > n.inicio
  ) THEN
    RETURN 'CONFLITO_BARBEIRO';
  END IF;

  -- Cliente: ocupado do inicio ao fim de cada agendamento, com qualquer barbeiro
  IF p_cliente_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM public.agendamentos a
      JOIN public.servicos s ON s.id = a.servico_id
     WHERE a.cliente_id = p_cliente_id
       AND a.id IS DISTINCT FROM p_ignorar_id
       AND a.status <> 'cancelado'
       AND a.data_hora < v_fim
       AND a.data_hora + make_interval(mins => coalesce(a.duracao_min, s.duracao_min)) > p_inicio
  ) THEN
    RETURN 'CONFLITO_CLIENTE';
  END IF;

  RETURN NULL;
END;
$$;

-- ---------------------------------------------------------------
-- 5. Trigger de validacao (substitui o da migration 20261009000014)
--    Mesmas regras e mensagens de antes, agora por etapas.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.validar_agendamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_copiou    boolean := false;
  v_com_pausa boolean;
  v_motivo    text;
  v_trava_barbeiro bigint;
  v_trava_cliente  bigint;
BEGIN
  -- Copia dos tempos: tirada do servico ao criar (ou ao trocar de servico) e
  -- depois congelada. O que o app enviar nessas colunas e ignorado.
  IF TG_OP = 'INSERT' OR NEW.servico_id IS DISTINCT FROM OLD.servico_id OR OLD.duracao_min IS NULL THEN
    SELECT s.duracao_min, s.ativo_inicial_min, s.pausa_min, s.ativo_final_min,
           CASE WHEN s.pausa_min IS NULL THEN NULL ELSE s.margem_min END
      INTO NEW.duracao_min, NEW.ativo_inicial_min, NEW.pausa_min, NEW.ativo_final_min, NEW.margem_min
      FROM public.servicos s
     WHERE s.id = NEW.servico_id;
    v_copiou := true;
  ELSE
    NEW.duracao_min       := OLD.duracao_min;
    NEW.ativo_inicial_min := OLD.ativo_inicial_min;
    NEW.pausa_min         := OLD.pausa_min;
    NEW.ativo_final_min   := OLD.ativo_final_min;
    NEW.margem_min        := OLD.margem_min;
  END IF;

  -- Cancelar nunca gera conflito
  IF NEW.status = 'cancelado' THEN
    RETURN NEW;
  END IF;

  -- Mudanca que nao mexe em horario, barbeiro, servico ou cliente (ex.: a
  -- conclusao automatica) passa direto. Reativar um cancelado e validado.
  IF TG_OP = 'UPDATE'
     AND OLD.status <> 'cancelado'
     AND NEW.data_hora   = OLD.data_hora
     AND NEW.barbeiro_id = OLD.barbeiro_id
     AND NEW.servico_id  = OLD.servico_id
     AND NEW.cliente_id  = OLD.cliente_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.barbeiros b WHERE b.id = NEW.barbeiro_id AND b.ativo) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'BARBEIRO_INDISPONIVEL',
      MESSAGE = 'Este barbeiro não está disponível para agendamento.';
  END IF;

  SELECT s.com_pausa INTO v_com_pausa
    FROM public.servicos s
    JOIN public.barbeiro_servicos bs ON bs.servico_id = s.id AND bs.barbeiro_id = NEW.barbeiro_id
   WHERE s.id = NEW.servico_id AND s.ativo;
  IF NOT FOUND OR NEW.duracao_min IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SERVICO_INDISPONIVEL',
      MESSAGE = 'Este serviço não está disponível para este barbeiro.';
  END IF;

  -- Servico marcado com pausa, mas sem os tempos configurados: nao e agendavel
  IF v_copiou AND v_com_pausa AND NEW.pausa_min IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SERVICO_SEM_ETAPAS',
      MESSAGE = 'Este serviço ainda não tem os tempos de atendimento configurados.';
  END IF;

  -- Reservas simultaneas: quem for gravar para o mesmo barbeiro ou para o mesmo
  -- cliente espera aqui ate a outra transacao terminar, e so entao confere os
  -- conflitos (ja enxergando a reserva que acabou de entrar). As travas sao
  -- pegas sempre na mesma ordem para duas reservas cruzadas nao se bloquearem.
  v_trava_barbeiro := hashtextextended('agendamento:barbeiro:' || NEW.barbeiro_id::text, 0);
  v_trava_cliente  := hashtextextended('agendamento:cliente:'  || NEW.cliente_id::text, 0);
  PERFORM pg_advisory_xact_lock(LEAST(v_trava_barbeiro, v_trava_cliente));
  PERFORM pg_advisory_xact_lock(GREATEST(v_trava_barbeiro, v_trava_cliente));

  v_motivo := public.conflito_agendamento(
    NEW.barbeiro_id, NEW.cliente_id, NEW.data_hora,
    NEW.duracao_min, NEW.ativo_inicial_min, NEW.pausa_min, NEW.ativo_final_min, NEW.margem_min,
    NEW.id);

  IF v_motivo = 'HORARIO_PASSADO' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = v_motivo,
      MESSAGE = 'Não é possível agendar em um horário que já passou.';
  ELSIF v_motivo = 'FORA_DO_EXPEDIENTE' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = v_motivo,
      MESSAGE = 'Este horário está fora do expediente do barbeiro.';
  ELSIF v_motivo = 'CONFLITO_BARBEIRO' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = v_motivo,
      MESSAGE = 'Esse horário não está mais disponível para este barbeiro. Por favor, escolha outro horário.';
  ELSIF v_motivo = 'CONFLITO_CLIENTE' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = v_motivo,
      MESSAGE = 'Você já possui um agendamento nesse horário. Escolha outro horário para evitar conflitos.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_agendamento ON public.agendamentos;
CREATE TRIGGER validar_agendamento
  BEFORE INSERT OR UPDATE ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.validar_agendamento();

-- ---------------------------------------------------------------
-- 6. Horarios livres para a tela de agendamento (web e mobile).
--    Calculados aqui, com a mesma regra do trigger, para os apps nao
--    precisarem repetir a logica. Alem da grade de 30 em 30 minutos, oferece
--    os horarios em que um periodo ocupado termina (ex.: o inicio da parte
--    aproveitavel de uma pausa), que nao caem na grade.
--    Devolve so horarios (HH:MI, hora local), sem dados de outros clientes.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.horarios_livres(
  p_barbeiro_id uuid,
  p_servico_id  uuid,
  p_data        date
)
RETURNS TABLE (horario text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso    constant text := 'America/Sao_Paulo';
  v_passo   constant integer := 30;
  v_cliente uuid := auth.uid();
  v_ini_dia timestamptz := p_data::timestamp AT TIME ZONE v_fuso;
  v_fim_dia timestamptz := (p_data + 1)::timestamp AT TIME ZONE v_fuso;
  v_srv     record;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.barbeiros b WHERE b.id = p_barbeiro_id AND b.ativo) THEN
    RETURN;
  END IF;

  SELECT s.duracao_min, s.ativo_inicial_min, s.pausa_min, s.ativo_final_min, s.com_pausa,
         CASE WHEN s.pausa_min IS NULL THEN NULL ELSE s.margem_min END AS margem_min
    INTO v_srv
    FROM public.servicos s
    JOIN public.barbeiro_servicos bs ON bs.servico_id = s.id AND bs.barbeiro_id = p_barbeiro_id
   WHERE s.id = p_servico_id AND s.ativo;
  IF NOT FOUND OR (v_srv.com_pausa AND v_srv.pausa_min IS NULL) THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH periodos AS (
    SELECT p_data + h.hora_inicio AS ini, p_data + h.hora_fim AS fim
      FROM public.horarios_disponiveis h
     WHERE h.barbeiro_id = p_barbeiro_id
       AND h.dia_semana = EXTRACT(dow FROM p_data)::int
  ),
  -- Fins dos periodos ocupados do dia (do barbeiro e do proprio cliente), em hora local
  fins AS (
    SELECT e.fim AT TIME ZONE v_fuso AS t
      FROM public.agendamentos a
      JOIN public.servicos s ON s.id = a.servico_id
     CROSS JOIN LATERAL public.agenda_blocos_barbeiro(
             a.data_hora, coalesce(a.duracao_min, s.duracao_min),
             a.ativo_inicial_min, a.pausa_min, a.ativo_final_min, a.margem_min) e
     WHERE a.barbeiro_id = p_barbeiro_id
       AND a.status <> 'cancelado'
       AND a.data_hora >= v_ini_dia - interval '1 day'
       AND a.data_hora < v_fim_dia
    UNION
    SELECT (a.data_hora + make_interval(mins => coalesce(a.duracao_min, s.duracao_min))) AT TIME ZONE v_fuso
      FROM public.agendamentos a
      JOIN public.servicos s ON s.id = a.servico_id
     WHERE a.cliente_id = v_cliente
       AND a.status <> 'cancelado'
       AND a.data_hora >= v_ini_dia - interval '1 day'
       AND a.data_hora < v_fim_dia
  ),
  candidatos AS (
    SELECT g.t
      FROM periodos p
     CROSS JOIN LATERAL generate_series(p.ini, p.fim, make_interval(mins => v_passo)) AS g(t)
    UNION
    SELECT f.t
      FROM fins f
      JOIN periodos p ON f.t >= p.ini AND f.t < p.fim
  )
  SELECT to_char(c.t, 'HH24:MI')
    FROM candidatos c
   WHERE public.conflito_agendamento(
           p_barbeiro_id, v_cliente, c.t AT TIME ZONE v_fuso,
           v_srv.duracao_min, v_srv.ativo_inicial_min, v_srv.pausa_min, v_srv.ativo_final_min, v_srv.margem_min
         ) IS NULL
   ORDER BY 1;
END;
$$;

-- ---------------------------------------------------------------
-- 7. Horarios ocupados (funcao da migration 20261009000014, usada por versoes
--    antigas dos apps): passa a devolver so os periodos em que o barbeiro esta
--    presente, mais os agendamentos inteiros do proprio cliente.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.horarios_ocupados(
  p_barbeiro_id uuid,
  p_inicio timestamptz,
  p_fim timestamptz
)
RETURNS TABLE (inicio timestamptz, fim timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT e.inicio, e.fim
    FROM public.agendamentos a
    JOIN public.servicos s ON s.id = a.servico_id
   CROSS JOIN LATERAL public.agenda_blocos_barbeiro(
           a.data_hora, coalesce(a.duracao_min, s.duracao_min),
           a.ativo_inicial_min, a.pausa_min, a.ativo_final_min, a.margem_min) e
   WHERE a.status <> 'cancelado'
     AND a.barbeiro_id = p_barbeiro_id
     AND e.inicio < p_fim
     AND e.fim > p_inicio
  UNION
  SELECT a.data_hora, a.data_hora + make_interval(mins => coalesce(a.duracao_min, s.duracao_min))
    FROM public.agendamentos a
    JOIN public.servicos s ON s.id = a.servico_id
   WHERE a.status <> 'cancelado'
     AND a.cliente_id = auth.uid()
     AND a.data_hora < p_fim
     AND a.data_hora + make_interval(mins => coalesce(a.duracao_min, s.duracao_min)) > p_inicio;
$$;

-- ---------------------------------------------------------------
-- 8. Conclusao automatica usa a duracao gravada no agendamento
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.concluir_agendamentos_passados()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total integer;
BEGIN
  UPDATE public.agendamentos a
     SET status = 'concluido'
    FROM public.servicos s
   WHERE s.id = a.servico_id
     AND a.status = 'confirmado'
     AND a.data_hora + make_interval(mins => COALESCE(a.duracao_min, s.duracao_min, 30)) <= now();

  GET DIAGNOSTICS total = ROW_COUNT;
  RETURN total;
END;
$$;

-- ---------------------------------------------------------------
-- 9. Configuracao das etapas de um servico (admin ou barbeiro que o oferece).
--    Valida os tempos com mensagens claras e mantem duracao_min = soma das
--    etapas. Agendamentos ja feitos nao mudam; a funcao devolve quantos
--    agendamentos futuros confirmados continuam com os tempos anteriores.
--    p_com_pausa = true com os tres tempos nulos deixa o servico marcado como
--    "com pausa" mas fora do agendamento ate os tempos serem informados.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.configurar_etapas_servico(
  p_servico_id    uuid,
  p_com_pausa     boolean,
  p_ativo_inicial integer DEFAULT NULL,
  p_pausa         integer DEFAULT NULL,
  p_ativo_final   integer DEFAULT NULL,
  p_margem        integer DEFAULT 0
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_margem   integer := coalesce(p_margem, 0);
  v_informados integer := (p_ativo_inicial IS NOT NULL)::int + (p_pausa IS NOT NULL)::int + (p_ativo_final IS NOT NULL)::int;
  v_futuros  integer;
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR EXISTS (
      SELECT 1 FROM public.barbeiro_servicos bs
        JOIN public.barbeiros b ON b.id = bs.barbeiro_id
       WHERE bs.servico_id = p_servico_id AND b.user_id = auth.uid())
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', DETAIL = 'SEM_PERMISSAO',
      MESSAGE = 'Você não tem permissão para configurar este serviço.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.servicos WHERE id = p_servico_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SERVICO_INDISPONIVEL',
      MESSAGE = 'Serviço não encontrado.';
  END IF;

  IF p_com_pausa AND v_informados > 0 THEN
    IF v_informados < 3 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'ETAPAS_INCOMPLETAS',
        MESSAGE = 'Informe os três tempos: atendimento inicial, pausa e atendimento final.';
    END IF;
    IF p_ativo_inicial NOT BETWEEN 1 AND 480 OR p_pausa NOT BETWEEN 1 AND 480 OR p_ativo_final NOT BETWEEN 1 AND 480 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'ETAPA_INVALIDA',
        MESSAGE = 'Cada etapa deve ter entre 1 e 480 minutos.';
    END IF;
    IF v_margem NOT BETWEEN 0 AND 120 THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'MARGEM_INVALIDA',
        MESSAGE = 'A margem de segurança deve ter entre 0 e 120 minutos.';
    END IF;
    IF p_pausa <= 2 * v_margem THEN
      RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'MARGEM_INVALIDA',
        MESSAGE = 'A pausa precisa ser maior que o dobro da margem de segurança.';
    END IF;
  ELSIF v_margem NOT BETWEEN 0 AND 120 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'MARGEM_INVALIDA',
      MESSAGE = 'A margem de segurança deve ter entre 0 e 120 minutos.';
  END IF;

  UPDATE public.servicos
     SET com_pausa         = p_com_pausa,
         ativo_inicial_min = CASE WHEN p_com_pausa THEN p_ativo_inicial END,
         pausa_min         = CASE WHEN p_com_pausa THEN p_pausa END,
         ativo_final_min   = CASE WHEN p_com_pausa THEN p_ativo_final END,
         margem_min        = v_margem,
         duracao_min       = CASE WHEN p_com_pausa AND v_informados = 3
                                  THEN p_ativo_inicial + p_pausa + p_ativo_final
                                  ELSE duracao_min END
   WHERE id = p_servico_id;

  SELECT count(*) INTO v_futuros
    FROM public.agendamentos
   WHERE servico_id = p_servico_id AND status = 'confirmado' AND data_hora > now();
  RETURN v_futuros;
END;
$$;

-- ---------------------------------------------------------------
-- 10. Permissoes. O Supabase concede EXECUTE em funcoes novas a anon e
--     authenticated por padrao, entao as internas sao revogadas explicitamente.
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.conflito_agendamento(uuid, uuid, timestamptz, integer, integer, integer, integer, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.agenda_blocos_barbeiro(timestamptz, integer, integer, integer, integer, integer) FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.horarios_livres(uuid, uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.horarios_livres(uuid, uuid, date) TO authenticated;

REVOKE ALL ON FUNCTION public.horarios_ocupados(uuid, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.horarios_ocupados(uuid, timestamptz, timestamptz) TO authenticated;

REVOKE ALL ON FUNCTION public.configurar_etapas_servico(uuid, boolean, integer, integer, integer, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configurar_etapas_servico(uuid, boolean, integer, integer, integer, integer) TO authenticated;
