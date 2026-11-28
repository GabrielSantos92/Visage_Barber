-- PRÉVIA da organização do banco para a apresentação do TCC (05/12/2026).
-- SOMENTE LEITURA: mostra o que 1_organizar.sql e 2_apagar_contas.sql vão fazer.
-- Rodar no SQL Editor e conferir antes de rodar os outros dois.
-- Colunas: passo, acao, item, detalhe.

WITH
manter(id) AS (VALUES
  ('4459f1e4-0d33-4bae-9399-d22f8bf8254b'::uuid),  -- Eliselton da Silva
  ('da7ea7dc-40f1-4cb6-b7d3-1d81582a4f27'::uuid),  -- João Silva (o com histórico)
  ('40bb9c6a-403c-487d-b0a1-d39a27f315d0'::uuid),  -- Paulo
  ('e135a5bf-4906-457e-9614-f05b2f08f364'::uuid)   -- Kiko
),
apagar_barbeiro(id) AS (VALUES
  ('3d502e6f-30a1-4032-afaf-39631827169c'::uuid),  -- Fernando (inativo, sem conta)
  ('dedc7f82-4113-4201-aa71-e52954d87fa3'::uuid)   -- Pedro Costa (inativo, duplicado)
),
contas(id) AS (VALUES
  ('f3dac782-b0bd-41ee-a6c7-3421cbc7e972'::uuid),  -- teste2@gmai.com
  ('be307692-c40f-4eda-af3e-def0d0dc3b85'::uuid),  -- gabriel@yahoo.com
  ('4a80468d-63e0-445b-a527-f2fc2ade0864'::uuid),  -- gabrielsantosalves1321@gmail.comg
  ('88a751d2-b9e3-47a6-ac02-653c414b011a'::uuid),  -- nj@yahoo.com
  ('48874a4d-60dd-4c15-bfcd-2a9c5d7360e2'::uuid)   -- gabriel@gmail.com
),
a_pagar AS (
  SELECT a.*, row_number() OVER (ORDER BY a.data_hora, a.id) AS n
    FROM public.agendamentos a
   WHERE a.status = 'concluido' AND a.preco IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.pagamentos p
                      WHERE p.agendamento_id = a.id AND p.status IN ('approved', 'partially_refunded', 'refunded'))
     AND NOT EXISTS (SELECT 1 FROM public.lancamentos_financeiros l
                      WHERE l.agendamento_id = a.id AND l.tipo = 'servico')
)
SELECT * FROM (
  -- 1. Barbeiros
  SELECT 1 AS passo,
         CASE WHEN b.id IN (SELECT id FROM manter) THEN 'MANTER ATIVO'
              WHEN b.id IN (SELECT id FROM apagar_barbeiro) THEN
                CASE WHEN EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.barbeiro_id = b.id)
                       OR EXISTS (SELECT 1 FROM public.avaliacoes av WHERE av.barbeiro_id = b.id)
                     THEN 'APAGAR -> BLOQUEADO (tem historico), so inativa'
                     ELSE 'APAGAR' END
              ELSE 'INATIVAR' END AS acao,
         b.nome AS item,
         'id=' || b.id || ' | hoje=' || CASE WHEN b.ativo THEN 'ativo' ELSE 'inativo' END
           || ' | agendamentos=' || (SELECT count(*) FROM public.agendamentos a WHERE a.barbeiro_id = b.id) AS detalhe
    FROM public.barbeiros b

  UNION ALL
  -- 1b. Agendamentos futuros de barbeiros que serão inativados (ficam no banco)
  SELECT 1, 'AVISO futuro com barbeiro inativado', b.nome,
         to_char(a.data_hora AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') || ' | ' || a.status::text
    FROM public.agendamentos a JOIN public.barbeiros b ON b.id = a.barbeiro_id
   WHERE b.id NOT IN (SELECT id FROM manter) AND a.data_hora > now() AND a.status <> 'cancelado'

  UNION ALL
  -- 2. Horários duplicados
  SELECT 2, 'APAGAR horario duplicado', coalesce(b.nome, '?'), count(*) || ' linha(s) a mais'
    FROM (SELECT h.barbeiro_id,
                 row_number() OVER (PARTITION BY h.barbeiro_id, h.dia_semana, h.hora_inicio, h.hora_fim ORDER BY h.ctid) AS rn
            FROM public.horarios_disponiveis h) d
    LEFT JOIN public.barbeiros b ON b.id = d.barbeiro_id
   WHERE d.rn > 1
   GROUP BY b.nome

  UNION ALL
  -- 3. Serviços novos
  SELECT 3, CASE WHEN EXISTS (SELECT 1 FROM public.servicos s WHERE lower(s.nome) = lower(n.nome))
                 THEN 'JA EXISTE (nao cria)' ELSE 'CRIAR servico' END,
         n.nome, n.detalhe
    FROM (VALUES
      ('Bigode',         'R$ 15,00 | 15 min | componente bigode'),
      ('Cavanhaque',     'R$ 20,00 | 20 min | componente barba'),
      ('Barba e Bigode', 'R$ 30,00 | 40 min | componentes barba, bigode')
    ) AS n(nome, detalhe)

  UNION ALL
  SELECT 3, 'LIGAR todos os servicos ativos', b.nome,
         'hoje faz ' || (SELECT count(*) FROM public.barbeiro_servicos bs WHERE bs.barbeiro_id = b.id) || ' servico(s)'
    FROM public.barbeiros b WHERE b.id IN (SELECT id FROM manter)

  UNION ALL
  -- 4. Comissão
  SELECT 4, 'COMISSAO padrao', 'barbearia', '50% para o barbeiro (hoje: '
         || coalesce((SELECT percentual::text || '%' FROM public.comissao_alteracoes
                       WHERE barbeiro_id IS NULL ORDER BY alterado_em DESC, id DESC LIMIT 1), 'nao configurada') || ')'

  UNION ALL
  -- 5. Pagamentos na barbearia
  SELECT 5, 'REGISTRAR pago na barbearia',
         to_char(p.data_hora AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') || ' ' || coalesce(b.nome, '?'),
         coalesce(s.nome, '?') || ' | R$ ' || p.preco || ' | '
           || (ARRAY['dinheiro', 'pix', 'cartao_debito', 'cartao_credito'])[(p.n % 4) + 1]
    FROM a_pagar p
    LEFT JOIN public.barbeiros b ON b.id = p.barbeiro_id
    LEFT JOIN public.servicos s ON s.id = p.servico_id

  UNION ALL
  SELECT 5, 'TOTAL a registrar', count(*) || ' atendimentos', 'R$ ' || coalesce(sum(preco), 0) || ' | comissao 50% = R$ ' || coalesce(round(sum(preco) / 2, 2), 0)
    FROM a_pagar

  UNION ALL
  SELECT 5, 'AVISO concluido sem preco (fica de fora)', a.id::text, to_char(a.data_hora, 'DD/MM/YYYY')
    FROM public.agendamentos a WHERE a.status = 'concluido' AND a.preco IS NULL

  UNION ALL
  SELECT 5, 'CANCELAR cobranca online em aberto (sandbox)', pg.metodo::text || ' R$ ' || pg.valor,
         'do agendamento ' || pg.agendamento_id
    FROM public.pagamentos pg
   WHERE pg.status = 'pending' AND pg.metodo <> 'presencial'
     AND pg.agendamento_id IN (SELECT id FROM a_pagar)

  UNION ALL
  -- 6. Contas a apagar (2_apagar_contas.sql)
  SELECT 6,
         CASE WHEN EXISTS (SELECT 1 FROM public.agendamentos a WHERE a.cliente_id = u.id)
                OR EXISTS (SELECT 1 FROM public.pagamentos p WHERE p.cliente_id = u.id)
                OR EXISTS (SELECT 1 FROM public.barbeiros b WHERE b.user_id = u.id)
                OR EXISTS (SELECT 1 FROM public.user_roles r WHERE r.user_id = u.id AND r.role::text <> 'cliente')
              THEN 'BLOQUEADO (tem agendamento, pagamento ou papel)' ELSE 'APAGAR conta' END,
         u.email,
         'criada ' || to_char(u.created_at, 'DD/MM/YYYY') || ' | ultimo login ' || coalesce(to_char(u.last_sign_in_at, 'DD/MM/YYYY'), 'nunca')
    FROM auth.users u WHERE u.id IN (SELECT id FROM contas)
) x
ORDER BY passo, acao, item;
