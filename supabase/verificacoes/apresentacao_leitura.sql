-- Retrato do banco para organizar a apresentação do TCC (05/12/2026).
-- SOMENTE LEITURA: só SELECT, não altera nada. Rodar no SQL Editor do Supabase
-- e copiar o resultado inteiro (botão de exportar/copiar da tabela).
-- Uma consulta só, para o Editor mostrar tudo numa tabela (colunas: ordem, secao, item, detalhe).

WITH
comissao AS (
  SELECT DISTINCT ON (barbeiro_id) barbeiro_id, percentual, alterado_em
    FROM public.comissao_alteracoes
   ORDER BY barbeiro_id, alterado_em DESC, id DESC
),
linhas AS (
  -- 1. Serviços
  SELECT 1 AS ordem, '1 servico' AS secao,
         s.nome AS item,
         concat_ws(' | ',
           'id=' || s.id,
           'preco=' || s.preco,
           'duracao=' || s.duracao_min || 'min',
           CASE WHEN s.ativo THEN 'ATIVO' ELSE 'inativo' END,
           'componentes=' || coalesce((SELECT string_agg(sc.componente, ',' ORDER BY sc.componente)
                                         FROM public.servico_componentes sc WHERE sc.servico_id = s.id), '-'),
           'barbeiros=' || (SELECT count(*) FROM public.barbeiro_servicos bs WHERE bs.servico_id = s.id),
           'agendamentos=' || (SELECT count(*) FROM public.agendamentos a WHERE a.servico_id = s.id),
           'descricao=' || coalesce(left(s.descricao, 60), '-')) AS detalhe
    FROM public.servicos s

  UNION ALL
  -- 2. Componentes cadastrados
  SELECT 2, '2 componente', c.codigo, c.nome
    FROM public.componentes_servico c

  UNION ALL
  -- 3. Barbeiros
  SELECT 3, '3 barbeiro', b.nome,
         concat_ws(' | ',
           'id=' || b.id,
           CASE WHEN b.ativo THEN 'ATIVO' ELSE 'inativo' END,
           'login=' || coalesce(u.email, 'SEM CONTA'),
           'foto=' || CASE WHEN coalesce(b.foto_url, '') = '' THEN 'NAO' ELSE 'sim' END,
           'especialidade=' || coalesce(b.especialidade, '-'),
           'servicos=' || (SELECT count(*) FROM public.barbeiro_servicos bs WHERE bs.barbeiro_id = b.id),
           'dias_com_horario=' || (SELECT count(DISTINCT h.dia_semana) FROM public.horarios_disponiveis h WHERE h.barbeiro_id = b.id),
           'comissao=' || coalesce(cm.percentual::text || '%', 'padrao'),
           'agendamentos=' || (SELECT count(*) FROM public.agendamentos a WHERE a.barbeiro_id = b.id),
           'avaliacoes=' || (SELECT count(*) FROM public.avaliacoes av WHERE av.barbeiro_id = b.id),
           'criado=' || to_char(b.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'))
    FROM public.barbeiros b
    LEFT JOIN auth.users u ON u.id = b.user_id
    LEFT JOIN comissao cm ON cm.barbeiro_id = b.id

  UNION ALL
  -- 4. Comissão padrão da barbearia
  SELECT 4, '4 comissao padrao', 'padrao',
         coalesce((SELECT percentual::text || '%' FROM comissao WHERE barbeiro_id IS NULL), 'NAO CONFIGURADA')

  UNION ALL
  -- 5. Contas (login)
  SELECT 5, '5 conta', u.email,
         concat_ws(' | ',
           'id=' || u.id,
           'papel=' || coalesce((SELECT string_agg(r.role::text, ',') FROM public.user_roles r WHERE r.user_id = u.id), 'cliente'),
           'nome=' || coalesce((SELECT string_agg(p.nome, ' / ') FROM public.profiles p WHERE p.user_id = u.id), '-'),
           'perfis=' || (SELECT count(*) FROM public.profiles p WHERE p.user_id = u.id),
           'confirmado=' || CASE WHEN u.email_confirmed_at IS NULL THEN 'NAO' ELSE 'sim' END,
           'criado=' || to_char(u.created_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'),
           'ultimo_login=' || coalesce(to_char(u.last_sign_in_at AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY'), 'nunca'),
           'agendamentos=' || (SELECT count(*) FROM public.agendamentos a WHERE a.cliente_id = u.id),
           'pagamentos=' || (SELECT count(*) FROM public.pagamentos pg WHERE pg.cliente_id = u.id))
    FROM auth.users u

  UNION ALL
  -- 6. Agendamentos por mês e status
  SELECT 6, '6 agendamentos',
         to_char(a.data_hora AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') || ' ' || a.status::text,
         count(*)::text
    FROM public.agendamentos a
   GROUP BY 1, 2, 3

  UNION ALL
  -- 7. Pagamentos por forma e situação
  SELECT 7, '7 pagamentos', p.metodo::text || ' ' || p.status::text,
         count(*) || ' | total=' || sum(p.valor)
    FROM public.pagamentos p
   GROUP BY 1, 2, 3

  UNION ALL
  -- 8. Totais de outras tabelas
  SELECT 8, '8 totais', t.tabela, t.qtd::text
    FROM (VALUES
      ('lancamentos_financeiros', (SELECT count(*) FROM public.lancamentos_financeiros)),
      ('pagamentos_comissao',     (SELECT count(*) FROM public.pagamentos_comissao)),
      ('pagamento_reembolsos',    (SELECT count(*) FROM public.pagamento_reembolsos)),
      ('avaliacoes',              (SELECT count(*) FROM public.avaliacoes)),
      ('conversas',               (SELECT count(*) FROM public.conversas)),
      ('mensagens',               (SELECT count(*) FROM public.mensagens)),
      ('visagismo_analises',      (SELECT count(*) FROM public.visagismo_analises)),
      ('horarios_disponiveis',    (SELECT count(*) FROM public.horarios_disponiveis)),
      ('notificacoes',            (SELECT count(*) FROM public.notificacoes)),
      ('dispositivos_push',       (SELECT count(*) FROM public.dispositivos_push))
    ) AS t(tabela, qtd)

  UNION ALL
  -- 9. Possíveis duplicados
  SELECT 9, '9 DUPLICADO servico', lower(trim(nome)), count(*) || ' servicos com esse nome'
    FROM public.servicos GROUP BY 1, 2, 3 HAVING count(*) > 1
  UNION ALL
  SELECT 9, '9 DUPLICADO barbeiro', lower(trim(nome)), count(*) || ' barbeiros com esse nome'
    FROM public.barbeiros GROUP BY 1, 2, 3 HAVING count(*) > 1
  UNION ALL
  SELECT 9, '9 DUPLICADO barbeiro por conta', user_id::text, count(*) || ' barbeiros na mesma conta'
    FROM public.barbeiros WHERE user_id IS NOT NULL GROUP BY 1, 2, 3 HAVING count(*) > 1
  UNION ALL
  SELECT 9, '9 DUPLICADO perfil', user_id::text, count(*) || ' perfis na mesma conta'
    FROM public.profiles GROUP BY 1, 2, 3 HAVING count(*) > 1
  UNION ALL
  SELECT 9, '9 DUPLICADO papel', user_id::text || ' ' || role::text, count(*) || ' vezes'
    FROM public.user_roles GROUP BY 1, 2, 3 HAVING count(*) > 1
  UNION ALL
  SELECT 9, '9 DUPLICADO horario', barbeiro_id || ' dia ' || dia_semana || ' ' || hora_inicio || '-' || hora_fim, count(*) || ' vezes'
    FROM public.horarios_disponiveis GROUP BY 1, 2, 3 HAVING count(*) > 1
  UNION ALL
  SELECT 9, '9 DUPLICADO barbeiro_servico', barbeiro_id || ' ' || servico_id, count(*) || ' vezes'
    FROM public.barbeiro_servicos GROUP BY 1, 2, 3 HAVING count(*) > 1
)
SELECT ordem, secao, item, detalhe
  FROM linhas
 ORDER BY ordem, secao, item;
