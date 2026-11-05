-- =====================================================================
-- Limite diario de agendamentos por cliente e servicos repetidos no mesmo dia
--
-- Regras (para o cliente, no dia local da barbearia, America/Sao_Paulo):
--   1. no maximo 3 agendamentos ativos (confirmado ou concluido) por dia,
--      somando todos os barbeiros;
--   2. um novo agendamento nao pode repetir nenhum COMPONENTE de servico ja
--      agendado no dia (ex.: "Corte + Barba" depois de "Barba completa").
-- Cancelados nao contam. Ao editar, o proprio agendamento nao conta.
--
-- Os componentes sao relacionais, nunca comparacao de nomes:
--   componentes_servico   catalogo (corte, barba, sobrancelha, coloracao)
--   servico_componentes   quais componentes cada servico inclui
-- Servico sem componente cadastrado conta como um componente proprio (o seu
-- id): repetir o mesmo servico e bloqueado, servicos diferentes nao.
--
-- A validacao fica no trigger validar_agendamento, o mesmo que ja valida
-- horario e conflitos: vale para web, app e qualquer chamada direta a API.
-- As travas por cliente que o trigger ja pega (pg_advisory_xact_lock)
-- serializam reservas simultaneas do mesmo cliente, entao duas requisicoes ao
-- mesmo tempo nao passam juntas do limite.
--
-- Depende da migration 20261014000015. Seguro para re-executar.
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Componentes de servico
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.componentes_servico (
  codigo text PRIMARY KEY CHECK (codigo ~ '^[a-z_]+$'),
  nome   text NOT NULL
);

INSERT INTO public.componentes_servico (codigo, nome) VALUES
  ('corte', 'Corte de cabelo'),
  ('barba', 'Barba'),
  ('sobrancelha', 'Sobrancelha'),
  ('coloracao', 'Coloração')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.servico_componentes (
  servico_id uuid NOT NULL REFERENCES public.servicos(id) ON DELETE CASCADE,
  componente text NOT NULL REFERENCES public.componentes_servico(codigo),
  PRIMARY KEY (servico_id, componente)
);

-- Leitura livre (as telas mostram e explicam a regra); escrita so pela
-- funcao definir_componentes_servico (admin)
ALTER TABLE public.componentes_servico ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.servico_componentes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Todos leem componentes" ON public.componentes_servico;
CREATE POLICY "Todos leem componentes" ON public.componentes_servico
  FOR SELECT TO anon, authenticated USING (true);
DROP POLICY IF EXISTS "Todos leem componentes dos servicos" ON public.servico_componentes;
CREATE POLICY "Todos leem componentes dos servicos" ON public.servico_componentes
  FOR SELECT TO anon, authenticated USING (true);

-- ---------------------------------------------------------------
-- 2. Carga inicial dos servicos ja cadastrados (uma vez)
--    O banco nao tem como saber o que cada servico existente inclui. Para a
--    regra valer desde ja, so os servicos SEM nenhum componente recebem uma
--    sugestao a partir do nome. E apenas carga inicial: a regra compara
--    componentes (ids), nunca nomes. Confira e ajuste em Admin > Servicos.
-- ---------------------------------------------------------------
INSERT INTO public.servico_componentes (servico_id, componente)
SELECT s.id, c.codigo
  FROM public.servicos s
 CROSS JOIN LATERAL (
   SELECT lower(translate(s.nome, 'áàâãäéèêëíìîïóòôõöúùûüçÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇ',
                                  'aaaaaeeeeiiiiooooouuuucAAAAAEEEEIIIIOOOOOUUUUC')) AS n
 ) t
 CROSS JOIN LATERAL (VALUES
   ('corte',       '(corte|degrad|navalh|social|maquin|tesour|fade|disfarc)'),
   ('barba',       '(barba|bigode|cavanhaque)'),
   ('sobrancelha', '(sobrancelh)'),
   ('coloracao',   '(color|tintur|luzes|mecha|platin|nevou|pigment)')
 ) AS c(codigo, padrao)
 WHERE t.n ~ c.padrao
   AND NOT EXISTS (SELECT 1 FROM public.servico_componentes x WHERE x.servico_id = s.id)
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------
-- 3. Componentes de um servico (o proprio id quando nao ha cadastro)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.componentes_do_servico(p_servico_id uuid)
RETURNS text[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT array_agg(sc.componente ORDER BY sc.componente)
       FROM public.servico_componentes sc
      WHERE sc.servico_id = p_servico_id),
    ARRAY['servico:' || p_servico_id::text]);
$$;

-- ---------------------------------------------------------------
-- 4. Regra diaria do cliente: devolve o motivo e a mensagem da recusa, ou
--    nenhuma linha quando o agendamento e permitido
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.regra_diaria_cliente(
  p_cliente_id uuid,
  p_servico_id uuid,
  p_inicio     timestamptz,
  p_ignorar_id uuid DEFAULT NULL
)
RETURNS TABLE (motivo text, mensagem text)
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_fuso      constant text := 'America/Sao_Paulo';
  v_limite    constant integer := 3;
  v_dia       date := (p_inicio AT TIME ZONE v_fuso)::date;
  v_ini       timestamptz := v_dia::timestamp AT TIME ZONE v_fuso;
  v_fim       timestamptz := (v_dia + 1)::timestamp AT TIME ZONE v_fuso;
  v_servicos  uuid[];
  v_repetidos text[];
  v_nomes     text;
BEGIN
  -- Agendamentos ativos do cliente no mesmo dia local, com qualquer barbeiro
  SELECT coalesce(array_agg(a.servico_id), '{}') INTO v_servicos
    FROM public.agendamentos a
   WHERE a.cliente_id = p_cliente_id
     AND a.id IS DISTINCT FROM p_ignorar_id
     AND a.status <> 'cancelado'
     AND a.data_hora >= v_ini
     AND a.data_hora <  v_fim;

  IF cardinality(v_servicos) >= v_limite THEN
    RETURN QUERY SELECT 'LIMITE_DIARIO'::text,
      'Você atingiu o limite máximo de 3 agendamentos por dia. Escolha outra data para realizar um novo agendamento.'::text;
    RETURN;
  END IF;

  -- Componentes do novo servico que ja aparecem nos servicos do dia
  SELECT array_agg(DISTINCT novo.c) INTO v_repetidos
    FROM unnest(public.componentes_do_servico(p_servico_id)) AS novo(c)
   WHERE novo.c IN (
     SELECT unnest(public.componentes_do_servico(s.id))
       FROM unnest(v_servicos) AS s(id));

  IF v_repetidos IS NOT NULL THEN
    SELECT string_agg(x.nome, ', ' ORDER BY x.nome) INTO v_nomes
      FROM (
        SELECT lower(coalesce(cs.nome, sv.nome, r.c)) AS nome
          FROM unnest(v_repetidos) AS r(c)
          LEFT JOIN public.componentes_servico cs ON cs.codigo = r.c
          LEFT JOIN public.servicos sv ON r.c = 'servico:' || sv.id::text
      ) x;
    RETURN QUERY SELECT 'SERVICO_REPETIDO'::text,
      format('Você já tem um agendamento neste dia que inclui %s. Escolha um serviço diferente ou outra data.', v_nomes);
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 5. Consulta para as telas de agendamento, antes de escolher o horario.
--    Usa sempre o cliente logado e nao expoe dados de outros clientes.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verificar_regra_diaria(p_servico_id uuid, p_data date)
RETURNS TABLE (motivo text, mensagem text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.motivo, r.mensagem
    FROM public.regra_diaria_cliente(
           auth.uid(), p_servico_id,
           (p_data::timestamp + interval '12 hours') AT TIME ZONE 'America/Sao_Paulo') r
   WHERE auth.uid() IS NOT NULL;
$$;

-- ---------------------------------------------------------------
-- 6. Componentes de um servico (admin), numa unica operacao
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.definir_componentes_servico(p_servico_id uuid, p_componentes text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', DETAIL = 'SEM_PERMISSAO',
      MESSAGE = 'Apenas o administrador pode alterar os componentes do serviço.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.servicos WHERE id = p_servico_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SERVICO_INDISPONIVEL',
      MESSAGE = 'Serviço não encontrado.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(p_componentes, '{}')) c
     WHERE c NOT IN (SELECT codigo FROM public.componentes_servico)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'COMPONENTE_INVALIDO',
      MESSAGE = 'Componente de serviço inválido.';
  END IF;

  DELETE FROM public.servico_componentes WHERE servico_id = p_servico_id;
  INSERT INTO public.servico_componentes (servico_id, componente)
  SELECT DISTINCT p_servico_id, c FROM unnest(coalesce(p_componentes, '{}')) c;
END;
$$;

-- ---------------------------------------------------------------
-- 7. Trigger de validacao: o mesmo da migration 20261014000015, com a regra
--    diaria depois das verificacoes de horario e de conflito
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
  v_regra          record;
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

  -- Limite diario e servicos repetidos (vale a mesma trava do cliente acima)
  SELECT * INTO v_regra
    FROM public.regra_diaria_cliente(NEW.cliente_id, NEW.servico_id, NEW.data_hora, NEW.id);
  IF v_regra.motivo IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = v_regra.motivo, MESSAGE = v_regra.mensagem;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS validar_agendamento ON public.agendamentos;
CREATE TRIGGER validar_agendamento
  BEFORE INSERT OR UPDATE ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.validar_agendamento();

-- ---------------------------------------------------------------
-- 8. Permissoes: funcoes internas fora do alcance dos apps
-- ---------------------------------------------------------------
REVOKE ALL ON FUNCTION public.regra_diaria_cliente(uuid, uuid, timestamptz, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.componentes_do_servico(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.verificar_regra_diaria(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verificar_regra_diaria(uuid, date) TO authenticated;
REVOKE ALL ON FUNCTION public.definir_componentes_servico(uuid, text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.definir_componentes_servico(uuid, text[]) TO authenticated;
