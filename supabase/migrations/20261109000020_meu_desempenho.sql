-- =====================================================================
-- Meu Desempenho (barbeiro): dias com mais cortes e origem do percentual
--
-- Rode depois da 20261105000019_pagamentos_duplicidade_auditoria.sql.
-- So leitura: nao cria tabela nem muda regra financeira. Faturamento e
-- comissao continuam vindo de meu_financeiro (lancamentos imutaveis).
--
--   * dias_semana: atendimentos com status 'concluido' do proprio barbeiro,
--     por dia da semana (segunda a domingo), na data e hora de Brasilia.
--     Conta o trabalho feito, pago ou nao. Agendado ou cancelado (inclusive
--     cancelado depois de concluido) nao entra. Pagamento em duplicidade nao
--     muda a contagem: e um atendimento so.
--   * percentual: o mesmo de comissao_vigente (individual > padrao > nenhum),
--     com a origem para a tela dizer de onde ele vem.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.meu_desempenho(p_inicio date, p_fim date)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_fuso constant text := 'America/Sao_Paulo';
  v_barbeiro uuid := public.meu_barbeiro_id();
  v_proprio numeric;
  v_padrao numeric;
BEGIN
  IF v_barbeiro IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = 'PT403', DETAIL = 'SEM_PERMISSAO',
      MESSAGE = 'Esta área é exclusiva dos barbeiros.';
  END IF;
  IF p_inicio IS NULL OR p_fim IS NULL OR p_fim < p_inicio THEN
    RAISE EXCEPTION USING ERRCODE = 'PT400', DETAIL = 'PERIODO_INVALIDO',
      MESSAGE = 'Período inválido.';
  END IF;

  -- Ultima configuracao de cada um (NULL = removido ou nunca configurado),
  -- igual a comissao_vigente
  SELECT c.percentual INTO v_proprio FROM public.comissao_alteracoes c
   WHERE c.barbeiro_id = v_barbeiro ORDER BY c.id DESC LIMIT 1;
  SELECT c.percentual INTO v_padrao FROM public.comissao_alteracoes c
   WHERE c.barbeiro_id IS NULL ORDER BY c.id DESC LIMIT 1;

  RETURN jsonb_build_object(
    'percentual', coalesce(v_proprio, v_padrao),
    'percentual_origem', CASE WHEN v_proprio IS NOT NULL THEN 'individual'
                              WHEN v_padrao IS NOT NULL THEN 'padrao' END,
    'percentual_padrao', v_padrao,
    -- 7 posicoes: segunda (indice 0) a domingo (indice 6)
    'dias_semana', (
      SELECT jsonb_agg(coalesce(q.total, 0) ORDER BY d.dia)
        FROM generate_series(1, 7) AS d(dia)
        LEFT JOIN (
          SELECT extract(isodow FROM a.data_hora AT TIME ZONE v_fuso)::int AS dia, count(*) AS total
            FROM public.agendamentos a
           WHERE a.barbeiro_id = v_barbeiro
             AND a.status = 'concluido'
             AND a.data_hora >= p_inicio::timestamp AT TIME ZONE v_fuso
             AND a.data_hora < (p_fim + 1)::timestamp AT TIME ZONE v_fuso
           GROUP BY 1
        ) q ON q.dia = d.dia));
END;
$$;

REVOKE ALL ON FUNCTION public.meu_desempenho(date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.meu_desempenho(date, date) TO authenticated;
