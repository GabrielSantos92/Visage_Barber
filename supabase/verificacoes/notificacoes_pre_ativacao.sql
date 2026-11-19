-- =====================================================================
-- Pre-ativacao das notificacoes push: permissoes e exposicao
--
-- SOMENTE LEITURA: uma unica consulta; nao cria, nao altera e nao apaga nada.
-- Le o catalogo do Postgres (permissoes, donos e configuracoes). Do Vault, so
-- confere se existe um segredo com o nome esperado: nenhum valor de segredo,
-- token ou cabecalho e lido ou exibido.
-- Rode no Supabase Dashboard > SQL Editor e mande o resultado.
--
-- Complementa notificacoes_auditoria.sql (tabelas, funcoes, triggers, jobs e
-- fila). Esta confere o que precisa estar certo antes de ligar o envio:
--   A. dispositivos_push e acesso de usuarios comuns
--   B. fila do pg_net (net.http_request_queue guarda os cabecalhos do pedido,
--      inclusive X-Notificacoes-Segredo, ate o pg_net envia-lo)
--   C. Supabase Vault (segredo notificacoes_segredo_backend e migration 24)
--   D. funcoes e chamada do banco ao backend, inclusive o estado da
--      arquitetura de acionamento (migrations 25, 27 e 26) e o job do pg_cron.
--      So os estados B (migration 27), C (26 depois da 27) e D (30) passam: versao
--      desconhecida da rotina, estado inconsistente, gatilho inesperado ou
--      job errado nunca ficam OK.
--
-- Coluna "situacao":
--   OK        como esperado
--   PENDENTE  passo da ativacao ainda nao feito (esperado nesta fase)
--   ATENCAO   leia o resultado; pode exigir conferir no painel
--   PROBLEMA  corrigir antes de ativar
-- =====================================================================
WITH
-- Papeis do Supabase: anon (sem login), authenticated (usuario logado no app
-- ou no site) e service_role (so o backend). oid nulo se o papel nao existir.
papeis AS (
  SELECT v.nome, r.oid, coalesce(r.rolbypassrls OR r.rolsuper, false) AS ignora_rls
    FROM (VALUES ('anon'), ('authenticated'), ('service_role')) AS v(nome)
    LEFT JOIN pg_roles r ON r.rolname = v.nome
),
privs(n, priv) AS (
  VALUES (1, 'SELECT'), (2, 'INSERT'), (3, 'UPDATE'), (4, 'DELETE'),
         (5, 'TRUNCATE'), (6, 'REFERENCES'), (7, 'TRIGGER')
),
-- Tabelas e views conferidas (oid nulo se nao existirem)
objetos AS (
  SELECT v.chave, c.oid, c.relnamespace AS ns
    FROM (VALUES ('dispositivos_push', 'public.dispositivos_push'),
                 ('notificacao_preferencias', 'public.notificacao_preferencias'),
                 ('notificacoes', 'public.notificacoes'),
                 ('notificacao_envios', 'public.notificacao_envios'),
                 ('notificacao_config', 'public.notificacao_config'),
                 ('fila', 'net.http_request_queue'),
                 ('respostas', 'net._http_response'),
                 ('segredos', 'vault.secrets'),
                 ('segredos_abertos', 'vault.decrypted_secrets')) AS v(chave, nome)
    LEFT JOIN pg_class c ON c.oid = to_regclass(v.nome)::oid
),
-- Privilegios de cada papel em cada objeto: diretos, herdados ou via PUBLIC,
-- inclusive os concedidos so em algumas colunas
matriz AS (
  SELECT o.chave, o.oid AS objeto, p.nome AS papel, p.oid AS papel_oid,
         CASE WHEN o.oid IS NULL OR p.oid IS NULL THEN NULL
              ELSE coalesce(
                (SELECT string_agg(x.priv, ',' ORDER BY x.n) FROM privs x
                  WHERE has_table_privilege(p.oid, o.oid, x.priv)),
                CASE WHEN has_any_column_privilege(p.oid, o.oid, 'SELECT,INSERT,UPDATE,REFERENCES')
                     THEN 'so em algumas colunas' END,
                'nenhum') END AS lista,
         CASE WHEN o.oid IS NOT NULL AND p.oid IS NOT NULL
              THEN has_schema_privilege(p.oid, o.ns, 'USAGE') END AS usa_schema,
         -- Consegue ler de fato: uso do schema e leitura da tabela (ou de colunas)
         CASE WHEN o.oid IS NOT NULL AND p.oid IS NOT NULL
              THEN has_schema_privilege(p.oid, o.ns, 'USAGE')
               AND has_any_column_privilege(p.oid, o.oid, 'SELECT') END AS le
    FROM objetos o
    CROSS JOIN papeis p
),
-- Todos os papeis (menos os internos pg_*) que conseguem ler cada objeto
leitores AS (
  SELECT o.chave,
         string_agg(r.rolname || CASE WHEN r.rolsuper THEN ' (superusuario)' ELSE '' END,
                    ', ' ORDER BY r.rolname) AS lista
    FROM objetos o
    JOIN pg_roles r ON r.rolname !~ '^pg_'
   WHERE o.oid IS NOT NULL
     AND has_schema_privilege(r.oid, o.ns, 'USAGE')
     AND has_any_column_privilege(r.oid, o.oid, 'SELECT')
   GROUP BY o.chave
),
-- Schemas servidos pela API (PostgREST), quando a configuracao esta no banco
api AS (
  SELECT (SELECT substr(c, length('pgrst.db_schemas=') + 1)
            FROM pg_roles r, unnest(r.rolconfig) AS c
           WHERE r.rolname = 'authenticator' AND c LIKE 'pgrst.db\_schemas=%'
           LIMIT 1) AS schemas
),
despertar AS (
  SELECT p.oid, p.proowner, p.prosrc
    FROM (SELECT to_regprocedure('public.despertar_backend()')::oid AS f) x
    LEFT JOIN pg_proc p ON p.oid = x.f
),
-- Arquitetura do acionamento do backend: o MESMO bloco 0 de
-- notificacoes_auditoria.sql (hashes, sinais e estados explicados la; os
-- testes conferem que as duas consultas classificam igual).
arq_sinais AS (
  SELECT
    (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.rotina_notificacoes()')) AS hash_rotina,
    (SELECT md5(replace(p.prosrc, chr(13), '')) FROM pg_proc p
      WHERE p.oid = to_regprocedure('public.despertar_backend_apos_aviso()')) AS hash_funcao_gatilho,
    EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = to_regclass('public.notificacoes') AND a.attname = 'canal'
               AND a.attnum > 0 AND NOT a.attisdropped) AS canal_existe,
    EXISTS (SELECT 1 FROM pg_attribute a
             WHERE a.attrelid = to_regclass('public.notificacoes') AND a.attname = 'canal'
               AND a.attnum > 0 AND NOT a.attisdropped AND a.atttypid = 'text'::regtype AND a.attnotnull)
      AND EXISTS (SELECT 1 FROM pg_constraint c
                   WHERE c.conrelid = to_regclass('public.notificacoes')
                     AND c.conname = 'notificacoes_canal_check' AND c.contype = 'c') AS canal_certo,
    (to_regprocedure('public.enfileirar_confirmacoes_presenca()') IS NOT NULL)::int
      + (to_regprocedure('public.reservar_whatsapp(integer)') IS NOT NULL)::int
      + (to_regprocedure('public.whatsapp_registrar_resposta(text,text,text,text,text,text)') IS NOT NULL)::int AS funcoes_25,
    (to_regprocedure('public.whatsapp_expirar_solicitacoes()') IS NOT NULL)::int
      + (to_regprocedure('public.whatsapp_versao_aviso()') IS NOT NULL)::int
      + (to_regprocedure('public.whatsapp_avisar_cancelamento_nao_concluido(uuid,text)') IS NOT NULL)::int AS funcoes_26,
    -- Colunas da migration 30 (central e marcador do push)
    (SELECT count(*) FROM pg_attribute a
      WHERE NOT a.attisdropped AND a.attnum > 0
        AND ((a.attrelid = to_regclass('public.notificacoes') AND a.attname = 'lida_em')
             OR (a.attrelid = to_regclass('public.notificacao_config') AND a.attname IN ('push_ativo', 'push_ativado_em'))))::int AS colunas_30,
    (SELECT count(*) FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
      WHERE t.tgrelid = to_regclass('public.notificacoes') AND NOT t.tgisinternal
        AND (f.prosrc ILIKE '%despertar_backend%' OR f.prosrc ILIKE '%http_post%')) AS gatilhos_despertar,
    (SELECT string_agg(t.tgname || CASE WHEN t.tgenabled = 'D' THEN ' (DESLIGADO)' ELSE '' END, ', ' ORDER BY t.tgname)
       FROM pg_trigger t JOIN pg_proc f ON f.oid = t.tgfoid
      WHERE t.tgrelid = to_regclass('public.notificacoes') AND NOT t.tgisinternal
        AND (f.prosrc ILIKE '%despertar_backend%' OR f.prosrc ILIKE '%http_post%')) AS nomes_gatilhos,
    -- tgtype 4 = AFTER INSERT, por comando
    EXISTS (SELECT 1 FROM pg_trigger t
             WHERE t.tgrelid = to_regclass('public.notificacoes') AND NOT t.tgisinternal
               AND t.tgname = 'despertar_backend' AND t.tgtype = 4 AND t.tgenabled <> 'D'
               AND t.tgfoid = to_regprocedure('public.despertar_backend_apos_aviso()')) AS gatilho_original
),
arq AS (
  SELECT s.*,
         CASE s.hash_rotina
           WHEN '07bc62f71d2b57432ed9c09a857a9923' THEN '22'
           WHEN '5039fb09232e75c561d0b1eaab4a07b0' THEN '25'
           WHEN 'c5e63445649493ba26941d701c74ac2d' THEN '27'
           WHEN 'd7292c319cc19a4318f90c845a0b0832' THEN '26'
           WHEN 'cf980d362eb940169527bb95b9c07b89' THEN '26_original'
           WHEN '0f8ac1055d747bd708c1b6211a2d8500' THEN '30'
           ELSE CASE WHEN s.hash_rotina IS NULL THEN 'ausente' ELSE 'desconhecida' END END AS versao,
         s.hash_funcao_gatilho IS NOT NULL AS funcao_gatilho_existe,
         coalesce(s.hash_funcao_gatilho = 'ae27781cf33c63989c107b791dcc6379', false) AS funcao_gatilho_da_22
    FROM arq_sinais s
),
arq_estado AS (
  SELECT a.*,
         CASE
           WHEN a.versao = 'ausente' THEN 'rotina_ausente'
           WHEN a.versao = 'desconhecida' THEN 'desconhecida'
           WHEN a.versao = '22' AND NOT a.canal_existe AND a.funcoes_25 = 0 AND a.funcoes_26 = 0
                AND a.gatilhos_despertar = 1 AND a.gatilho_original AND a.funcao_gatilho_da_22 AND a.colunas_30 = 0 THEN 'antes_da_25'
           WHEN a.versao = '25' AND a.canal_certo AND a.funcoes_25 = 3 AND a.funcoes_26 = 0
                AND a.gatilhos_despertar = 1 AND a.gatilho_original AND a.funcao_gatilho_da_22 AND a.colunas_30 = 0 THEN 'A'
           WHEN a.versao = '27' AND a.canal_certo AND a.funcoes_25 = 3 AND a.funcoes_26 = 0
                AND a.gatilhos_despertar = 0 AND NOT a.funcao_gatilho_existe AND a.colunas_30 = 0 THEN 'B'
           WHEN a.versao = '26' AND a.canal_certo AND a.funcoes_25 = 3 AND a.funcoes_26 = 3
                AND a.gatilhos_despertar = 0 AND NOT a.funcao_gatilho_existe AND a.colunas_30 = 0 THEN 'C'
           WHEN a.versao = '30' AND a.canal_certo AND a.funcoes_25 = 3 AND a.funcoes_26 = 3
                AND a.gatilhos_despertar = 0 AND NOT a.funcao_gatilho_existe AND a.colunas_30 = 3 THEN 'D'
           ELSE 'inconsistente' END AS estado,
         'rotina ' || a.versao
           || '; coluna canal: ' || CASE WHEN a.canal_certo THEN 'a da 25' WHEN a.canal_existe THEN 'INESPERADA' ELSE 'ausente' END
           || '; funcoes da 25: ' || a.funcoes_25 || '/3; da 26: ' || a.funcoes_26 || '/3'
           || '; colunas da 30: ' || a.colunas_30 || '/3'
           || '; gatilhos que acordam o backend: ' || coalesce(a.nomes_gatilhos, 'nenhum')
           || '; funcao do gatilho: ' || CASE WHEN NOT a.funcao_gatilho_existe THEN 'ausente'
                                              WHEN a.funcao_gatilho_da_22 THEN 'a da 22' ELSE 'DESCONHECIDA' END AS sinais
    FROM arq a
),

-- A. dispositivos_push: RLS ligado e sem policy (o app e o site nunca leem a
--    tabela direto); so as funcoes do banco e a service_role chegam aos aparelhos.
r_a AS (
  SELECT 1 AS ordem, 1 AS sub, 'A. dispositivos_push' AS area, 'tabela, RLS e policies' AS item,
         CASE WHEN c.oid IS NULL THEN 'nao existe'
              ELSE 'existe; dono ' || pg_get_userbyid(c.relowner)
                || '; RLS ' || CASE WHEN c.relrowsecurity THEN 'ligado' ELSE 'DESLIGADO' END
                || CASE WHEN c.relforcerowsecurity THEN ' e forcado' ELSE '' END
                || '; policies: ' || (SELECT count(*) FROM pg_policy pol WHERE pol.polrelid = c.oid) END AS resultado,
         CASE WHEN c.oid IS NULL OR NOT c.relrowsecurity
                OR EXISTS (SELECT 1 FROM pg_policy pol WHERE pol.polrelid = c.oid) THEN 'PROBLEMA'
              ELSE 'OK' END AS situacao
    FROM (SELECT to_regclass('public.dispositivos_push')::oid AS t) x
    LEFT JOIN pg_class c ON c.oid = x.t
  UNION ALL
  -- A rota /api/notificacoes/teste le os aparelhos do proprio usuario com a
  -- service_role: precisa ler a tabela e ignorar o RLS (sem policy, o RLS
  -- esconderia todas as linhas)
  SELECT 1, 2, 'A. dispositivos_push', 'service_role (rota /api/notificacoes/teste)',
         CASE WHEN m.papel_oid IS NULL THEN 'papel service_role nao existe'
              WHEN m.objeto IS NULL THEN 'tabela nao existe'
              ELSE 'privilegios: ' || m.lista
                || '; ignora RLS: ' || CASE WHEN p.ignora_rls THEN 'sim' ELSE 'NAO' END END,
         CASE WHEN coalesce(m.le AND p.ignora_rls, false) THEN 'OK' ELSE 'PROBLEMA' END
    FROM matriz m
    JOIN papeis p ON p.nome = m.papel
   WHERE m.chave = 'dispositivos_push' AND m.papel = 'service_role'
  UNION ALL
  -- Funcoes que leem ou gravam os aparelhos (envio, desativacao, registro pelo
  -- app). Rodam como o dono (SECURITY DEFINER), que precisa de acesso a tabela
  -- e de passar pelo RLS: ser o dono dela (sem RLS forcado) ou ter BYPASSRLS.
  SELECT 1, 3, 'A. dispositivos_push', 'funcao ' || p.oid::regprocedure::text,
         'dono ' || dono.rolname
           || '; SECURITY DEFINER: ' || CASE WHEN p.prosecdef THEN 'sim' ELSE 'NAO' END
           || '; le e grava os aparelhos: ' || CASE WHEN a.acesso THEN 'sim' ELSE 'NAO' END,
         CASE WHEN p.prosecdef AND a.acesso THEN 'OK' ELSE 'PROBLEMA' END
    FROM pg_proc p
    JOIN pg_class c ON c.oid = to_regclass('public.dispositivos_push')::oid
    JOIN pg_roles dono ON dono.oid = p.proowner
    CROSS JOIN LATERAL (
      SELECT has_table_privilege(p.proowner, c.oid, 'SELECT')
         AND has_table_privilege(p.proowner, c.oid, 'INSERT')
         AND has_table_privilege(p.proowner, c.oid, 'UPDATE')
         AND has_table_privilege(p.proowner, c.oid, 'DELETE')
         AND (dono.rolsuper OR dono.rolbypassrls
              OR (pg_has_role(p.proowner, c.relowner, 'USAGE') AND NOT c.relforcerowsecurity)) AS acesso
    ) a
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.prosrc ILIKE '%dispositivos_push%'
),

-- A. Usuarios comuns (anon e authenticated) sem acesso direto as tabelas das
--    notificacoes, nem por colunas. notificacao_config entra porque quem
--    trocasse a URL passaria a receber o segredo nas chamadas do banco.
r_usuarios AS (
  SELECT 1 AS ordem, 4 AS sub, 'A. Acesso de usuarios comuns' AS area, 'public.' || m.chave AS item,
         'anon: ' || coalesce(max(m.lista) FILTER (WHERE m.papel = 'anon'), '?')
           || '; authenticated: ' || coalesce(max(m.lista) FILTER (WHERE m.papel = 'authenticated'), '?') AS resultado,
         CASE WHEN bool_and(m.lista = 'nenhum') FILTER (WHERE m.papel IN ('anon', 'authenticated')) THEN 'OK'
              ELSE 'PROBLEMA' END AS situacao
    FROM matriz m
   WHERE m.chave IN ('dispositivos_push', 'notificacao_preferencias', 'notificacoes',
                     'notificacao_envios', 'notificacao_config')
   GROUP BY m.chave
  UNION ALL
  -- O Realtime so entrega o que o RLS deixa ler, mas estas tabelas nao tem
  -- motivo para estar em publicacao nenhuma
  SELECT 1, 5, 'A. Acesso de usuarios comuns', 'tabelas das notificacoes no Realtime (publicacoes)',
         coalesce((SELECT string_agg(pt.pubname || ': ' || pt.tablename, ', ' ORDER BY pt.pubname, pt.tablename)
                     FROM pg_publication_tables pt
                    WHERE pt.schemaname = 'public'
                      AND pt.tablename IN ('dispositivos_push', 'notificacao_preferencias', 'notificacoes',
                                           'notificacao_envios', 'notificacao_config')), 'nenhuma'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_publication_tables pt
                            WHERE pt.schemaname = 'public'
                              AND pt.tablename IN ('dispositivos_push', 'notificacao_preferencias', 'notificacoes',
                                                   'notificacao_envios', 'notificacao_config'))
              THEN 'ATENCAO' ELSE 'OK' END
),

-- B. Fila do pg_net. Cada chamada do banco ao backend vira uma linha em
--    net.http_request_queue, com os cabecalhos (inclusive o segredo), ate o
--    pg_net enviar o pedido. As respostas ficam em net._http_response, sem os
--    cabecalhos enviados.
r_b AS (
  SELECT 2 AS ordem, 1 AS sub, 'B. Fila do pg_net' AS area, 'net.http_request_queue e net._http_response' AS item,
         'fila: ' || CASE WHEN f.oid IS NULL THEN 'NAO existe' ELSE 'existe' END
           || '; respostas: ' || CASE WHEN r.oid IS NULL THEN 'NAO existe' ELSE 'existe' END AS resultado,
         CASE WHEN f.oid IS NULL OR r.oid IS NULL THEN 'ATENCAO' ELSE 'OK' END AS situacao
    FROM (SELECT oid FROM objetos WHERE chave = 'fila') f,
         (SELECT oid FROM objetos WHERE chave = 'respostas') r
  UNION ALL
  SELECT 2, 2, 'B. Fila do pg_net', 'quem consegue ler a fila (e os cabecalhos)',
         coalesce((SELECT lista FROM leitores WHERE chave = 'fila'), 'fila ausente'),
         CASE WHEN EXISTS (SELECT 1 FROM matriz
                            WHERE chave = 'fila' AND papel IN ('anon', 'authenticated') AND le)
              THEN 'PROBLEMA' ELSE 'OK' END
  UNION ALL
  SELECT 2, 3, 'B. Fila do pg_net', m.papel,
         'uso do schema net: ' || CASE WHEN m.usa_schema THEN 'sim' ELSE 'nao' END
           || '; fila: ' || coalesce(m.lista, '?')
           || '; respostas: ' || coalesce(r.lista, '?'),
         CASE WHEN m.le THEN 'PROBLEMA' WHEN r.le THEN 'ATENCAO' ELSE 'OK' END
    FROM matriz m
    JOIN matriz r ON r.papel = m.papel AND r.chave = 'respostas'
   WHERE m.chave = 'fila' AND m.papel IN ('anon', 'authenticated')
  UNION ALL
  -- Mesmo com permissao, a API so alcanca os schemas expostos. O esperado e
  -- public e graphql_public, nunca net ou vault.
  SELECT 2, 4, 'B. Fila do pg_net', 'schemas expostos pela API (vale para net e vault)',
         coalesce('pgrst.db_schemas = ' || a.schemas,
                  'configuracao nao visivel no banco: confira no painel (Project Settings > Data API > Exposed schemas)'),
         CASE WHEN a.schemas IS NULL THEN 'ATENCAO'
              WHEN a.schemas ~* '(^|[\s,])(net|vault)(\s|,|$)' THEN 'PROBLEMA'
              ELSE 'OK' END
    FROM api a
),

-- C. Supabase Vault. A migration 24 le o segredo pelo nome
--    notificacoes_segredo_backend em vault.decrypted_secrets, como o dono de
--    despertar_backend.
r_c AS (
  SELECT 3 AS ordem, 1 AS sub, 'C. Supabase Vault' AS area, 'extensao supabase_vault e schema vault' AS item,
         coalesce('extensao ' || e.extversion, 'extensao NAO instalada')
           || '; schema vault: ' || CASE WHEN to_regnamespace('vault') IS NULL THEN 'NAO existe' ELSE 'existe' END AS resultado,
         CASE WHEN e.oid IS NULL OR to_regnamespace('vault') IS NULL THEN 'PROBLEMA' ELSE 'OK' END AS situacao
    FROM (SELECT 1) AS um
    LEFT JOIN pg_extension e ON e.extname = 'supabase_vault'
  UNION ALL
  SELECT 3, 2, 'C. Supabase Vault', 'vault.secrets, vault.decrypted_secrets e vault.create_secret',
         'secrets: ' || CASE WHEN s.oid IS NULL THEN 'NAO existe' ELSE 'existe' END
           || '; decrypted_secrets: ' || CASE WHEN d.oid IS NULL THEN 'NAO existe' ELSE 'existe' END
           || '; create_secret: ' || CASE WHEN c.cs THEN 'existe' ELSE 'NAO existe' END,
         CASE WHEN s.oid IS NULL OR d.oid IS NULL OR NOT c.cs THEN 'PROBLEMA' ELSE 'OK' END
    FROM (SELECT oid FROM objetos WHERE chave = 'segredos') s,
         (SELECT oid FROM objetos WHERE chave = 'segredos_abertos') d,
         (SELECT EXISTS (SELECT 1 FROM pg_proc
                          WHERE proname = 'create_secret' AND pronamespace = to_regnamespace('vault')) AS cs) c
  UNION ALL
  SELECT 3, 3, 'C. Supabase Vault', m.papel,
         'uso do schema vault: ' || CASE WHEN m.usa_schema THEN 'sim' ELSE 'nao' END
           || '; secrets: ' || coalesce(m.lista, '?')
           || '; decrypted_secrets: ' || coalesce(d.lista, '?'),
         CASE WHEN m.le OR d.le THEN 'PROBLEMA' ELSE 'OK' END
    FROM matriz m
    JOIN matriz d ON d.papel = m.papel AND d.chave = 'segredos_abertos'
   WHERE m.chave = 'segredos' AND m.papel IN ('anon', 'authenticated')
  UNION ALL
  SELECT 3, 4, 'C. Supabase Vault', 'quem consegue ler os segredos abertos (decrypted_secrets)',
         coalesce((SELECT lista FROM leitores WHERE chave = 'segredos_abertos'), 'view ausente'),
         CASE WHEN EXISTS (SELECT 1 FROM matriz
                            WHERE chave = 'segredos_abertos' AND papel IN ('anon', 'authenticated') AND le)
              THEN 'PROBLEMA' ELSE 'OK' END
  UNION ALL
  -- despertar_backend roda como o dono (SECURITY DEFINER): e ele quem le o segredo
  SELECT 3, 5, 'C. Supabase Vault', 'dono de despertar_backend consegue ler o segredo',
         CASE WHEN dsp.oid IS NULL THEN 'despertar_backend nao existe'
              WHEN d.oid IS NULL THEN 'vault.decrypted_secrets nao existe'
              ELSE pg_get_userbyid(dsp.proowner) || ': '
                || CASE WHEN has_schema_privilege(dsp.proowner, d.ns, 'USAGE')
                         AND has_table_privilege(dsp.proowner, d.oid, 'SELECT') THEN 'sim' ELSE 'NAO' END END,
         CASE WHEN dsp.oid IS NOT NULL AND d.oid IS NOT NULL
               AND has_schema_privilege(dsp.proowner, d.ns, 'USAGE')
               AND has_table_privilege(dsp.proowner, d.oid, 'SELECT') THEN 'OK'
              ELSE 'PROBLEMA' END
    FROM despertar dsp,
         (SELECT oid, ns FROM objetos WHERE chave = 'segredos_abertos') d
  UNION ALL
  -- So o nome: conta as linhas com esse nome, sem ler o valor
  SELECT 3, 6, 'C. Supabase Vault', 'segredo notificacoes_segredo_backend',
         sg.resultado,
         CASE WHEN sg.resultado = 'existe' THEN 'OK'
              WHEN sg.resultado = 'NAO existe' THEN 'PENDENTE'
              ELSE 'ATENCAO' END
    FROM (SELECT CASE
                   WHEN s.oid IS NULL THEN 'vault.secrets nao existe'
                   WHEN NOT (has_schema_privilege(s.ns, 'USAGE') AND has_any_column_privilege(s.oid, 'SELECT'))
                     THEN 'sem permissao para conferir (rode como postgres)'
                   ELSE coalesce((xpath('/row/x/text()', query_to_xml(
                     $q$SELECT CASE WHEN count(*) > 0 THEN 'existe' ELSE 'NAO existe' END AS x
                          FROM vault.secrets WHERE name = 'notificacoes_segredo_backend'$q$,
                     false, true, '')))[1]::text, '?') END AS resultado
            FROM (SELECT oid, ns FROM objetos WHERE chave = 'segredos') s) sg
  UNION ALL
  SELECT 3, 7, 'C. Supabase Vault', 'migration 24 (despertar_backend envia o segredo)',
         CASE WHEN dsp.oid IS NULL THEN 'despertar_backend nao existe'
              WHEN dsp.prosrc ILIKE '%notificacoes_segredo_backend%' AND dsp.prosrc ILIKE '%X-Notificacoes-Segredo%'
                THEN 'aplicada: le notificacoes_segredo_backend e envia X-Notificacoes-Segredo'
              ELSE 'nao aplicada (versao da migration 22, sem segredo)' END,
         CASE WHEN dsp.oid IS NULL THEN 'PROBLEMA'
              WHEN dsp.prosrc ILIKE '%notificacoes_segredo_backend%' AND dsp.prosrc ILIKE '%X-Notificacoes-Segredo%'
                THEN 'OK'
              ELSE 'PENDENTE' END
    FROM despertar dsp
),

-- D. Funcoes da comunicacao entre o banco e o backend. Todas rodam como o dono
--    (SECURITY DEFINER) com search_path fixo; nenhuma pode ser executada por
--    PUBLIC, anon ou authenticated; as do backend precisam da service_role.
fn(sub, assinatura, uso) AS (
  VALUES (1, 'public.despertar_backend()', 'interna'),
         -- So existe antes da migration 27 (a 27 a remove junto com o gatilho)
         (2, 'public.despertar_backend_apos_aviso()', 'gatilho'),
         (3, 'public.rotina_notificacoes()', 'backend'),
         (4, 'public.reservar_notificacoes(integer)', 'backend'),
         (5, 'public.concluir_envio_notificacao(uuid,jsonb)', 'backend'),
         (6, 'public.recibos_pendentes(integer,integer)', 'backend'),
         (7, 'public.registrar_recibos(jsonb)', 'backend'),
         (8, 'public.desativar_dispositivo_push(uuid,text)', 'interna'),
         (9, 'public.expirar_notificacoes()', 'interna'),
         (10, 'public.motivo_para_nao_enviar(public.notificacoes)', 'interna')
),
r_d AS (
  SELECT 4 AS ordem, f.sub, 'D. Funcoes e chamada ao backend' AS area,
         f.assinatura || ' [' || f.uso || ']' AS item,
         CASE WHEN p.oid IS NULL AND f.uso = 'gatilho' AND e.versao IN ('27', '26', '30')
                THEN 'removida pela migration 27 (esperado)'
              WHEN p.oid IS NULL THEN 'nao existe'
              WHEN f.uso = 'gatilho' AND e.versao IN ('27', '26', '30')
                THEN 'AINDA EXISTE: com a rotina da migration ' || e.versao || ' nao deveria existir'
              ELSE 'dono ' || pg_get_userbyid(p.proowner)
                || '; SECURITY DEFINER: ' || CASE WHEN p.prosecdef THEN 'sim' ELSE 'NAO' END
                || '; search_path fixo: ' || CASE WHEN x.caminho THEN 'sim' ELSE 'NAO' END
                || '; executam: ' || coalesce(nullif(concat_ws(', ',
                     CASE WHEN x.publico THEN 'PUBLIC' END,
                     CASE WHEN x.anon THEN 'anon' END,
                     CASE WHEN x.logado THEN 'authenticated' END,
                     CASE WHEN x.servico THEN 'service_role' END), ''), 'so o dono') END AS resultado,
         CASE WHEN p.oid IS NULL AND f.uso = 'gatilho' AND e.versao IN ('27', '26', '30') THEN 'OK'
              WHEN p.oid IS NULL OR NOT p.prosecdef OR NOT x.caminho
                OR x.publico OR x.anon OR x.logado THEN 'PROBLEMA'
              WHEN f.uso = 'gatilho' AND e.versao IN ('27', '26', '30') THEN 'PROBLEMA'
              WHEN f.uso = 'backend' AND NOT coalesce(x.servico, false) THEN 'PROBLEMA'
              ELSE 'OK' END AS situacao
    FROM fn f
    CROSS JOIN arq_estado e
    LEFT JOIN pg_proc p ON p.oid = to_regprocedure(f.assinatura)::oid
    CROSS JOIN LATERAL (
      SELECT EXISTS (SELECT 1 FROM unnest(p.proconfig) AS c WHERE c LIKE 'search\_path=%') AS caminho,
             p.oid IS NOT NULL AND (p.proacl IS NULL OR EXISTS (
               SELECT 1 FROM aclexplode(p.proacl) AS a
                WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE')) AS publico,
             has_function_privilege((SELECT oid FROM papeis WHERE nome = 'anon'), p.oid, 'EXECUTE') AS anon,
             has_function_privilege((SELECT oid FROM papeis WHERE nome = 'authenticated'), p.oid, 'EXECUTE') AS logado,
             has_function_privilege((SELECT oid FROM papeis WHERE nome = 'service_role'), p.oid, 'EXECUTE') AS servico
    ) x
  UNION ALL
  SELECT 4, 11, 'D. Funcoes e chamada ao backend', 'net.http_post (usada por despertar_backend)',
         CASE WHEN dsp.oid IS NULL THEN 'despertar_backend nao existe'
              WHEN NOT h.existe THEN 'pg_net ausente'
              ELSE pg_get_userbyid(dsp.proowner) || ' (dono de despertar_backend) '
                || CASE WHEN h.pode THEN 'pode executar' ELSE 'NAO pode executar' END END,
         CASE WHEN dsp.oid IS NULL OR NOT h.existe THEN 'ATENCAO'
              WHEN h.pode THEN 'OK' ELSE 'PROBLEMA' END
    FROM despertar dsp
    CROSS JOIN LATERAL (
      SELECT EXISTS (SELECT 1 FROM pg_proc
                      WHERE proname = 'http_post' AND pronamespace = to_regnamespace('net')) AS existe,
             coalesce(has_schema_privilege(dsp.proowner, to_regnamespace('net')::oid, 'USAGE')
                      AND (SELECT bool_or(has_function_privilege(dsp.proowner, hp.oid, 'EXECUTE'))
                             FROM pg_proc hp
                            WHERE hp.proname = 'http_post' AND hp.pronamespace = to_regnamespace('net')),
                      false) AS pode
    ) h
  UNION ALL
  -- A migration 24 troca despertar_backend: so o dono (ou membro do papel
  -- dono) consegue
  SELECT 4, 12, 'D. Funcoes e chamada ao backend', 'quem roda esta consulta pode aplicar a migration 24',
         CASE WHEN dsp.oid IS NULL THEN 'despertar_backend nao existe'
              ELSE current_user
                || CASE WHEN pg_has_role(current_user, dsp.proowner, 'MEMBER') THEN ' pode' ELSE ' NAO pode' END
                || ' (dono: ' || pg_get_userbyid(dsp.proowner) || ')' END,
         CASE WHEN dsp.oid IS NOT NULL AND pg_has_role(current_user, dsp.proowner, 'MEMBER') THEN 'OK'
              ELSE 'ATENCAO' END
    FROM despertar dsp
  UNION ALL
  -- Usuario com que o pg_cron roda cada job e se ele pode executar a funcao chamada
  SELECT 4, 13, 'D. Funcoes e chamada ao backend', 'jobs do pg_cron (usuario que executa)',
         j.resultado,
         CASE WHEN j.resultado LIKE '%SEM permissao%' THEN 'PROBLEMA'
              WHEN j.resultado LIKE '%roda como%' THEN 'OK'
              ELSE 'ATENCAO' END
    FROM (SELECT CASE WHEN to_regclass('cron.job') IS NULL THEN 'pg_cron ausente'
                      ELSE coalesce((xpath('/row/x/text()', query_to_xml(
                        $q$SELECT string_agg(j.jobname || ': roda como ' || j.username
                                 || CASE WHEN has_function_privilege(j.username::name, f.oid, 'EXECUTE')
                                         THEN ' (pode executar)' ELSE ' (SEM permissao)' END,
                                 '; ' ORDER BY j.jobname) AS x
                             FROM cron.job j
                             JOIN (VALUES ('notificacoes-rotina', to_regprocedure('public.rotina_notificacoes()')::oid),
                                          ('notificacoes-limpeza', to_regprocedure('public.limpar_notificacoes_antigas(integer)')::oid))
                                  AS f(jobname, oid) ON f.jobname = j.jobname$q$,
                        false, true, '')))[1]::text, 'jobs nao agendados') END AS resultado) j
  UNION ALL
  -- A URL e o ultimo passo da ativacao: sem ela o banco nao chama ninguem
  SELECT 4, 14, 'D. Funcoes e chamada ao backend', 'notificacao_config.url_backend',
         CASE WHEN u.url IS NULL THEN 'NAO configurada'
              WHEN u.url = '-' THEN 'tabela notificacao_config nao existe'
              ELSE u.url || ' (ja configurada: o banco ja tenta chamar o backend)' END,
         CASE WHEN u.url IS NULL THEN 'PENDENTE'
              WHEN u.url LIKE 'https://%' THEN 'ATENCAO'
              ELSE 'PROBLEMA' END
    FROM (SELECT CASE WHEN to_regclass('public.notificacao_config') IS NULL THEN '-'
                      ELSE (xpath('/row/x/text()', query_to_xml(
                        $q$SELECT max(url_backend) AS x FROM public.notificacao_config$q$,
                        false, true, '')))[1]::text END AS url) u
  UNION ALL
  -- Antes de ativar: so a migration 27 (B) ou a 26 depois da 27 (C). Sem a 27,
  -- o banco chamaria o backend por qualquer aviso, inclusive do push. Versao
  -- desconhecida da rotina, gatilho inesperado ou funcoes de versoes que nao
  -- combinam nunca passam.
  SELECT 4, 15, 'D. Funcoes e chamada ao backend', 'estado da arquitetura de acionamento (migrations 25, 27 e 26)',
         CASE e.estado
           WHEN 'antes_da_25' THEN 'antes da migration 25: aplique a 25 e a 27'
           WHEN 'A' THEN 'A: migration 25 sem a 27: aplique a 27 antes de ativar'
           WHEN 'B' THEN 'B: migration 27 (so o canal whatsapp acorda o backend)'
           WHEN 'C' THEN 'C: migration 26 depois da 27'
           WHEN 'D' THEN 'D: migration 30 (central; o push acorda o backend so com push_ativo)'
           WHEN 'desconhecida' THEN 'rotina_notificacoes com versao DESCONHECIDA (md5 ' || e.hash_rotina || '): nao ative'
           WHEN 'rotina_ausente' THEN 'rotina_notificacoes NAO existe'
           ELSE 'INCONSISTENTE: nao ative' END || ' | ' || e.sinais,
         CASE WHEN e.estado IN ('B', 'C', 'D') THEN 'OK'
              WHEN e.estado IN ('antes_da_25', 'A') THEN 'PENDENTE'
              ELSE 'PROBLEMA' END
    FROM arq_estado e
  UNION ALL
  -- O job de cada minuto: um so, ativo, com exatamente esta agenda e este comando
  SELECT 4, 16, 'D. Funcoes e chamada ao backend', 'job notificacoes-rotina (unico, ativo, agenda e comando exatos)',
         j.resultado,
         CASE WHEN j.resultado = 'ativo; agenda: * * * * *; comando: SELECT public.rotina_notificacoes();' THEN 'OK'
              ELSE 'PROBLEMA' END
    FROM (SELECT CASE WHEN to_regclass('cron.job') IS NULL THEN 'pg_cron ausente'
                      ELSE coalesce((xpath('/row/x/text()', query_to_xml(
                        $q$SELECT CASE WHEN count(*) = 0 THEN 'job NAO agendado'
                                       WHEN count(*) > 1 THEN count(*) || ' jobs com esse nome'
                                       ELSE CASE WHEN bool_and(active) THEN 'ativo' ELSE 'DESATIVADO' END
                                         || '; agenda: ' || max(schedule) || '; comando: ' || max(command) END AS x
                             FROM cron.job WHERE jobname = 'notificacoes-rotina'$q$,
                        false, true, '')))[1]::text, '?') END AS resultado) j
  UNION ALL
  -- Marcador do push no banco (migration 30): o ULTIMO passo da ativacao.
  -- Desligado, o push nao acorda o backend nem e reservado.
  SELECT 4, 17, 'D. Funcoes e chamada ao backend', 'marcador do push no banco (notificacao_config.push_ativo)',
         m.resultado,
         CASE WHEN m.resultado LIKE 'ligado%' THEN 'OK' ELSE 'PENDENTE' END
    FROM (SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM pg_attribute a
                                        WHERE a.attrelid = to_regclass('public.notificacao_config')
                                          AND a.attname = 'push_ativo' AND NOT a.attisdropped)
                      THEN 'nao existe: aplique a migration 30'
                      ELSE coalesce((xpath('/row/x/text()', query_to_xml(
                        $q$SELECT CASE WHEN bool_or(push_ativo) THEN 'ligado desde '
                                         || coalesce(to_char(max(push_ativado_em) AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI'), '?')
                                       ELSE 'desligado (ligue por ultimo, depois do Render)' END AS x
                             FROM public.notificacao_config WHERE id$q$,
                        false, true, '')))[1]::text, '?') END AS resultado) m
)
SELECT area, item, resultado, situacao
  FROM (
    SELECT * FROM r_a
    UNION ALL SELECT * FROM r_usuarios
    UNION ALL SELECT * FROM r_b
    UNION ALL SELECT * FROM r_c
    UNION ALL SELECT * FROM r_d
  ) t
 ORDER BY ordem, sub, item;
