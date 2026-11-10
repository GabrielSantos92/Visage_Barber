-- =====================================================================
-- Pre-requisitos das notificacoes push (migrations 21, 22 e 23)
--
-- SOMENTE LEITURA: uma unica consulta; nao cria, nao altera e nao apaga nada.
-- Rode no Supabase Dashboard > SQL Editor e confira a coluna "situacao":
--   OK        tudo certo
--   ATENCAO   funciona, mas leia o resultado
--   BLOQUEIA  a migration indicada vai parar sem mudar nada
-- =====================================================================
WITH esperado(tabela, coluna, tipo) AS (
  VALUES
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
),
colunas AS (
  SELECT 1 AS ordem,
         'Migration 21: coluna necessaria' AS verificacao,
         e.tabela || '.' || e.coluna AS item,
         coalesce(c.data_type, 'nao existe') AS resultado,
         CASE WHEN c.data_type IS NULL THEN 'BLOQUEIA'
              WHEN e.tipo IS NOT NULL AND c.data_type <> e.tipo THEN 'BLOQUEIA'
              ELSE 'OK' END AS situacao
    FROM esperado e
    LEFT JOIN information_schema.columns c
      ON c.table_schema = 'public' AND c.table_name = e.tabela AND c.column_name = e.coluna
),
chaves AS (
  SELECT 2, 'Migration 21: chave primaria', x.tabela || '.id',
         CASE WHEN x.ok THEN 'sim' ELSE 'nao' END,
         CASE WHEN x.ok THEN 'OK' ELSE 'BLOQUEIA' END
    FROM (
      SELECT t AS tabela, EXISTS (
               SELECT 1
                 FROM pg_constraint k
                 JOIN pg_attribute a ON a.attrelid = k.conrelid AND a.attname = 'id'
                WHERE k.conrelid = to_regclass('public.' || t)
                  AND k.contype IN ('p', 'u')
                  AND k.conkey = ARRAY[a.attnum]) AS ok
        FROM unnest(ARRAY['conversas', 'mensagens']) AS t
    ) x
),
nomes AS (
  SELECT 3, 'Migrations 21 e 22: nome da tabela nova', o.nome,
         CASE WHEN to_regclass('public.' || o.nome) IS NULL THEN 'livre'
              ELSE 'ja existe (normal se a migration ja rodou)' END,
         CASE WHEN to_regclass('public.' || o.nome) IS NULL THEN 'OK' ELSE 'ATENCAO' END
    FROM (VALUES ('dispositivos_push'), ('notificacao_preferencias'), ('notificacoes'),
                 ('notificacao_envios'), ('notificacao_config')) AS o(nome)
),
extensoes AS (
  SELECT 4, 'Migration 22: extensao', x.nome,
         CASE WHEN ae.installed_version IS NOT NULL THEN 'instalada (' || ae.installed_version || ')'
              WHEN ae.name IS NOT NULL THEN 'disponivel; a migration 22 instala'
              ELSE 'indisponivel: sem ela, so envia com o backend acordado' END,
         CASE WHEN ae.name IS NULL THEN 'ATENCAO' ELSE 'OK' END
    FROM (VALUES ('pg_cron'), ('pg_net')) AS x(nome)
    LEFT JOIN pg_available_extensions ae ON ae.name = x.nome
),
antigas AS (
  -- So tabelas: uma view que use a coluna aparece abaixo, como dependencia
  SELECT c.table_name, c.data_type
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
   WHERE c.table_schema = 'public' AND c.column_name = 'push_token' AND t.table_type = 'BASE TABLE'
),
push_colunas AS (
  SELECT 5, 'Migration 23: coluna antiga', a.table_name || '.push_token',
         'existe (' || a.data_type || ')', 'OK'
    FROM antigas a
  UNION ALL
  SELECT 5, 'Migration 23: coluna antiga', 'push_token', 'nao existe em nenhuma tabela: nada a remover', 'OK'
   WHERE NOT EXISTS (SELECT 1 FROM antigas)
),
push_dados AS (
  -- Funciona com ou sem a coluna: to_jsonb mostra so as colunas que existem
  SELECT 6, 'Migration 23: tokens antigos guardados', 'barbeiros.push_token',
         (count(*) FILTER (WHERE to_jsonb(b) ->> 'push_token' IS NOT NULL))::text, 'OK'
    FROM public.barbeiros b
  UNION ALL
  SELECT 6, 'Migration 23: tokens antigos guardados', 'profiles.push_token',
         (count(*) FILTER (WHERE to_jsonb(p) ->> 'push_token' IS NOT NULL))::text, 'OK'
    FROM public.profiles p
),
push_dependencias AS (
  -- Views e policies impedem a remocao; indices saem junto com a coluna
  SELECT 7, 'Migration 23: depende da coluna',
         pg_describe_object(d.classid, d.objid, d.objsubid),
         'usa ' || a.attrelid::regclass::text || '.push_token',
         CASE WHEN d.classid IN ('pg_rewrite'::regclass, 'pg_policy'::regclass) THEN 'BLOQUEIA'
              ELSE 'ATENCAO' END
    FROM pg_depend d
    JOIN pg_attribute a ON a.attrelid = d.refobjid AND a.attnum = d.refobjsubid
   WHERE d.refclassid = 'pg_class'::regclass
     AND a.attname = 'push_token'
     AND d.classid <> 'pg_attrdef'::regclass
  UNION ALL
  SELECT 7, 'Migration 23: funcao cita push_token', n.nspname || '.' || p.proname,
         'cita push_token no codigo', 'BLOQUEIA'
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE p.prosrc ILIKE '%push_token%'
     AND n.nspname NOT IN ('pg_catalog', 'information_schema')
),
push_resumo AS (
  SELECT 8, 'Migration 23: dependencias', 'push_token',
         'nenhuma view, policy ou funcao usa a coluna', 'OK'
   WHERE NOT EXISTS (SELECT 1 FROM push_dependencias)
)
SELECT verificacao, item, resultado, situacao
  FROM (
    SELECT * FROM colunas
    UNION ALL SELECT * FROM chaves
    UNION ALL SELECT * FROM nomes
    UNION ALL SELECT * FROM extensoes
    UNION ALL SELECT * FROM push_colunas
    UNION ALL SELECT * FROM push_dados
    UNION ALL SELECT * FROM push_dependencias
    UNION ALL SELECT * FROM push_resumo
  ) t
 ORDER BY ordem, item;
