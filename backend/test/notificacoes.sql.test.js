// Notificacoes push (migrations 21 e 22) direto no banco (PGlite): os eventos
// que geram avisos, os lembretes, os aparelhos, as preferencias, o acesso e as
// funcoes que o backend usa para enviar. Nenhum servico externo e chamado: o
// envio de verdade (Expo) e testado na etapa do backend.
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  criarBanco, auxiliares, recusa,
  JOAO, PEDRO, CORTE_30, BARBA_30, CLIENTE_A, CLIENTE_B, CLIENTE_C, ADMIN, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

const TOKEN = {
  joao: 'ExponentPushToken[joao-celular]',
  joaoTablet: 'ExponentPushToken[joao-tablet]',
  ana: 'ExponentPushToken[ana-celular]',
  bruno: 'ExponentPushToken[bruno-celular]',
};
const TABELAS = ['dispositivos_push', 'notificacao_preferencias', 'notificacoes', 'notificacao_envios', 'notificacao_config'];

let db;
let agendar, comoUsuario;

before(async () => {
  db = await criarBanco({
    // Como no Supabase: o esquema e visivel e toda tabela nova nasce com GRANT ALL
    antesDasMigrations: `
      GRANT USAGE ON SCHEMA public, auth TO authenticated, anon;
      ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO authenticated, anon;
    `,
  });
  ({ agendar, comoUsuario } = auxiliares(db));
  await db.exec(`
    INSERT INTO public.profiles (user_id, nome) VALUES
      ('${CLIENTE_A}', 'Ana Paula Souza'), ('${CLIENTE_B}', 'Bruno Lima'), ('${USUARIO_JOAO}', 'João Barbeiro');
  `);
});

beforeEach(async () => {
  await db.exec('RESET ROLE');
  await comoUsuario(null);
  await db.exec(`
    DELETE FROM public.notificacoes;
    DELETE FROM public.dispositivos_push;
    DELETE FROM public.notificacao_preferencias;
    DELETE FROM public.mensagens;
    DELETE FROM public.conversas;
    UPDATE public.notificacao_config SET url_backend = NULL;
    DELETE FROM public.lancamentos_financeiros;
    DELETE FROM public.pagamento_auditoria;
    DELETE FROM public.pagamento_reembolsos;
    DELETE FROM public.pagamentos;
    DELETE FROM public.pagamentos_comissao;
    DELETE FROM public.comissao_alteracoes;
    DELETE FROM public.pagamento_eventos;
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
    DELETE FROM public.agendamentos;
    ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;
  `);
});

// ---------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------
async function rpc(nome, args = {}) {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return (await db.query(`SELECT public.${nome}(${lista}) AS r`, valores)).rows[0].r;
}

async function como(uid, fn) {
  await comoUsuario(uid);
  try {
    return await fn();
  } finally {
    await comoUsuario(null);
  }
}

// Agendamento pelas regras normais (disponibilidade ativa), feito por quem esta logado
const agendarComo = (uid, hhmm, { cliente = uid, barbeiro = JOAO, servico = CORTE_30 } = {}) =>
  como(uid, () => agendar(cliente, barbeiro, servico, hhmm));

// Agendamento daqui a N minutos (sem a checagem do horario de funcionamento),
// criado ha `criadoHaMin` minutos
async function agendarDaquiA(minutos, { cliente = CLIENTE_A, barbeiro = JOAO, servico = CORTE_30, criadoHaMin = 180 } = {}) {
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento');
  try {
    const r = await db.query(
      `INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, created_at)
       VALUES ($1, $2, $3, now() + make_interval(mins => $4::int), now() - make_interval(mins => $5::int))
       RETURNING id`,
      [cliente, barbeiro, servico, minutos, criadoHaMin],
    );
    return r.rows[0].id;
  } finally {
    await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento');
  }
}

const mudarStatus = (uid, id, status) => como(uid, () =>
  db.query('UPDATE public.agendamentos SET status = $2 WHERE id = $1', [id, status]));

const avisos = async (tipo) => (await db.query(
  `SELECT id, tipo, destinatario_id, ator_id, status, motivo, dados, tentativas
     FROM public.notificacoes ${tipo ? 'WHERE tipo = $1' : ''}
    ORDER BY criada_em, chave`,
  tipo ? [tipo] : [],
)).rows;

const ultimo = async (tipo) => (await db.query(
  'SELECT status, motivo FROM public.notificacoes WHERE tipo = $1 ORDER BY criada_em DESC LIMIT 1', [tipo],
)).rows[0];

const statusDe = async (id) => (await db.query(
  'SELECT status, motivo, tentativas, proxima_tentativa, enviada_em FROM public.notificacoes WHERE id = $1', [id],
)).rows[0];

const dataHora = async (id) => (await db.query('SELECT data_hora FROM public.agendamentos WHERE id = $1', [id])).rows[0].data_hora;
const contar = async (sql, params) => Number((await db.query(sql, params)).rows[0].n);

const registrarAparelho = (uid, token) => como(uid, () => rpc('registrar_dispositivo_push', { p_token: token }));
const idDoAparelho = async (token) => (await db.query('SELECT id FROM public.dispositivos_push WHERE token = $1', [token])).rows[0]?.id;

const novaConversa = async (cliente = CLIENTE_A, barbeiro = JOAO) => (await db.query(
  'INSERT INTO public.conversas (cliente_id, barbeiro_id) VALUES ($1, $2) RETURNING id', [cliente, barbeiro],
)).rows[0].id;

// Mensagem gravada por quem esta logado, como o app e o site fazem
const enviarMensagem = (conversa, remetente, conteudo = 'Posso chegar 10 minutos antes?', { logado = remetente, lida = false } = {}) =>
  como(logado, async () => (await db.query(
    'INSERT INTO public.mensagens (conversa_id, remetente_id, conteudo, lida) VALUES ($1, $2, $3, $4) RETURNING id',
    [conversa, remetente, conteudo, lida],
  )).rows[0].id);

const reservar = (limite = 50) => rpc('reservar_notificacoes', { p_limite: limite });
const concluir = (id, resultados) => rpc('concluir_envio_notificacao', { p_notificacao_id: id, p_resultados: resultados });

// Executa como um usuario logado do Supabase (papel authenticated)
async function comoAutenticado(uid, sql, params) {
  await comoUsuario(uid);
  await db.exec('SET ROLE authenticated');
  try {
    return await db.query(sql, params);
  } finally {
    await db.exec('RESET ROLE');
    await comoUsuario(null);
  }
}

// ---------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------
test('1. cliente agenda: só o barbeiro recebe o aviso, com cliente, serviço e horário', async () => {
  const id = await agendarComo(CLIENTE_A, '10:00');
  const lista = await avisos();
  assert.equal(lista.length, 1);
  const [a] = lista;
  assert.equal(a.tipo, 'novo_agendamento');
  assert.equal(a.destinatario_id, USUARIO_JOAO);
  assert.equal(a.ator_id, CLIENTE_A);
  assert.equal(a.status, 'pendente');
  assert.equal(a.dados.agendamento_id, id);
  assert.equal(a.dados.cliente_nome, 'Ana'); // so o primeiro nome
  assert.equal(a.dados.servico, 'Corte');
  assert.equal(a.dados.papel, 'barbeiro');
  assert.equal(a.dados.ator, 'cliente');
  assert.equal(new Date(a.dados.data_hora).getTime(), new Date(await dataHora(id)).getTime());
});

test('2. cliente cancela: só o barbeiro recebe o aviso de cancelamento', async () => {
  const id = await agendarComo(CLIENTE_A, '10:00');
  await mudarStatus(CLIENTE_A, id, 'cancelado');
  const lista = await avisos('cancelamento');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].destinatario_id, USUARIO_JOAO);
  assert.equal(lista[0].ator_id, CLIENTE_A);
  const { ator, cliente_nome: cliente, servico, papel } = lista[0].dados;
  assert.deepEqual({ ator, cliente, servico, papel }, { ator: 'cliente', cliente: 'Ana', servico: 'Corte', papel: 'barbeiro' });
});

test('3. barbeiro cancela: só o cliente recebe o aviso de cancelamento', async () => {
  const id = await agendarComo(CLIENTE_A, '10:00');
  await mudarStatus(USUARIO_JOAO, id, 'cancelado');
  const lista = await avisos('cancelamento');
  assert.equal(lista.length, 1);
  assert.equal(lista[0].destinatario_id, CLIENTE_A);
  assert.equal(lista[0].ator_id, USUARIO_JOAO);
  assert.equal(lista[0].dados.ator, 'barbeiro');
  assert.equal(lista[0].dados.barbeiro_nome, 'João');
  assert.equal(lista[0].dados.papel, 'cliente');
});

test('4. cancelado por outra pessoa (admin): cliente e barbeiro recebem', async () => {
  const id = await agendarComo(CLIENTE_A, '10:00');
  await mudarStatus(ADMIN, id, 'cancelado');
  const lista = await avisos('cancelamento');
  assert.deepEqual(lista.map((a) => a.destinatario_id).sort(), [CLIENTE_A, USUARIO_JOAO].sort());
  assert.ok(lista.every((a) => a.dados.ator === 'barbearia'));
});

test('5. falta: cancelar depois do horário (ou depois de concluído) não avisa ninguém', async () => {
  const comecou = await agendarDaquiA(-20);
  await mudarStatus(USUARIO_JOAO, comecou, 'cancelado'); // "Cliente faltou"
  const concluido = await agendarDaquiA(-90, { cliente: CLIENTE_B });
  await mudarStatus(null, concluido, 'concluido');
  await mudarStatus(USUARIO_JOAO, concluido, 'cancelado');
  assert.deepEqual(await avisos('cancelamento'), []);
  // A falta continua registrada normalmente
  const r = await db.query('SELECT status FROM public.agendamentos WHERE id IN ($1, $2)', [comecou, concluido]);
  assert.deepEqual(r.rows.map((x) => x.status), ['cancelado', 'cancelado']);
});

test('6. o mesmo evento não gera dois avisos', async () => {
  const id = await agendarComo(CLIENTE_A, '10:00');
  await mudarStatus(CLIENTE_A, id, 'cancelado');
  // Processado de novo (ex.: repeticao do evento): nenhum aviso novo
  assert.equal(await rpc('avisar_agendamento', { p_tipo: 'cancelamento', p_agendamento_id: id, p_ator: CLIENTE_A }), 0);
  assert.equal(await rpc('avisar_agendamento', { p_tipo: 'novo_agendamento', p_agendamento_id: id, p_ator: CLIENTE_A }), 0);
  // Reaberto e cancelado de novo: continua um aviso de cada
  await mudarStatus(ADMIN, id, 'confirmado');
  await mudarStatus(CLIENTE_A, id, 'cancelado');
  assert.equal((await avisos('cancelamento')).length, 1);
  assert.equal((await avisos('novo_agendamento')).length, 1);
});

test('7. barbeiro sem login (Pedro): ninguém a avisar, e agendar e cancelar continuam funcionando', async () => {
  const id = await agendarComo(CLIENTE_A, '10:00', { barbeiro: PEDRO });
  await mudarStatus(CLIENTE_A, id, 'cancelado');
  assert.deepEqual(await avisos(), []);
  assert.equal((await db.query('SELECT status FROM public.agendamentos WHERE id = $1', [id])).rows[0].status, 'cancelado');
});

test('8. mensagem: o outro participante recebe o aviso, o remetente nunca, e o texto não vai junto', async () => {
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'Posso chegar 10 minutos antes?');
  await enviarMensagem(conversa, USUARIO_JOAO, 'Pode sim, te espero.');
  const lista = await avisos('mensagem');
  assert.equal(lista.length, 2);
  const paraBarbeiro = lista.find((a) => a.destinatario_id === USUARIO_JOAO);
  const paraCliente = lista.find((a) => a.destinatario_id === CLIENTE_A);
  assert.equal(paraBarbeiro.ator_id, CLIENTE_A);
  assert.deepEqual([paraBarbeiro.dados.outro_nome, paraBarbeiro.dados.papel], ['Ana', 'barbeiro']);
  assert.deepEqual([paraCliente.dados.outro_nome, paraCliente.dados.papel], ['João', 'cliente']);
  assert.deepEqual(
    [paraCliente.dados.conversa_id, paraCliente.dados.barbeiro_id, paraCliente.dados.cliente_id],
    [conversa, JOAO, CLIENTE_A],
  );
  assert.ok(lista.every((a) => a.destinatario_id !== a.ator_id));
  const tudo = JSON.stringify(lista);
  assert.ok(!tudo.includes('10 minutos') && !tudo.includes('te espero'));
});

test('9. sem aviso: mensagem já lida, gravada em nome de outra pessoa, de quem não participa ou para barbeiro sem login', async () => {
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'já lida', { lida: true });
  await enviarMensagem(conversa, CLIENTE_A, 'forjada', { logado: CLIENTE_B });
  await enviarMensagem(conversa, CLIENTE_B, 'intrusa');
  const comPedro = await novaConversa(CLIENTE_A, PEDRO);
  await enviarMensagem(comPedro, CLIENTE_A, 'oi Pedro');
  assert.deepEqual(await avisos('mensagem'), []);
  // As mensagens em si foram gravadas normalmente
  assert.equal(await contar('SELECT count(*) AS n FROM public.mensagens'), 4);
});

test('10. operação desfeita não deixa aviso na fila', async () => {
  const conversa = await novaConversa();
  await db.exec('BEGIN');
  try {
    const id = await agendarComo(CLIENTE_A, '10:00');
    await mudarStatus(CLIENTE_A, id, 'cancelado');
    await enviarMensagem(conversa, CLIENTE_A);
    assert.equal((await avisos()).length, 3); // dentro da transacao, os avisos existem
  } finally {
    await db.exec('ROLLBACK');
  }
  assert.deepEqual(await avisos(), []);
});

test('11. falha ao gravar o aviso não impede agendar, cancelar nem enviar mensagem', async () => {
  // Simula uma falha em qualquer gravacao na fila
  await db.exec('ALTER TABLE public.notificacoes ADD CONSTRAINT simula_falha CHECK (false) NOT VALID');
  try {
    const id = await agendarComo(CLIENTE_A, '10:00');
    await mudarStatus(CLIENTE_A, id, 'cancelado');
    const conversa = await novaConversa();
    const mensagem = await enviarMensagem(conversa, CLIENTE_A);
    assert.equal((await db.query('SELECT status FROM public.agendamentos WHERE id = $1', [id])).rows[0].status, 'cancelado');
    assert.equal(await contar('SELECT count(*) AS n FROM public.mensagens WHERE id = $1', [mensagem]), 1);
    assert.deepEqual(await avisos(), []);
  } finally {
    await db.exec('ALTER TABLE public.notificacoes DROP CONSTRAINT simula_falha');
  }
});

// ---------------------------------------------------------------
// Lembretes
// ---------------------------------------------------------------
test('12. lembrete: o cliente recebe 30 min antes, uma vez só; o barbeiro só se ligar', async () => {
  const id = await agendarDaquiA(20);
  assert.equal(await rpc('enfileirar_lembretes'), 1);
  assert.equal(await rpc('enfileirar_lembretes'), 0); // rodar de novo nao duplica
  let lembretes = await avisos('lembrete');
  assert.equal(lembretes.length, 1);
  assert.equal(lembretes[0].destinatario_id, CLIENTE_A);
  const { papel, minutos, barbeiro_nome: barbeiro, servico, agendamento_id: agendamento } = lembretes[0].dados;
  assert.deepEqual({ papel, minutos, barbeiro, servico, agendamento }, { papel: 'cliente', minutos: 30, barbeiro: 'João', servico: 'Corte', agendamento: id });

  // O barbeiro liga o lembrete nas preferencias
  await como(USUARIO_JOAO, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { lembretes: true } }));
  assert.equal(await rpc('enfileirar_lembretes'), 1);
  lembretes = await avisos('lembrete');
  const doBarbeiro = lembretes.find((l) => l.destinatario_id === USUARIO_JOAO);
  assert.equal(doBarbeiro.dados.papel, 'barbeiro');
  assert.equal(doBarbeiro.dados.cliente_nome, 'Ana');
});

test('13. sem lembrete: cancelado, agendado já dentro da janela, a 5 min ou menos, fora da janela ou desligado', async () => {
  const cancelado = await agendarDaquiA(20);
  await mudarStatus(CLIENTE_A, cancelado, 'cancelado');
  await agendarDaquiA(21, { cliente: CLIENTE_B, criadoHaMin: 5 }); // agendou 26 min antes: ja dentro da janela
  await agendarDaquiA(4, { cliente: CLIENTE_C }); // faltam 4 min
  await agendarDaquiA(45, { cliente: CLIENTE_C, servico: BARBA_30 }); // ainda fora da janela
  await como(ADMIN, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { lembretes: false } }));
  await agendarDaquiA(22, { cliente: ADMIN }); // lembrete desligado
  assert.equal(await rpc('enfileirar_lembretes'), 0);
  assert.deepEqual(await avisos('lembrete'), []);

  // Controle da fronteira: agendado 31 min antes (fora da janela) recebe
  await agendarDaquiA(21, { cliente: CLIENTE_B, barbeiro: PEDRO, criadoHaMin: 10 });
  assert.equal(await rpc('enfileirar_lembretes'), 1);
  assert.deepEqual((await avisos('lembrete')).map((l) => l.destinatario_id), [CLIENTE_B]);
});

test('14. lembrete com horário alterado: o antigo é descartado no envio e sai um novo', async () => {
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  const id = await agendarDaquiA(20);
  await rpc('enfileirar_lembretes');
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento');
  await db.query("UPDATE public.agendamentos SET data_hora = data_hora + interval '7 minutes' WHERE id = $1", [id]);
  await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento');
  assert.equal(await rpc('enfileirar_lembretes'), 1);

  const itens = (await reservar()).filter((i) => i.tipo === 'lembrete');
  assert.equal(itens.length, 1);
  assert.equal(new Date(itens[0].dados.data_hora).getTime(), new Date(await dataHora(id)).getTime());
  const descartados = (await avisos('lembrete')).filter((l) => l.status === 'ignorada');
  assert.deepEqual(descartados.map((l) => l.motivo), ['horario_alterado']);
});

test('15. antecedência configurável: com 60 min o lembrete sai mais cedo; os outros seguem com 30', async () => {
  await como(CLIENTE_A, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { lembrete_minutos: 60 } }));
  await agendarDaquiA(50); // Ana: 60 min
  await agendarDaquiA(50, { cliente: CLIENTE_B, barbeiro: PEDRO }); // Bruno: padrao de 30
  assert.equal(await rpc('enfileirar_lembretes'), 1);
  const [lembrete] = await avisos('lembrete');
  assert.equal(lembrete.destinatario_id, CLIENTE_A);
  assert.equal(lembrete.dados.minutos, 60);
});

// ---------------------------------------------------------------
// Aparelhos, preferencias e acesso
// ---------------------------------------------------------------
test('16. aparelho: exige login e token Expo válido; vários por pessoa; o mesmo aparelho fica com a última conta que entrou', async () => {
  assert.equal((await recusa(rpc('registrar_dispositivo_push', { p_token: TOKEN.ana }))).detail, 'NAO_AUTENTICADO');
  await como(CLIENTE_A, async () => {
    for (const token of ['abc', 'ExponentPushToken[]', `ExponentPushToken[${'x'.repeat(250)}]`]) {
      assert.equal((await recusa(rpc('registrar_dispositivo_push', { p_token: token }))).detail, 'TOKEN_INVALIDO', token);
    }
    const plataforma = await recusa(rpc('registrar_dispositivo_push', { p_token: TOKEN.ana, p_plataforma: 'windows' }));
    assert.equal(plataforma.detail, 'PLATAFORMA_INVALIDA');
  });

  await registrarAparelho(USUARIO_JOAO, TOKEN.joao);
  await registrarAparelho(USUARIO_JOAO, TOKEN.joaoTablet);
  await registrarAparelho(USUARIO_JOAO, TOKEN.joao); // renovar nao duplica
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  await registrarAparelho(CLIENTE_B, TOKEN.ana); // Bruno entrou no celular da Ana
  const r = await db.query('SELECT user_id, token, ativo FROM public.dispositivos_push ORDER BY token');
  assert.deepEqual(r.rows, [
    { user_id: CLIENTE_B, token: TOKEN.ana, ativo: true },
    { user_id: USUARIO_JOAO, token: TOKEN.joao, ativo: true },
    { user_id: USUARIO_JOAO, token: TOKEN.joaoTablet, ativo: true },
  ]);
});

test('17. sair da conta: remove só o próprio aparelho, nunca o de outra conta', async () => {
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  await registrarAparelho(CLIENTE_B, TOKEN.bruno);
  assert.equal((await recusa(rpc('remover_dispositivo_push', { p_token: TOKEN.ana }))).detail, 'NAO_AUTENTICADO');
  await como(CLIENTE_A, async () => {
    assert.equal(await rpc('remover_dispositivo_push', { p_token: TOKEN.bruno }), false);
    assert.equal(await rpc('remover_dispositivo_push', { p_token: TOKEN.ana }), true);
  });
  const r = await db.query('SELECT user_id FROM public.dispositivos_push');
  assert.deepEqual(r.rows.map((x) => x.user_id), [CLIENTE_B]);
});

test('18. preferências: padrão por perfil; cada um altera só as próprias; valores inválidos são recusados', async () => {
  const padraoCliente = await como(CLIENTE_A, () => rpc('minhas_preferencias_notificacao'));
  assert.deepEqual(padraoCliente, {
    cancelamentos: true, mensagens: true, novos_agendamentos: true, lembretes: true, lembrete_minutos: 30, perfil: 'cliente',
  });
  const padraoBarbeiro = await como(USUARIO_JOAO, () => rpc('minhas_preferencias_notificacao'));
  assert.equal(padraoBarbeiro.lembretes, false);
  assert.equal(padraoBarbeiro.perfil, 'barbeiro');
  assert.equal((await como(ADMIN, () => rpc('minhas_preferencias_notificacao'))).perfil, 'admin');

  const salvo = await como(CLIENTE_A, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { mensagens: false } }));
  assert.deepEqual(salvo, { ...padraoCliente, mensagens: false });
  assert.equal((await como(CLIENTE_B, () => rpc('minhas_preferencias_notificacao'))).mensagens, true);

  for (const [preferencias, codigo] of [
    [{ mensagens: 'nao' }, 'PREFERENCIAS_INVALIDAS'],
    [{ lembretes: null }, 'PREFERENCIAS_INVALIDAS'],
    [{ outra_coisa: true }, 'PREFERENCIAS_INVALIDAS'],
    [[true], 'PREFERENCIAS_INVALIDAS'],
    [{ lembrete_minutos: 45 }, 'ANTECEDENCIA_INVALIDA'],
    [{ lembrete_minutos: '30' }, 'ANTECEDENCIA_INVALIDA'],
  ]) {
    const erro = await como(CLIENTE_A, () => recusa(rpc('salvar_preferencias_notificacao', { p_preferencias: preferencias })));
    assert.equal(erro.detail, codigo, JSON.stringify(preferencias));
  }
  assert.equal((await recusa(rpc('minhas_preferencias_notificacao'))).detail, 'NAO_AUTENTICADO');
});

test('19. acesso: app e site não leem nem gravam as tabelas; as funções do backend ficam fechadas; as do app, só para quem está logado', async () => {
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  for (const tabela of TABELAS) {
    await assert.rejects(comoAutenticado(CLIENTE_A, `SELECT * FROM public.${tabela}`), /permission denied/, tabela);
  }
  await assert.rejects(
    comoAutenticado(CLIENTE_A, "INSERT INTO public.dispositivos_push (user_id, token) VALUES ($1, 'ExponentPushToken[x]')", [CLIENTE_A]),
    /permission denied/,
  );
  for (const chamada of [
    'public.reservar_notificacoes(10)',
    "public.concluir_envio_notificacao(gen_random_uuid(), '[]'::jsonb)",
    'public.recibos_pendentes()',
    "public.registrar_recibos('[]'::jsonb)",
    'public.rotina_notificacoes()',
    'public.enfileirar_lembretes()',
    'public.despertar_backend()',
    'public.limpar_notificacoes_antigas()',
    "public.inserir_notificacao('teste', 'x', gen_random_uuid(), NULL, '{}'::jsonb, now() + interval '1 hour')",
    "public.avisar_agendamento('cancelamento', gen_random_uuid(), NULL)",
  ]) {
    await assert.rejects(comoAutenticado(CLIENTE_A, `SELECT ${chamada}`), /permission denied/, chamada);
  }

  // As do app funcionam para quem esta logado
  await comoAutenticado(CLIENTE_A, 'SELECT public.registrar_dispositivo_push($1)', [TOKEN.ana]);
  await comoAutenticado(CLIENTE_A, 'SELECT public.minhas_preferencias_notificacao()');
  await comoAutenticado(CLIENTE_A, `SELECT public.salvar_preferencias_notificacao('{"mensagens": true}'::jsonb)`);
  await comoAutenticado(CLIENTE_A, 'SELECT public.pedir_notificacao_teste()');
  await comoAutenticado(CLIENTE_A, 'SELECT public.remover_dispositivo_push($1)', [TOKEN.ana]);

  // Visitante (anon) nao chama nem as do app
  await db.exec('SET ROLE anon');
  try {
    await assert.rejects(db.query('SELECT public.registrar_dispositivo_push($1)', [TOKEN.ana]), /permission denied/);
    await assert.rejects(db.query('SELECT public.pedir_notificacao_teste()'), /permission denied/);
  } finally {
    await db.exec('RESET ROLE');
  }

  // RLS ligado e nenhuma policy
  const lista = TABELAS.map((t) => `'${t}'`).join(', ');
  const rls = await db.query(`SELECT relname, relrowsecurity FROM pg_class
    WHERE relnamespace = 'public'::regnamespace AND relname IN (${lista})`);
  assert.equal(rls.rows.length, TABELAS.length);
  assert.ok(rls.rows.every((r) => r.relrowsecurity));
  assert.equal(await contar(`SELECT count(*) AS n FROM pg_policies WHERE tablename IN (${lista})`), 0);
});

test('20. conta excluída: aparelhos, preferências e avisos dela saem junto', async () => {
  const uid = 'c0000000-0000-4000-8000-0000000000d1';
  await db.query('INSERT INTO auth.users VALUES ($1)', [uid]);
  await registrarAparelho(uid, 'ExponentPushToken[temporario]');
  await como(uid, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { mensagens: false } }));
  await como(uid, () => rpc('pedir_notificacao_teste'));
  await db.query('DELETE FROM auth.users WHERE id = $1', [uid]);
  assert.equal(await contar('SELECT count(*) AS n FROM public.dispositivos_push WHERE user_id = $1', [uid]), 0);
  assert.equal(await contar('SELECT count(*) AS n FROM public.notificacao_preferencias WHERE user_id = $1', [uid]), 0);
  assert.equal(await contar('SELECT count(*) AS n FROM public.notificacoes WHERE destinatario_id = $1', [uid]), 0);
});

// ---------------------------------------------------------------
// Fila: o que o backend usa para enviar
// ---------------------------------------------------------------
test('21. reservar: entrega o aviso com os aparelhos ativos do destinatário, uma vez só, e retoma depois de uma queda', async () => {
  await registrarAparelho(USUARIO_JOAO, TOKEN.joao);
  await registrarAparelho(USUARIO_JOAO, TOKEN.joaoTablet);
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  const id = await agendarComo(CLIENTE_A, '10:00');

  const itens = await reservar();
  assert.equal(itens.length, 1);
  const [item] = itens;
  assert.equal(item.tipo, 'novo_agendamento');
  assert.equal(item.destinatario_id, USUARIO_JOAO);
  assert.equal(item.tentativas, 1);
  assert.equal(item.dados.agendamento_id, id);
  assert.deepEqual(item.dispositivos.map((d) => d.token), [TOKEN.joao, TOKEN.joaoTablet]); // nunca o da Ana
  assert.equal((await statusDe(item.id)).status, 'enviando');
  assert.deepEqual(await reservar(), []); // reservado: outra execucao nao pega

  // O backend caiu no meio do envio: passado o prazo da reserva, outra execucao retoma
  await db.query("UPDATE public.notificacoes SET reservada_ate = now() - interval '1 second' WHERE id = $1", [item.id]);
  const [retomado] = await reservar();
  assert.equal(retomado.id, item.id);
  assert.equal(retomado.tentativas, 2);
});

test('22. reservar descarta o que não vale mais: preferência, sem aparelho, já lida, cancelamento desfeito, agendamento cancelado, prazo vencido', async () => {
  await registrarAparelho(USUARIO_JOAO, TOKEN.joao);
  await registrarAparelho(CLIENTE_A, TOKEN.ana);

  // Preferencia desligada: o barbeiro nao quer avisos de novos agendamentos
  await como(USUARIO_JOAO, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { novos_agendamentos: false } }));
  await agendarComo(CLIENTE_A, '10:00');
  assert.deepEqual(await reservar(), []);
  assert.deepEqual(await ultimo('novo_agendamento'), { status: 'ignorada', motivo: 'preferencia' });
  await como(USUARIO_JOAO, () => rpc('salvar_preferencias_notificacao', { p_preferencias: { novos_agendamentos: true } }));

  // Agendamento cancelado antes do envio, e o cliente sem aparelho registrado
  const doBruno = await agendarComo(CLIENTE_B, '11:00');
  await mudarStatus(USUARIO_JOAO, doBruno, 'cancelado');
  assert.deepEqual(await reservar(), []);
  assert.deepEqual(await ultimo('novo_agendamento'), { status: 'ignorada', motivo: 'agendamento_cancelado' });
  assert.deepEqual(await ultimo('cancelamento'), { status: 'ignorada', motivo: 'sem_aparelho' });

  // Mensagem lida antes do envio (ex.: pelo site)
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A);
  await db.query('UPDATE public.mensagens SET lida = true WHERE conversa_id = $1', [conversa]);
  assert.deepEqual(await reservar(), []);
  assert.deepEqual(await ultimo('mensagem'), { status: 'ignorada', motivo: 'ja_lida' });

  // Cancelamento desfeito antes do envio: o cancelamento nao sai, o novo agendamento sim
  const reaberto = await agendarComo(CLIENTE_A, '13:00', { servico: BARBA_30 });
  await mudarStatus(USUARIO_JOAO, reaberto, 'cancelado');
  await mudarStatus(ADMIN, reaberto, 'confirmado');
  assert.deepEqual((await reservar()).map((i) => i.tipo), ['novo_agendamento']);
  assert.deepEqual(await ultimo('cancelamento'), { status: 'ignorada', motivo: 'cancelamento_revertido' });

  // Prazo vencido (ex.: o backend ficou fora do ar)
  await enviarMensagem(conversa, CLIENTE_A, 'outra');
  await db.query("UPDATE public.notificacoes SET expira_em = now() - interval '1 second' WHERE status = 'pendente'");
  assert.deepEqual(await reservar(), []);
  assert.deepEqual(await ultimo('mensagem'), { status: 'expirada', motivo: 'prazo' });
});

test('23. mensagem: o aviso traz o total de não lidas da conversa (o mesmo contador dos apps)', async () => {
  await registrarAparelho(USUARIO_JOAO, TOKEN.joao);
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'um');
  await enviarMensagem(conversa, CLIENTE_A, 'dois');
  await enviarMensagem(conversa, CLIENTE_A, 'três');
  const itens = await reservar();
  assert.equal(itens.length, 3);
  assert.ok(itens.every((i) => i.tipo === 'mensagem' && Number(i.nao_lidas) === 3));
});

test('24. concluir: aceito vira enviada; app desinstalado desativa o aparelho; falha temporária tenta de novo só onde falhou; na 5ª desiste', async () => {
  await registrarAparelho(USUARIO_JOAO, TOKEN.joao);
  await registrarAparelho(USUARIO_JOAO, TOKEN.joaoTablet);
  const celular = await idDoAparelho(TOKEN.joao);
  const tablet = await idDoAparelho(TOKEN.joaoTablet);

  // O celular recebe; o tablet teve o app desinstalado
  await agendarComo(CLIENTE_A, '10:00');
  let [item] = await reservar();
  let r = await concluir(item.id, [
    { dispositivo_id: celular, status: 'aceito', ticket_id: 'ticket-1' },
    { dispositivo_id: tablet, status: 'recusado', erro: 'DeviceNotRegistered' },
  ]);
  assert.equal(r.status, 'enviada');
  let s = await statusDe(item.id);
  assert.equal(s.status, 'enviada');
  assert.ok(s.enviada_em);
  assert.equal(s.motivo, 'parcial: DeviceNotRegistered');
  const aparelho = (await db.query('SELECT ativo, motivo_desativacao FROM public.dispositivos_push WHERE id = $1', [tablet])).rows[0];
  assert.deepEqual(aparelho, { ativo: false, motivo_desativacao: 'DeviceNotRegistered' });

  // O tablet volta (app reinstalado); o celular tem uma falha temporaria
  await registrarAparelho(USUARIO_JOAO, TOKEN.joaoTablet);
  await agendarComo(CLIENTE_B, '11:00');
  [item] = await reservar();
  assert.equal(item.dispositivos.length, 2);
  r = await concluir(item.id, [
    { dispositivo_id: celular, status: 'erro', erro: 'HTTP 503' },
    { dispositivo_id: tablet, status: 'aceito', ticket_id: 'ticket-2' },
  ]);
  assert.equal(r.status, 'pendente');
  s = await statusDe(item.id);
  assert.equal(s.motivo, 'erro_temporario: HTTP 503');
  const espera = (new Date(s.proxima_tentativa) - Date.now()) / 1000;
  assert.ok(espera > 20 && espera <= 31, `espera de ${espera}s`);
  assert.deepEqual(await reservar(), []); // ainda nao e a hora
  await db.query('UPDATE public.notificacoes SET proxima_tentativa = now() WHERE id = $1', [item.id]);
  [item] = await reservar();
  assert.deepEqual(item.dispositivos.map((d) => d.id), [celular]); // so quem falhou
  r = await concluir(item.id, [{ dispositivo_id: celular, status: 'aceito', ticket_id: 'ticket-3' }]);
  assert.equal(r.status, 'enviada');
  assert.equal((await statusDe(item.id)).motivo, null);

  // Falhas seguidas: espera 30 s, 2 min, 8 min e 32 min; na 5a, desiste
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A);
  const esperas = [];
  for (let tentativa = 1; tentativa <= 5; tentativa++) {
    await db.query("UPDATE public.notificacoes SET proxima_tentativa = now() WHERE status = 'pendente'");
    [item] = await reservar();
    assert.equal(item.tentativas, tentativa);
    r = await concluir(item.id, item.dispositivos.map((d) => ({ dispositivo_id: d.id, status: 'erro', erro: 'HTTP 500' })));
    if (r.proxima_tentativa) esperas.push(Math.round((new Date(r.proxima_tentativa) - Date.now()) / 1000));
  }
  assert.equal(r.status, 'falhou');
  assert.equal((await statusDe(item.id)).motivo, 'tentativas_esgotadas: HTTP 500');
  [30, 120, 480, 1920].forEach((esperado, i) => assert.ok(Math.abs(esperas[i] - esperado) <= 2, `espera ${i + 1}: ${esperas[i]}s`));
});

test('25. recibos: conferidos depois de 15 min; entregue ou aparelho desativado; se nenhum aparelho recebeu, o aviso falha', async () => {
  await registrarAparelho(USUARIO_JOAO, TOKEN.joao);
  await registrarAparelho(USUARIO_JOAO, TOKEN.joaoTablet);
  const celular = await idDoAparelho(TOKEN.joao);
  const tablet = await idDoAparelho(TOKEN.joaoTablet);
  await agendarComo(CLIENTE_A, '10:00');
  const [item] = await reservar();
  await concluir(item.id, [
    { dispositivo_id: celular, status: 'aceito', ticket_id: 'ticket-ok' },
    { dispositivo_id: tablet, status: 'aceito', ticket_id: 'ticket-desinstalado' },
  ]);
  assert.deepEqual(await rpc('recibos_pendentes'), []); // cedo demais
  await db.query("UPDATE public.notificacao_envios SET enviado_em = now() - interval '20 minutes'");
  assert.deepEqual((await rpc('recibos_pendentes')).sort(), ['ticket-desinstalado', 'ticket-ok']);

  const r = await rpc('registrar_recibos', { p_recibos: [
    { ticket_id: 'ticket-ok', status: 'ok' },
    { ticket_id: 'ticket-desinstalado', status: 'error', erro: 'DeviceNotRegistered' },
    { ticket_id: 'ticket-desconhecido', status: 'ok' },
  ] });
  assert.deepEqual(r, { entregues: 1, recusados: 1, desativados: 1 });
  const envios = await db.query('SELECT dispositivo_id, status FROM public.notificacao_envios WHERE notificacao_id = $1', [item.id]);
  assert.deepEqual(Object.fromEntries(envios.rows.map((e) => [e.dispositivo_id, e.status])), { [celular]: 'entregue', [tablet]: 'recusado' });
  assert.equal((await db.query('SELECT ativo FROM public.dispositivos_push WHERE id = $1', [tablet])).rows[0].ativo, false);
  assert.equal((await statusDe(item.id)).status, 'enviada');
  assert.deepEqual(await rpc('recibos_pendentes'), []);

  // So o celular ativo, e o recibo dele falha: o aviso conta como falha
  await agendarComo(CLIENTE_B, '11:00');
  const [outro] = await reservar();
  assert.deepEqual(outro.dispositivos.map((d) => d.id), [celular]);
  await concluir(outro.id, [{ dispositivo_id: celular, status: 'aceito', ticket_id: 'ticket-grande' }]);
  await rpc('registrar_recibos', { p_recibos: [{ ticket_id: 'ticket-grande', status: 'error', erro: 'MessageTooBig' }] });
  const s = await statusDe(outro.id);
  assert.deepEqual([s.status, s.motivo], ['falhou', 'recibo: MessageTooBig']);
  // MessageTooBig nao e culpa do aparelho: ele continua ativo
  assert.equal((await db.query('SELECT ativo FROM public.dispositivos_push WHERE id = $1', [celular])).rows[0].ativo, true);
});

test('26. o aviso nunca vai para o aparelho de outra pessoa', async () => {
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  await registrarAparelho(CLIENTE_B, TOKEN.bruno);
  const id = await agendarComo(CLIENTE_A, '10:00');
  await mudarStatus(USUARIO_JOAO, id, 'cancelado'); // aviso para a Ana
  const [item] = (await reservar()).filter((i) => i.tipo === 'cancelamento');
  assert.deepEqual(item.dispositivos.map((d) => d.token), [TOKEN.ana]);

  // Resultado informado para o aparelho do Bruno e ignorado
  const r = await concluir(item.id, [{ dispositivo_id: await idDoAparelho(TOKEN.bruno), status: 'aceito', ticket_id: 'ticket-intruso' }]);
  assert.equal(r.status, 'falhou');
  assert.equal(await contar('SELECT count(*) AS n FROM public.notificacao_envios'), 0);

  // Bruno entrou no celular da Ana: os avisos da Ana nao vao mais para esse aparelho
  const conversa = await novaConversa();
  await enviarMensagem(conversa, USUARIO_JOAO, 'Confirmado!');
  await registrarAparelho(CLIENTE_B, TOKEN.ana);
  assert.deepEqual(await reservar(), []);
  assert.deepEqual(await ultimo('mensagem'), { status: 'ignorada', motivo: 'sem_aparelho' });
});

// ---------------------------------------------------------------
// Rotina, notificacao de teste e limpeza
// ---------------------------------------------------------------
test('27. rotina de cada minuto: gera lembretes, expira o vencido e, sem pg_net, não chama o backend', async () => {
  await agendarDaquiA(20); // novo agendamento (para o barbeiro) e lembrete (para a Ana)
  let r = await rpc('rotina_notificacoes');
  assert.deepEqual(r, { lembretes: 1, expiradas: 0, pendentes: true, despertou: false });

  await db.query("UPDATE public.notificacao_config SET url_backend = 'https://backend.teste'");
  assert.equal(await rpc('despertar_backend'), false); // URL configurada, mas o PGlite nao tem pg_net

  await db.query("UPDATE public.notificacoes SET expira_em = now() - interval '1 second'");
  r = await rpc('rotina_notificacoes');
  assert.deepEqual(r, { lembretes: 0, expiradas: 2, pendentes: false, despertou: false });

  // So aceita endereco http(s)
  await assert.rejects(db.query("UPDATE public.notificacao_config SET url_backend = 'javascript:alert(1)'"), /check/i);
});

test('28. notificação de teste: exige login, vai só para o próprio aparelho, no máximo uma por minuto', async () => {
  assert.equal((await recusa(rpc('pedir_notificacao_teste'))).detail, 'NAO_AUTENTICADO');
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  await registrarAparelho(CLIENTE_B, TOKEN.bruno);

  // Dois pedidos no mesmo instante: so o primeiro cria
  await comoUsuario(CLIENTE_A);
  await db.exec('BEGIN');
  let primeiro;
  let segundo;
  try {
    primeiro = await rpc('pedir_notificacao_teste');
    segundo = await rpc('pedir_notificacao_teste');
  } finally {
    await db.exec('COMMIT');
    await comoUsuario(null);
  }
  assert.deepEqual(primeiro, { criada: true, aparelhos: 1 });
  assert.deepEqual(segundo, { criada: false, aparelhos: 1 });

  const itens = await reservar();
  assert.equal(itens.length, 1);
  assert.equal(itens[0].tipo, 'teste');
  assert.deepEqual(itens[0].dispositivos.map((d) => d.token), [TOKEN.ana]);
});

test('29. limpeza: apaga o histórico finalizado com mais de 90 dias e aparelhos desativados há tempo; mantém o resto', async () => {
  await registrarAparelho(CLIENTE_A, TOKEN.ana);
  await registrarAparelho(CLIENTE_B, TOKEN.bruno);
  const conversa = await novaConversa();
  await enviarMensagem(conversa, CLIENTE_A, 'antiga');
  await enviarMensagem(conversa, CLIENTE_A, 'pendente antiga');
  await enviarMensagem(conversa, CLIENTE_A, 'recente');
  const [velha, pendente] = await avisos('mensagem');
  await db.query("UPDATE public.notificacoes SET criada_em = now() - interval '100 days', status = 'enviada' WHERE id = $1", [velha.id]);
  await db.query("UPDATE public.notificacoes SET criada_em = now() - interval '100 days' WHERE id = $1", [pendente.id]);
  await db.query("UPDATE public.dispositivos_push SET ativo = false, desativado_em = now() - interval '100 days' WHERE token = $1", [TOKEN.bruno]);

  assert.deepEqual(await rpc('limpar_notificacoes_antigas'), { avisos: 1, aparelhos: 1 });
  assert.equal((await avisos('mensagem')).length, 2);
  assert.deepEqual((await db.query('SELECT token FROM public.dispositivos_push')).rows.map((x) => x.token), [TOKEN.ana]);
});
