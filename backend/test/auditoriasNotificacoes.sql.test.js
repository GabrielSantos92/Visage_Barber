// Auditorias somente leitura (supabase/verificacoes/notificacoes_auditoria.sql e
// notificacoes_pre_ativacao.sql): a arquitetura de acionamento do backend e
// identificada pelo md5 do corpo REAL de public.rotina_notificacoes() no banco
// (pg_proc.prosrc), mais os sinais estruturais (coluna canal, funcoes da 25 e
// da 26, gatilhos que acordam o backend, funcao do gatilho), e o job do
// pg_cron e conferido a parte. Cada cenario monta o banco (PGlite, pg_cron
// SIMULADO por uma tabela cron.job) e roda as DUAS consultas inteiras.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  criarBanco, migration, MIGRATIONS_AGENDA, MIGRATIONS_WHATSAPP, MIGRATIONS_WHATSAPP_27, MIGRATIONS_WHATSAPP_26, MIGRATIONS_PUSH_30,
  JOAO, CORTE_30, CLIENTE_A, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

const RAIZ = path.join(__dirname, '..', '..');
const ler = (rel) => fs.readFileSync(path.join(RAIZ, rel), 'utf8');
const AUDITORIA = ler('supabase/verificacoes/notificacoes_auditoria.sql');
const PRE = ler('supabase/verificacoes/notificacoes_pre_ativacao.sql');
const M22 = '20261109000022_notificacoes_eventos.sql';
const M25 = '20261113000025_whatsapp_confirmacao_presenca.sql';
const M27 = '20261115000027_despertar_so_whatsapp.sql';
const ROLLBACK26 = ler('supabase/rollbacks/20261116000026_rollback.sql');
const ROLLBACK27 = ler('supabase/rollbacks/20261115000027_rollback.sql');
const COMANDO = 'SELECT public.rotina_notificacoes();';

// pg_cron simulado: so a tabela de jobs (a migration 22 nao consegue criar a
// extensao no PGlite, entao os jobs sao gravados pelos testes)
const CRON = `
  CREATE SCHEMA cron;
  CREATE TABLE cron.job (jobid bigserial PRIMARY KEY, jobname text, schedule text, command text,
    active boolean NOT NULL DEFAULT true, username text NOT NULL DEFAULT current_user);
  CREATE TABLE cron.job_run_details (runid bigserial PRIMARY KEY, jobid bigint, status text,
    return_message text, start_time timestamptz);
  CREATE ROLE service_role;`;

async function banco(migracoes, { cron = true, jobs = true } = {}) {
  const db = await criarBanco({ migracoes, antesDasMigrations: cron ? CRON : 'CREATE ROLE service_role;' });
  if (cron && jobs) await agendar(db);
  return db;
}
async function agendar(db, { comando = COMANDO, ativo = true, agenda = '* * * * *' } = {}) {
  await db.query(`INSERT INTO cron.job (jobname, schedule, command, active) VALUES
    ('notificacoes-rotina', $3, $1, $2),
    ('notificacoes-limpeza', '30 6 * * *', 'SELECT public.limpar_notificacoes_antigas();', true)`, [comando, ativo, agenda]);
}

const ITEM_ESTADO_AUD = 'estado da arquitetura (rotina, gatilho, migrations 25, 27 e 26)';
const ITEM_GATILHOS = 'gatilhos em notificacoes que acordam o backend';
const ITEM_ESTADO_PRE = 'estado da arquitetura de acionamento (migrations 25, 27 e 26)';
const ITEM_JOB_PRE = 'job notificacoes-rotina (unico, ativo, agenda e comando exatos)';
const ITEM_JOB_AUD = 'notificacoes-rotina: unico, ativo, agenda e comando';
const ESTADOS = [
  [/^antes da migration 25/, 'antes_da_25'], [/^A: /, 'A'], [/^B: /, 'B'], [/^C: /, 'C'], [/^D: /, 'D'],
  [/^rotina_notificacoes com versao DESCONHECIDA/, 'desconhecida'], [/^rotina_notificacoes NAO existe/, 'rotina_ausente'],
  [/^INCONSISTENTE/, 'inconsistente'],
];
const estadoDe = (resultado) => ESTADOS.find(([rx]) => rx.test(resultado))?.[1] ?? `? ${resultado}`;

// Classificacao das duas auditorias para o banco como ele esta
async function classificar(db) {
  const aud = (await db.query(AUDITORIA)).rows;
  const pre = (await db.query(PRE)).rows;
  const a = (item) => {
    const l = aud.find((x) => x.item === item);
    assert.ok(l, `auditoria sem a linha "${item}"`);
    return l;
  };
  const p = (item) => {
    const l = pre.find((x) => x.item === item);
    assert.ok(l, `pre-ativacao sem a linha "${item}"`);
    return l;
  };
  return {
    estado: estadoDe(a(ITEM_ESTADO_AUD).resultado),
    estadoPre: estadoDe(p(ITEM_ESTADO_PRE).resultado),
    auditoria: a(ITEM_ESTADO_AUD).situacao,
    pre: p(ITEM_ESTADO_PRE).situacao,
    sinais: a(ITEM_ESTADO_AUD).resultado,
    gatilhos: a(ITEM_GATILHOS).situacao,
    funcao: a('public.despertar_backend_apos_aviso()').situacao,
    funcaoPre: p('public.despertar_backend_apos_aviso() [gatilho]').situacao,
    job: a('notificacoes-rotina').situacao,
    comando: a(ITEM_JOB_AUD).situacao,
    jobPre: p(ITEM_JOB_PRE).situacao,
  };
}

// O que cada estado deve dar em cada auditoria
const SITUACAO_AUD = { antes_da_25: 'OK', A: 'ATENCAO', B: 'OK', C: 'OK', D: 'OK', desconhecida: 'ATENCAO', inconsistente: 'PROBLEMA', rotina_ausente: 'PROBLEMA' };
const SITUACAO_PRE = { antes_da_25: 'PENDENTE', A: 'PENDENTE', B: 'OK', C: 'OK', D: 'OK', desconhecida: 'PROBLEMA', inconsistente: 'PROBLEMA', rotina_ausente: 'PROBLEMA' };
async function esperar(db, estado, extra = {}) {
  const c = await classificar(db);
  assert.equal(c.estado, estado, c.sinais);
  assert.equal(c.estadoPre, estado, 'a pre-ativacao classifica igual a auditoria');
  assert.equal(c.auditoria, SITUACAO_AUD[estado], `auditoria: ${c.sinais}`);
  assert.equal(c.pre, SITUACAO_PRE[estado], `pre-ativacao: ${c.sinais}`);
  for (const [k, v] of Object.entries(extra)) assert.equal(c[k], v, `${k}: ${c.sinais}`);
  return c;
}

// Corpo da rotina da 27 (para as alteracoes feitas fora das migrations)
const ROTINA_27 = (() => {
  const t = ler(`supabase/migrations/${M27}`);
  const ini = t.indexOf('CREATE OR REPLACE FUNCTION public.rotina_notificacoes()');
  return t.slice(ini, t.indexOf('$$;', t.indexOf('AS $$', ini) + 5) + 3);
})();
function trocar(texto, de, para) {
  assert.ok(texto.includes(de), `trecho nao encontrado: ${de}`);
  return texto.replace(de, para);
}
const FILTRO = "     WHERE canal = 'whatsapp'\n       AND ((status";
// Recria o gatilho e a funcao da 22 (como alguem faria a mao)
const GATILHO_22 = `
  CREATE OR REPLACE FUNCTION public.despertar_backend_apos_aviso() RETURNS trigger LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public AS $$
  BEGIN
    PERFORM public.despertar_backend();
    RETURN NULL;
  END;
  $$;
  CREATE TRIGGER despertar_backend AFTER INSERT ON public.notificacoes
    FOR EACH STATEMENT EXECUTE FUNCTION public.despertar_backend_apos_aviso();`;

// ---------------------------------------------------------------
// Estados validos e rollbacks
// ---------------------------------------------------------------
test('antes da 25: rotina da 22, sem canal, com o gatilho original: OK na auditoria, PENDENTE na pré-ativação', async () => {
  await esperar(await banco(MIGRATIONS_AGENDA), 'antes_da_25',
    { gatilhos: 'OK', funcao: 'OK', job: 'OK', comando: 'OK', jobPre: 'OK' });
});

test('estado A (25, gatilho presente, produção hoje): ATENÇÃO na auditoria, PENDENTE na pré-ativação', async () => {
  await esperar(await banco(MIGRATIONS_WHATSAPP), 'A', { gatilhos: 'OK', funcao: 'OK', funcaoPre: 'OK' });
});

test('estado B (27, sem gatilho nem função): OK nas duas; a ausência da função é o esperado', async () => {
  await esperar(await banco(MIGRATIONS_WHATSAPP_27), 'B',
    { gatilhos: 'OK', funcao: 'OK', funcaoPre: 'OK', job: 'OK', comando: 'OK', jobPre: 'OK' });
});

test('estado C (26 ajustada depois da 27): OK nas duas', async () => {
  await esperar(await banco(MIGRATIONS_WHATSAPP_26), 'C', { gatilhos: 'OK', funcao: 'OK', funcaoPre: 'OK' });
});

test('rollback da 26 volta ao estado B; rollback da 27 volta ao estado A', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_26);
  await db.exec(ROLLBACK26);
  await esperar(db, 'B');
  await db.exec(ROLLBACK27);
  await esperar(db, 'A', { gatilhos: 'OK', funcao: 'OK' });
});

// ---------------------------------------------------------------
// Reaplicações indevidas
// ---------------------------------------------------------------
test('22 reaplicada depois da 27: inconsistente (rotina da 22 com a 25 instalada e gatilho de volta)', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_27);
  await db.exec(migration(M22));
  // O gatilho que volta é o original e combina com a rotina da 22 (linha dos
  // gatilhos OK); o erro é a rotina da 22 com a 25 instalada, e o estado acusa
  const c = await esperar(db, 'inconsistente', { gatilhos: 'OK' });
  assert.match(c.sinais, /rotina 22; coluna canal: a da 25; funcoes da 25: 3\/3/);
  assert.match(c.sinais, /gatilhos que acordam o backend: despertar_backend/);
});

test('25 reaplicada depois da 27: inconsistente (rotina da 25 sem o gatilho)', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_27);
  await db.exec(migration(M25));
  await esperar(db, 'inconsistente', { gatilhos: 'PROBLEMA' });
});

test('25 reaplicada depois da 26: inconsistente (rotina da 25 com as funções da 26)', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_26);
  await db.exec(migration(M25));
  const c = await esperar(db, 'inconsistente');
  assert.match(c.sinais, /da 26: 3\/3/);
});

test('27 reaplicada depois da 26: a migration para e o estado continua C', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_26);
  await assert.rejects(db.exec(migration(M27)), /20261116000026 ja esta aplicada/);
  await db.exec('ROLLBACK');
  await esperar(db, 'C');
});

// ---------------------------------------------------------------
// Gatilhos fora do esperado
// ---------------------------------------------------------------
test('gatilho recriado à mão depois da 27: inconsistente; gatilhos e função com PROBLEMA', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_27);
  await db.exec(GATILHO_22);
  await esperar(db, 'inconsistente', { gatilhos: 'PROBLEMA', funcao: 'PROBLEMA', funcaoPre: 'PROBLEMA' });
});

test('gatilho com outro nome que acorda o backend (com a 27 e com a 25): inconsistente', async () => {
  const b = await banco(MIGRATIONS_WHATSAPP_27);
  await b.exec(`
    CREATE FUNCTION public.acordar_de_novo() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM public.despertar_backend(); RETURN NULL; END $$;
    CREATE TRIGGER qualquer_nome AFTER INSERT ON public.notificacoes
      FOR EACH STATEMENT EXECUTE FUNCTION public.acordar_de_novo();`);
  const c = await esperar(b, 'inconsistente', { gatilhos: 'PROBLEMA' });
  assert.match(c.sinais, /qualquer_nome/);

  const a = await banco(MIGRATIONS_WHATSAPP);
  await a.exec(`CREATE TRIGGER segundo AFTER INSERT ON public.notificacoes
    FOR EACH ROW EXECUTE FUNCTION public.despertar_backend_apos_aviso();`);
  await esperar(a, 'inconsistente', { gatilhos: 'PROBLEMA' });
});

test('gatilho original desligado ou com a função trocada (estado A): inconsistente', async () => {
  const desligado = await banco(MIGRATIONS_WHATSAPP);
  await desligado.exec('ALTER TABLE public.notificacoes DISABLE TRIGGER despertar_backend');
  const c = await esperar(desligado, 'inconsistente', { gatilhos: 'PROBLEMA' });
  assert.match(c.sinais, /DESLIGADO/);

  const trocada = await banco(MIGRATIONS_WHATSAPP);
  await trocada.exec(`CREATE OR REPLACE FUNCTION public.despertar_backend_apos_aviso() RETURNS trigger LANGUAGE plpgsql
    SECURITY DEFINER SET search_path = public AS $$ BEGIN PERFORM public.despertar_backend(); PERFORM 1; RETURN NULL; END $$;`);
  const t = await esperar(trocada, 'inconsistente', { gatilhos: 'PROBLEMA' });
  assert.match(t.sinais, /funcao do gatilho: DESCONHECIDA/);
});

// ---------------------------------------------------------------
// Job do pg_cron (conferido à parte, em qualquer estado)
// ---------------------------------------------------------------
test('cron: agenda e comando certos, job único e ativo → OK nas duas', async () => {
  await esperar(await banco(MIGRATIONS_WHATSAPP_27), 'B', { job: 'OK', comando: 'OK', jobPre: 'OK' });
});

test('cron: sem pg_cron a auditoria acusa nas linhas próprias; job inexistente é PROBLEMA nas duas', async () => {
  const semCron = await banco(MIGRATIONS_WHATSAPP_27, { cron: false });
  await esperar(semCron, 'B', { job: 'PROBLEMA', comando: 'ATENCAO', jobPre: 'PROBLEMA' });
  const semJob = await banco(MIGRATIONS_WHATSAPP_27, { jobs: false });
  await esperar(semJob, 'B', { job: 'PROBLEMA', comando: 'PROBLEMA', jobPre: 'PROBLEMA' });
});

test('cron com agenda errada (anual, a cada 5 min, com espaço a mais): PROBLEMA nas duas', async () => {
  for (const agenda of ['0 0 1 1 *', '*/5 * * * *', '*  * * * *']) {
    const db = await banco(MIGRATIONS_WHATSAPP_27, { jobs: false });
    await agendar(db, { agenda });
    await esperar(db, 'B', { job: 'OK', comando: 'PROBLEMA', jobPre: 'PROBLEMA' });
  }
});

test('cron desativado: PROBLEMA nas duas', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_27, { jobs: false });
  await agendar(db, { ativo: false });
  await esperar(db, 'B', { job: 'PROBLEMA', comando: 'PROBLEMA', jobPre: 'PROBLEMA' });
});

test('cron com comando errado (sem ";", outro comando, espaço no início) ou dois jobs: PROBLEMA nas duas', async () => {
  for (const comando of ['SELECT public.rotina_notificacoes()', 'SELECT 1;', ' SELECT public.rotina_notificacoes();']) {
    const db = await banco(MIGRATIONS_WHATSAPP_27, { jobs: false });
    await agendar(db, { comando });
    await esperar(db, 'B', { job: 'OK', comando: 'PROBLEMA', jobPre: 'PROBLEMA' });
  }
  const dois = await banco(MIGRATIONS_WHATSAPP_27);
  await dois.query("INSERT INTO cron.job (jobname, schedule, command) VALUES ('notificacoes-rotina', '* * * * *', $1)", [COMANDO]);
  await esperar(dois, 'B', { comando: 'PROBLEMA', jobPre: 'PROBLEMA' });
});

// ---------------------------------------------------------------
// Rotina alterada fora das migrations
// ---------------------------------------------------------------
test('hash desconhecido: só um espaço a mais já vira versão desconhecida (ATENÇÃO; pré-ativação PROBLEMA)', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_27);
  await db.exec(trocar(ROTINA_27, 'v_expiradas := public.expirar_notificacoes();', 'v_expiradas := public.expirar_notificacoes(); '));
  await esperar(db, 'desconhecida', { gatilhos: 'ATENCAO' });
});

test('mesmo corpo com CRLF (colado no SQL Editor): continua reconhecido como a 27', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_27);
  await db.exec(ROTINA_27.replace(/\n/g, '\r\n'));
  const [{ cr }] = (await db.query(
    "SELECT position(chr(13) IN prosrc) > 0 AS cr FROM pg_proc WHERE oid = 'public.rotina_notificacoes()'::regprocedure")).rows;
  assert.equal(cr, true, 'o corpo gravado tem CRLF de verdade');
  await esperar(db, 'B');
});

test('filtro comentado ou ineficaz (o texto "canal = \'whatsapp\'" continua lá): versão desconhecida, nunca B', async () => {
  const comentado = await banco(MIGRATIONS_WHATSAPP_27);
  await comentado.exec(trocar(ROTINA_27, FILTRO, "     WHERE -- canal = 'whatsapp' AND\n       ((status"));
  await esperar(comentado, 'desconhecida');
  const ineficaz = await banco(MIGRATIONS_WHATSAPP_27);
  await ineficaz.exec(trocar(ROTINA_27, "WHERE canal = 'whatsapp'", "WHERE (canal = 'whatsapp' OR true)"));
  await esperar(ineficaz, 'desconhecida');
});

test('rotina removida: PROBLEMA nas duas', async () => {
  const db = await banco(MIGRATIONS_WHATSAPP_27);
  await db.exec('DROP FUNCTION public.rotina_notificacoes()');
  await esperar(db, 'rotina_ausente');
});

// ---------------------------------------------------------------
// Coluna canal
// ---------------------------------------------------------------
test('coluna canal ausente (com a 25) ou inesperada (antes da 25, ou diferente da criada pela 25): inconsistente', async () => {
  const semCanal = await banco(MIGRATIONS_WHATSAPP);
  await semCanal.exec('ALTER TABLE public.notificacoes DROP COLUMN canal');
  const c1 = await esperar(semCanal, 'inconsistente');
  assert.match(c1.sinais, /coluna canal: ausente/);

  const antes = await banco(MIGRATIONS_AGENDA);
  await antes.exec("ALTER TABLE public.notificacoes ADD COLUMN canal text NOT NULL DEFAULT 'push'");
  const c2 = await esperar(antes, 'inconsistente');
  assert.match(c2.sinais, /coluna canal: INESPERADA/);

  const nula = await banco(MIGRATIONS_WHATSAPP_27);
  await nula.exec('ALTER TABLE public.notificacoes ALTER COLUMN canal DROP NOT NULL');
  await esperar(nula, 'inconsistente');
});

// ---------------------------------------------------------------
// Migration 30 (estado D): central e push de volta
// ---------------------------------------------------------------
const ROLLBACK30 = ler('supabase/rollbacks/20261119000030_rollback.sql');
const ITEM_MARCADOR = 'marcador do push no banco (notificacao_config.push_ativo)';
const CENTRAL = ['public.minhas_notificacoes(integer,timestamp with time zone)', 'public.contar_notificacoes_nao_lidas()',
  'public.marcar_notificacoes_lidas(uuid[])', 'public.marcar_todas_notificacoes_lidas()', 'public.central_dados(jsonb)', 'public.central_desde()', 'public.push_ao_ativar()'];
async function linhas(db) {
  const aud = (await db.query(AUDITORIA)).rows;
  const pre = (await db.query(PRE)).rows;
  return { aud: (i) => aud.find((x) => x.item === i), pre: (i) => pre.find((x) => x.item === i) };
}

test('estado D (30 depois da 26): OK nas duas; funções da central com a permissão certa; marcador PENDENTE até ligar', async () => {
  const db = await banco(MIGRATIONS_PUSH_30);
  await esperar(db, 'D', { gatilhos: 'OK', funcao: 'OK', funcaoPre: 'OK', job: 'OK', comando: 'OK', jobPre: 'OK' });
  const l = await linhas(db);
  for (const fn of CENTRAL) assert.equal(l.aud(fn)?.situacao, 'OK', `${fn}: ${l.aud(fn)?.resultado}`);
  assert.match(l.aud(CENTRAL[0]).resultado, /logado: sim/);
  assert.deepEqual([l.pre(ITEM_MARCADOR).situacao, l.pre(ITEM_MARCADOR).resultado.slice(0, 9)], ['PENDENTE', 'desligado']);
  await db.query('UPDATE public.notificacao_config SET push_ativo = true WHERE id');
  assert.equal((await linhas(db)).pre(ITEM_MARCADOR).situacao, 'OK');
});

test('antes da 30 (estado C): as funções da central são esperadas ausentes (OK) e o marcador pede a migration 30', async () => {
  const l = await linhas(await banco(MIGRATIONS_WHATSAPP_26));
  for (const fn of CENTRAL) assert.deepEqual([l.aud(fn).resultado, l.aud(fn).situacao], ['so existe a partir da migration 30', 'OK'], fn);
  assert.deepEqual([l.pre(ITEM_MARCADOR).resultado, l.pre(ITEM_MARCADOR).situacao], ['nao existe: aplique a migration 30', 'PENDENTE']);
});

test('rollback da 30 volta ao estado C; a 26 reaplicada depois da 30 fica inconsistente', async () => {
  const db = await banco(MIGRATIONS_PUSH_30);
  await db.exec(ROLLBACK30);
  await esperar(db, 'C', { gatilhos: 'OK', funcao: 'OK', funcaoPre: 'OK' });

  const reaplicada = await banco(MIGRATIONS_PUSH_30);
  await reaplicada.exec(migration('20261116000026_whatsapp_cancelamento_confirmado.sql'));
  const c = await esperar(reaplicada, 'inconsistente');
  assert.match(c.sinais, /rotina 26; .*colunas da 30: 3\/3/);
});

// ---------------------------------------------------------------
// Fila com dois canais (push e WhatsApp): duplicidade e "enviada sem aparelho"
// so comparam avisos do mesmo canal / so o push
// ---------------------------------------------------------------
const ITEM_DUPLICADOS = 'avisos duplicados';
const ITEM_SEM_APARELHO = 'avisos "enviada" sem nenhum aparelho que recebeu';
const PRODUCAO = [...MIGRATIONS_WHATSAPP_26,
  '20261118000028_whatsapp_novo_agendamento.sql', '20261118000029_whatsapp_aviso_cancelamento.sql'];
const PERFIS = `
  INSERT INTO public.profiles (user_id, nome, telefone) VALUES
    ('${CLIENTE_A}', 'Ana Paula', '11987654321'), ('${USUARIO_JOAO}', 'João Barbeiro', '11912345678');
  ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;`;
const linhaAud = async (db, item) => {
  const l = (await db.query(AUDITORIA)).rows.find((x) => x.item === item);
  assert.ok(l, `auditoria sem a linha "${item}"`);
  return l;
};
const agendarAtendimento = async (db, minutos = 240) => (await db.query(
  `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status)
   VALUES ($1, $2, $3, date_trunc('minute', now()) + make_interval(mins => $4), 'confirmado') RETURNING id`,
  [CLIENTE_A, JOAO, CORTE_30, minutos])).rows[0].id;
// Aviso gravado direto na fila (para montar as situacoes da auditoria)
const aviso = (db, { canal, tipo = 'novo_agendamento', status = 'pendente', chave, ag = null }) => db.query(
  `INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, agendamento_id, status, expira_em)
   VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 hour')`, [tipo, canal, chave, USUARIO_JOAO, ag, status]);

test('produção (25, 27, 26, 28 e 29) com o mesmo evento nos dois canais: estado C e nenhuma duplicata', async () => {
  const db = await banco(PRODUCAO);
  await db.exec(PERFIS);
  for (const uid of [CLIENTE_A, USUARIO_JOAO]) {
    await db.query("INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES ($1, 'whatsapp_avisos', '2026-11-16', 'web')", [uid]);
  }
  await esperar(db, 'C', { gatilhos: 'OK', funcao: 'OK', funcaoPre: 'OK', job: 'OK', comando: 'OK', jobPre: 'OK' });

  // Novo agendamento (22 no push e 28 no WhatsApp) e cancelamento (22 e 29):
  // o barbeiro tem os dois eventos nos dois canais
  const ag = await agendarAtendimento(db);
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [ag]);
  const porCanal = (await db.query(
    `SELECT canal, tipo, count(*)::int AS n FROM public.notificacoes
      WHERE agendamento_id = $1 AND destinatario_id = $2 GROUP BY 1, 2 ORDER BY 1, 2`, [ag, USUARIO_JOAO])).rows;
  assert.deepEqual(porCanal.map((r) => `${r.canal}:${r.tipo}:${r.n}`),
    ['push:cancelamento:1', 'push:novo_agendamento:1', 'whatsapp:cancelamento:1', 'whatsapp:novo_agendamento:1'],
    'o barbeiro tem os dois eventos nos dois canais');
  assert.deepEqual(await linhaAud(db, ITEM_DUPLICADOS), { area: 'Fila', item: ITEM_DUPLICADOS, resultado: '0', situacao: 'OK' });

  // Duplicata de verdade (mesmo canal) continua acusada
  await aviso(db, { canal: 'whatsapp', chave: 'manual:1', ag });
  assert.deepEqual(await linhaAud(db, ITEM_DUPLICADOS), { area: 'Fila', item: ITEM_DUPLICADOS, resultado: '1', situacao: 'PROBLEMA' });
});

test('"enviada sem aparelho": o WhatsApp enviado não conta; o push enviado sem aparelho continua PROBLEMA', async () => {
  const db = await banco(PRODUCAO);
  await aviso(db, { canal: 'whatsapp', status: 'enviada', chave: 'wa:1' });
  assert.equal((await linhaAud(db, ITEM_SEM_APARELHO)).situacao, 'OK');
  assert.equal((await linhaAud(db, ITEM_DUPLICADOS)).situacao, 'OK');
  await aviso(db, { canal: 'push', status: 'enviada', chave: 'push:1' });
  assert.deepEqual(await linhaAud(db, ITEM_SEM_APARELHO),
    { area: 'Consistencia', item: ITEM_SEM_APARELHO, resultado: '1', situacao: 'PROBLEMA' });
});

test('antes da 25 (sem a coluna canal): as duas verificações rodam e tratam tudo como push', async () => {
  const db = await banco(MIGRATIONS_AGENDA);
  const semCanal = (chave) => db.query(
    `INSERT INTO public.notificacoes (tipo, chave, destinatario_id, status, expira_em)
     VALUES ('novo_agendamento', $1, $2, 'enviada', now() + interval '1 hour')`, [chave, USUARIO_JOAO]);
  await semCanal('a:1');
  assert.equal((await linhaAud(db, ITEM_SEM_APARELHO)).situacao, 'PROBLEMA');
  assert.equal((await linhaAud(db, ITEM_DUPLICADOS)).situacao, 'OK');
  await semCanal('a:2');
  assert.equal((await linhaAud(db, ITEM_DUPLICADOS)).situacao, 'PROBLEMA');
});

// ---------------------------------------------------------------
// As consultas continuam somente leitura
// ---------------------------------------------------------------
test('as duas auditorias são uma única consulta somente leitura (inclusive as consultas internas)', () => {
  for (const [nome, sql] of [['auditoria', AUDITORIA], ['pre-ativacao', PRE]]) {
    const codigo = sql.replace(/--.*$/gm, '').replace(/\$q\$[\s\S]*?\$q\$/g, "''").replace(/'(?:[^']|'')*'/g, "''");
    assert.doesNotMatch(codigo, /\b(insert|update|delete|merge|alter|create|drop|truncate|grant|revoke|comment|do|call|set|copy|vacuum|lock)\b/i, nome);
    assert.equal(codigo.split(';').filter((parte) => parte.trim()).length, 1, nome);
    for (const interna of sql.match(/\$q\$[\s\S]*?\$q\$/g)) {
      assert.doesNotMatch(interna.replace(/'(?:[^']|'')*'/g, "''"), /\b(insert|update|delete|alter|create|drop|truncate|grant|revoke)\b/i, nome);
    }
  }
});
