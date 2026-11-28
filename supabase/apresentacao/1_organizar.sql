-- Organiza o banco para a apresentação do TCC (05/12/2026). Autorizado pelo usuário em 28/11/2026.
-- Rodar DEPOIS de conferir 0_previa.sql. Tudo num bloco só: se qualquer passo
-- falhar, NADA é aplicado (o banco fica como estava) e a mensagem diz o motivo.
--
-- 1. Barbeiros: ficam ativos Eliselton, João Silva, Paulo e Kiko; os demais são
--    inativados (somem da lista de agendamento; histórico preservado; reversível
--    com UPDATE barbeiros SET ativo = true). Fernando (sem conta) e Pedro Costa
--    (duplicado inativo) são apagados só se não tiverem histórico nenhum.
-- 2. Horários duplicados apagados (fica uma linha de cada).
-- 3. Serviços Bigode, Cavanhaque e Barba e Bigode (componente novo "bigode");
--    os 4 barbeiros ativos passam a fazer todos os serviços ativos.
-- 4. Comissão padrão da barbearia: 50%.
-- 5. Atendimentos concluídos e ainda não pagos: registrados como pagos na
--    barbearia pela MESMA função da tela do admin (registrar_pagamento_presencial),
--    em nome da conta admin@gmail.com. Formas alternadas (dinheiro, pix, débito,
--    crédito); taxa da maquininha: débito 1,5% e crédito 3%. Gera os lançamentos
--    e as comissões oficiais, na data de cada atendimento. Registro financeiro
--    não se apaga: correção é por reembolso/estorno, como no sistema.
--    Cobranças online de teste (sandbox) em aberto desses atendimentos ficam
--    canceladas, como acontece na tela.

DO $$
DECLARE
  v_admin constant uuid := '304f1fa3-7de3-4efd-a39b-a94aa0136672';  -- admin@gmail.com
  v_manter constant uuid[] := ARRAY[
    '4459f1e4-0d33-4bae-9399-d22f8bf8254b',  -- Eliselton da Silva
    'da7ea7dc-40f1-4cb6-b7d3-1d81582a4f27',  -- João Silva
    '40bb9c6a-403c-487d-b0a1-d39a27f315d0',  -- Paulo
    'e135a5bf-4906-457e-9614-f05b2f08f364'   -- Kiko
  ]::uuid[];
  v_apagar constant uuid[] := ARRAY[
    '3d502e6f-30a1-4032-afaf-39631827169c',  -- Fernando (sem conta)
    'dedc7f82-4113-4201-aa71-e52954d87fa3'   -- Pedro Costa (duplicado inativo)
  ]::uuid[];
  v_formas constant text[] := ARRAY['dinheiro', 'pix', 'cartao_debito', 'cartao_credito'];
  v_id uuid;
  v_forma text;
  v_taxa numeric;
  r record;
  n integer := 0;
BEGIN
  -- Age como o admin, para as funções do sistema aceitarem (igual à tela)
  PERFORM set_config('request.jwt.claim.sub', v_admin::text, true);
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);
  IF auth.uid() IS DISTINCT FROM v_admin OR NOT public.has_role(v_admin, 'admin') THEN
    RAISE EXCEPTION 'Não foi possível agir como admin@gmail.com (auth.uid() = %).', auth.uid();
  END IF;
  IF (SELECT count(*) FROM public.barbeiros WHERE id = ANY (v_manter)) <> 4 THEN
    RAISE EXCEPTION 'Algum dos 4 barbeiros a manter não foi encontrado.';
  END IF;

  -- 1. Barbeiros
  UPDATE public.barbeiros SET ativo = (id = ANY (v_manter))
   WHERE ativo IS DISTINCT FROM (id = ANY (v_manter));

  FOREACH v_id IN ARRAY v_apagar LOOP
    IF EXISTS (SELECT 1 FROM public.agendamentos WHERE barbeiro_id = v_id)
       OR EXISTS (SELECT 1 FROM public.avaliacoes WHERE barbeiro_id = v_id)
       OR EXISTS (SELECT 1 FROM public.lancamentos_financeiros WHERE barbeiro_id = v_id)
       OR EXISTS (SELECT 1 FROM public.conversas WHERE barbeiro_id = v_id) THEN
      CONTINUE;  -- tem histórico: fica só inativo
    END IF;
    DELETE FROM public.barbeiro_servicos WHERE barbeiro_id = v_id;
    DELETE FROM public.horarios_disponiveis WHERE barbeiro_id = v_id;
    DELETE FROM public.barbeiros WHERE id = v_id;
  END LOOP;

  -- 2. Horários duplicados (fica a primeira linha de cada)
  DELETE FROM public.horarios_disponiveis h
   USING (SELECT ctid AS c,
                 row_number() OVER (PARTITION BY barbeiro_id, dia_semana, hora_inicio, hora_fim ORDER BY ctid) AS rn
            FROM public.horarios_disponiveis) d
   WHERE h.ctid = d.c AND d.rn > 1;

  -- 3. Serviços novos
  INSERT INTO public.componentes_servico (codigo, nome) VALUES ('bigode', 'Bigode')
  ON CONFLICT (codigo) DO NOTHING;

  FOR r IN
    SELECT * FROM (VALUES
      ('Bigode',         'Aparar e modelar o bigode',                  15.00, 15, ARRAY['bigode']),
      ('Cavanhaque',     'Desenho e acabamento do cavanhaque',         20.00, 20, ARRAY['barba']),
      ('Barba e Bigode', 'Barba e bigode aparados, modelados e hidratados', 30.00, 40, ARRAY['barba', 'bigode'])
    ) AS t(nome, descricao, preco, duracao, componentes)
  LOOP
    IF NOT EXISTS (SELECT 1 FROM public.servicos WHERE lower(nome) = lower(r.nome)) THEN
      INSERT INTO public.servicos (nome, descricao, preco, duracao_min, ativo)
      VALUES (r.nome, r.descricao, r.preco, r.duracao, true)
      RETURNING id INTO v_id;
      INSERT INTO public.servico_componentes (servico_id, componente)
      SELECT v_id, unnest(r.componentes);
    END IF;
  END LOOP;

  INSERT INTO public.barbeiro_servicos (barbeiro_id, servico_id)
  SELECT b, s.id
    FROM unnest(v_manter) AS b
   CROSS JOIN public.servicos s
   WHERE s.ativo
     AND NOT EXISTS (SELECT 1 FROM public.barbeiro_servicos bs WHERE bs.barbeiro_id = b AND bs.servico_id = s.id);

  -- 4. Comissão padrão
  IF (SELECT percentual FROM public.comissao_alteracoes
       WHERE barbeiro_id IS NULL ORDER BY alterado_em DESC, id DESC LIMIT 1) IS DISTINCT FROM 50 THEN
    PERFORM public.configurar_comissao(NULL, 50);
  END IF;

  -- 5. Pagamentos na barbearia dos atendimentos concluídos
  FOR r IN
    SELECT a.id, a.preco
      FROM public.agendamentos a
     WHERE a.status = 'concluido' AND a.preco IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.pagamentos p
                        WHERE p.agendamento_id = a.id AND p.status IN ('approved', 'partially_refunded', 'refunded'))
       AND NOT EXISTS (SELECT 1 FROM public.lancamentos_financeiros l
                        WHERE l.agendamento_id = a.id AND l.tipo = 'servico')
     ORDER BY a.data_hora, a.id
  LOOP
    n := n + 1;
    v_forma := v_formas[(n % 4) + 1];
    v_taxa := CASE v_forma WHEN 'cartao_debito' THEN round(r.preco * 0.015, 2)
                           WHEN 'cartao_credito' THEN round(r.preco * 0.03, 2)
                           ELSE 0 END;
    PERFORM public.registrar_pagamento_presencial(r.id, v_forma, 0, v_taxa);
  END LOOP;
END;
$$;

-- Resultado (aparece no SQL Editor)
SELECT 'barbeiros ativos' AS item, string_agg(nome, ', ' ORDER BY nome) AS valor FROM public.barbeiros WHERE ativo
UNION ALL SELECT 'servicos ativos', string_agg(nome, ', ' ORDER BY nome) FROM public.servicos WHERE ativo
UNION ALL SELECT 'comissao padrao', (SELECT percentual::text || '%' FROM public.comissao_alteracoes
                                      WHERE barbeiro_id IS NULL ORDER BY alterado_em DESC, id DESC LIMIT 1)
UNION ALL SELECT 'lancamentos de servico', count(*)::text FROM public.lancamentos_financeiros WHERE tipo = 'servico'
UNION ALL SELECT 'faturamento total', 'R$ ' || coalesce(sum(valor_pago), 0) FROM public.lancamentos_financeiros
UNION ALL SELECT 'comissoes total', 'R$ ' || coalesce(sum(valor_comissao), 0) FROM public.lancamentos_financeiros
UNION ALL SELECT 'horarios duplicados restantes', count(*)::text FROM (
  SELECT 1 FROM public.horarios_disponiveis GROUP BY barbeiro_id, dia_semana, hora_inicio, hora_fim HAVING count(*) > 1) d;
