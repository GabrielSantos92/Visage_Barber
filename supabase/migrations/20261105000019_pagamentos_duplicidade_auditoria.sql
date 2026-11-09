-- =====================================================================
-- Pagamentos em duplicidade, cancelamento no provedor e historico auditavel
--
-- Complementa a 20261105000018_financeiro.sql (rode depois dela):
--   * Um segundo pagamento aprovado para o mesmo agendamento (ex.: o cliente
--     pagou o PIX e tambem o cartao, ou pagou duas vezes na pagina do cartao)
--     fica registrado com o proprio valor e marcado como duplicidade do
--     pagamento que quitou o atendimento. Entra no total recebido (o dinheiro
--     entrou), nao gera comissao e fica destacado para o admin devolver.
--     Nada e devolvido automaticamente.
--   * O pagamento que quitou o atendimento so pode ser reembolsado depois que
--     a duplicidade for devolvida: evita devolver o pagamento errado.
--   * Cobranca online cancelada aqui (troca de meio, paga por outro meio, paga
--     na barbearia) fica marcada ate o backend confirmar o cancelamento no
--     Mercado Pago.
--   * Toda operacao em um pagamento entra em um historico que nao pode ser
--     alterado: o que mudou, quando, por quem e por qual origem.
--
-- Seguro para re-executar. Execute no Supabase Dashboard > SQL Editor
-- =====================================================================

-- ---------------------------------------------------------------
-- 1. Novas colunas
-- ---------------------------------------------------------------
-- Pagamento aprovado em duplicidade: aponta para o pagamento que quitou o atendimento
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS duplicidade_de uuid REFERENCES public.pagamentos(id);
-- Cobranca online cancelada aqui: pendente/confirmado/falhou no provedor
ALTER TABLE public.pagamentos ADD COLUMN IF NOT EXISTS cancelamento_provedor text;

DO $$ BEGIN
  ALTER TABLE public.pagamentos ADD CONSTRAINT pagamentos_cancelamento_provedor
    CHECK (cancelamento_provedor IN ('pendente', 'confirmado', 'falhou'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.pagamentos ADD CONSTRAINT pagamentos_duplicidade_propria CHECK (duplicidade_de <> id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS pagamentos_duplicidade_idx ON public.pagamentos (duplicidade_de) WHERE duplicidade_de IS NOT NULL;

-- ---------------------------------------------------------------
-- 2. Historico das operacoes (so cresce; nao pode ser alterado)
-- ---------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pagamento_auditoria (
  id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  pagamento_id    uuid NOT NULL REFERENCES public.pagamentos(id) ON DELETE RESTRICT,
  agendamento_id  uuid NOT NULL REFERENCES public.agendamentos(id) ON DELETE RESTRICT,
  evento          text NOT NULL CHECK (evento IN ('criado', 'cobranca_gerada', 'status', 'reembolso', 'duplicidade',
                                                  'cancelamento_provedor', 'reembolso_solicitado', 'reembolso_falhou')),
  status_anterior public.pagamento_status,
  status_novo     public.pagamento_status,
  valor           numeric(10,2),
  detalhe         text,
  -- cliente: pedido do cliente; admin: operacao do administrador;
  -- provedor: estado confirmado na API do Mercado Pago; sistema: consequencia automatica
  origem          text NOT NULL CHECK (origem IN ('cliente', 'admin', 'provedor', 'sistema')),
  ator            uuid,
  registrado_em   timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS pagamento_auditoria_agendamento_idx ON public.pagamento_auditoria (agendamento_id, id);
CREATE INDEX IF NOT EXISTS pagamento_auditoria_pagamento_idx ON public.pagamento_auditoria (pagamento_id, id);

DROP TRIGGER IF EXISTS pagamento_auditoria_imutavel ON public.pagamento_auditoria;
CREATE TRIGGER pagamento_auditoria_imutavel BEFORE UPDATE ON public.pagamento_auditoria
  FOR EACH ROW EXECUTE FUNCTION public.financeiro_imutavel();

-- Grava um evento. Quem opera: o usuario logado (admin pelo app) ou o que o
-- backend informou na mesma transacao (visage.origem / visage.ator).
CREATE OR REPLACE FUNCTION public.auditar_pagamento_evento(
  p_pagamento_id   uuid,
  p_agendamento_id uuid,
  p_evento         text,
  p_anterior       public.pagamento_status,
  p_novo           public.pagamento_status,
  p_valor          numeric,
  p_detalhe        text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  INSERT INTO public.pagamento_auditoria
    (pagamento_id, agendamento_id, evento, status_anterior, status_novo, valor, detalhe, origem, ator)
  VALUES (
    p_pagamento_id, p_agendamento_id, p_evento, p_anterior, p_novo, p_valor, nullif(p_detalhe, ''),
    coalesce(nullif(current_setting('visage.origem', true), ''),
             CASE WHEN v_uid IS NULL THEN 'sistema'
                  WHEN public.has_role(v_uid, 'admin') THEN 'admin'
                  ELSE 'cliente' END),
    coalesce(v_uid, nullif(current_setting('visage.ator', true), '')::uuid));
END;
$$;

-- Cada mudanca relevante em um pagamento vira um evento, qualquer que seja o caminho
CREATE OR REPLACE FUNCTION public.auditar_pagamento()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.auditar_pagamento_evento(NEW.id, NEW.agendamento_id, 'criado', NULL, NEW.status, NEW.valor,
      concat_ws(' · ', NEW.metodo::text, NEW.forma_presencial, NEW.detalhe));
    IF NEW.duplicidade_de IS NOT NULL THEN
      PERFORM public.auditar_pagamento_evento(NEW.id, NEW.agendamento_id, 'duplicidade', NULL, NEW.status,
        NEW.valor - NEW.valor_reembolsado, 'atendimento já quitado pelo pagamento ' || NEW.duplicidade_de);
    END IF;
    RETURN NULL;
  END IF;

  IF (OLD.pix_copia_cola IS NULL AND NEW.pix_copia_cola IS NOT NULL)
     OR (OLD.link_pagamento IS NULL AND NEW.link_pagamento IS NOT NULL) THEN
    PERFORM public.auditar_pagamento_evento(NEW.id, NEW.agendamento_id, 'cobranca_gerada', NULL, NEW.status, NEW.valor,
      'Mercado Pago ' || coalesce(NEW.provedor_pagamento_id, NEW.provedor_preferencia_id, ''));
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.auditar_pagamento_evento(NEW.id, NEW.agendamento_id, 'status', OLD.status, NEW.status, NEW.valor,
      concat_ws(' · ', NEW.detalhe, NEW.forma_presencial,
                CASE WHEN NEW.desconto > 0 THEN 'desconto ' || NEW.desconto END,
                'id ' || NEW.provedor_pagamento_id));
  END IF;
  IF NEW.valor_reembolsado > OLD.valor_reembolsado THEN
    PERFORM public.auditar_pagamento_evento(NEW.id, NEW.agendamento_id, 'reembolso', OLD.status, NEW.status,
      NEW.valor_reembolsado - OLD.valor_reembolsado, NULL);
  END IF;
  IF NEW.duplicidade_de IS NOT NULL AND OLD.duplicidade_de IS NULL THEN
    PERFORM public.auditar_pagamento_evento(NEW.id, NEW.agendamento_id, 'duplicidade', NULL, NEW.status,
      NEW.valor - NEW.valor_reembolsado, 'atendimento já quitado pelo pagamento ' || NEW.duplicidade_de);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS pagamento_auditar ON public.pagamentos;
CREATE TRIGGER pagamento_auditar
  AFTER INSERT OR UPDATE ON public.pagamentos
  FOR EACH ROW EXECUTE FUNCTION public.auditar_pagamento();

-- ---------------------------------------------------------------
-- 3. Dados anteriores: mais de um pagamento com dinheiro recebido no mesmo
--    agendamento. Fica como principal o que ja esta no lancamento do servico;
--    sem lancamento, o primeiro aprovado. Os demais viram duplicidade (o
--    historico registra a marcacao). Re-executar nao muda mais nada.
-- ---------------------------------------------------------------
WITH pagos AS (
  SELECT p.id, p.agendamento_id,
         row_number() OVER (PARTITION BY p.agendamento_id
                            ORDER BY (l.id IS NULL), p.aprovado_em NULLS LAST, p.criado_em) AS ordem
    FROM public.pagamentos p
    LEFT JOIN public.lancamentos_financeiros l ON l.pagamento_id = p.id AND l.tipo = 'servico'
   WHERE p.status IN ('approved', 'partially_refunded') AND p.duplicidade_de IS NULL
)
UPDATE public.pagamentos d
   SET duplicidade_de = principal.id
  FROM pagos x
  JOIN pagos principal ON principal.agendamento_id = x.agendamento_id AND principal.ordem = 1
 WHERE d.id = x.id AND x.ordem > 1;

-- ---------------------------------------------------------------
-- 4. Lancamentos: o servico usa o pagamento que quitou o atendimento, nunca
--    uma duplicidade (o resto da funcao e igual ao da migration 18)
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

  -- O pagamento que vale para o servico: o que quitou o atendimento (nunca uma
  -- duplicidade), preferindo o que nao foi devolvido por inteiro
  SELECT * INTO p FROM public.pagamentos
   WHERE agendamento_id = a.id AND status IN ('approved', 'partially_refunded', 'refunded')
     AND duplicidade_de IS NULL
   ORDER BY (status = 'refunded'), aprovado_em NULLS LAST, criado_em
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

-- ---------------------------------------------------------------
-- 5. Ciclo do pagamento (backend)
-- ---------------------------------------------------------------

-- Igual a da migration 18, mais: registra quem pediu, marca a cobranca
-- substituida para o backend cancelar no provedor e nao abre cobranca de
-- atendimento ja contabilizado e devolvido (o novo valor ficaria fora do financeiro)
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
  PERFORM set_config('visage.origem', 'cliente', true);
  PERFORM set_config('visage.ator', coalesce(p_cliente_id::text, ''), true);

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
  IF EXISTS (SELECT 1 FROM public.lancamentos_financeiros WHERE agendamento_id = a.id AND tipo = 'servico') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'JA_REEMBOLSADO',
      MESSAGE = 'O pagamento deste atendimento foi devolvido. Fale com a barbearia.';
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
    UPDATE public.pagamentos SET
      status = 'canceled', detalhe = 'substituido', atualizado_em = now(),
      cancelamento_provedor = CASE WHEN coalesce(provedor_pagamento_id, provedor_preferencia_id) IS NOT NULL THEN 'pendente' END
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

-- Aplica o estado confirmado pelo provedor (consultado pelo backend na API do
-- provedor, nunca o que o app informou). Idempotente. Diferencas para a 18:
--   * pagamento do provedor que ja tem registro proprio atualiza esse registro
--   * segundo pagamento aprovado na mesma cobranca vira um registro proprio
--   * cobranca cancelada aqui so volta a valer se o provedor disser que foi paga
--   * aprovado com o atendimento ja quitado por outro pagamento: duplicidade
--   * reembolso pedido pelo admin guarda o motivo e quem pediu
CREATE OR REPLACE FUNCTION public.aplicar_estado_pagamento(p_pagamento_id uuid, p_estado jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento uuid;
  p public.pagamentos;
  v_outro public.pagamentos;
  v_status   public.pagamento_status := (p_estado->>'status')::public.pagamento_status;
  v_id       text := p_estado->>'provedor_pagamento_id';
  v_valor    numeric := (p_estado->>'valor')::numeric;
  v_pago     boolean;
  v_reemb    numeric;
  v_principal uuid;
  v_cancelados jsonb := '[]'::jsonb;
  -- Prioridade dos estados entre tentativas diferentes da mesma cobranca
  v_prio_novo  int;
  v_prio_atual int;
BEGIN
  -- Estado confirmado pelo provedor; quem pediu a consulta (admin) fica no historico
  PERFORM set_config('visage.origem', 'provedor', true);
  PERFORM set_config('visage.ator', coalesce(p_estado->>'ator', ''), true);
  v_pago := v_status IN ('approved', 'partially_refunded', 'refunded');

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

  -- Pagamento do provedor com registro proprio (segundo pagamento da mesma
  -- cobranca, guardado antes como duplicidade): atualiza esse registro
  IF p.provedor_pagamento_id IS DISTINCT FROM v_id THEN
    SELECT * INTO v_outro FROM public.pagamentos
     WHERE provedor = p.provedor AND provedor_pagamento_id = v_id
       FOR UPDATE;
    IF FOUND THEN
      IF v_outro.agendamento_id <> p.agendamento_id THEN
        RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'REFERENCIA_DIVERGENTE',
          MESSAGE = 'O pagamento do provedor não corresponde a esta cobrança.';
      END IF;
      p := v_outro;
    END IF;
  END IF;

  -- Cobranca ja cancelada aqui (trocada ou paga por outro meio): so volta a
  -- valer se o provedor confirmar que ela foi paga mesmo assim
  IF p.status = 'canceled' AND NOT v_pago THEN
    RETURN jsonb_build_object('pagamento', to_jsonb(p), 'ignorado', true, 'cancelados', '[]'::jsonb, 'duplicado', false);
  END IF;

  IF p.provedor_pagamento_id IS NOT NULL AND p.provedor_pagamento_id <> v_id THEN
    IF v_pago AND p.status IN ('approved', 'partially_refunded', 'refunded') THEN
      -- Segundo pagamento aprovado na mesma cobranca (ex.: pagou duas vezes na
      -- pagina do cartao): registro proprio, para nao perder o valor recebido
      INSERT INTO public.pagamentos (agendamento_id, cliente_id, metodo, status, valor_original, desconto, valor,
                                     provedor, provedor_pagamento_id, provedor_preferencia_id, detalhe)
      VALUES (p.agendamento_id, p.cliente_id, p.metodo, v_status, p.valor_original, p.desconto, p.valor,
              p.provedor, v_id, p.provedor_preferencia_id, 'segundo pagamento da mesma cobrança')
      RETURNING * INTO p;
    ELSE
      -- Outra tentativa da mesma cobranca (ex.: cartao recusado e depois
      -- aprovado na mesma pagina): so substitui se o estado novo for "melhor"
      v_prio_novo  := CASE WHEN v_pago THEN 3 WHEN v_status = 'pending' THEN 2 ELSE 1 END;
      v_prio_atual := CASE WHEN p.status IN ('approved', 'partially_refunded', 'refunded') THEN 3
                           WHEN p.status = 'pending' THEN 2 ELSE 1 END;
      IF v_prio_novo < v_prio_atual THEN
        RETURN jsonb_build_object('pagamento', to_jsonb(p), 'ignorado', true, 'cancelados', '[]'::jsonb, 'duplicado', false);
      END IF;
    END IF;
  END IF;

  -- Reembolsos informados pelo provedor; o pedido pelo admin leva motivo e autor
  INSERT INTO public.pagamento_reembolsos (pagamento_id, valor, provedor_reembolso_id, reembolsado_em, motivo, registrado_por)
  SELECT p.id, (r->>'valor')::numeric, r->>'id', coalesce((r->>'data')::timestamptz, now()),
         CASE WHEN r->>'id' = p_estado->'solicitacao'->>'id' THEN nullif(p_estado->'solicitacao'->>'motivo', '') END,
         CASE WHEN r->>'id' = p_estado->'solicitacao'->>'id' THEN nullif(p_estado->'solicitacao'->>'ator', '')::uuid END
    FROM jsonb_array_elements(coalesce(p_estado->'reembolsos', '[]'::jsonb)) r
  ON CONFLICT (pagamento_id, provedor_reembolso_id) DO NOTHING;

  SELECT greatest(coalesce((p_estado->>'valor_reembolsado')::numeric, 0), coalesce(sum(valor), 0))
    INTO v_reemb FROM public.pagamento_reembolsos WHERE pagamento_id = p.id;

  UPDATE public.pagamentos SET
    status                = v_status,
    provedor_pagamento_id = v_id,
    taxa                  = coalesce((p_estado->>'taxa')::numeric, taxa),
    valor_reembolsado     = least(v_reemb, valor),
    aprovado_em           = CASE WHEN v_pago
                                 THEN coalesce(aprovado_em, (p_estado->>'aprovado_em')::timestamptz, now())
                                 ELSE aprovado_em END,
    detalhe               = p_estado->>'detalhe',
    atualizado_em         = now()
  WHERE id = p.id
  RETURNING * INTO p;

  -- Pago com o atendimento ja quitado por outro pagamento: duplicidade. O
  -- valor fica registrado (entrou na conta), sem comissao, para o admin devolver.
  IF v_pago AND p.duplicidade_de IS NULL THEN
    SELECT o.id INTO v_principal FROM public.pagamentos o
     WHERE o.agendamento_id = p.agendamento_id AND o.id <> p.id AND o.duplicidade_de IS NULL
       AND o.status IN ('approved', 'partially_refunded')
     ORDER BY o.aprovado_em NULLS LAST, o.criado_em
     LIMIT 1;
    IF FOUND THEN
      UPDATE public.pagamentos SET duplicidade_de = v_principal, atualizado_em = now()
       WHERE id = p.id
      RETURNING * INTO p;
    END IF;
  END IF;

  -- Pago: as outras cobrancas em aberto do agendamento deixam de valer
  IF v_status IN ('approved', 'partially_refunded') THEN
    PERFORM set_config('visage.origem', 'sistema', true);
    WITH c AS (
      UPDATE public.pagamentos SET
        status = 'canceled', detalhe = 'pago por outro meio', atualizado_em = now(),
        cancelamento_provedor = CASE WHEN coalesce(provedor_pagamento_id, provedor_preferencia_id) IS NOT NULL THEN 'pendente' END
       WHERE agendamento_id = p.agendamento_id AND id <> p.id AND status = 'pending'
      RETURNING id, metodo, provedor_pagamento_id, provedor_preferencia_id)
    SELECT coalesce(jsonb_agg(to_jsonb(c)), '[]'::jsonb) INTO v_cancelados FROM c;
  END IF;

  PERFORM public.gerar_lancamentos(p.agendamento_id);
  RETURN jsonb_build_object('pagamento', to_jsonb(p), 'ignorado', false, 'cancelados', v_cancelados,
                            'duplicado', p.duplicidade_de IS NOT NULL);
END;
$$;

-- Resultado do cancelamento no provedor de uma cobranca cancelada aqui
CREATE OR REPLACE FUNCTION public.confirmar_cancelamento_provedor(p_pagamento_id uuid, p_ok boolean, p_erro text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.pagamentos;
BEGIN
  PERFORM set_config('visage.origem', 'sistema', true);
  UPDATE public.pagamentos SET
    cancelamento_provedor = CASE WHEN p_ok THEN 'confirmado' ELSE 'falhou' END,
    atualizado_em = now()
   WHERE id = p_pagamento_id AND status = 'canceled' AND cancelamento_provedor IS DISTINCT FROM 'confirmado'
  RETURNING * INTO p;
  IF FOUND THEN
    PERFORM public.auditar_pagamento_evento(p.id, p.agendamento_id, 'cancelamento_provedor', p.status, p.status, NULL,
      CASE WHEN p_ok THEN 'cancelada no Mercado Pago'
           ELSE concat_ws(': ', 'não foi possível cancelar no Mercado Pago', left(p_erro, 300)) END);
  END IF;
END;
$$;

-- Cobrancas canceladas aqui que ainda podem ser pagas no provedor (cancelamento
-- pendente ou que falhou, e ainda dentro do prazo)
CREATE OR REPLACE FUNCTION public.cobrancas_abertas_no_provedor(p_agendamento_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'metodo', metodo,
           'provedor_pagamento_id', provedor_pagamento_id,
           'provedor_preferencia_id', provedor_preferencia_id) ORDER BY criado_em), '[]'::jsonb)
    FROM public.pagamentos
   WHERE status = 'canceled' AND cancelamento_provedor IN ('pendente', 'falhou')
     AND (expira_em IS NULL OR expira_em > now())
     AND (p_agendamento_id IS NULL OR agendamento_id = p_agendamento_id);
$$;

-- Reembolso online pedido pelo admin (backend): confere tudo antes de chamar o
-- provedor e registra o pedido no historico, com motivo e autor
CREATE OR REPLACE FUNCTION public.preparar_reembolso(p_pagamento_id uuid, p_valor numeric, p_ator uuid, p_motivo text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_agendamento uuid;
  p public.pagamentos;
  v_restante numeric;
  v_valor numeric;
BEGIN
  PERFORM set_config('visage.origem', 'admin', true);
  PERFORM set_config('visage.ator', coalesce(p_ator::text, ''), true);

  SELECT agendamento_id INTO v_agendamento FROM public.pagamentos WHERE id = p_pagamento_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT404', DETAIL = 'PAGAMENTO_NAO_ENCONTRADO', MESSAGE = 'Pagamento não encontrado.';
  END IF;
  PERFORM 1 FROM public.agendamentos WHERE id = v_agendamento FOR UPDATE;
  SELECT * INTO p FROM public.pagamentos WHERE id = p_pagamento_id FOR UPDATE;

  IF p.metodo = 'presencial' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PAGAMENTO_PRESENCIAL',
      MESSAGE = 'Pagamentos feitos na barbearia são reembolsados pelo registro presencial.';
  END IF;
  IF p.status NOT IN ('approved', 'partially_refunded') OR p.provedor_pagamento_id IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'NAO_REEMBOLSAVEL', MESSAGE = 'Este pagamento não pode ser reembolsado.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pagamentos d WHERE d.duplicidade_de = p.id AND d.status IN ('approved', 'partially_refunded')) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'DUPLICIDADE_PENDENTE',
      MESSAGE = 'Este atendimento tem um pagamento em duplicidade. Devolva primeiro a cobrança duplicada.';
  END IF;

  v_restante := p.valor - p.valor_reembolsado;
  v_valor := coalesce(round(p_valor, 2), v_restante);
  IF v_valor <= 0 OR v_valor > v_restante THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'VALOR_INVALIDO',
      MESSAGE = format('Informe um valor entre R$ 0,01 e R$ %s.', replace(to_char(v_restante, 'FM999999990.00'), '.', ','));
  END IF;

  PERFORM public.auditar_pagamento_evento(p.id, p.agendamento_id, 'reembolso_solicitado', p.status, p.status, v_valor,
    nullif(trim(p_motivo), ''));
  RETURN jsonb_build_object('pagamento', to_jsonb(p), 'valor', v_valor,
                            'total', v_valor = v_restante AND p.valor_reembolsado = 0);
END;
$$;

-- O provedor nao confirmou o reembolso pedido pelo admin
CREATE OR REPLACE FUNCTION public.registrar_falha_reembolso(p_pagamento_id uuid, p_ator uuid, p_erro text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  p public.pagamentos;
BEGIN
  PERFORM set_config('visage.origem', 'admin', true);
  PERFORM set_config('visage.ator', coalesce(p_ator::text, ''), true);
  SELECT * INTO p FROM public.pagamentos WHERE id = p_pagamento_id;
  IF FOUND THEN
    PERFORM public.auditar_pagamento_evento(p.id, p.agendamento_id, 'reembolso_falhou', p.status, p.status, NULL, left(p_erro, 300));
  END IF;
END;
$$;

-- ---------------------------------------------------------------
-- 6. Operacoes do administrador
-- ---------------------------------------------------------------

-- Igual a da migration 18, mais: as cobrancas online que deixam de valer ficam
-- marcadas para o backend cancelar no provedor, e atendimento ja contabilizado
-- e devolvido nao recebe novo pagamento
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
  IF EXISTS (SELECT 1 FROM public.lancamentos_financeiros WHERE agendamento_id = a.id AND tipo = 'servico') THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'JA_REEMBOLSADO',
      MESSAGE = 'O pagamento deste atendimento já foi contabilizado e devolvido.';
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

  -- Cobrancas online em aberto deixam de valer (e precisam ser canceladas no provedor)
  WITH c AS (
    UPDATE public.pagamentos SET
      status = 'canceled', detalhe = 'pago na barbearia', atualizado_em = now(),
      cancelamento_provedor = CASE WHEN coalesce(provedor_pagamento_id, provedor_preferencia_id) IS NOT NULL THEN 'pendente' END
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

-- Igual a da migration 18, mais: com duplicidade pendente, devolve-se primeiro a duplicada
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
  IF EXISTS (SELECT 1 FROM public.pagamentos d WHERE d.duplicidade_de = p.id AND d.status IN ('approved', 'partially_refunded')) THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', DETAIL = 'DUPLICIDADE_PENDENTE',
      MESSAGE = 'Este atendimento tem um pagamento em duplicidade. Devolva primeiro a cobrança duplicada.';
  END IF;
  IF p_valor IS NULL OR p_valor <= 0 OR p_valor > p.valor - p.valor_reembolsado THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'VALOR_INVALIDO',
      MESSAGE = format('Informe um valor entre R$ 0,01 e R$ %s.', replace(to_char(p.valor - p.valor_reembolsado, 'FM999999990.00'), '.', ','));
  END IF;

  INSERT INTO public.pagamento_reembolsos (pagamento_id, valor, motivo, registrado_por)
  VALUES (p.id, p_valor, nullif(trim(p_motivo), ''), auth.uid());
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

-- ---------------------------------------------------------------
-- 7. Consultas do administrador
-- ---------------------------------------------------------------

-- Igual a da migration 18, mais o que esta pendente de devolver (duplicidades)
-- e as cobrancas canceladas aqui que ainda podem ser pagas no provedor. Esses
-- dois sao a situacao de hoje, como o saldo de comissoes: nao dependem do periodo.
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
  ), base AS (
    SELECT p.* FROM public.pagamentos p JOIN public.agendamentos a ON a.id = p.agendamento_id
     WHERE (p_barbeiro_id IS NULL OR a.barbeiro_id = p_barbeiro_id)
       AND (p_servico_id IS NULL OR a.servico_id = p_servico_id)
  ), pg AS (
    SELECT * FROM base WHERE p_status IS NULL OR status = p_status
  ), recebidos AS (
    SELECT * FROM pg WHERE status IN ('approved', 'partially_refunded', 'refunded')
       AND aprovado_em >= v_ini AND aprovado_em < v_fim
  ), pendentes AS (
    SELECT * FROM pg WHERE status = 'pending' AND criado_em >= v_ini AND criado_em < v_fim
  ), reembolsos AS (
    SELECT rb.* FROM public.pagamento_reembolsos rb JOIN pg ON pg.id = rb.pagamento_id
     WHERE rb.reembolsado_em >= v_ini AND rb.reembolsado_em < v_fim
  ), duplicados AS (
    SELECT * FROM base WHERE duplicidade_de IS NOT NULL AND status IN ('approved', 'partially_refunded')
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
                           - (SELECT coalesce(sum(valor), 0) FROM pc),
    'duplicados_quantidade', (SELECT count(*) FROM duplicados),
    'duplicados_valor',    (SELECT coalesce(sum(valor - valor_reembolsado), 0) FROM duplicados),
    'cobrancas_abertas',   (SELECT count(*) FROM base
                             WHERE status = 'canceled' AND cancelamento_provedor IN ('pendente', 'falhou')
                               AND (expira_em IS NULL OR expira_em > now()))
  ) INTO r;

  RETURN r || jsonb_build_object(
    'recebido_liquido',  (r->>'total_recebido')::numeric - (r->>'taxas')::numeric - (r->>'reembolsos')::numeric,
    -- Parte da barbearia nos servicos realizados, ja sem as taxas desses
    -- pagamentos. Antes das demais despesas: nao e lucro liquido.
    'receita_barbearia', (r->>'parte_barbearia')::numeric - (r->>'taxas_servicos')::numeric);
END;
$$;

-- Lista de pagamentos: agora diz qual e duplicidade, qual quitou um atendimento
-- que tem duplicidade a devolver e se a cobranca ainda esta aberta no provedor
DROP FUNCTION IF EXISTS public.financeiro_pagamentos(date, date, uuid, uuid, public.pagamento_status);
CREATE FUNCTION public.financeiro_pagamentos(
  p_inicio date, p_fim date, p_barbeiro_id uuid DEFAULT NULL, p_servico_id uuid DEFAULT NULL,
  p_status public.pagamento_status DEFAULT NULL)
RETURNS TABLE (id uuid, agendamento_id uuid, data_hora timestamptz, cliente text, barbeiro text, servico text,
               metodo public.pagamento_metodo, status public.pagamento_status, valor numeric, desconto numeric,
               taxa numeric, valor_reembolsado numeric, forma_presencial text, criado_em timestamptz, aprovado_em timestamptz,
               duplicidade_de uuid, tem_duplicidade boolean, cancelamento_provedor text)
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
           p.criado_em, p.aprovado_em, p.duplicidade_de,
           EXISTS (SELECT 1 FROM public.pagamentos d
                    WHERE d.duplicidade_de = p.id AND d.status IN ('approved', 'partially_refunded')),
           p.cancelamento_provedor
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

-- Duplicidades com valor a devolver, de qualquer data
CREATE OR REPLACE FUNCTION public.financeiro_duplicidades()
RETURNS TABLE (id uuid, agendamento_id uuid, data_hora timestamptz, cliente text, barbeiro text, servico text,
               metodo public.pagamento_metodo, status public.pagamento_status, valor numeric, desconto numeric,
               taxa numeric, valor_reembolsado numeric, forma_presencial text, criado_em timestamptz, aprovado_em timestamptz,
               duplicidade_de uuid, tem_duplicidade boolean, cancelamento_provedor text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  RETURN QUERY
    SELECT p.id, p.agendamento_id, a.data_hora, coalesce(pr.nome, 'Cliente'), b.nome, s.nome,
           p.metodo, p.status, p.valor, p.desconto, p.taxa, p.valor_reembolsado, p.forma_presencial,
           p.criado_em, p.aprovado_em, p.duplicidade_de, false, p.cancelamento_provedor
      FROM public.pagamentos p
      JOIN public.agendamentos a ON a.id = p.agendamento_id
      JOIN public.barbeiros b ON b.id = a.barbeiro_id
      JOIN public.servicos s ON s.id = a.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = p.cliente_id
     WHERE p.duplicidade_de IS NOT NULL AND p.status IN ('approved', 'partially_refunded')
     ORDER BY p.aprovado_em;
END;
$$;

-- Reembolsos do periodo (online e presenciais)
CREATE OR REPLACE FUNCTION public.financeiro_reembolsos(
  p_inicio date, p_fim date, p_barbeiro_id uuid DEFAULT NULL, p_servico_id uuid DEFAULT NULL)
RETURNS TABLE (id uuid, pagamento_id uuid, agendamento_id uuid, reembolsado_em timestamptz, cliente text, barbeiro text,
               servico text, metodo public.pagamento_metodo, valor numeric, motivo text, registrado_por text,
               origem text, duplicidade boolean)
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
    SELECT rb.id, rb.pagamento_id, p.agendamento_id, rb.reembolsado_em, coalesce(pr.nome, 'Cliente'), b.nome, s.nome,
           p.metodo, rb.valor, rb.motivo,
           CASE WHEN rb.registrado_por IS NULL THEN NULL ELSE coalesce(ad.nome, 'Administrador') END,
           -- admin: pedido no Visage Barber; estorno: contestacao no cartao;
           -- provedor: feito direto no Mercado Pago
           CASE WHEN rb.provedor_reembolso_id LIKE 'chargeback-%' THEN 'estorno'
                WHEN rb.registrado_por IS NOT NULL OR p.metodo = 'presencial' THEN 'admin'
                ELSE 'provedor' END,
           p.duplicidade_de IS NOT NULL
      FROM public.pagamento_reembolsos rb
      JOIN public.pagamentos p ON p.id = rb.pagamento_id
      JOIN public.agendamentos a ON a.id = p.agendamento_id
      JOIN public.barbeiros b ON b.id = a.barbeiro_id
      JOIN public.servicos s ON s.id = a.servico_id
      LEFT JOIN public.profiles pr ON pr.user_id = p.cliente_id
      LEFT JOIN public.profiles ad ON ad.user_id = rb.registrado_por
     WHERE rb.reembolsado_em >= v_ini AND rb.reembolsado_em < v_fim
       AND (p_barbeiro_id IS NULL OR a.barbeiro_id = p_barbeiro_id)
       AND (p_servico_id IS NULL OR a.servico_id = p_servico_id)
     ORDER BY rb.reembolsado_em DESC
     LIMIT 300;
END;
$$;

-- Historico de todos os pagamentos do atendimento deste pagamento
CREATE OR REPLACE FUNCTION public.pagamento_historico(p_pagamento_id uuid)
RETURNS TABLE (id bigint, registrado_em timestamptz, pagamento_id uuid, metodo public.pagamento_metodo, evento text,
               status_anterior public.pagamento_status, status_novo public.pagamento_status, valor numeric,
               detalhe text, origem text, ator text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.exigir_admin();
  RETURN QUERY
    SELECT au.id, au.registrado_em, au.pagamento_id, p.metodo, au.evento, au.status_anterior, au.status_novo,
           au.valor, au.detalhe, au.origem,
           CASE WHEN au.ator IS NULL THEN NULL
                ELSE coalesce(pr.nome, CASE WHEN au.origem = 'cliente' THEN 'Cliente' ELSE 'Administrador' END) END
      FROM public.pagamento_auditoria au
      JOIN public.pagamentos p ON p.id = au.pagamento_id
      LEFT JOIN public.profiles pr ON pr.user_id = au.ator
     WHERE au.agendamento_id = (SELECT x.agendamento_id FROM public.pagamentos x WHERE x.id = p_pagamento_id)
     ORDER BY au.id;
END;
$$;

-- ---------------------------------------------------------------
-- 8. Acesso
-- ---------------------------------------------------------------
ALTER TABLE public.pagamento_auditoria ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admin le historico de pagamentos" ON public.pagamento_auditoria;
CREATE POLICY "Admin le historico de pagamentos" ON public.pagamento_auditoria
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
REVOKE INSERT, UPDATE, DELETE ON public.pagamento_auditoria FROM anon, authenticated;

-- So do backend (service role) ou internas
REVOKE ALL ON FUNCTION public.auditar_pagamento_evento(uuid, uuid, text, public.pagamento_status, public.pagamento_status, numeric, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auditar_pagamento() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.confirmar_cancelamento_provedor(uuid, boolean, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.cobrancas_abertas_no_provedor(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preparar_reembolso(uuid, numeric, uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.registrar_falha_reembolso(uuid, uuid, text) FROM PUBLIC, anon, authenticated;

-- Consultas do admin (cada uma confere o perfil de quem chama)
REVOKE ALL ON FUNCTION public.financeiro_pagamentos(date, date, uuid, uuid, public.pagamento_status) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_pagamentos(date, date, uuid, uuid, public.pagamento_status) TO authenticated;
REVOKE ALL ON FUNCTION public.financeiro_duplicidades() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_duplicidades() TO authenticated;
REVOKE ALL ON FUNCTION public.financeiro_reembolsos(date, date, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.financeiro_reembolsos(date, date, uuid, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.pagamento_historico(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pagamento_historico(uuid) TO authenticated;
