-- =====================================================================
-- Auditoria das notificacoes push (depois das migrations 21, 22 e 23)
--
-- SOMENTE LEITURA: uma unica consulta; nao cria, nao altera e nao apaga nada.
-- Rode no Supabase Dashboard > SQL Editor e mande o resultado.
-- Coluna "situacao":
--   OK        como esperado
--   ATENCAO   funciona, mas leia o resultado
--   PROBLEMA  precisa ser corrigido
-- Se a consulta falhar com "relation ... does not exist", a 21 ou a 22 nao
-- rodou por completo (isso ja e o diagnostico).
-- =====================================================================
WITH
-- 1. Tabelas: existem, RLS ligado, sem policy, sem acesso direto do app/site
tabelas(nome) AS (
  VALUES ('dispositivos_push'), ('notificacao_preferencias'), ('notificacoes'),
         ('notificacao_envios'), ('notificacao_config')
),
t_estado AS (
  SELECT t.nome, c.oid, c.relrowsecurity AS rls,
         (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = t.nome) AS policies,
         CASE WHEN c.oid IS NULL THEN NULL
              ELSE has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE') END AS acesso_app
    FROM tabelas t
    LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || t.nome)
),
r_tabelas AS (
  SELECT 1 AS ordem, 'Tabela' AS area, nome AS item,
         CASE WHEN oid IS NULL THEN 'nao existe'
              ELSE 'RLS ' || CASE WHEN rls THEN 'ligado' ELSE 'DESLIGADO' END
                || '; policies: ' || policies
                || '; app/site acessam direto: ' || CASE WHEN acesso_app THEN 'SIM' ELSE 'nao' END END AS resultado,
         CASE WHEN oid IS NULL OR NOT rls OR policies > 0 OR acesso_app THEN 'PROBLEMA' ELSE 'OK' END AS situacao
    FROM t_estado
),

-- 2. Funcoes: existem e com a permissao certa
funcoes(assinatura, publico) AS (
  VALUES
    ('public.registrar_dispositivo_push(text,text)', 'app'),
    ('public.remover_dispositivo_push(text)', 'app'),
    ('public.minhas_preferencias_notificacao()', 'app'),
    ('public.salvar_preferencias_notificacao(jsonb)', 'app'),
    ('public.pedir_notificacao_teste()', 'app'),
    ('public.reservar_notificacoes(integer)', 'backend'),
    ('public.concluir_envio_notificacao(uuid,jsonb)', 'backend'),
    ('public.recibos_pendentes(integer,integer)', 'backend'),
    ('public.registrar_recibos(jsonb)', 'backend'),
    ('public.rotina_notificacoes()', 'backend'),
    ('public.expirar_notificacoes()', 'interna'),
    ('public.motivo_para_nao_enviar(public.notificacoes)', 'interna'),
    ('public.desativar_dispositivo_push(uuid,text)', 'interna'),
    ('public.primeiro_nome(text,text)', 'interna'),
    ('public.inserir_notificacao(text,text,uuid,uuid,jsonb,timestamp with time zone,uuid,uuid,uuid)', 'interna'),
    ('public.avisar_agendamento(text,uuid,uuid)', 'interna'),
    ('public.notificar_novo_agendamento()', 'interna'),
    ('public.notificar_cancelamento()', 'interna'),
    ('public.notificar_mensagem()', 'interna'),
    ('public.enfileirar_lembretes()', 'interna'),
    ('public.despertar_backend()', 'interna'),
    ('public.despertar_backend_apos_aviso()', 'interna'),
    ('public.limpar_notificacoes_antigas(integer)', 'interna')
),
f_estado AS (
  SELECT f.assinatura, f.publico, to_regprocedure(f.assinatura) AS oid,
         EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') AS tem_service
    FROM funcoes f
),
f_perm AS (
  SELECT assinatura, publico, oid,
         CASE WHEN oid IS NOT NULL THEN has_function_privilege('anon', oid, 'EXECUTE') END AS anon,
         CASE WHEN oid IS NOT NULL THEN has_function_privilege('authenticated', oid, 'EXECUTE') END AS logado,
         CASE WHEN oid IS NOT NULL AND tem_service THEN has_function_privilege('service_role', oid, 'EXECUTE') END AS servico
    FROM f_estado
),
r_funcoes AS (
  SELECT 2, 'Funcao (' || publico || ')', assinatura,
         CASE WHEN oid IS NULL THEN 'nao existe'
              ELSE 'anon: ' || CASE WHEN anon THEN 'SIM' ELSE 'nao' END
                || '; logado: ' || CASE WHEN logado THEN 'sim' ELSE 'nao' END
                || coalesce('; service_role: ' || CASE WHEN servico THEN 'sim' ELSE 'nao' END, '') END,
         CASE WHEN oid IS NULL OR anon THEN 'PROBLEMA'
              WHEN publico = 'app' AND NOT logado THEN 'PROBLEMA'
              WHEN publico <> 'app' AND logado THEN 'PROBLEMA'
              WHEN publico = 'backend' AND servico IS FALSE THEN 'PROBLEMA'
              ELSE 'OK' END
    FROM f_perm
),

-- 3. Triggers novos e os de regras que ja existiam (nenhum pode estar desligado)
gatilhos(nome, tabela) AS (
  VALUES ('notificar_novo_agendamento', 'agendamentos'),
         ('notificar_cancelamento', 'agendamentos'),
         ('notificar_mensagem', 'mensagens'),
         ('despertar_backend', 'notificacoes'),
         ('validar_agendamento', 'agendamentos'),
         ('agendamento_lancamentos', 'agendamentos')
),
r_triggers AS (
  SELECT 3, 'Trigger', g.nome || ' em ' || g.tabela,
         CASE WHEN tg.oid IS NULL THEN 'nao existe'
              WHEN tg.tgenabled = 'D' THEN 'DESLIGADO' ELSE 'ativo' END,
         CASE WHEN tg.oid IS NULL OR tg.tgenabled = 'D' THEN 'PROBLEMA' ELSE 'OK' END
    FROM gatilhos g
    LEFT JOIN pg_trigger tg
      ON tg.tgname = g.nome AND tg.tgrelid = to_regclass('public.' || g.tabela) AND NOT tg.tgisinternal
),

-- 4. Extensoes
r_extensoes AS (
  SELECT 4, 'Extensao', x.nome,
         coalesce('instalada ' || e.extversion || ' (schema ' || n.nspname || ')', 'NAO instalada'),
         CASE WHEN e.oid IS NULL THEN 'PROBLEMA' ELSE 'OK' END
    FROM (VALUES ('pg_cron'), ('pg_net')) AS x(nome)
    LEFT JOIN pg_extension e ON e.extname = x.nome
    LEFT JOIN pg_namespace n ON n.oid = e.extnamespace
  UNION ALL
  SELECT 4, 'Extensao', 'net.http_post (usada para acordar o backend)',
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'http_post' AND pronamespace = to_regnamespace('net'))
              THEN 'existe' ELSE 'NAO existe' END,
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'http_post' AND pronamespace = to_regnamespace('net'))
              THEN 'OK' ELSE 'PROBLEMA' END
),

-- 5. Rotina automatica (jobs do pg_cron) e suas execucoes na ultima hora.
--    So consulta o pg_cron se ele existir.
jobs(nome) AS (VALUES ('notificacoes-rotina'), ('notificacoes-limpeza')),
j_estado AS (
  SELECT j.nome,
         CASE WHEN to_regclass('cron.job') IS NULL THEN 'pg_cron ausente'
              ELSE coalesce((xpath('/row/x/text()', query_to_xml(format(
                $q$SELECT string_agg(schedule || ' | ativo=' || active || ' | ' || command, '; ') AS x
                     FROM cron.job WHERE jobname = %L$q$, j.nome), false, true, '')))[1]::text,
                'job NAO agendado') END AS resultado
    FROM jobs j
),
r_jobs AS (
  SELECT 5, 'Rotina (pg_cron)', nome, resultado,
         CASE WHEN resultado LIKE '%ativo=true%' THEN 'OK' ELSE 'PROBLEMA' END
    FROM j_estado
  UNION ALL
  SELECT 5, 'Rotina (pg_cron)', 'execucoes de notificacoes-rotina na ultima hora',
         CASE WHEN to_regclass('cron.job_run_details') IS NULL THEN 'pg_cron ausente'
              ELSE coalesce((xpath('/row/x/text()', query_to_xml(
                $q$SELECT (SELECT count(*) FROM cron.job_run_details d JOIN cron.job j USING (jobid)
                            WHERE j.jobname = 'notificacoes-rotina' AND d.start_time > now() - interval '1 hour')
                          || ' execucoes; com falha: '
                          || (SELECT count(*) FROM cron.job_run_details d JOIN cron.job j USING (jobid)
                               WHERE j.jobname = 'notificacoes-rotina' AND d.start_time > now() - interval '1 hour'
                                 AND d.status = 'failed')
                          || '; ultima: '
                          || coalesce((SELECT d.status || ' em ' || to_char(d.start_time AT TIME ZONE 'America/Sao_Paulo', 'DD/MM HH24:MI')
                                              || coalesce(' - ' || left(d.return_message, 150), '')
                                         FROM cron.job_run_details d JOIN cron.job j USING (jobid)
                                        WHERE j.jobname = 'notificacoes-rotina'
                                        ORDER BY d.start_time DESC LIMIT 1), 'nenhuma') AS x$q$,
                false, true, '')))[1]::text, '?') END,
         'ATENCAO'
),

-- 6. Chamadas do pg_net nas ultimas 6 horas (codigo HTTP x quantidade)
r_pgnet AS (
  SELECT 6, 'Chamadas ao backend (pg_net)', 'respostas nas ultimas 6 h',
         CASE WHEN to_regclass('net._http_response') IS NULL THEN 'pg_net ausente'
              ELSE coalesce((xpath('/row/x/text()', query_to_xml(
                $q$SELECT coalesce(string_agg(r.codigo || ': ' || r.n, ', '), 'nenhuma chamada') AS x
                     FROM (SELECT coalesce(status_code::text, 'erro ' || left(coalesce(error_msg, '?'), 60)) AS codigo,
                                  count(*) AS n
                             FROM net._http_response
                            WHERE created > now() - interval '6 hours'
                            GROUP BY 1 ORDER BY 2 DESC LIMIT 5) r$q$,
                false, true, '')))[1]::text, '?') END,
         'ATENCAO'
),

-- 7. URL do backend
r_url AS (
  SELECT 7, 'Configuracao', 'notificacao_config.url_backend',
         coalesce(url_backend, 'NAO configurada'),
         CASE WHEN url_backend IS NULL THEN 'ATENCAO' ELSE 'OK' END
    FROM public.notificacao_config
  UNION ALL
  SELECT 7, 'Configuracao', 'linhas em notificacao_config', count(*)::text,
         CASE WHEN count(*) = 1 THEN 'OK' ELSE 'PROBLEMA' END
    FROM public.notificacao_config
  UNION ALL
  -- So o nome do segredo: o valor nunca e lido
  SELECT 7, 'Configuracao', 'segredo do backend no Vault (notificacoes_segredo_backend)', s.resultado,
         CASE WHEN s.resultado = 'existe' THEN 'OK' ELSE 'ATENCAO' END
    FROM (SELECT CASE WHEN to_regclass('vault.secrets') IS NULL THEN 'Vault ausente'
                      ELSE coalesce((xpath('/row/x/text()', query_to_xml(
                        $q$SELECT CASE WHEN count(*) > 0 THEN 'existe' ELSE 'NAO existe' END AS x
                             FROM vault.secrets WHERE name = 'notificacoes_segredo_backend'$q$,
                        false, true, '')))[1]::text, '?') END AS resultado) s
  UNION ALL
  SELECT 7, 'Configuracao', 'despertar_backend envia o segredo (migration 24)', s.resultado,
         CASE WHEN s.resultado = 'sim' THEN 'OK' ELSE 'ATENCAO' END
    FROM (SELECT CASE WHEN (SELECT prosrc FROM pg_proc WHERE oid = to_regprocedure('public.despertar_backend()'))
                           ILIKE '%X-Notificacoes-Segredo%'
                      THEN 'sim' ELSE 'nao (migration 24 nao aplicada)' END AS resultado) s
),

-- 8. Colunas antigas push_token
antigas AS (
  SELECT c.table_name
    FROM information_schema.columns c
    JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
   WHERE c.table_schema = 'public' AND c.column_name = 'push_token' AND t.table_type = 'BASE TABLE'
),
r_push AS (
  SELECT 8, 'Colunas antigas', 'push_token em barbeiros/profiles',
         coalesce('AINDA EXISTE em: ' || (SELECT string_agg(table_name, ', ') FROM antigas), 'removidas'),
         CASE WHEN EXISTS (SELECT 1 FROM antigas) THEN 'PROBLEMA' ELSE 'OK' END
  UNION ALL
  SELECT 8, 'Colunas antigas', 'funcoes ou views que citam push_token',
         coalesce((SELECT string_agg(n.nspname || '.' || p.proname, ', ')
                     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                    WHERE p.prosrc ILIKE '%push_token%' AND n.nspname NOT IN ('pg_catalog', 'information_schema')),
                  (SELECT string_agg(viewname, ', ') FROM pg_views
                    WHERE definition ILIKE '%push_token%' AND schemaname NOT IN ('pg_catalog', 'information_schema')),
                  'nenhuma'),
         CASE WHEN EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                            WHERE p.prosrc ILIKE '%push_token%' AND n.nspname NOT IN ('pg_catalog', 'information_schema'))
                OR EXISTS (SELECT 1 FROM pg_views WHERE definition ILIKE '%push_token%'
                            AND schemaname NOT IN ('pg_catalog', 'information_schema'))
              THEN 'PROBLEMA' ELSE 'OK' END
),

-- 9. Fila: situacao por tipo, atrasos, falhas e duplicidades
r_fila AS (
  SELECT 9, 'Fila', 'tipo: ' || tipo,
         string_agg(status || ' ' || n, ', ' ORDER BY status), 'OK'
    FROM (SELECT tipo, status, count(*) AS n FROM public.notificacoes GROUP BY 1, 2) q
   GROUP BY tipo
  UNION ALL
  SELECT 9, 'Fila', 'total de avisos', count(*)::text, 'OK' FROM public.notificacoes
  UNION ALL
  SELECT 9, 'Fila', 'pendentes esperando ha mais de 5 min', count(*)::text,
         CASE WHEN count(*) > 0 THEN 'ATENCAO' ELSE 'OK' END
    FROM public.notificacoes WHERE status = 'pendente' AND proxima_tentativa < now() - interval '5 minutes'
  UNION ALL
  SELECT 9, 'Fila', 'em envio com reserva vencida', count(*)::text,
         CASE WHEN count(*) > 0 THEN 'ATENCAO' ELSE 'OK' END
    FROM public.notificacoes WHERE status = 'enviando' AND reservada_ate < now()
  UNION ALL
  SELECT 9, 'Fila', 'com falha (motivos)',
         coalesce((SELECT string_agg(motivo || ' x' || n, ', ')
                     FROM (SELECT coalesce(motivo, '?') AS motivo, count(*) AS n FROM public.notificacoes
                            WHERE status = 'falhou' GROUP BY 1 ORDER BY 2 DESC LIMIT 5) m), 'nenhuma'),
         CASE WHEN EXISTS (SELECT 1 FROM public.notificacoes WHERE status = 'falhou') THEN 'ATENCAO' ELSE 'OK' END
  UNION ALL
  SELECT 9, 'Fila', 'ignoradas (motivos)',
         coalesce((SELECT string_agg(motivo || ' x' || n, ', ')
                     FROM (SELECT coalesce(motivo, '?') AS motivo, count(*) AS n FROM public.notificacoes
                            WHERE status = 'ignorada' GROUP BY 1 ORDER BY 2 DESC LIMIT 5) m), 'nenhuma'),
         'OK'
  UNION ALL
  -- O mesmo evento para o mesmo destinatario mais de uma vez (lembrete conta
  -- por horario; teste pode repetir)
  SELECT 9, 'Fila', 'avisos duplicados', count(*)::text,
         CASE WHEN count(*) > 0 THEN 'PROBLEMA' ELSE 'OK' END
    FROM (SELECT 1 FROM public.notificacoes
           WHERE tipo <> 'teste'
           GROUP BY tipo, destinatario_id, agendamento_id, mensagem_id,
                    CASE WHEN tipo = 'lembrete' THEN dados ->> 'data_hora' END
          HAVING count(*) > 1) d
  UNION ALL
  SELECT 9, 'Fila', 'chave unica (impede duplicidade)',
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
            WHERE i.indrelid = to_regclass('public.notificacoes') AND i.indisunique AND a.attname = 'chave'
              AND i.indnatts = 1)
              THEN 'existe' ELSE 'NAO existe' END,
         CASE WHEN EXISTS (
           SELECT 1 FROM pg_index i JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey)
            WHERE i.indrelid = to_regclass('public.notificacoes') AND i.indisunique AND a.attname = 'chave'
              AND i.indnatts = 1)
              THEN 'OK' ELSE 'PROBLEMA' END
),

-- 10. Consistencia
r_consistencia AS (
  SELECT 10, 'Consistencia', 'avisos "enviada" sem nenhum aparelho que recebeu', count(*)::text,
         CASE WHEN count(*) > 0 THEN 'PROBLEMA' ELSE 'OK' END
    FROM public.notificacoes n
   WHERE n.status = 'enviada'
     AND NOT EXISTS (SELECT 1 FROM public.notificacao_envios e
                      WHERE e.notificacao_id = n.id AND e.status IN ('aceito', 'entregue', 'recusado'))
  UNION ALL
  SELECT 10, 'Consistencia', 'avisos de agendamento para quem nao e cliente nem barbeiro dele', count(*)::text,
         CASE WHEN count(*) > 0 THEN 'PROBLEMA' ELSE 'OK' END
    FROM public.notificacoes n
    JOIN public.agendamentos ag ON ag.id = n.agendamento_id
    JOIN public.barbeiros b ON b.id = ag.barbeiro_id
   WHERE n.destinatario_id IS DISTINCT FROM ag.cliente_id
     AND n.destinatario_id IS DISTINCT FROM b.user_id
  UNION ALL
  SELECT 10, 'Consistencia', 'avisos de mensagem para o proprio remetente', count(*)::text,
         CASE WHEN count(*) > 0 THEN 'PROBLEMA' ELSE 'OK' END
    FROM public.notificacoes n
   WHERE n.tipo = 'mensagem' AND n.destinatario_id = n.ator_id
  UNION ALL
  SELECT 10, 'Consistencia', 'aparelhos registrados (ativos / desativados)',
         count(*) FILTER (WHERE ativo) || ' / ' || count(*) FILTER (WHERE NOT ativo), 'OK'
    FROM public.dispositivos_push
  UNION ALL
  SELECT 10, 'Consistencia', 'preferencias salvas', count(*)::text, 'OK'
    FROM public.notificacao_preferencias
)
SELECT area, item, resultado, situacao
  FROM (
    SELECT * FROM r_tabelas
    UNION ALL SELECT * FROM r_funcoes
    UNION ALL SELECT * FROM r_triggers
    UNION ALL SELECT * FROM r_extensoes
    UNION ALL SELECT * FROM r_jobs
    UNION ALL SELECT * FROM r_pgnet
    UNION ALL SELECT * FROM r_url
    UNION ALL SELECT * FROM r_push
    UNION ALL SELECT * FROM r_fila
    UNION ALL SELECT * FROM r_consistencia
  ) t
 ORDER BY ordem, item;
