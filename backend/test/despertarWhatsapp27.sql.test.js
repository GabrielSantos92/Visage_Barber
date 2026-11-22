// Migration 27 (so avisos do WhatsApp acordam o backend), a 26 ajustada e os
// dois rollbacks, direto no banco (PGlite, PostgreSQL embutido em processo,
// UMA conexao). O pg_net e o Vault sao FALSOS: cada chamada ao backend vira uma
// linha em net.chamadas, com quem a fez (gatilho ou rotina). Nada sai para a
// rede. Concorrencia de verdade (duas conexoes) NAO e testada aqui: o PGlite
// executa um comando por vez; ela foi validada a parte em PostgreSQL real.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  criarBanco, recusa, migration, MIGRATIONS_WHATSAPP, MIGRATIONS_WHATSAPP_27, MIGRATIONS_WHATSAPP_26,
  JOAO, CORTE_30, CLIENTE_A, CLIENTE_B, CLIENTE_C,
} = require('./helpers/bancoAgenda');

const RAIZ = path.join(__dirname, '..', '..');
const M22 = '20261109000022_notificacoes_eventos.sql';
const M26 = '20261116000026_whatsapp_cancelamento_confirmado.sql';
const M27 = '20261115000027_despertar_so_whatsapp.sql';
const rollback = (nome) => fs.readFileSync(path.join(RAIZ, 'supabase', 'rollbacks', nome), 'utf8');
const ROLLBACK26 = rollback('20261116000026_rollback.sql');
const ROLLBACK27 = rollback('20261115000027_rollback.sql');

// Plataforma minima: pg_net e Vault falsos, a service_role e as permissoes
// padrao do Supabase (funcao nova em public nasce executavel por todos)
const PLATAFORMA = `
  CREATE SCHEMA net;
  CREATE TABLE net.chamadas (id bigserial PRIMARY KEY, url text, headers jsonb, origem text NOT NULL);
  CREATE FUNCTION net.http_post(url text, body jsonb DEFAULT '{}'::jsonb, params jsonb DEFAULT '{}'::jsonb,
      headers jsonb DEFAULT '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer DEFAULT 5000)
    RETURNS bigint LANGUAGE sql AS $$
      INSERT INTO net.chamadas (url, headers, origem)
      VALUES (url, headers, CASE WHEN pg_trigger_depth() > 0 THEN 'gatilho' ELSE 'rotina' END)
      RETURNING id $$;
  CREATE SCHEMA vault;
  CREATE TABLE vault.secrets (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text UNIQUE, secret text);
  CREATE VIEW vault.decrypted_secrets AS SELECT id, name, secret AS decrypted_secret FROM vault.secrets;
  CREATE ROLE service_role;
  GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
  GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated, anon;
  ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role;`;
// URL e segredo do backend (falsos); clientes com celular e autorizacao
const DADOS = `
  UPDATE public.notificacao_config SET url_backend = 'https://backend.simulado';
  INSERT INTO vault.secrets (name, secret) VALUES ('notificacoes_segredo_backend', 'segredo-simulado-com-mais-de-32-caracteres-000');
  INSERT INTO public.profiles (user_id, nome, telefone) VALUES
    ('${CLIENTE_A}', 'Ana', '11987654321'), ('${CLIENTE_B}', 'Bruno', '21998765432'), ('${CLIENTE_C}', 'Caio', '31991234567');
  INSERT INTO public.consentimentos (user_id, finalidade, versao_aviso, origem) VALUES
    ('${CLIENTE_A}', 'whatsapp_avisos', '2026-11-13', 'web'), ('${CLIENTE_B}', 'whatsapp_avisos', '2026-11-13', 'web'),
    ('${CLIENTE_C}', 'whatsapp_avisos', '2026-11-16', 'web');
  -- Os horarios dos testes sao relativos a agora: fora da grade da barbearia
  ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;`;

async function banco(migracoes) {
  const db = await criarBanco({ migracoes, antesDasMigrations: PLATAFORMA });
  await db.exec(DADOS);
  return db;
}

const linhas = async (db, sql, p) => (await db.query(sql, p)).rows;
async function chamadas(db) {
  const r = await linhas(db, 'SELECT origem, count(*)::int AS n FROM net.chamadas GROUP BY origem');
  const por = Object.fromEntries(r.map((x) => [x.origem, x.n]));
  return { total: (por.gatilho ?? 0) + (por.rotina ?? 0), gatilho: por.gatilho ?? 0, rotina: por.rotina ?? 0 };
}
const zerar = (db) => db.query('DELETE FROM net.chamadas');
const rotina = async (db) => (await linhas(db, 'SELECT public.rotina_notificacoes() AS r'))[0].r;
async function limparFila(db) {
  await db.exec(`DELETE FROM public.whatsapp_mensagens; DELETE FROM public.confirmacoes_presenca;
                 DELETE FROM public.notificacoes; DELETE FROM public.agendamentos; DELETE FROM net.chamadas;`);
}
let seq = 0;
const aviso = (canal, extra = '') => `('${canal === 'push' ? 'novo_agendamento' : 'confirmacao_presenca'}', '${canal}',
  'teste27:${canal}:${++seq}', '${CLIENTE_A}', '{}'::jsonb, now() + interval '1 hour'${extra})`;
const inserir = (db, valores) => db.exec(
  `INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, dados, expira_em) VALUES ${valores.join(', ')}`);
// Agendamento que a rotina transforma em pedido de confirmacao (entre 60 e
// 120 min, horario definido ha mais de 2 h); o aviso push que ele gera sai
async function elegivel(db, cliente, minutos) {
  const [{ id }] = await linhas(db, `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora)
    VALUES ($1, $2, $3, now() + make_interval(mins => $4)) RETURNING id`, [cliente, JOAO, CORTE_30, minutos]);
  await db.query("UPDATE public.agendamentos SET horario_definido_em = now() - interval '3 hours' WHERE id = $1", [id]);
  return id;
}

// Assinatura do banco: corpo, SECURITY DEFINER, search_path e quem executa
// cada funcao de public; gatilhos; RLS e privilegios de cada tabela
async function assinatura(db) {
  const funcoes = await linhas(db, `
    SELECT p.oid::regprocedure::text AS f, md5(pg_get_functiondef(p.oid)) AS corpo, p.prosecdef AS definer,
           coalesce(array_to_string(p.proconfig, ','), '') AS config, coalesce(p.proacl::text, '') AS acl,
           has_function_privilege('anon', p.oid, 'EXECUTE') AS anon,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') AS logado
      FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'`);
  const gatilhos = await linhas(db, `SELECT tgname || ' em ' || tgrelid::regclass AS g, pg_get_triggerdef(oid) AS d
                                       FROM pg_trigger WHERE NOT tgisinternal`);
  const tabelas = await linhas(db, `
    SELECT c.relname AS t, c.relrowsecurity AS rls, coalesce(c.relacl::text, '') AS acl
      FROM pg_class c WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'`);
  return {
    funcoes: Object.fromEntries(funcoes.map((x) => [x.f, x])),
    gatilhos: Object.fromEntries(gatilhos.map((x) => [x.g, x.d])),
    tabelas: Object.fromEntries(tabelas.map((x) => [x.t, x])),
  };
}
function diferencas(a, b) {
  const out = [];
  for (const k of [...new Set([...Object.keys(a.funcoes), ...Object.keys(b.funcoes)])].sort()) {
    const x = a.funcoes[k];
    const y = b.funcoes[k];
    if (!x) out.push(`funcao nova: ${k}`);
    else if (!y) out.push(`funcao removida: ${k}`);
    else for (const c of ['corpo', 'definer', 'config', 'acl', 'anon', 'logado']) if (x[c] !== y[c]) out.push(`${c}: ${k}`);
  }
  for (const k of [...new Set([...Object.keys(a.gatilhos), ...Object.keys(b.gatilhos)])].sort()) {
    if (a.gatilhos[k] !== b.gatilhos[k]) out.push(`gatilho ${!a.gatilhos[k] ? 'novo' : !b.gatilhos[k] ? 'removido' : 'mudou'}: ${k}`);
  }
  for (const k of [...new Set([...Object.keys(a.tabelas), ...Object.keys(b.tabelas)])].sort()) {
    if (JSON.stringify(a.tabelas[k]) !== JSON.stringify(b.tabelas[k])) out.push(`tabela: ${k}`);
  }
  return out;
}
// Consentimentos inteiros (inclusive revogados), para provar que nada muda
const consentimentos = async (db) => (await linhas(db,
  "SELECT md5(coalesce(string_agg(to_jsonb(c)::text, '|' ORDER BY c.user_id, c.finalidade, c.versao_aviso), '')) AS h FROM public.consentimentos c"))[0].h;
const fonteDaRotina = async (db) => (await linhas(db,
  "SELECT prosrc FROM pg_proc WHERE oid = 'public.rotina_notificacoes()'::regprocedure"))[0].prosrc;
const temGatilho = async (db) => (await linhas(db,
  "SELECT count(*)::int AS n FROM pg_trigger WHERE tgname = 'despertar_backend' AND tgrelid = 'public.notificacoes'::regclass"))[0].n > 0;
const existe = async (db, assinaturaFuncao) => (await linhas(db, 'SELECT to_regprocedure($1) IS NOT NULL AS ok', [assinaturaFuncao]))[0].ok;

let db; // 25 + 27
let so25; // so a 25 (estado de producao antes da 27)
before(async () => {
  so25 = await banco(MIGRATIONS_WHATSAPP);
  db = await banco(MIGRATIONS_WHATSAPP_27);
});

// ---------------------------------------------------------------
// Chamadas ao backend (itens 1 a 7)
// ---------------------------------------------------------------
test('01. só avisos do push pendentes: nenhuma chamada ao backend (nem pela rotina, nem pelo INSERT)', async () => {
  await limparFila(db);
  await inserir(db, [aviso('push'), aviso('push')]);
  assert.deepEqual(await chamadas(db), { total: 0, gatilho: 0, rotina: 0 }, 'INSERT do push');
  for (let i = 0; i < 3; i++) assert.equal((await rotina(db)).despertou, false);
  assert.equal((await chamadas(db)).total, 0, 'três execuções da rotina');
  // Antes da 27 (o estado de produção), o mesmo cenário chamava o backend
  await limparFila(so25);
  await inserir(so25, [aviso('push')]);
  await rotina(so25);
  assert.deepEqual(await chamadas(so25), { total: 2, gatilho: 1, rotina: 1 });
});

test('02. um aviso do WhatsApp pendente: uma chamada por execução da rotina, nunca mais', async () => {
  await limparFila(db);
  await inserir(db, [aviso('whatsapp')]);
  assert.equal((await chamadas(db)).total, 0, 'o INSERT não chama (sem gatilho)');
  for (let i = 1; i <= 3; i++) {
    assert.equal((await rotina(db)).despertou, true);
    assert.deepEqual(await chamadas(db), { total: i, gatilho: 0, rotina: i });
  }
});

test('03. a rotina cria um pedido de confirmação: uma chamada só', async () => {
  await limparFila(db);
  await elegivel(db, CLIENTE_A, 90);
  await db.exec("DELETE FROM public.notificacoes WHERE canal = 'push'");
  await zerar(db);
  const r = await rotina(db);
  assert.equal(r.confirmacoes, 1);
  assert.deepEqual(await chamadas(db), { total: 1, gatilho: 0, rotina: 1 });
});

test('04. a rotina cria três pedidos na mesma execução: uma chamada só', async () => {
  await limparFila(db);
  await elegivel(db, CLIENTE_A, 90);
  await elegivel(db, CLIENTE_B, 95);
  await elegivel(db, CLIENTE_C, 100);
  await db.exec("DELETE FROM public.notificacoes WHERE canal = 'push'");
  await zerar(db);
  assert.equal((await rotina(db)).confirmacoes, 3);
  assert.deepEqual(await chamadas(db), { total: 1, gatilho: 0, rotina: 1 });
});

test('05. INSERT direto do WhatsApp: nada na hora; a próxima execução da rotina acorda o backend', async () => {
  await limparFila(db);
  await inserir(db, [aviso('whatsapp')]);
  assert.equal((await chamadas(db)).total, 0);
  await rotina(db);
  assert.equal((await chamadas(db)).total, 1);
  // Já enviado: não chama mais
  await db.exec("UPDATE public.notificacoes SET status = 'enviada'");
  await zerar(db);
  await rotina(db);
  assert.equal((await chamadas(db)).total, 0);
  // Nova tentativa marcada para depois: ainda não chama
  await limparFila(db);
  await inserir(db, [aviso('whatsapp', '')]);
  await db.exec("UPDATE public.notificacoes SET proxima_tentativa = now() + interval '2 minutes'");
  await rotina(db);
  assert.equal((await chamadas(db)).total, 0);
  // Em envio com a reserva vencida (o backend caiu no meio): chama, para o
  // backend registrar o resultado incerto; com a reserva valendo, não chama
  await db.exec("UPDATE public.notificacoes SET status = 'enviando', reservada_ate = now() - interval '1 minute'");
  await rotina(db);
  assert.equal((await chamadas(db)).total, 1);
  await db.exec("UPDATE public.notificacoes SET reservada_ate = now() + interval '1 minute'");
  await zerar(db);
  await rotina(db);
  assert.equal((await chamadas(db)).total, 0);
});

test('06. INSERT direto do push: nenhuma chamada, nem com reserva vencida', async () => {
  await limparFila(db);
  await inserir(db, [aviso('push')]);
  await db.exec("UPDATE public.notificacoes SET status = 'enviando', reservada_ate = now() - interval '1 minute'");
  await rotina(db);
  assert.equal((await chamadas(db)).total, 0);
});

test('07. push e WhatsApp no mesmo comando: só o WhatsApp conta', async () => {
  await limparFila(db);
  await inserir(db, [aviso('push'), aviso('whatsapp'), aviso('push')]);
  assert.equal((await chamadas(db)).total, 0, 'o INSERT não chama');
  await rotina(db);
  assert.equal((await chamadas(db)).total, 1);
  // O WhatsApp sai da fila; o push continua pendente e não chama mais
  await db.exec("UPDATE public.notificacoes SET status = 'expirada' WHERE canal = 'whatsapp'");
  await zerar(db);
  await rotina(db);
  assert.equal((await chamadas(db)).total, 0);
  assert.equal((await linhas(db, "SELECT count(*)::int AS n FROM public.notificacoes WHERE canal = 'push' AND status = 'pendente'"))[0].n, 2);
});

test('08. duas leituras da fila seguidas (dois acionamentos): o aviso é entregue uma vez só', async () => {
  // Em sequência (o PGlite tem uma conexão); com duas conexões ao mesmo tempo,
  // validado em PostgreSQL real
  await limparFila(db);
  const ag = await elegivel(db, CLIENTE_A, 90);
  await db.query(`INSERT INTO public.notificacoes (tipo, canal, chave, destinatario_id, agendamento_id, dados, expira_em)
    SELECT 'confirmacao_presenca', 'whatsapp', 'teste27:reserva', cliente_id, id,
           jsonb_build_object('data_hora', data_hora, 'confirmacao_id', gen_random_uuid()), now() + interval '30 minutes'
      FROM public.agendamentos WHERE id = $1`, [ag]);
  const primeira = (await linhas(db, 'SELECT public.reservar_whatsapp(20) AS r'))[0].r;
  const segunda = (await linhas(db, 'SELECT public.reservar_whatsapp(20) AS r'))[0].r;
  assert.equal(primeira.length, 1);
  assert.equal(segunda.length, 0);
  assert.equal((await linhas(db, 'SELECT count(*)::int AS n FROM public.whatsapp_mensagens'))[0].n, 1);
});

// ---------------------------------------------------------------
// 26 ajustada e rollbacks (itens 9 a 11)
// ---------------------------------------------------------------
test('09. com a 26 ajustada: a rotina mantém o filtro, expira as solicitações e o gatilho não volta', async () => {
  const c26 = await banco(MIGRATIONS_WHATSAPP_26);
  const fonte = await fonteDaRotina(c26);
  assert.match(fonte, /canal = 'whatsapp'/);
  assert.match(fonte, /public\.whatsapp_expirar_solicitacoes\(\)/);
  assert.equal(await temGatilho(c26), false);
  assert.equal(await existe(c26, 'public.despertar_backend_apos_aviso()'), false);

  // Solicitação vencida, aguardando a resposta: a rotina a expira sem cancelar nada
  const ag = await elegivel(c26, CLIENTE_C, 30);
  const [{ id: conf }] = await linhas(c26, `INSERT INTO public.confirmacoes_presenca (agendamento_id, data_hora, cliente_id, estado)
    SELECT id, data_hora, cliente_id, 'recusada' FROM public.agendamentos WHERE id = $1 RETURNING id`, [ag]);
  await c26.query(`INSERT INTO public.solicitacoes_cancelamento
      (confirmacao_id, agendamento_id, data_hora, cliente_id, estado, origem_pedido, expira_em, evento_pedido)
    SELECT $1, id, data_hora, cliente_id, 'aguardando', 'botao', now() - interval '1 minute', 'evento-teste'
      FROM public.agendamentos WHERE id = $2`, [conf, ag]);
  await c26.exec("DELETE FROM public.notificacoes WHERE canal = 'push'; DELETE FROM net.chamadas;");
  const r = await rotina(c26);
  assert.equal(r.solicitacoes_expiradas, 1);
  assert.deepEqual((await linhas(c26, 'SELECT estado, motivo FROM public.solicitacoes_cancelamento'))[0], { estado: 'expirada', motivo: 'prazo' });
  assert.equal((await linhas(c26, 'SELECT status::text AS s FROM public.agendamentos WHERE id = $1', [ag]))[0].s, 'confirmado');
  assert.equal((await chamadas(c26)).total, 0, 'só push e solicitação: o backend não é chamado');

  // Push não chama; WhatsApp chama uma vez
  await inserir(c26, [aviso('push')]);
  await rotina(c26);
  assert.equal((await chamadas(c26)).total, 0);
  await inserir(c26, [aviso('whatsapp')]);
  await rotina(c26);
  assert.deepEqual(await chamadas(c26), { total: 1, gatilho: 0, rotina: 1 });
});

test('10. rollback da 26 ajustada: volta exatamente ao estado da 27 (filtro, sem gatilho)', async () => {
  const c26 = await banco(MIGRATIONS_WHATSAPP_26);
  await c26.exec(ROLLBACK26);
  await c26.exec(ROLLBACK26); // pode rodar de novo
  // Igual ao banco 25 + 27 em tudo que a 26 tinha mudado (funções, gatilhos,
  // permissões); da 26 só ficam o histórico e o que o rollback guarda de propósito
  const ref = await assinatura(db);
  const depois = await assinatura(c26);
  const extras = diferencas(ref, depois).filter((d) => !/solicitac|solicitacoes_cancelamento/.test(d));
  assert.deepEqual(extras, []);
  assert.equal(await fonteDaRotina(c26), await fonteDaRotina(db));
  assert.equal(await temGatilho(c26), false);
  await inserir(c26, [aviso('push')]);
  await rotina(c26);
  assert.equal((await chamadas(c26)).total, 0);
});

test('11. rollback da 27: volta exatamente à 25 (rotina, gatilho, função e permissões), sem sobras', async () => {
  const c27 = await banco(MIGRATIONS_WHATSAPP_27);
  assert.notDeepEqual(diferencas(await assinatura(so25), await assinatura(c27)), []);
  await c27.exec(ROLLBACK27);
  await c27.exec(ROLLBACK27); // pode rodar de novo
  assert.deepEqual(diferencas(await assinatura(so25), await assinatura(c27)), []);
  // O comportamento antigo volta (é isso que o rollback promete)
  await limparFila(c27);
  await inserir(c27, [aviso('push')]);
  assert.deepEqual(await chamadas(c27), { total: 1, gatilho: 1, rotina: 0 });
  // E a 27 pode ser aplicada de novo depois
  await c27.exec(migration(M27));
  assert.deepEqual(diferencas(await assinatura(db), await assinatura(c27)), []);
});

// ---------------------------------------------------------------
// Permissões, RLS, consentimentos e dados (itens 12 a 14)
// ---------------------------------------------------------------
test('12-13. a 27 só muda a rotina e tira o gatilho: nenhuma permissão nova, RLS igual', async () => {
  assert.deepEqual(diferencas(await assinatura(so25), await assinatura(db)), [
    'funcao removida: despertar_backend_apos_aviso()',
    'corpo: rotina_notificacoes()',
    'gatilho removido: despertar_backend em notificacoes',
  ]);
  for (const papel of ['anon', 'authenticated']) {
    const [{ pode }] = await linhas(db, "SELECT has_function_privilege($1, 'public.rotina_notificacoes()', 'EXECUTE') AS pode", [papel]);
    assert.equal(pode, false, papel);
  }
  const [{ servico }] = await linhas(db, "SELECT has_function_privilege('service_role', 'public.rotina_notificacoes()', 'EXECUTE') AS servico");
  assert.equal(servico, true);
  // O app e o site continuam sem acesso à rotina
  await db.exec('SET ROLE authenticated');
  try {
    assert.equal((await recusa(db.query('SELECT public.rotina_notificacoes()'))).code, '42501');
  } finally {
    await db.exec('RESET ROLE');
  }
  // A 26 ajustada também não abre nada a mais que a 26 já abria
  const c26 = await banco(MIGRATIONS_WHATSAPP_26);
  for (const papel of ['anon', 'authenticated']) {
    const [{ n }] = await linhas(c26, `SELECT count(*)::int AS n FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f' AND has_function_privilege($1, p.oid, 'EXECUTE')
        AND p.proname IN ('rotina_notificacoes', 'whatsapp_expirar_solicitacoes', 'despertar_backend', 'reservar_whatsapp')`, [papel]);
    assert.equal(n, 0, papel);
  }
});

test('14. consentimentos (inclusive revogados) e avisos existentes: nada muda em nenhum passo', async () => {
  const c = await banco(MIGRATIONS_WHATSAPP);
  await c.exec(`UPDATE public.consentimentos SET revogado_em = now(), revogado_origem = 'whatsapp' WHERE user_id = '${CLIENTE_B}'`);
  await inserir(c, [aviso('push'), aviso('push'), aviso('whatsapp')]);
  const fila = async () => (await linhas(c,
    "SELECT md5(string_agg(to_jsonb(n)::text, '|' ORDER BY n.chave)) AS h FROM public.notificacoes n"))[0].h;
  const antes = [await consentimentos(c), await fila()];
  for (const passo of [migration(M27), migration(M26), ROLLBACK26, ROLLBACK27, migration(M27)]) {
    await c.exec(passo);
    assert.deepEqual([await consentimentos(c), await fila()], antes);
  }
});

// ---------------------------------------------------------------
// Ordem errada (item 15) e dependências
// ---------------------------------------------------------------
test('15. a 27 depois da 26 para com mensagem clara e não muda nada', async () => {
  const c26 = await banco(MIGRATIONS_WHATSAPP_26);
  const antes = await assinatura(c26);
  const r = await recusa(c26.exec(migration(M27)));
  assert.match(r.message, /20261116000026 ja esta aplicada.*Nada foi alterado/);
  await c26.exec('ROLLBACK');
  assert.deepEqual(diferencas(antes, await assinatura(c26)), []);
  assert.match(await fonteDaRotina(c26), /whatsapp_expirar_solicitacoes/);
});

test('15b. a 26 sem a 27 (ou com o gatilho de volta) para com mensagem clara e não cria nada', async () => {
  const c25 = await banco(MIGRATIONS_WHATSAPP);
  const r = await recusa(c25.exec(migration(M26)));
  assert.match(r.message, /Rode antes a migration 20261115000027_despertar_so_whatsapp\.sql/);
  await c25.exec('ROLLBACK');
  assert.equal((await linhas(c25, "SELECT to_regclass('public.solicitacoes_cancelamento') IS NULL AS ok"))[0].ok, true);

  // Reexecutar a 22 depois da 27 traz o gatilho de volta (proibido); a 26 percebe
  const c27 = await banco(MIGRATIONS_WHATSAPP_27);
  await c27.exec(migration(M22));
  assert.equal(await temGatilho(c27), true);
  assert.doesNotMatch(await fonteDaRotina(c27), /enfileirar_confirmacoes_presenca/, 'a rotina da 22 nem gera confirmações');
  const r2 = await recusa(c27.exec(migration(M26)));
  assert.match(r2.message, /Rode antes a migration 20261115000027/);
  await c27.exec('ROLLBACK');
});

test('15c. o rollback da 27 com a 26 aplicada para com mensagem clara e não muda nada', async () => {
  const c26 = await banco(MIGRATIONS_WHATSAPP_26);
  const antes = await assinatura(c26);
  const r = await recusa(c26.exec(ROLLBACK27));
  assert.match(r.message, /20261116000026 esta aplicada: reverta-a antes/);
  await c26.exec('ROLLBACK');
  assert.deepEqual(diferencas(antes, await assinatura(c26)), []);
});

test('15d. a 27 não remove a função do gatilho se outro gatilho a usar', async () => {
  const c25 = await banco(MIGRATIONS_WHATSAPP);
  await c25.exec(`CREATE TABLE public.outra (id int);
    CREATE TRIGGER usa_a_mesma AFTER INSERT ON public.outra FOR EACH STATEMENT EXECUTE FUNCTION public.despertar_backend_apos_aviso();`);
  const r = await recusa(c25.exec(migration(M27)));
  assert.match(r.message, /tambem e usada por: usa_a_mesma em outra/);
  await c25.exec('ROLLBACK');
  assert.equal(await temGatilho(c25), true);
});
