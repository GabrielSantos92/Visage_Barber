-- =====================================================================
-- Conflitos de horario nos agendamentos
-- Os apps gravam direto na tabela agendamentos (nao ha endpoint no backend),
-- entao a regra fica no banco: vale para o mobile, para a web e para qualquer
-- chamada direta a API do Supabase.
--
-- Regras, aplicadas ao criar ou remarcar um agendamento:
--   1. um barbeiro nao atende dois clientes em horarios que se sobreponham;
--   2. um cliente nao tem dois agendamentos sobrepostos, mesmo com barbeiros diferentes;
--   3. o horario precisa ser futuro e caber no expediente do barbeiro;
--   4. o barbeiro e o servico precisam estar ativos e vinculados.
-- A duracao vem de servicos.duracao_min, nunca do que o app envia.
-- Agendamentos cancelados nao bloqueiam horario; confirmados e concluidos sim.
--
-- Nao cria tabela nem coluna e nao altera dados existentes.
-- Seguro para re-executar. Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

CREATE OR REPLACE FUNCTION public.validar_agendamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- Fuso da barbearia: o expediente (horarios_disponiveis) e hora local
  v_fuso      constant text := 'America/Sao_Paulo';
  v_duracao   integer;
  v_fim       timestamptz;
  v_ini_local timestamp;
  v_fim_local timestamp;
  v_trava_barbeiro bigint;
  v_trava_cliente  bigint;
BEGIN
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

  SELECT s.duracao_min INTO v_duracao
    FROM public.servicos s
    JOIN public.barbeiro_servicos bs ON bs.servico_id = s.id AND bs.barbeiro_id = NEW.barbeiro_id
   WHERE s.id = NEW.servico_id AND s.ativo;
  IF v_duracao IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SERVICO_INDISPONIVEL',
      MESSAGE = 'Este serviço não está disponível para este barbeiro.';
  END IF;

  v_fim := NEW.data_hora + make_interval(mins => v_duracao);

  IF NEW.data_hora <= now() THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'HORARIO_PASSADO',
      MESSAGE = 'Não é possível agendar em um horário que já passou.';
  END IF;

  -- O atendimento inteiro precisa caber em um periodo do expediente do dia
  v_ini_local := NEW.data_hora AT TIME ZONE v_fuso;
  v_fim_local := v_fim AT TIME ZONE v_fuso;
  IF v_ini_local::date <> v_fim_local::date OR NOT EXISTS (
    SELECT 1 FROM public.horarios_disponiveis h
     WHERE h.barbeiro_id = NEW.barbeiro_id
       AND h.dia_semana  = EXTRACT(dow FROM v_ini_local)::int
       AND h.hora_inicio <= v_ini_local::time
       AND h.hora_fim    >= v_fim_local::time
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'FORA_DO_EXPEDIENTE',
      MESSAGE = 'Este horário está fora do expediente do barbeiro.';
  END IF;

  -- Reservas simultaneas: quem for gravar para o mesmo barbeiro ou para o mesmo
  -- cliente espera aqui ate a outra transacao terminar, e so entao confere os
  -- conflitos (ja enxergando a reserva que acabou de entrar). As travas sao
  -- pegas sempre na mesma ordem para duas reservas cruzadas nao se bloquearem.
  v_trava_barbeiro := hashtextextended('agendamento:barbeiro:' || NEW.barbeiro_id::text, 0);
  v_trava_cliente  := hashtextextended('agendamento:cliente:'  || NEW.cliente_id::text, 0);
  PERFORM pg_advisory_xact_lock(LEAST(v_trava_barbeiro, v_trava_cliente));
  PERFORM pg_advisory_xact_lock(GREATEST(v_trava_barbeiro, v_trava_cliente));

  -- Sobreposicao: inicio_existente < fim_novo E fim_existente > inicio_novo
  IF EXISTS (
    SELECT 1 FROM public.agendamentos a
      JOIN public.servicos s ON s.id = a.servico_id
     WHERE a.barbeiro_id = NEW.barbeiro_id
       AND a.id <> NEW.id
       AND a.status <> 'cancelado'
       AND a.data_hora < v_fim
       AND a.data_hora + make_interval(mins => s.duracao_min) > NEW.data_hora
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'CONFLITO_BARBEIRO',
      MESSAGE = 'Esse horário não está mais disponível para este barbeiro. Por favor, escolha outro horário.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.agendamentos a
      JOIN public.servicos s ON s.id = a.servico_id
     WHERE a.cliente_id = NEW.cliente_id
       AND a.id <> NEW.id
       AND a.status <> 'cancelado'
       AND a.data_hora < v_fim
       AND a.data_hora + make_interval(mins => s.duracao_min) > NEW.data_hora
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'CONFLITO_CLIENTE',
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
-- Horarios ocupados para a tela de escolha de horario.
-- O RLS so deixa o cliente ler os proprios agendamentos, entao ele nao
-- enxergava as reservas de outros clientes com o barbeiro. Esta funcao devolve
-- apenas os intervalos (inicio e fim), sem nenhum dado de quem reservou:
-- os do barbeiro escolhido e os do proprio cliente com qualquer barbeiro.
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
  SELECT a.data_hora, a.data_hora + make_interval(mins => s.duracao_min)
    FROM public.agendamentos a
    JOIN public.servicos s ON s.id = a.servico_id
   WHERE a.status <> 'cancelado'
     AND (a.barbeiro_id = p_barbeiro_id OR a.cliente_id = auth.uid())
     AND a.data_hora < p_fim
     AND a.data_hora + make_interval(mins => s.duracao_min) > p_inicio;
$$;

REVOKE ALL ON FUNCTION public.horarios_ocupados(uuid, timestamptz, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.horarios_ocupados(uuid, timestamptz, timestamptz) TO authenticated;
