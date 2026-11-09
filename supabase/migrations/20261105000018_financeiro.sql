-- =====================================================================
-- Financeiro: pagamentos dos clientes, comissoes e pagamentos aos barbeiros
--
-- Modelo:
--   * O cliente paga a barbearia (PIX, cartao ou presencial). O dinheiro cai na
--     conta de pagamentos da barbearia; o barbeiro nao recebe direto.
--   * Cada servico CONCLUIDO e PAGO gera um lancamento imutavel com a
--     fotografia daquele momento: valor original, desconto, valor pago,
--     percentual, comissao, parte da barbearia, taxa do meio de pagamento.
--   * Reembolso e cancelamento depois da conclusao geram lancamentos de ajuste
--     (valores negativos). Nada e alterado nem apagado.
--   * A comissao vigente e a ultima configurada pelo admin para o barbeiro ou,
--     sem ela, o padrao da barbearia. Sem nenhum dos dois, o lancamento espera
--     o admin configurar: o sistema nao inventa percentual.
--   * O fechamento semanal (segunda a domingo, hora de Sao Paulo) e calculado
--     a partir dos lancamentos; os pagamentos aos barbeiros sao registrados
--     pelo admin e nunca passam do saldo pendente.
--
-- Escrita: so por funcoes (admin) e pelo backend (service role). Os apps nao
-- gravam direto em nenhuma tabela financeira.
--
-- Depende das migrations ate 20261105000017. Seguro para re-executar.
-- Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Tipos
-- ---------------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE public.pagamento_status AS ENUM
    ('pending', 'approved', 'rejected', 'expired', 'refunded', 'partially_refunded', 'canceled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.pagamento_metodo AS ENUM ('pix', 'cartao', 'presencial');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.lancamento_tipo AS ENUM ('servico', 'reembolso', 'cancelamento');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------
-- 2. Preco congelado no agendamento
--    Copiado do servico ao criar (ou ao trocar de servico), como os tempos da
--    agenda. O que o app enviar nessa coluna e ignorado. A cobranca usa este
--    valor: mudar o preco do servico nao muda o que ja foi reservado.
-- ---------------------------------------------------------------
ALTER TABLE public.agendamentos ADD COLUMN IF NOT EXISTS preco numeric(10,2);

-- Agendamentos existentes recebem o preco atual do servico (triggers desligados
-- so durante a copia, para nao revalidar nem mexer em updated_at)
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
     SET preco = s.preco
    FROM public.servicos s
   WHERE s.id = a.servico_id AND a.preco IS NULL;

  FOREACH v_t IN ARRAY v_triggers LOOP
    EXECUTE format('ALTER TABLE public.agendamentos ENABLE TRIGGER %I', v_t);
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.copiar_preco_agendamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.servico_id IS DISTINCT FROM OLD.servico_id OR OLD.preco IS NULL THEN
    SELECT s.preco INTO NEW.preco FROM public.servicos s WHERE s.id = NEW.servico_id;
  ELSE
    NEW.preco := OLD.preco;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agendamento_preco ON public.agendamentos;
CREATE TRIGGER agendamento_preco
  BEFORE INSERT OR UPDATE ON public.agendamentos
  FOR EACH ROW EXECUTE FUNCTION public.copiar_preco_agendamento();

-- ---------------------------------------------------------------
-- 3. Comissoes: historico imutavel de alteracoes
--    barbeiro_id NULL = percentual padrao da barbearia.
--    percentual NULL  = o barbeiro deixa de ter percentual proprio (volta ao
--    padrao) ou, no padrao, a barbearia deixa de ter padrao.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.comissao_alteracoes (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  barbeiro_id  uuid REFERENCES public.barbeiros(id) ON DELETE CASCADE,
  percentual   numeric(5,2) CHECK (percentual BETWEEN 0 AND 100),
  alterado_por uuid NOT NULL REFERENCES auth.users(id),
  alterado_em  timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS comissao_alteracoes_barbeiro_idx ON public.comissao_alteracoes (barbeiro_id, id DESC);

-- Percentual em vigor: o ultimo do barbeiro; sem ele, o ultimo padrao; senao NULL
CREATE OR REPLACE FUNCTION public.comissao_vigente(p_barbeiro_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT coalesce(
    (SELECT c.percentual FROM public.comissao_alteracoes c
      WHERE c.barbeiro_id = p_barbeiro_id ORDER BY c.id DESC LIMIT 1),
    (SELECT c.percentual FROM public.comissao_alteracoes c
      WHERE c.barbeiro_id IS NULL ORDER BY c.id DESC LIMIT 1));
$$;

-- ---------------------------------------------------------------
-- 4. Pagamentos dos clientes
--    Status do pagamento e independente do status do agendamento.
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagamentos (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agendamento_id          uuid NOT NULL REFERENCES public.agendamentos(id) ON DELETE RESTRICT,
  cliente_id              uuid NOT NULL REFERENCES auth.users(id),
  metodo                  public.pagamento_metodo NOT NULL,
  status                  public.pagamento_status NOT NULL DEFAULT 'pending',
  valor_original          numeric(10,2) NOT NULL CHECK (valor_original >= 0),
  desconto                numeric(10,2) NOT NULL DEFAULT 0,
  valor                   numeric(10,2) NOT NULL,
  valor_reembolsado       numeric(10,2) NOT NULL DEFAULT 0,
  taxa                    numeric(10,2) NOT NULL DEFAULT 0 CHECK (taxa >= 0),
  provedor                text CHECK (provedor IN ('mercadopago')),
  provedor_pagamento_id   text,
  provedor_preferencia_id text,
  link_pagamento          text,
  pix_copia_cola          text,
  pix_qr_base64           text,
  expira_em               timestamptz,
  forma_presencial        text CHECK (forma_presencial IN ('dinheiro', 'cartao_credito', 'cartao_debito', 'pix')),
  detalhe                 text,
  registrado_por          uuid REFERENCES auth.users(id),
  criado_em               timestamptz NOT NULL DEFAULT now(),
  atualizado_em           timestamptz NOT NULL DEFAULT now(),
  aprovado_em             timestamptz,
  CONSTRAINT pagamentos_desconto  CHECK (desconto >= 0 AND desconto <= valor_original),
  CONSTRAINT pagamentos_valor     CHECK (valor = valor_original - desconto),
  CONSTRAINT pagamentos_reembolso CHECK (valor_reembolsado >= 0 AND valor_reembolsado <= valor),
  CONSTRAINT pagamentos_provedor  CHECK ((metodo = 'presencial') = (provedor IS NULL))
);
-- Um pagamento do provedor so pode estar ligado a um registro
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_provedor_unico
  ON public.pagamentos (provedor, provedor_pagamento_id) WHERE provedor_pagamento_id IS NOT NULL;
-- No maximo uma cobranca em aberto por agendamento (evita cobranca duplicada)
CREATE UNIQUE INDEX IF NOT EXISTS pagamentos_um_pendente
  ON public.pagamentos (agendamento_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS pagamentos_agendamento_idx ON public.pagamentos (agendamento_id);
CREATE INDEX IF NOT EXISTS pagamentos_cliente_idx ON public.pagamentos (cliente_id);
CREATE INDEX IF NOT EXISTS pagamentos_aprovado_idx ON public.pagamentos (aprovado_em);

CREATE TABLE IF NOT EXISTS public.pagamento_reembolsos (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pagamento_id          uuid NOT NULL REFERENCES public.pagamentos(id) ON DELETE RESTRICT,
  valor                 numeric(10,2) NOT NULL CHECK (valor > 0),
  provedor_reembolso_id text,
  motivo                text,
  registrado_por        uuid REFERENCES auth.users(id),
  reembolsado_em        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pagamento_id, provedor_reembolso_id)
);

-- Notificacoes do provedor ja recebidas (idempotencia do webhook)
CREATE TABLE IF NOT EXISTS public.pagamento_eventos (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  provedor      text NOT NULL,
  chave         text NOT NULL,
  tipo          text,
  recurso_id    text,
  situacao      text NOT NULL DEFAULT 'recebido' CHECK (situacao IN ('recebido', 'processado', 'ignorado', 'erro')),
  erro          text,
  recebido_em   timestamptz NOT NULL DEFAULT now(),
  processado_em timestamptz,
  UNIQUE (provedor, chave)
);

-- ---------------------------------------------------------------
-- 5. Lancamentos financeiros (livro imutavel)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lancamentos_financeiros (
  id                  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo                public.lancamento_tipo NOT NULL,
  agendamento_id      uuid NOT NULL REFERENCES public.agendamentos(id) ON DELETE RESTRICT,
  pagamento_id        uuid NOT NULL REFERENCES public.pagamentos(id) ON DELETE RESTRICT,
  reembolso_id        uuid REFERENCES public.pagamento_reembolsos(id) ON DELETE RESTRICT,
  barbeiro_id         uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE RESTRICT,
  servico_id          uuid NOT NULL REFERENCES public.servicos(id) ON DELETE RESTRICT,
  competencia         date NOT NULL,
  valor_original      numeric(10,2) NOT NULL,
  desconto            numeric(10,2) NOT NULL,
  valor_pago          numeric(10,2) NOT NULL,
  percentual_comissao numeric(5,2) NOT NULL,
  valor_comissao      numeric(10,2) NOT NULL,
  valor_barbearia     numeric(10,2) NOT NULL,
  taxa_meio           numeric(10,2) NOT NULL,
  calculado_em        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lancamentos_soma CHECK (valor_comissao + valor_barbearia = valor_pago),
  CONSTRAINT lancamentos_reembolso CHECK ((tipo = 'reembolso') = (reembolso_id IS NOT NULL))
);
-- Um lancamento de servico e um de cancelamento por agendamento; um por reembolso
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_servico_unico
  ON public.lancamentos_financeiros (agendamento_id) WHERE tipo = 'servico';
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_cancelamento_unico
  ON public.lancamentos_financeiros (agendamento_id) WHERE tipo = 'cancelamento';
CREATE UNIQUE INDEX IF NOT EXISTS lancamentos_reembolso_unico
  ON public.lancamentos_financeiros (reembolso_id) WHERE reembolso_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS lancamentos_barbeiro_idx ON public.lancamentos_financeiros (barbeiro_id, competencia);
CREATE INDEX IF NOT EXISTS lancamentos_competencia_idx ON public.lancamentos_financeiros (competencia);

-- ---------------------------------------------------------------
-- 6. Pagamentos de comissao aos barbeiros (registrados pelo admin)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagamentos_comissao (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  barbeiro_id    uuid NOT NULL REFERENCES public.barbeiros(id) ON DELETE RESTRICT,
  semana_inicio  date NOT NULL CHECK (extract(isodow FROM semana_inicio) = 1),
  valor          numeric(10,2) NOT NULL CHECK (valor > 0),
  metodo         text NOT NULL CHECK (metodo IN ('pix', 'dinheiro', 'transferencia', 'outro')),
  comprovante    text,
  observacoes    text,
  registrado_por uuid NOT NULL REFERENCES auth.users(id),
  pago_em        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pagamentos_comissao_barbeiro_idx ON public.pagamentos_comissao (barbeiro_id, semana_inicio);

-- ---------------------------------------------------------------
-- 7. Historico imutavel: registros financeiros nao podem ser alterados
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financeiro_imutavel()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'REGISTRO_IMUTAVEL',
    MESSAGE = 'Registros financeiros não podem ser alterados. Registre um ajuste.';
END;
$$;

DROP TRIGGER IF EXISTS comissao_alteracoes_imutavel ON public.comissao_alteracoes;
CREATE TRIGGER comissao_alteracoes_imutavel BEFORE UPDATE ON public.comissao_alteracoes
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_imutavel();
DROP TRIGGER IF EXISTS lancamentos_imutavel ON public.lancamentos_financeiros;
CREATE TRIGGER lancamentos_imutavel BEFORE UPDATE ON public.lancamentos_financeiros
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_imutavel();
DROP TRIGGER IF EXISTS pagamentos_comissao_imutavel ON public.pagamentos_comissao;
CREATE TRIGGER pagamentos_comissao_imutavel BEFORE UPDATE ON public.pagamentos_comissao
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_imutavel();
DROP TRIGGER IF EXISTS reembolsos_imutavel ON public.pagamento_reembolsos;
CREATE TRIGGER reembolsos_imutavel BEFORE UPDATE ON public.pagamento_reembolsos
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_imutavel();

-- ---------------------------------------------------------------
-- 8. Auxiliares de permissao
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.exigir_admin()
RETURNS void
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', DETAIL = 'SEM_PERMISSAO',
      MESSAGE = 'Acesso restrito ao administrador.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.meu_barbeiro_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT b.id FROM public.barbeiros b WHERE b.user_id = auth.uid() LIMIT 1;
$$;

-- ---------------------------------------------------------------
-- 9. Geracao dos lancamentos de um agendamento (idempotente)
--    Chamada quando o agendamento e concluido ou cancelado, quando um
--    pagamento muda e quando o admin configura uma comissao. Pode ser chamada
--    quantas vezes for: os indices unicos impedem lancamento duplicado.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.gerar_lancamentos(p_agendamento_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso constant text := 'America/Sao_Paulo';
  a record;
  p record;
  s record;
  r record;
  v_pct      numeric;
  v_com      numeric;
  v_valor    numeric;
  v_net_pago numeric;
  v_net_com  numeric;
BEGIN
  SELECT * INTO a FROM public.agendamentos WHERE id = p_agendamento_id FOR UPDATE;
  IF NOT FOUND THEN RETURN; END IF;

  -- O pagamento que vale para o servico: o primeiro que chegou a ser aprovado
  SELECT * INTO p FROM public.pagamentos
   WHERE agendamento_id = a.id AND status IN ('approved', 'partially_refunded', 'refunded')
   ORDER BY aprovado_em NULLS LAST, criado_em
   LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT * INTO s FROM public.lancamentos_financeiros WHERE agendamento_id = a.id AND tipo = 'servico';
  IF NOT FOUND THEN
    -- Servico ainda nao realizado (ou cancelado antes) nao gera comissao
    IF a.status <> 'concluido' THEN RETURN; END IF;
    v_pct := public.comissao_vigente(a.barbeiro_id);
    -- Sem percentual configurado: espera o admin configurar
    IF v_pct IS NULL THEN RETURN; END IF;
    v_com := round(p.valor * v_pct / 100, 2);
    INSERT INTO public.lancamentos_financeiros (
      tipo, agendamento_id, pagamento_id, barbeiro_id, servico_id, competencia,
      valor_original, desconto, valor_pago, percentual_comissao, valor_comissao, valor_barbearia, taxa_meio)
    VALUES (
      'servico', a.id, p.id, a.barbeiro_id, a.servico_id, (a.data_hora AT TIME ZONE v_fuso)::date,
      p.valor_original, p.desconto, p.valor, v_pct, v_com, p.valor - v_com, p.taxa)
    RETURNING * INTO s;
  END IF;

  -- Reembolsos ainda sem ajuste: estorno proporcional da comissao
  FOR r IN
    SELECT rb.* FROM public.pagamento_reembolsos rb
     WHERE rb.pagamento_id = s.pagamento_id
       AND NOT EXISTS (SELECT 1 FROM public.lancamentos_financeiros l WHERE l.reembolso_id = rb.id)
     ORDER BY rb.reembolsado_em, rb.id
  LOOP
    SELECT coalesce(sum(valor_pago), 0), coalesce(sum(valor_comissao), 0)
      INTO v_net_pago, v_net_com
      FROM public.lancamentos_financeiros WHERE agendamento_id = a.id;
    -- Ja estornado por inteiro (ex.: cancelado depois da conclusao)
    EXIT WHEN v_net_pago <= 0;
    v_valor := least(r.valor, v_net_pago);
    -- O ultimo estorno zera exatamente o que restou, sem sobra de arredondamento
    v_com := CASE WHEN v_valor >= v_net_pago THEN v_net_com
                  ELSE round(s.valor_comissao * v_valor / s.valor_pago, 2) END;
    INSERT INTO public.lancamentos_financeiros (
      tipo, agendamento_id, pagamento_id, reembolso_id, barbeiro_id, servico_id, competencia,
      valor_original, desconto, valor_pago, percentual_comissao, valor_comissao, valor_barbearia, taxa_meio)
    VALUES (
      'reembolso', a.id, s.pagamento_id, r.id, s.barbeiro_id, s.servico_id, (r.reembolsado_em AT TIME ZONE v_fuso)::date,
      0, 0, -v_valor, s.percentual_comissao, -v_com, -(v_valor - v_com), 0);
  END LOOP;

  -- Cancelado depois de concluido (ex.: falta registrada depois): estorna o que restou
  IF a.status = 'cancelado'
     AND NOT EXISTS (SELECT 1 FROM public.lancamentos_financeiros WHERE agendamento_id = a.id AND tipo = 'cancelamento') THEN
    SELECT coalesce(sum(valor_pago), 0), coalesce(sum(valor_comissao), 0)
      INTO v_net_pago, v_net_com
      FROM public.lancamentos_financeiros WHERE agendamento_id = a.id;
    INSERT INTO public.lancamentos_financeiros (
      tipo, agendamento_id, pagamento_id, barbeiro_id, servico_id, competencia,
      valor_original, desconto, valor_pago, percentual_comissao, valor_comissao, valor_barbearia, taxa_meio)
    VALUES (
      'cancelamento', a.id, s.pagamento_id, s.barbeiro_id, s.servico_id, (now() AT TIME ZONE v_fuso)::date,
      -s.valor_original, -s.desconto, -v_net_pago, s.percentual_comissao, -v_net_com, -(v_net_pago - v_net_com), 0);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.agendamento_lancamentos()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status IN ('concluido', 'cancelado') THEN
    PERFORM public.gerar_lancamentos(NEW.id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS agendamento_lancamentos ON public.agendamentos;
CREATE TRIGGER agendamento_lancamentos
  AFTER UPDATE OF status ON public.agendamentos
  FOR EACH ROW WHEN (NEW.status IS DISTINCT FROM OLD.status)
  EXECUTE FUNCTION public.agendamento_lancamentos();

-- ---------------------------------------------------------------
-- 10. Ciclo do pagamento (backend, com service role)
-- ---------------------------------------------------------------

-- Abre uma cobranca para o agendamento do cliente. O valor vem do agendamento,
-- nunca do app. Reaproveita a cobranca aberta do mesmo meio que ainda vale e
-- cancela a de outro meio (devolvida em "cancelados" para o backend cancelar
-- tambem no provedor).
CREATE OR REPLACE FUNCTION public.iniciar_pagamento(
  p_agendamento_id uuid,
  p_cliente_id     uuid,
  p_metodo         public.pagamento_metodo
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a record;
  p public.pagamentos;
  v_cancelados jsonb := '[]'::jsonb;
  v_descricao text;
BEGIN
  SELECT ag.*, s.nome AS servico_nome INTO a
    FROM public.agendamentos ag JOIN public.servicos s ON s.id = ag.servico_id
   WHERE ag.id = p_agendamento_id
     FOR UPDATE OF ag;
  IF NOT FOUND OR a.cliente_id IS DISTINCT FROM p_cliente_id THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'AGENDAMENTO_NAO_ENCONTRADO',
      MESSAGE = 'Agendamento não encontrado.';
  END IF;
  IF a.status = 'cancelado' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'AGENDAMENTO_CANCELADO',
      MESSAGE = 'Este agendamento foi cancelado e não pode ser pago.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pagamentos
              WHERE agendamento_id = a.id AND status IN ('approved', 'partially_refunded')) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'JA_PAGO',
      MESSAGE = 'Este agendamento já está pago.';
  END IF;
  IF a.preco IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SEM_PRECO',
      MESSAGE = 'Este serviço está sem preço cadastrado.';
  END IF;
  v_descricao := 'Visage Barber - ' || a.servico_nome;

  SELECT * INTO p FROM public.pagamentos WHERE agendamento_id = a.id AND status = 'pending';
  IF FOUND THEN
    IF p.metodo = p_metodo AND (
         p.metodo = 'presencial'
         OR (p.expira_em > now() + interval '1 minute' AND coalesce(p.pix_copia_cola, p.link_pagamento) IS NOT NULL)
       ) THEN
      RETURN jsonb_build_object('pagamento', to_jsonb(p), 'reaproveitado', true,
                                'cancelados', '[]'::jsonb, 'descricao', v_descricao);
    END IF;
    UPDATE public.pagamentos SET status = 'canceled', detalhe = 'substituido', atualizado_em = now()
     WHERE id = p.id;
    v_cancelados := jsonb_build_array(jsonb_build_object(
      'id', p.id, 'metodo', p.metodo,
      'provedor_pagamento_id', p.provedor_pagamento_id,
      'provedor_preferencia_id', p.provedor_preferencia_id));
  END IF;

  INSERT INTO public.pagamentos (agendamento_id, cliente_id, metodo, valor_original, valor, provedor)
  VALUES (a.id, a.cliente_id, p_metodo, a.preco, a.preco,
          CASE WHEN p_metodo = 'presencial' THEN NULL ELSE 'mercadopago' END)
  RETURNING * INTO p;

  RETURN jsonb_build_object('pagamento', to_jsonb(p), 'reaproveitado', false,
                            'cancelados', v_cancelados, 'descricao', v_descricao);
END;
$$;

-- Dados da cobranca criada no provedor
CREATE OR REPLACE FUNCTION public.registrar_cobranca(p_pagamento_id uuid, p_dados jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.pagamentos;
BEGIN
  UPDATE public.pagamentos SET
    provedor_pagamento_id   = coalesce(p_dados->>'provedor_pagamento_id', provedor_pagamento_id),
    provedor_preferencia_id = coalesce(p_dados->>'provedor_preferencia_id', provedor_preferencia_id),
    link_pagamento          = coalesce(p_dados->>'link_pagamento', link_pagamento),
    pix_copia_cola          = coalesce(p_dados->>'pix_copia_cola', pix_copia_cola),
    pix_qr_base64           = coalesce(p_dados->>'pix_qr_base64', pix_qr_base64),
    expira_em               = coalesce((p_dados->>'expira_em')::timestamptz, expira_em),
    atualizado_em           = now()
  WHERE id = p_pagamento_id AND status = 'pending' AND metodo <> 'presencial'
  RETURNING * INTO p;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'PAGAMENTO_FECHADO',
      MESSAGE = 'Esta cobrança não está mais em aberto.';
  END IF;
  RETURN to_jsonb(p);
END;
$$;

-- A cobranca nao pode ser criada no provedor
CREATE OR REPLACE FUNCTION public.falhar_cobranca(p_pagamento_id uuid, p_detalhe text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pagamentos SET status = 'canceled', detalhe = p_detalhe, atualizado_em = now()
   WHERE id = p_pagamento_id AND status = 'pending';
$$;

-- Pagamento para sincronizar com o provedor: so do proprio cliente, ou de
-- qualquer cliente quando p_cliente_id e NULL (backend ja conferiu o admin)
CREATE OR REPLACE FUNCTION public.pagamento_para_sincronizar(p_pagamento_id uuid, p_cliente_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.pagamentos;
BEGIN
  SELECT * INTO p FROM public.pagamentos
   WHERE id = p_pagamento_id AND (p_cliente_id IS NULL OR cliente_id = p_cliente_id);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'PAGAMENTO_NAO_ENCONTRADO',
      MESSAGE = 'Pagamento não encontrado.';
  END IF;
  RETURN to_jsonb(p);
END;
$$;

-- Aplica o estado confirmado pelo provedor (consultado pelo backend na API do
-- provedor, nunca o que o app informou). Idempotente: aplicar o mesmo estado
-- de novo nao muda nada.
CREATE OR REPLACE FUNCTION public.aplicar_estado_pagamento(p_pagamento_id uuid, p_estado jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento uuid;
  p public.pagamentos;
  v_status   public.pagamento_status := (p_estado->>'status')::public.pagamento_status;
  v_id       text := p_estado->>'provedor_pagamento_id';
  v_valor    numeric := (p_estado->>'valor')::numeric;
  v_reemb    numeric;
  v_cancelados jsonb := '[]'::jsonb;
  -- Prioridade dos estados entre tentativas diferentes da mesma cobranca
  v_prio_novo  int;
  v_prio_atual int;
BEGIN
  -- Mesma ordem de travas do iniciar_pagamento (agendamento, depois pagamento)
  SELECT agendamento_id INTO v_agendamento FROM public.pagamentos WHERE id = p_pagamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'PAGAMENTO_NAO_ENCONTRADO',
      MESSAGE = 'Pagamento não encontrado.';
  END IF;
  PERFORM 1 FROM public.agendamentos WHERE id = v_agendamento FOR UPDATE;
  SELECT * INTO p FROM public.pagamentos WHERE id = p_pagamento_id FOR UPDATE;

  IF p.metodo = 'presencial' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PAGAMENTO_PRESENCIAL',
      MESSAGE = 'Pagamento presencial é registrado pelo administrador.';
  END IF;
  IF v_valor IS DISTINCT FROM p.valor THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'VALOR_DIVERGENTE',
      MESSAGE = format('O valor do provedor (%s) é diferente do valor cobrado (%s).', v_valor, p.valor);
  END IF;

  -- Outra tentativa da mesma cobranca (ex.: cartao recusado e depois aprovado
  -- na mesma pagina): so substitui se o estado novo for "melhor"
  IF p.provedor_pagamento_id IS NOT NULL AND p.provedor_pagamento_id <> v_id THEN
    v_prio_novo  := CASE WHEN v_status IN ('approved', 'partially_refunded', 'refunded') THEN 3
                         WHEN v_status = 'pending' THEN 2 ELSE 1 END;
    v_prio_atual := CASE WHEN p.status IN ('approved', 'partially_refunded', 'refunded') THEN 3
                         WHEN p.status = 'pending' THEN 2 ELSE 1 END;
    IF v_prio_novo < v_prio_atual THEN
      RETURN jsonb_build_object('pagamento', to_jsonb(p), 'ignorado', true, 'cancelados', '[]'::jsonb);
    END IF;
  END IF;

  INSERT INTO public.pagamento_reembolsos (pagamento_id, valor, provedor_reembolso_id, reembolsado_em)
  SELECT p.id, (r->>'valor')::numeric, r->>'id', coalesce((r->>'data')::timestamptz, now())
    FROM jsonb_array_elements(coalesce(p_estado->'reembolsos', '[]'::jsonb)) r
  ON CONFLICT (pagamento_id, provedor_reembolso_id) DO NOTHING;

  SELECT greatest(coalesce((p_estado->>'valor_reembolsado')::numeric, 0), coalesce(sum(valor), 0))
    INTO v_reemb FROM public.pagamento_reembolsos WHERE pagamento_id = p.id;

  UPDATE public.pagamentos SET
    status                = v_status,
    provedor_pagamento_id = v_id,
    taxa                  = coalesce((p_estado->>'taxa')::numeric, taxa),
    valor_reembolsado     = least(v_reemb, valor),
    aprovado_em           = CASE WHEN v_status IN ('approved', 'partially_refunded', 'refunded')
                                 THEN coalesce(aprovado_em, (p_estado->>'aprovado_em')::timestamptz, now())
                                 ELSE aprovado_em END,
    detalhe               = p_estado->>'detalhe',
    atualizado_em         = now()
  WHERE id = p.id
  RETURNING * INTO p;

  -- Pago: as outras cobrancas em aberto do agendamento deixam de valer
  IF v_status IN ('approved', 'partially_refunded') THEN
    WITH c AS (
      UPDATE public.pagamentos SET status = 'canceled', detalhe = 'pago por outro meio', atualizado_em = now()
       WHERE agendamento_id = p.agendamento_id AND id <> p.id AND status = 'pending'
      RETURNING id, metodo, provedor_pagamento_id, provedor_preferencia_id)
    SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_cancelados FROM c;
  END IF;

  PERFORM public.gerar_lancamentos(p.agendamento_id);
  RETURN jsonb_build_object('pagamento', to_jsonb(p), 'ignorado', false, 'cancelados', v_cancelados);
END;
$$;

-- Notificacao do provedor: registra e diz se deve ser processada
CREATE OR REPLACE FUNCTION public.registrar_evento_pagamento(p_provedor text, p_chave text, p_tipo text, p_recurso_id text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.pagamento_eventos;
BEGIN
  INSERT INTO public.pagamento_eventos (provedor, chave, tipo, recurso_id)
  VALUES (p_provedor, p_chave, p_tipo, p_recurso_id)
  ON CONFLICT (provedor, chave) DO NOTHING
  RETURNING * INTO e;
  IF FOUND THEN
    RETURN jsonb_build_object('processar', true, 'situacao', e.situacao);
  END IF;
  SELECT * INTO e FROM public.pagamento_eventos WHERE provedor = p_provedor AND chave = p_chave;
  -- Ja processado: a notificacao repetida nao faz nada. Com erro: tenta de novo.
  RETURN jsonb_build_object('processar', e.situacao IN ('recebido', 'erro'), 'situacao', e.situacao);
END;
$$;

CREATE OR REPLACE FUNCTION public.concluir_evento_pagamento(p_provedor text, p_chave text, p_situacao text, p_erro text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.pagamento_eventos SET situacao = p_situacao, erro = p_erro, processado_em = now()
   WHERE provedor = p_provedor AND chave = p_chave;
$$;

-- ---------------------------------------------------------------
-- 11. Operacoes do administrador
-- ---------------------------------------------------------------

-- Pagamento feito na barbearia (dinheiro, maquininha, PIX direto).
-- Aprova a cobranca presencial em aberto ou registra uma nova.
CREATE OR REPLACE FUNCTION public.registrar_pagamento_presencial(
  p_agendamento_id uuid,
  p_forma          text,
  p_desconto       numeric DEFAULT 0,
  p_taxa           numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  a public.agendamentos;
  p public.pagamentos;
  v_desconto numeric := coalesce(p_desconto, 0);
  v_taxa numeric := coalesce(p_taxa, 0);
  v_cancelados jsonb;
BEGIN
  PERFORM public.exigir_admin();
  SELECT * INTO a FROM public.agendamentos WHERE id = p_agendamento_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'AGENDAMENTO_NAO_ENCONTRADO', MESSAGE = 'Agendamento não encontrado.';
  END IF;
  IF a.status = 'cancelado' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'AGENDAMENTO_CANCELADO',
      MESSAGE = 'Este agendamento foi cancelado e não pode ser pago.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pagamentos
              WHERE agendamento_id = a.id AND status IN ('approved', 'partially_refunded')) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'JA_PAGO', MESSAGE = 'Este agendamento já está pago.';
  END IF;
  IF p_forma IS NULL OR p_forma NOT IN ('dinheiro', 'cartao_credito', 'cartao_debito', 'pix') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'FORMA_INVALIDA', MESSAGE = 'Forma de pagamento inválida.';
  END IF;
  IF a.preco IS NULL OR v_desconto < 0 OR v_desconto > a.preco THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'DESCONTO_INVALIDO',
      MESSAGE = 'O desconto deve estar entre zero e o preço do serviço.';
  END IF;
  IF v_taxa < 0 OR v_taxa > a.preco - v_desconto THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'TAXA_INVALIDA', MESSAGE = 'Taxa inválida.';
  END IF;

  -- Cobrancas online em aberto deixam de valer
  WITH c AS (
    UPDATE public.pagamentos SET status = 'canceled', detalhe = 'pago na barbearia', atualizado_em = now()
     WHERE agendamento_id = a.id AND status = 'pending' AND metodo <> 'presencial'
    RETURNING id, metodo, provedor_pagamento_id, provedor_preferencia_id)
  SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_cancelados FROM c;

  UPDATE public.pagamentos SET
    status = 'approved', forma_presencial = p_forma, desconto = v_desconto,
    valor = valor_original - v_desconto, taxa = v_taxa,
    registrado_por = auth.uid(), aprovado_em = now(), atualizado_em = now()
  WHERE agendamento_id = a.id AND status = 'pending' AND metodo = 'presencial'
  RETURNING * INTO p;
  IF NOT FOUND THEN
    INSERT INTO public.pagamentos (agendamento_id, cliente_id, metodo, status, valor_original, desconto, valor,
                                   taxa, forma_presencial, registrado_por, aprovado_em)
    VALUES (a.id, a.cliente_id, 'presencial', 'approved', a.preco, v_desconto, a.preco - v_desconto,
            v_taxa, p_forma, auth.uid(), now())
    RETURNING * INTO p;
  END IF;

  PERFORM public.gerar_lancamentos(a.id);
  RETURN jsonb_build_object('pagamento', to_jsonb(p), 'cancelados', v_cancelados);
END;
$$;

-- Reembolso de pagamento presencial (devolvido na barbearia). Reembolso de
-- pagamento online e feito pelo backend, no provedor.
CREATE OR REPLACE FUNCTION public.registrar_reembolso_presencial(p_pagamento_id uuid, p_valor numeric, p_motivo text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento uuid;
  p public.pagamentos;
BEGIN
  PERFORM public.exigir_admin();
  SELECT agendamento_id INTO v_agendamento FROM public.pagamentos WHERE id = p_pagamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'PAGAMENTO_NAO_ENCONTRADO', MESSAGE = 'Pagamento não encontrado.';
  END IF;
  PERFORM 1 FROM public.agendamentos WHERE id = v_agendamento FOR UPDATE;
  SELECT * INTO p FROM public.pagamentos WHERE id = p_pagamento_id FOR UPDATE;
  IF p.metodo <> 'presencial' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PAGAMENTO_ONLINE',
      MESSAGE = 'Pagamentos online são reembolsados pelo provedor de pagamento.';
  END IF;
  IF p.status NOT IN ('approved', 'partially_refunded') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'NAO_REEMBOLSAVEL', MESSAGE = 'Este pagamento não pode ser reembolsado.';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 OR p_valor > p.valor - p.valor_reembolsado THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'VALOR_INVALIDO',
      MESSAGE = format('Informe um valor entre R$ 0,01 e R$ %s.', replace(to_char(p.valor - p.valor_reembolsado, 'FM999999990.00'), '.', ','));
  END IF;

  INSERT INTO public.pagamento_reembolsos (pagamento_id, valor, motivo, registrado_por)
  VALUES (p.id, p_valor, p_motivo, auth.uid());
  UPDATE public.pagamentos SET
    valor_reembolsado = valor_reembolsado + p_valor,
    status = CASE WHEN valor_reembolsado + p_valor >= valor THEN 'refunded' ELSE 'partially_refunded' END::public.pagamento_status,
    atualizado_em = now()
  WHERE id = p.id
  RETURNING * INTO p;

  PERFORM public.gerar_lancamentos(p.agendamento_id);
  RETURN to_jsonb(p);
END;
$$;

-- Comissao: padrao (p_barbeiro_id NULL) ou do barbeiro. NULL em p_percentual
-- remove o percentual proprio (o barbeiro volta ao padrao).
CREATE OR REPLACE FUNCTION public.configurar_comissao(p_barbeiro_id uuid, p_percentual numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  IF p_percentual IS NOT NULL AND (p_percentual < 0 OR p_percentual > 100) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PERCENTUAL_INVALIDO',
      MESSAGE = 'O percentual deve estar entre 0 e 100.';
  END IF;
  IF p_barbeiro_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.barbeiros WHERE id = p_barbeiro_id) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'BARBEIRO_NAO_ENCONTRADO', MESSAGE = 'Barbeiro não encontrado.';
  END IF;

  INSERT INTO public.comissao_alteracoes (barbeiro_id, percentual, alterado_por)
  VALUES (p_barbeiro_id, round(p_percentual, 2), auth.uid());

  -- Servicos concluidos e pagos que esperavam um percentual: geram agora, com o
  -- percentual em vigor neste momento. Os ja gerados nao mudam.
  PERFORM public.gerar_lancamentos(a.id)
     FROM public.agendamentos a
    WHERE a.status = 'concluido'
      AND (p_barbeiro_id IS NULL OR a.barbeiro_id = p_barbeiro_id)
      AND NOT EXISTS (SELECT 1 FROM public.lancamentos_financeiros l WHERE l.agendamento_id = a.id AND l.tipo = 'servico')
      AND EXISTS (SELECT 1 FROM public.pagamentos pg
                   WHERE pg.agendamento_id = a.id AND pg.status IN ('approved', 'partially_refunded', 'refunded'));

  RETURN CASE WHEN p_barbeiro_id IS NULL
              THEN (SELECT percentual FROM public.comissao_alteracoes WHERE barbeiro_id IS NULL ORDER BY id DESC LIMIT 1)
              ELSE public.comissao_vigente(p_barbeiro_id) END;
END;
$$;

-- Pagamento de comissao ao barbeiro, referente a uma semana (segunda-feira).
-- Nunca passa do saldo pendente da semana nem do saldo geral do barbeiro.
CREATE OR REPLACE FUNCTION public.registrar_pagamento_comissao(
  p_barbeiro_id   uuid,
  p_semana_inicio date,
  p_valor         numeric,
  p_metodo        text,
  p_comprovante   text DEFAULT NULL,
  p_observacoes   text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_semana numeric;
  v_geral  numeric;
  v_max    numeric;
  pc public.pagamentos_comissao;
BEGIN
  PERFORM public.exigir_admin();
  -- Serializa os pagamentos do mesmo barbeiro (dois cliques, duas abas)
  PERFORM 1 FROM public.barbeiros WHERE id = p_barbeiro_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'BARBEIRO_NAO_ENCONTRADO', MESSAGE = 'Barbeiro não encontrado.';
  END IF;
  IF p_semana_inicio IS NULL OR extract(isodow FROM p_semana_inicio) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SEMANA_INVALIDA',
      MESSAGE = 'A semana de referência deve começar em uma segunda-feira.';
  END IF;
  IF p_metodo IS NULL OR p_metodo NOT IN ('pix', 'dinheiro', 'transferencia', 'outro') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'METODO_INVALIDO', MESSAGE = 'Método de pagamento inválido.';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'VALOR_INVALIDO', MESSAGE = 'Informe um valor maior que zero.';
  END IF;

  SELECT coalesce(sum(valor_comissao), 0) INTO v_semana FROM public.lancamentos_financeiros
   WHERE barbeiro_id = p_barbeiro_id AND competencia BETWEEN p_semana_inicio AND p_semana_inicio + 6;
  v_semana := v_semana - (SELECT coalesce(sum(valor), 0) FROM public.pagamentos_comissao
                           WHERE barbeiro_id = p_barbeiro_id AND semana_inicio = p_semana_inicio);
  v_geral := (SELECT coalesce(sum(valor_comissao), 0) FROM public.lancamentos_financeiros WHERE barbeiro_id = p_barbeiro_id)
           - (SELECT coalesce(sum(valor), 0) FROM public.pagamentos_comissao WHERE barbeiro_id = p_barbeiro_id);
  v_max := least(v_semana, v_geral);

  IF v_max <= 0 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'SEM_SALDO',
      MESSAGE = 'Não há comissão pendente para este barbeiro nesta semana.';
  END IF;
  IF p_valor > v_max THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'VALOR_ACIMA_DO_SALDO',
      MESSAGE = format('O valor é maior que o saldo pendente (R$ %s).', replace(to_char(v_max, 'FM999999990.00'), '.', ','));
  END IF;

  INSERT INTO public.pagamentos_comissao (barbeiro_id, semana_inicio, valor, metodo, comprovante, observacoes, registrado_por)
  VALUES (p_barbeiro_id, p_semana_inicio, round(p_valor, 2), p_metodo,
          nullif(trim(p_comprovante), ''), nullif(trim(p_observacoes), ''), auth.uid())
  RETURNING * INTO pc;

  RETURN jsonb_build_object('pagamento', to_jsonb(pc),
                            'saldo_semana', v_semana - pc.valor, 'saldo_geral', v_geral - pc.valor);
END;
$$;

-- ---------------------------------------------------------------
-- 12. Consultas do administrador
--     Datas em hora local de Sao Paulo; p_fim inclusivo.
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.financeiro_resumo(
  p_inicio      date,
  p_fim         date,
  p_barbeiro_id uuid DEFAULT NULL,
  p_servico_id  uuid DEFAULT NULL,
  p_status      public.pagamento_status DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso constant text := 'America/Sao_Paulo';
  v_ini timestamptz := p_inicio::timestamp AT TIME ZONE v_fuso;
  v_fim timestamptz := (p_fim + 1)::timestamp AT TIME ZONE v_fuso;
  r jsonb;
BEGIN
  PERFORM public.exigir_admin();
  WITH l AS (
    SELECT * FROM public.lancamentos_financeiros
     WHERE competencia BETWEEN p_inicio AND p_fim
       AND (p_barbeiro_id IS NULL OR barbeiro_id = p_barbeiro_id)
       AND (p_servico_id IS NULL OR servico_id = p_servico_id)
  ), pg AS (
    SELECT p.* FROM public.pagamentos p JOIN public.agendamentos a ON a.id = p.agendamento_id
     WHERE (p_barbeiro_id IS NULL OR a.barbeiro_id = p_barbeiro_id)
       AND (p_servico_id IS NULL OR a.servico_id = p_servico_id)
       AND (p_status IS NULL OR p.status = p_status)
  ), recebidos AS (
    SELECT * FROM pg WHERE status IN ('approved', 'partially_refunded', 'refunded')
       AND aprovado_em >= v_ini AND aprovado_em < v_fim
  ), pendentes AS (
    SELECT * FROM pg WHERE status = 'pending' AND criado_em >= v_ini AND criado_em < v_fim
  ), reembolsos AS (
    SELECT rb.* FROM public.pagamento_reembolsos rb JOIN pg ON pg.id = rb.pagamento_id
     WHERE rb.reembolsado_em >= v_ini AND rb.reembolsado_em < v_fim
  ), pc AS (
    SELECT * FROM public.pagamentos_comissao WHERE p_barbeiro_id IS NULL OR barbeiro_id = p_barbeiro_id
  )
  SELECT jsonb_build_object(
    'servicos',            (SELECT count(*) FILTER (WHERE tipo = 'servico') - count(*) FILTER (WHERE tipo = 'cancelamento') FROM l),
    'faturamento_bruto',   (SELECT coalesce(sum(valor_original), 0) FROM l),
    'descontos',           (SELECT coalesce(sum(desconto), 0) FROM l),
    'faturamento',         (SELECT coalesce(sum(valor_pago), 0) FROM l),
    'comissoes',           (SELECT coalesce(sum(valor_comissao), 0) FROM l),
    'parte_barbearia',     (SELECT coalesce(sum(valor_barbearia), 0) FROM l),
    'taxas_servicos',      (SELECT coalesce(sum(taxa_meio), 0) FROM l),
    'total_recebido',      (SELECT coalesce(sum(valor), 0) FROM recebidos),
    'taxas',               (SELECT coalesce(sum(taxa), 0) FROM recebidos),
    'reembolsos',          (SELECT coalesce(sum(valor), 0) FROM reembolsos),
    'pendentes_valor',     (SELECT coalesce(sum(valor), 0) FROM pendentes),
    'pendentes_quantidade',(SELECT count(*) FROM pendentes),
    'comissoes_pagas',     (SELECT coalesce(sum(valor), 0) FROM pc WHERE pago_em >= v_ini AND pago_em < v_fim),
    'comissoes_pendentes', (SELECT coalesce(sum(valor_comissao), 0) FROM public.lancamentos_financeiros
                             WHERE p_barbeiro_id IS NULL OR barbeiro_id = p_barbeiro_id)
                           - (SELECT coalesce(sum(valor), 0) FROM pc)
  ) INTO r;

  RETURN r || jsonb_build_object(
    'recebido_liquido',  (r->>'total_recebido')::numeric - (r->>'taxas')::numeric - (r->>'reembolsos')::numeric,
    -- Parte da barbearia nos servicos realizados, ja sem as taxas desses
    -- pagamentos. Antes das demais despesas: nao e lucro liquido.
    'receita_barbearia', (r->>'parte_barbearia')::numeric - (r->>'taxas_servicos')::numeric);
END;
$$;

CREATE OR REPLACE FUNCTION public.financeiro_serie(
  p_inicio date, p_fim date, p_barbeiro_id uuid DEFAULT NULL, p_servico_id uuid DEFAULT NULL)
RETURNS TABLE (dia date, faturamento numeric, comissao numeric, barbearia numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  RETURN QUERY
    SELECT l.competencia, sum(l.valor_pago), sum(l.valor_comissao), sum(l.valor_barbearia)
      FROM public.lancamentos_financeiros l
     WHERE l.competencia BETWEEN p_inicio AND p_fim
       AND (p_barbeiro_id IS NULL OR l.barbeiro_id = p_barbeiro_id)
       AND (p_servico_id IS NULL OR l.servico_id = p_servico_id)
     GROUP BY l.competencia
     ORDER BY l.competencia;
END;
$$;

CREATE OR REPLACE FUNCTION public.financeiro_barbeiros(p_inicio date, p_fim date, p_servico_id uuid DEFAULT NULL)
RETURNS TABLE (barbeiro_id uuid, nome text, ativo boolean, percentual numeric, servicos bigint,
               faturamento numeric, comissao numeric, saldo_pendente numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  RETURN QUERY
    SELECT b.id, b.nome, b.ativo, public.comissao_vigente(b.id),
           coalesce(per.servicos, 0), coalesce(per.faturamento, 0), coalesce(per.comissao, 0),
           (SELECT coalesce(sum(l.valor_comissao), 0) FROM public.lancamentos_financeiros l WHERE l.barbeiro_id = b.id)
         - (SELECT coalesce(sum(pc.valor), 0) FROM public.pagamentos_comissao pc WHERE pc.barbeiro_id = b.id)
      FROM public.barbeiros b
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE l.tipo = 'servico') - count(*) FILTER (WHERE l.tipo = 'cancelamento') AS servicos,
               sum(l.valor_pago) AS faturamento, sum(l.valor_comissao) AS comissao
          FROM public.lancamentos_financeiros l
         WHERE l.barbeiro_id = b.id AND l.competencia BETWEEN p_inicio AND p_fim
           AND (p_servico_id IS NULL OR l.servico_id = p_servico_id)
      ) per ON true
     ORDER BY b.nome;
END;
$$;

-- A migration 19 acrescenta colunas: recriar permite rodar esta de novo depois dela
DROP FUNCTION IF EXISTS public.financeiro_pagamentos(date, date, uuid, uuid, public.pagamento_status);
CREATE FUNCTION public.financeiro_pagamentos(
  p_inicio date, p_fim date, p_barbeiro_id uuid DEFAULT NULL, p_servico_id uuid DEFAULT NULL,
  p_status public.pagamento_status DEFAULT NULL)
RETURNS TABLE (id uuid, agendamento_id uuid, data_hora timestamptz, cliente text, barbeiro text, servico text,
               metodo public.pagamento_metodo, status public.pagamento_status, valor numeric, desconto numeric,
               taxa numeric, valor_reembolsado numeric, forma_presencial text, criado_em timestamptz, aprovado_em timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso constant text := 'America/Sao_Paulo';
  v_ini timestamptz := p_inicio::timestamp AT TIME ZONE v_fuso;
  v_fim timestamptz := (p_fim + 1)::timestamp AT TIME ZONE v_fuso;
BEGIN
  PERFORM public.exigir_admin();
  RETURN QUERY
    SELECT p.id, p.agendamento_id, a.data_hora, coalesce(pr.nome, 'Cliente'), b.nome, s.nome,
           p.metodo, p.status, p.valor, p.desconto, p.taxa, p.valor_reembolsado, p.forma_presencial,
           p.criado_em, p.aprovado_em
      FROM public.pagamentos p
      JOIN public.agendamentos a ON a.id = p.agendamento_id
      JOIN public.barbeiros b ON b.id = a.barbeiro_id
      JOIN public.servicos s ON s.id = a.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = p.cliente_id
     WHERE ((p.criado_em >= v_ini AND p.criado_em < v_fim) OR (p.aprovado_em >= v_ini AND p.aprovado_em < v_fim))
       AND (p_barbeiro_id IS NULL OR a.barbeiro_id = p_barbeiro_id)
       AND (p_servico_id IS NULL OR a.servico_id = p_servico_id)
       AND (p_status IS NULL OR p.status = p_status)
     ORDER BY p.criado_em DESC
     LIMIT 300;
END;
$$;

-- Atendimentos do periodo ainda sem pagamento confirmado (a receber na barbearia)
CREATE OR REPLACE FUNCTION public.financeiro_a_receber(p_inicio date, p_fim date)
RETURNS TABLE (agendamento_id uuid, data_hora timestamptz, status public.agendamento_status, cliente text,
               barbeiro text, servico text, preco numeric, metodo_pendente public.pagamento_metodo)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso constant text := 'America/Sao_Paulo';
  v_ini timestamptz := p_inicio::timestamp AT TIME ZONE v_fuso;
  v_fim timestamptz := (p_fim + 1)::timestamp AT TIME ZONE v_fuso;
BEGIN
  PERFORM public.exigir_admin();
  RETURN QUERY
    SELECT a.id, a.data_hora, a.status, coalesce(pr.nome, 'Cliente'), b.nome, s.nome, a.preco,
           (SELECT p.metodo FROM public.pagamentos p WHERE p.agendamento_id = a.id AND p.status = 'pending' LIMIT 1)
      FROM public.agendamentos a
      JOIN public.barbeiros b ON b.id = a.barbeiro_id
      JOIN public.servicos s ON s.id = a.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = a.cliente_id
     WHERE a.status <> 'cancelado'
       AND a.data_hora >= v_ini AND a.data_hora < v_fim
       AND NOT EXISTS (SELECT 1 FROM public.pagamentos p
                        WHERE p.agendamento_id = a.id AND p.status IN ('approved', 'partially_refunded', 'refunded'))
     ORDER BY a.data_hora;
END;
$$;

-- Fechamento semanal (segunda a domingo) por barbeiro
CREATE OR REPLACE FUNCTION public.fechamento_semanal(p_semana_inicio date)
RETURNS TABLE (barbeiro_id uuid, nome text, percentual numeric, servicos bigint, faturamento numeric,
               comissao numeric, pago numeric, pendente numeric, saldo_geral numeric)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  IF p_semana_inicio IS NULL OR extract(isodow FROM p_semana_inicio) <> 1 THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'SEMANA_INVALIDA',
      MESSAGE = 'A semana de referência deve começar em uma segunda-feira.';
  END IF;
  RETURN QUERY
    SELECT b.id, b.nome, public.comissao_vigente(b.id),
           coalesce(w.servicos, 0), coalesce(w.faturamento, 0), coalesce(w.comissao, 0),
           coalesce(pg.pago, 0),
           coalesce(w.comissao, 0) - coalesce(pg.pago, 0),
           (SELECT coalesce(sum(l.valor_comissao), 0) FROM public.lancamentos_financeiros l WHERE l.barbeiro_id = b.id)
         - (SELECT coalesce(sum(pc.valor), 0) FROM public.pagamentos_comissao pc WHERE pc.barbeiro_id = b.id)
      FROM public.barbeiros b
      LEFT JOIN LATERAL (
        SELECT count(*) FILTER (WHERE l.tipo = 'servico') - count(*) FILTER (WHERE l.tipo = 'cancelamento') AS servicos,
               sum(l.valor_pago) AS faturamento, sum(l.valor_comissao) AS comissao
          FROM public.lancamentos_financeiros l
         WHERE l.barbeiro_id = b.id AND l.competencia BETWEEN p_semana_inicio AND p_semana_inicio + 6
      ) w ON true
      LEFT JOIN LATERAL (
        SELECT sum(pc.valor) AS pago FROM public.pagamentos_comissao pc
         WHERE pc.barbeiro_id = b.id AND pc.semana_inicio = p_semana_inicio
      ) pg ON true
     WHERE b.ativo OR w.comissao IS NOT NULL OR pg.pago IS NOT NULL
     ORDER BY b.nome;
END;
$$;

-- Comissoes configuradas (padrao + cada barbeiro) e historico
CREATE OR REPLACE FUNCTION public.comissoes_configuradas()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  RETURN jsonb_build_object(
    'padrao', (SELECT percentual FROM public.comissao_alteracoes WHERE barbeiro_id IS NULL ORDER BY id DESC LIMIT 1),
    'barbeiros', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'barbeiro_id', b.id, 'nome', b.nome, 'ativo', b.ativo,
               'proprio', (SELECT c.percentual FROM public.comissao_alteracoes c WHERE c.barbeiro_id = b.id ORDER BY c.id DESC LIMIT 1),
               'vigente', public.comissao_vigente(b.id)) ORDER BY b.nome)
        FROM public.barbeiros b), '[]'::jsonb),
    'historico', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', c.id, 'barbeiro', coalesce(b.nome, 'Padrão da barbearia'), 'percentual', c.percentual,
               'alterado_em', c.alterado_em, 'alterado_por', coalesce(pr.nome, 'Administrador')) ORDER BY c.id DESC)
        FROM public.comissao_alteracoes c
        LEFT JOIN public.barbeiros b ON b.id = c.barbeiro_id
        LEFT JOIN public.profiles pr ON pr.user_id = c.alterado_por), '[]'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.comissao_pagamentos_lista(p_barbeiro_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, barbeiro_id uuid, barbeiro text, semana_inicio date, valor numeric, metodo text,
               comprovante text, observacoes text, registrado_por text, pago_em timestamptz)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  RETURN QUERY
    SELECT pc.id, pc.barbeiro_id, b.nome, pc.semana_inicio, pc.valor, pc.metodo, pc.comprovante, pc.observacoes,
           coalesce(pr.nome, 'Administrador'), pc.pago_em
      FROM public.pagamentos_comissao pc
      JOIN public.barbeiros b ON b.id = pc.barbeiro_id
      LEFT JOIN public.profiles pr ON pr.user_id = pc.registrado_por
     WHERE p_barbeiro_id IS NULL OR pc.barbeiro_id = p_barbeiro_id
     ORDER BY pc.pago_em DESC
     LIMIT 300;
END;
$$;

-- ---------------------------------------------------------------
-- 13. Financeiro do proprio barbeiro (so os dados dele)
-- ---------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.meu_financeiro(p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso constant text := 'America/Sao_Paulo';
  v_ini timestamptz := p_inicio::timestamp AT TIME ZONE v_fuso;
  v_fim timestamptz := (p_fim + 1)::timestamp AT TIME ZONE v_fuso;
  v_barbeiro uuid := public.meu_barbeiro_id();
BEGIN
  IF v_barbeiro IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', DETAIL = 'SEM_PERMISSAO',
      MESSAGE = 'Esta área é exclusiva dos barbeiros.';
  END IF;
  RETURN jsonb_build_object(
    'percentual', public.comissao_vigente(v_barbeiro),
    'servicos', (SELECT count(*) FILTER (WHERE tipo = 'servico') - count(*) FILTER (WHERE tipo = 'cancelamento')
                   FROM public.lancamentos_financeiros
                  WHERE barbeiro_id = v_barbeiro AND competencia BETWEEN p_inicio AND p_fim),
    'faturamento', (SELECT coalesce(sum(valor_pago), 0) FROM public.lancamentos_financeiros
                     WHERE barbeiro_id = v_barbeiro AND competencia BETWEEN p_inicio AND p_fim),
    'comissao', (SELECT coalesce(sum(valor_comissao), 0) FROM public.lancamentos_financeiros
                  WHERE barbeiro_id = v_barbeiro AND competencia BETWEEN p_inicio AND p_fim),
    'recebido', (SELECT coalesce(sum(valor), 0) FROM public.pagamentos_comissao
                  WHERE barbeiro_id = v_barbeiro AND pago_em >= v_ini AND pago_em < v_fim),
    'comissao_total', (SELECT coalesce(sum(valor_comissao), 0) FROM public.lancamentos_financeiros WHERE barbeiro_id = v_barbeiro),
    'recebido_total', (SELECT coalesce(sum(valor), 0) FROM public.pagamentos_comissao WHERE barbeiro_id = v_barbeiro),
    'lancamentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', l.id, 'tipo', l.tipo, 'competencia', l.competencia, 'servico', s.nome,
               'valor_pago', l.valor_pago, 'percentual', l.percentual_comissao, 'comissao', l.valor_comissao)
               ORDER BY l.competencia DESC, l.id DESC)
        FROM public.lancamentos_financeiros l JOIN public.servicos s ON s.id = l.servico_id
       WHERE l.barbeiro_id = v_barbeiro AND l.competencia BETWEEN p_inicio AND p_fim), '[]'::jsonb),
    'pagamentos', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
               'id', pc.id, 'semana_inicio', pc.semana_inicio, 'valor', pc.valor, 'metodo', pc.metodo,
               'comprovante', pc.comprovante, 'observacoes', pc.observacoes, 'pago_em', pc.pago_em)
               ORDER BY pc.pago_em DESC)
        FROM public.pagamentos_comissao pc WHERE pc.barbeiro_id = v_barbeiro), '[]'::jsonb));
END;
$$;

-- ---------------------------------------------------------------
-- 14. Acesso (RLS). Escrita so por funcoes e pelo backend.
-- ---------------------------------------------------------------
ALTER TABLE public.comissao_alteracoes      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamentos               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamento_reembolsos     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamento_eventos        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lancamentos_financeiros  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pagamentos_comissao      ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Cliente le seus pagamentos" ON public.pagamentos;
CREATE POLICY "Cliente le seus pagamentos" ON public.pagamentos
  FOR SELECT TO authenticated USING (cliente_id = auth.uid());
DROP POLICY IF EXISTS "Admin le pagamentos" ON public.pagamentos;
CREATE POLICY "Admin le pagamentos" ON public.pagamentos
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin le reembolsos" ON public.pagamento_reembolsos;
CREATE POLICY "Admin le reembolsos" ON public.pagamento_reembolsos
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Admin le comissoes" ON public.comissao_alteracoes;
CREATE POLICY "Admin le comissoes" ON public.comissao_alteracoes
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Barbeiro le sua comissao" ON public.comissao_alteracoes;
CREATE POLICY "Barbeiro le sua comissao" ON public.comissao_alteracoes
  FOR SELECT TO authenticated USING (barbeiro_id = public.meu_barbeiro_id());

DROP POLICY IF EXISTS "Admin le lancamentos" ON public.lancamentos_financeiros;
CREATE POLICY "Admin le lancamentos" ON public.lancamentos_financeiros
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Barbeiro le seus lancamentos" ON public.lancamentos_financeiros;
CREATE POLICY "Barbeiro le seus lancamentos" ON public.lancamentos_financeiros
  FOR SELECT TO authenticated USING (barbeiro_id = public.meu_barbeiro_id());

DROP POLICY IF EXISTS "Admin le pagamentos de comissao" ON public.pagamentos_comissao;
CREATE POLICY "Admin le pagamentos de comissao" ON public.pagamentos_comissao
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS "Barbeiro le seus pagamentos de comissao" ON public.pagamentos_comissao;
CREATE POLICY "Barbeiro le seus pagamentos de comissao" ON public.pagamentos_comissao
  FOR SELECT TO authenticated USING (barbeiro_id = public.meu_barbeiro_id());

REVOKE INSERT, UPDATE, DELETE ON
  public.comissao_alteracoes, public.pagamentos, public.pagamento_reembolsos, public.pagamento_eventos,
  public.lancamentos_financeiros, public.pagamentos_comissao
FROM anon, authenticated;

-- Funcoes so do backend (service role) ou internas
REVOKE ALL ON FUNCTION public.iniciar_pagamento(uuid, uuid, public.pagamento_metodo) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_cobranca(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.falhar_cobranca(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pagamento_para_sincronizar(uuid, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.aplicar_estado_pagamento(uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_evento_pagamento(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.concluir_evento_pagamento(text, text, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.gerar_lancamentos(uuid) FROM PUBLIC, anon, authenticated;

-- Funcoes dos apps (cada uma confere o perfil de quem chama)
REVOKE ALL ON FUNCTION public.registrar_pagamento_presencial(uuid, text, numeric, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_presencial(uuid, text, numeric, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_reembolso_presencial(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_reembolso_presencial(uuid, numeric, text) TO authenticated;
REVOKE ALL ON FUNCTION public.configurar_comissao(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.configurar_comissao(uuid, numeric) TO authenticated;
REVOKE ALL ON FUNCTION public.registrar_pagamento_comissao(uuid, date, numeric, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.registrar_pagamento_comissao(uuid, date, numeric, text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.financeiro_resumo(date, date, uuid, uuid, public.pagamento_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_resumo(date, date, uuid, uuid, public.pagamento_status) TO authenticated;
REVOKE ALL ON FUNCTION public.financeiro_serie(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_serie(date, date, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.financeiro_barbeiros(date, date, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_barbeiros(date, date, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.financeiro_pagamentos(date, date, uuid, uuid, public.pagamento_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_pagamentos(date, date, uuid, uuid, public.pagamento_status) TO authenticated;
REVOKE ALL ON FUNCTION public.financeiro_a_receber(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_a_receber(date, date) TO authenticated;
REVOKE ALL ON FUNCTION public.fechamento_semanal(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fechamento_semanal(date) TO authenticated;
REVOKE ALL ON FUNCTION public.comissoes_configuradas() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comissoes_configuradas() TO authenticated;
REVOKE ALL ON FUNCTION public.comissao_pagamentos_lista(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.comissao_pagamentos_lista(uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.meu_financeiro(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_financeiro(date, date) TO authenticated;
