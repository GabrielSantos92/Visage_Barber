// Financeiro no banco: preco congelado, ciclo do pagamento, lancamentos
// imutaveis (comissao), reembolsos, cancelamento, fechamento semanal,
// pagamentos aos barbeiros e quem pode ver o que. Roda as migrations reais em
// um Postgres embutido (PGlite).
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  criarBanco, auxiliares, recusa, migration, DIA,
  JOAO, PEDRO, CORTE_30, BARBA_30, CLIENTE_A, CLIENTE_B, ADMIN, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

// Servico do exemplo da especificacao: R$ 50,00
const SERVICO_50 = '50000000-0000-4000-8000-000000000050';
// Segunda-feira da semana de DIA (DIA e uma quarta-feira)
const SEMANA = new Date(Date.parse(`${DIA}T12:00:00Z`) - 2 * 86400000).toISOString().slice(0, 10);
// Inicio de periodo que sempre inclui "agora" no horario de Sao Paulo (a noite
// a data em UTC ja e a do dia seguinte)
const INICIO = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);

let db;
let agendar, comoUsuario;

before(async () => {
  db = await criarBanco();
  ({ agendar, comoUsuario } = auxiliares(db));
  await db.exec(`
    INSERT INTO public.servicos (id, nome, preco, duracao_min) VALUES ('${SERVICO_50}', 'Corte premium', 50, 30);
    INSERT INTO public.barbeiro_servicos SELECT id, '${SERVICO_50}' FROM public.barbeiros;
    INSERT INTO public.profiles (user_id, nome) VALUES
      ('${CLIENTE_A}', 'Ana'), ('${CLIENTE_B}', 'Bruno'), ('${ADMIN}', 'Dono'), ('${USUARIO_JOAO}', 'João');
    -- Permissoes que o Supabase concede por padrao, para testar o RLS de verdade
    GRANT USAGE ON SCHEMA public, auth TO authenticated;
    GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
    GRANT EXECUTE ON FUNCTION auth.uid() TO authenticated;
    GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated;
  `);
});

beforeEach(async () => {
  await comoUsuario(null);
  await db.exec(`
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

// Chama uma funcao do banco com argumentos nomeados (como o supabase.rpc)
async function rpc(nome, args = {}) {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  const r = await db.query(`SELECT public.${nome}(${lista}) AS r`, valores);
  return r.rows[0].r;
}
async function linhas(nome, args = {}) {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  return (await db.query(`SELECT * FROM public.${nome}(${lista})`, chaves.map((k) => args[k]))).rows;
}
const n = (v) => Number(v);

async function comoAdmin(fn) {
  await comoUsuario(ADMIN);
  try { return await fn(); } finally { await comoUsuario(null); }
}
const configurar = (barbeiro, pct) => comoAdmin(() => rpc('configurar_comissao', { p_barbeiro_id: barbeiro, p_percentual: pct }));
const concluir = (id) => db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [id]);
const cancelar = (id) => db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [id]);
const lancamentos = async (agendamento) =>
  (await db.query('SELECT * FROM public.lancamentos_financeiros WHERE agendamento_id = $1 ORDER BY id', [agendamento])).rows;

// Pagamento online confirmado pelo provedor (como o backend faz depois de
// consultar a API do Mercado Pago)
async function pagarOnline(agendamento, cliente, { metodo = 'pix', status = 'approved', taxa = 0, mpId = `mp-${agendamento}` } = {}) {
  const ini = await rpc('iniciar_pagamento', { p_agendamento_id: agendamento, p_cliente_id: cliente, p_metodo: metodo });
  const pag = ini.pagamento;
  await rpc('registrar_cobranca', {
    p_pagamento_id: pag.id,
    p_dados: { provedor_pagamento_id: metodo === 'pix' ? mpId : undefined, pix_copia_cola: '000201...', expira_em: new Date(Date.now() + 1800e3).toISOString() },
  });
  const r = await rpc('aplicar_estado_pagamento', {
    p_pagamento_id: pag.id,
    p_estado: { status, provedor_pagamento_id: mpId, valor: n(pag.valor), taxa, valor_reembolsado: 0, aprovado_em: new Date().toISOString(), reembolsos: [] },
  });
  return r.pagamento;
}

test('preço congelado no agendamento: o app não consegue mudar o valor cobrado', async () => {
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  assert.equal(n((await db.query('SELECT preco FROM public.agendamentos WHERE id = $1', [id])).rows[0].preco), 50);
  await db.query('UPDATE public.agendamentos SET preco = 1 WHERE id = $1', [id]);
  assert.equal(n((await db.query('SELECT preco FROM public.agendamentos WHERE id = $1', [id])).rows[0].preco), 50);
  // Mudar o preco do servico depois nao muda o que ja foi reservado
  await db.query('UPDATE public.servicos SET preco = 80 WHERE id = $1', [SERVICO_50]);
  const ini = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'pix' });
  assert.equal(n(ini.pagamento.valor), 50);
  await db.query('UPDATE public.servicos SET preco = 50 WHERE id = $1', [SERVICO_50]);
});

test('cobrança: só o dono do agendamento, nunca de agendamento cancelado ou já pago', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const outro = await recusa(rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_B, p_metodo: 'pix' }));
  assert.equal(outro.detail, 'AGENDAMENTO_NAO_ENCONTRADO');

  await pagarOnline(id, CLIENTE_A);
  assert.equal((await recusa(rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'cartao' }))).detail, 'JA_PAGO');

  const cancelado = await agendar(CLIENTE_A, JOAO, BARBA_30, '10:00');
  await cancelar(cancelado);
  assert.equal((await recusa(rpc('iniciar_pagamento', { p_agendamento_id: cancelado, p_cliente_id: CLIENTE_A, p_metodo: 'pix' }))).detail, 'AGENDAMENTO_CANCELADO');
});

test('uma cobrança em aberto por agendamento: reaproveita o mesmo meio e troca de meio cancelando a anterior', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'pix' });
  await rpc('registrar_cobranca', { p_pagamento_id: pix.pagamento.id, p_dados: { provedor_pagamento_id: 'mp-1', pix_copia_cola: 'abc', expira_em: new Date(Date.now() + 1800e3).toISOString() } });

  const denovo = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'pix' });
  assert.equal(denovo.reaproveitado, true);
  assert.equal(denovo.pagamento.id, pix.pagamento.id);

  const cartao = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'cartao' });
  assert.equal(cartao.reaproveitado, false);
  assert.deepEqual(cartao.cancelados.map((c) => c.provedor_pagamento_id), ['mp-1']);
  const { rows } = await db.query('SELECT status FROM public.pagamentos WHERE agendamento_id = $1 ORDER BY criado_em', [id]);
  assert.deepEqual(rows.map((r) => r.status), ['canceled', 'pending']);
});

test('4/7. pagamento aprovado e serviço concluído: lançamento com a fotografia e a comissão personalizada', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  await pagarOnline(id, CLIENTE_A, { taxa: 0.5 });
  // Pago, mas ainda nao realizado: nao gera comissao
  assert.equal((await lancamentos(id)).length, 0);

  await concluir(id);
  const [l] = await lancamentos(id);
  assert.equal(l.tipo, 'servico');
  assert.equal(l.competencia instanceof Date ? l.competencia.toISOString().slice(0, 10) : String(l.competencia).slice(0, 10), DIA);
  assert.deepEqual(
    [l.valor_original, l.desconto, l.valor_pago, l.percentual_comissao, l.valor_comissao, l.valor_barbearia, l.taxa_meio].map(n),
    [50, 0, 50, 60, 30, 20, 0.5],
  );
});

test('3/7. presencial com desconto (exemplo R$ 50 - R$ 5, 60%): barbeiro R$ 27, barbearia R$ 18', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  // Cliente escolhe pagar na barbearia
  const ini = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'presencial' });
  assert.equal(ini.pagamento.status, 'pending');

  // So o admin confirma o recebimento
  await comoUsuario(CLIENTE_A);
  assert.equal((await recusa(rpc('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'dinheiro', p_desconto: 5 }))).detail, 'SEM_PERMISSAO');
  const r = await comoAdmin(() => rpc('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'dinheiro', p_desconto: 5 }));
  assert.equal(r.pagamento.id, ini.pagamento.id);
  assert.equal(r.pagamento.status, 'approved');
  assert.equal(n(r.pagamento.valor), 45);

  await concluir(id);
  const [l] = await lancamentos(id);
  assert.deepEqual([l.valor_original, l.desconto, l.valor_pago, l.valor_comissao, l.valor_barbearia].map(n), [50, 5, 45, 27, 18]);
});

test('5. pagamento recusado ou expirado não gera receita nem comissão', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pag = await pagarOnline(id, CLIENTE_A, { status: 'rejected' });
  assert.equal(pag.status, 'rejected');
  assert.equal(pag.aprovado_em, null);
  await concluir(id);
  assert.equal((await lancamentos(id)).length, 0);

  const resumo = await comoAdmin(() => rpc('financeiro_resumo', { p_inicio: SEMANA, p_fim: DIA }));
  assert.equal(n(resumo.total_recebido), 0);
});

test('valor divergente do provedor é recusado (não aprova o que não foi cobrado)', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const ini = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'pix' });
  const r = await recusa(rpc('aplicar_estado_pagamento', {
    p_pagamento_id: ini.pagamento.id,
    p_estado: { status: 'approved', provedor_pagamento_id: 'mp-x', valor: 1, reembolsos: [] },
  }));
  assert.equal(r.detail, 'VALOR_DIVERGENTE');
  assert.equal((await db.query('SELECT status FROM public.pagamentos WHERE id = $1', [ini.pagamento.id])).rows[0].status, 'pending');
});

test('6. o mesmo estado aplicado de novo (notificação repetida) não duplica nada', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await concluir(id);
  const pag = await pagarOnline(id, CLIENTE_A);
  const estado = { status: 'partially_refunded', provedor_pagamento_id: `mp-${id}`, valor: 40, valor_reembolsado: 10, reembolsos: [{ id: 'r1', valor: 10 }] };
  for (let i = 0; i < 3; i++) await rpc('aplicar_estado_pagamento', { p_pagamento_id: pag.id, p_estado: estado });
  assert.deepEqual((await lancamentos(id)).map((l) => l.tipo), ['servico', 'reembolso']);
  assert.equal(n((await db.query('SELECT count(*) AS c FROM public.pagamento_reembolsos')).rows[0].c), 1);

  // Evento do webhook: o segundo igual e ignorado depois de processado
  assert.equal((await rpc('registrar_evento_pagamento', { p_provedor: 'mercadopago', p_chave: 'n1', p_tipo: 'payment', p_recurso_id: '1' })).processar, true);
  await rpc('concluir_evento_pagamento', { p_provedor: 'mercadopago', p_chave: 'n1', p_situacao: 'processado', p_erro: null });
  assert.equal((await rpc('registrar_evento_pagamento', { p_provedor: 'mercadopago', p_chave: 'n1', p_tipo: 'payment', p_recurso_id: '1' })).processar, false);
});

test('8. mudar a comissão não altera serviços anteriores', async () => {
  await configurar(JOAO, 60);
  const antes = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  await pagarOnline(antes, CLIENTE_A);
  await concluir(antes);

  await configurar(JOAO, 50);
  const depois = await agendar(CLIENTE_B, JOAO, SERVICO_50, '10:00');
  await pagarOnline(depois, CLIENTE_B);
  await concluir(depois);

  assert.deepEqual([(await lancamentos(antes))[0], (await lancamentos(depois))[0]].map((l) => [n(l.percentual_comissao), n(l.valor_comissao)]),
    [[60, 30], [50, 25]]);
  // E o registro nao pode ser editado
  assert.equal((await recusa(db.query('UPDATE public.lancamentos_financeiros SET valor_comissao = 0'))).detail, 'REGISTRO_IMUTAVEL');
});

test('sem comissão configurada não há lançamento; o admin configura e ele é gerado (padrão vale para quem não tem próprio)', async () => {
  const id = await agendar(CLIENTE_A, PEDRO, SERVICO_50, '09:00');
  await pagarOnline(id, CLIENTE_A);
  await concluir(id);
  assert.equal((await lancamentos(id)).length, 0);

  await configurar(null, 40); // padrao da barbearia
  const [l] = await lancamentos(id);
  assert.deepEqual([n(l.percentual_comissao), n(l.valor_comissao)], [40, 20]);

  // Percentual proprio passa a valer para os proximos; remover volta ao padrao
  await configurar(PEDRO, 70);
  assert.equal(n((await db.query('SELECT public.comissao_vigente($1) AS p', [PEDRO])).rows[0].p), 70);
  await configurar(PEDRO, null);
  assert.equal(n((await db.query('SELECT public.comissao_vigente($1) AS p', [PEDRO])).rows[0].p), 40);
  assert.equal((await recusa(configurar(PEDRO, 120))).detail, 'PERCENTUAL_INVALIDO');
});

test('9. serviço cancelado não gera comissão; cancelado depois de concluído é estornado', async () => {
  await configurar(JOAO, 60);
  const cancelado = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await pagarOnline(cancelado, CLIENTE_A);
  await cancelar(cancelado);
  assert.equal((await lancamentos(cancelado)).length, 0);

  // Concluido e depois registrado como falta
  const falta = await agendar(CLIENTE_B, JOAO, CORTE_30, '10:00');
  await pagarOnline(falta, CLIENTE_B);
  await concluir(falta);
  await cancelar(falta);
  const ls = await lancamentos(falta);
  assert.deepEqual(ls.map((l) => l.tipo), ['servico', 'cancelamento']);
  assert.equal(ls.reduce((s, l) => s + n(l.valor_comissao), 0), 0);
  assert.equal(ls.reduce((s, l) => s + n(l.valor_pago), 0), 0);
});

test('10. reembolso parcial ajusta a comissão proporcionalmente; o total zera sem sobra de arredondamento', async () => {
  await configurar(JOAO, 55);
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00'); // R$ 40, comissao R$ 22
  await concluir(id);
  const pag = await pagarOnline(id, CLIENTE_A);

  await rpc('aplicar_estado_pagamento', { p_pagamento_id: pag.id, p_estado: {
    status: 'partially_refunded', provedor_pagamento_id: `mp-${id}`, valor: 40, valor_reembolsado: 10, reembolsos: [{ id: 'r1', valor: 10 }] } });
  let ls = await lancamentos(id);
  assert.deepEqual([n(ls[1].valor_pago), n(ls[1].valor_comissao), n(ls[1].valor_barbearia)], [-10, -5.5, -4.5]);

  await rpc('aplicar_estado_pagamento', { p_pagamento_id: pag.id, p_estado: {
    status: 'refunded', provedor_pagamento_id: `mp-${id}`, valor: 40, valor_reembolsado: 40,
    reembolsos: [{ id: 'r1', valor: 10 }, { id: 'r2', valor: 30 }] } });
  ls = await lancamentos(id);
  assert.deepEqual(ls.map((l) => l.tipo), ['servico', 'reembolso', 'reembolso']);
  assert.equal(ls.reduce((s, l) => s + n(l.valor_comissao), 0), 0);
  assert.equal(ls.reduce((s, l) => s + n(l.valor_pago), 0), 0);
  const p = (await db.query('SELECT status, valor_reembolsado FROM public.pagamentos WHERE id = $1', [pag.id])).rows[0];
  assert.deepEqual([p.status, n(p.valor_reembolsado)], ['refunded', 40]);
});

test('10b. reembolso de pagamento presencial pelo admin, sem passar do valor pago', async () => {
  await configurar(JOAO, 50);
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await concluir(id);
  const { pagamento } = await comoAdmin(() => rpc('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'cartao_debito' }));
  assert.equal((await recusa(comoAdmin(() => rpc('registrar_reembolso_presencial', { p_pagamento_id: pagamento.id, p_valor: 50 })))).detail, 'VALOR_INVALIDO');
  const r = await comoAdmin(() => rpc('registrar_reembolso_presencial', { p_pagamento_id: pagamento.id, p_valor: 20, p_motivo: 'insatisfeito' }));
  assert.equal(r.status, 'partially_refunded');
  const ls = await lancamentos(id);
  assert.deepEqual(ls.map((l) => [l.tipo, n(l.valor_comissao)]), [['servico', 20], ['reembolso', -10]]);
});

test('11. fechamento semanal soma as comissões de cada barbeiro', async () => {
  await configurar(JOAO, 60);
  await configurar(PEDRO, 50);
  const a1 = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  const a2 = await agendar(CLIENTE_B, JOAO, CORTE_30, '10:00');
  const a3 = await agendar(CLIENTE_A, PEDRO, CORTE_30, '14:00');
  for (const [id, cli] of [[a1, CLIENTE_A], [a2, CLIENTE_B], [a3, CLIENTE_A]]) { await pagarOnline(id, cli); await concluir(id); }

  const semana = await comoAdmin(() => linhas('fechamento_semanal', { p_semana_inicio: SEMANA }));
  const porNome = Object.fromEntries(semana.map((r) => [r.nome, [n(r.servicos), n(r.faturamento), n(r.comissao), n(r.pago), n(r.pendente)]]));
  assert.deepEqual(porNome['João'], [2, 90, 54, 0, 54]);
  assert.deepEqual(porNome['Pedro'], [1, 40, 20, 0, 20]);
  // A semana tem que comecar na segunda
  assert.equal((await recusa(comoAdmin(() => linhas('fechamento_semanal', { p_semana_inicio: DIA })))).detail, 'SEMANA_INVALIDA');
});

test('12/13. pagamento semanal ao barbeiro: parcial mantém saldo, não paga duas vezes, só o admin registra', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00'); // comissao R$ 30
  await pagarOnline(id, CLIENTE_A);
  await concluir(id);

  const pagar = (valor) => rpc('registrar_pagamento_comissao', {
    p_barbeiro_id: JOAO, p_semana_inicio: SEMANA, p_valor: valor, p_metodo: 'pix', p_comprovante: 'E123', p_observacoes: 'semana 1' });

  await comoUsuario(USUARIO_JOAO);
  assert.equal((await recusa(pagar(10))).detail, 'SEM_PERMISSAO');

  const parcial = await comoAdmin(() => pagar(10));
  assert.deepEqual([n(parcial.saldo_semana), n(parcial.saldo_geral)], [20, 20]);
  assert.equal(parcial.pagamento.registrado_por, ADMIN);

  const acima = await recusa(comoAdmin(() => pagar(25)));
  assert.equal(acima.detail, 'VALOR_ACIMA_DO_SALDO');
  assert.equal(acima.message, 'O valor é maior que o saldo pendente (R$ 20,00).');

  // Dois cliques ao mesmo tempo no saldo inteiro: so um grava
  const dois = await comoAdmin(() => Promise.allSettled([pagar(20), pagar(20)]));
  assert.equal(dois.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(dois.find((r) => r.status === 'rejected').reason.detail, 'SEM_SALDO');

  const [linha] = (await comoAdmin(() => linhas('fechamento_semanal', { p_semana_inicio: SEMANA }))).filter((r) => r.nome === 'João');
  assert.deepEqual([n(linha.comissao), n(linha.pago), n(linha.pendente), n(linha.saldo_geral)], [30, 30, 0, 0]);
  // Historico permanente
  assert.equal((await recusa(db.query('UPDATE public.pagamentos_comissao SET valor = 1'))).detail, 'REGISTRO_IMUTAVEL');
});

test('resumo do admin: recebido, taxas, reembolsos, comissões pagas e pendentes', async () => {
  await configurar(JOAO, 60);
  const a1 = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  const a2 = await agendar(CLIENTE_B, JOAO, CORTE_30, '10:00');
  const p1 = await pagarOnline(a1, CLIENTE_A, { taxa: 1 });
  await concluir(a1);
  await rpc('iniciar_pagamento', { p_agendamento_id: a2, p_cliente_id: CLIENTE_B, p_metodo: 'pix' }); // pendente
  await rpc('aplicar_estado_pagamento', { p_pagamento_id: p1.id, p_estado: {
    status: 'partially_refunded', provedor_pagamento_id: `mp-${a1}`, valor: 50, taxa: 1, valor_reembolsado: 10, reembolsos: [{ id: 'r1', valor: 10 }] } });
  await comoAdmin(() => rpc('registrar_pagamento_comissao', { p_barbeiro_id: JOAO, p_semana_inicio: SEMANA, p_valor: 5, p_metodo: 'dinheiro' }));

  const r = await comoAdmin(() => rpc('financeiro_resumo', { p_inicio: INICIO, p_fim: DIA }));
  assert.equal(n(r.total_recebido), 50);
  assert.equal(n(r.taxas), 1);
  assert.equal(n(r.reembolsos), 10);
  assert.equal(n(r.recebido_liquido), 39);
  assert.equal(n(r.pendentes_valor), 40);
  assert.equal(n(r.comissoes), 24);          // 30 - 6 de estorno
  assert.equal(n(r.comissoes_pagas), 5);
  assert.equal(n(r.comissoes_pendentes), 19);
  assert.equal(n(r.receita_barbearia), 15);  // parte da barbearia (20 - 4) - taxa (1)
});

test('14. barbeiro vê só o próprio financeiro e não acessa o da barbearia', async () => {
  await configurar(JOAO, 60);
  await configurar(PEDRO, 50);
  const a1 = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  const a2 = await agendar(CLIENTE_B, PEDRO, CORTE_30, '10:00');
  for (const [id, cli] of [[a1, CLIENTE_A], [a2, CLIENTE_B]]) { await pagarOnline(id, cli); await concluir(id); }

  await comoUsuario(USUARIO_JOAO);
  const meu = await rpc('meu_financeiro', { p_inicio: SEMANA, p_fim: DIA });
  assert.deepEqual([n(meu.percentual), n(meu.servicos), n(meu.comissao), n(meu.comissao_total)], [60, 1, 30, 30]);
  assert.equal(meu.lancamentos.length, 1);
  assert.equal((await recusa(rpc('financeiro_resumo', { p_inicio: SEMANA, p_fim: DIA }))).detail, 'SEM_PERMISSAO');
  assert.equal((await recusa(linhas('fechamento_semanal', { p_semana_inicio: SEMANA }))).detail, 'SEM_PERMISSAO');

  // Pelo RLS, so os proprios lancamentos e nenhum pagamento de cliente
  await db.exec('SET ROLE authenticated');
  try {
    const ls = (await db.query('SELECT barbeiro_id FROM public.lancamentos_financeiros')).rows;
    assert.deepEqual([...new Set(ls.map((l) => l.barbeiro_id))], [JOAO]);
    assert.equal((await db.query('SELECT count(*) AS c FROM public.pagamentos')).rows[0].c, 0);
  } finally {
    await db.exec('RESET ROLE');
  }

  // Cliente nao e barbeiro: sem acesso ao "Meu Financeiro"
  await comoUsuario(CLIENTE_A);
  assert.equal((await recusa(rpc('meu_financeiro', { p_inicio: SEMANA, p_fim: DIA }))).detail, 'SEM_PERMISSAO');
});

test('15/16. cliente vê só os próprios pagamentos e não grava nada financeiro', async () => {
  const a1 = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const a2 = await agendar(CLIENTE_B, JOAO, BARBA_30, '10:00');
  await rpc('iniciar_pagamento', { p_agendamento_id: a1, p_cliente_id: CLIENTE_A, p_metodo: 'pix' });
  await rpc('iniciar_pagamento', { p_agendamento_id: a2, p_cliente_id: CLIENTE_B, p_metodo: 'pix' });

  await comoUsuario(CLIENTE_A);
  await db.exec('SET ROLE authenticated');
  try {
    const meus = (await db.query('SELECT cliente_id FROM public.pagamentos')).rows;
    assert.deepEqual(meus.map((p) => p.cliente_id), [CLIENTE_A]);
    assert.equal((await db.query('SELECT count(*) AS c FROM public.lancamentos_financeiros')).rows[0].c, 0);
    // Gravar direto ou chamar as funcoes do backend: sem permissao
    await assert.rejects(db.query(
      "INSERT INTO public.pagamentos (agendamento_id, cliente_id, metodo, status, valor_original, valor) VALUES ($1, $2, 'presencial', 'approved', 1, 1)",
      [a1, CLIENTE_A]), /permission denied/);
    await assert.rejects(db.query("UPDATE public.pagamentos SET status = 'approved'"), /permission denied/);
    await assert.rejects(db.query('SELECT public.aplicar_estado_pagamento($1, $2)', [a1, '{}']), /permission denied/);
    await assert.rejects(db.query("SELECT public.iniciar_pagamento($1, $2, 'pix')", [a2, CLIENTE_A]), /permission denied/);
  } finally {
    await db.exec('RESET ROLE');
  }
});

// ---------------------------------------------------------------
// Duplicidade, cancelamento no provedor e historico (migration 19)
// ---------------------------------------------------------------
const NO_PRAZO = () => new Date(Date.now() + 1800e3).toISOString();
const pagamento = async (id) => (await db.query('SELECT * FROM public.pagamentos WHERE id = $1', [id])).rows[0];
const estadoPago = (mpId, valor, extra = {}) =>
  ({ status: 'approved', provedor_pagamento_id: mpId, valor, taxa: 0, valor_reembolsado: 0, aprovado_em: new Date().toISOString(), reembolsos: [], ...extra });
const aplicar = (id, estado) => rpc('aplicar_estado_pagamento', { p_pagamento_id: id, p_estado: estado });

async function pixAberto(agendamento, cliente, mpId) {
  const ini = await rpc('iniciar_pagamento', { p_agendamento_id: agendamento, p_cliente_id: cliente, p_metodo: 'pix' });
  await rpc('registrar_cobranca', { p_pagamento_id: ini.pagamento.id, p_dados: { provedor_pagamento_id: mpId, pix_copia_cola: '0002', expira_em: NO_PRAZO() } });
  return ini.pagamento.id;
}

test('duplicidade: PIX e cartão aprovados no mesmo agendamento — o segundo fica registrado, marcado e sem comissão', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  const pix = await pixAberto(id, CLIENTE_A, 'mp-pix');
  // O cliente troca para cartao: o PIX e cancelado aqui e fica marcado para cancelar no provedor
  const cartao = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'cartao' });
  assert.deepEqual(cartao.cancelados.map((c) => c.id), [pix]);
  assert.deepEqual([(await pagamento(pix)).status, (await pagamento(pix)).cancelamento_provedor], ['canceled', 'pendente']);
  await rpc('registrar_cobranca', { p_pagamento_id: cartao.pagamento.id, p_dados: { provedor_preferencia_id: 'pref-1', link_pagamento: 'https://mp.test/x', expira_em: NO_PRAZO() } });

  const r1 = await aplicar(cartao.pagamento.id, estadoPago('mp-cartao', 50, { taxa: 2 }));
  assert.equal(r1.duplicado, false);
  // O PIX cancelado aqui foi pago mesmo assim (o cancelamento nao chegou a tempo ao provedor)
  const r2 = await aplicar(pix, estadoPago('mp-pix', 50, { taxa: 0.5 }));
  assert.equal(r2.duplicado, true);
  assert.deepEqual([r2.pagamento.status, r2.pagamento.duplicidade_de], ['approved', cartao.pagamento.id]);

  // A comissao vem so do pagamento que quitou o atendimento
  await concluir(id);
  assert.deepEqual((await lancamentos(id)).map((l) => [l.tipo, l.pagamento_id, n(l.valor_comissao)]), [['servico', cartao.pagamento.id, 30]]);

  // O dinheiro dos dois entrou: total recebido conta os dois; a duplicidade fica a devolver
  const r = await comoAdmin(() => rpc('financeiro_resumo', { p_inicio: INICIO, p_fim: DIA }));
  assert.deepEqual([n(r.total_recebido), n(r.taxas), n(r.faturamento), n(r.comissoes), n(r.duplicados_quantidade), n(r.duplicados_valor)],
    [100, 2.5, 50, 30, 1, 50]);
  assert.deepEqual((await comoAdmin(() => linhas('financeiro_duplicidades'))).map((d) => d.id), [pix]);
  const lista = await comoAdmin(() => linhas('financeiro_pagamentos', { p_inicio: INICIO, p_fim: DIA }));
  const linha = (pid) => lista.find((p) => p.id === pid);
  assert.deepEqual([linha(cartao.pagamento.id).tem_duplicidade, linha(cartao.pagamento.id).duplicidade_de], [true, null]);
  assert.deepEqual([linha(pix).tem_duplicidade, linha(pix).duplicidade_de], [false, cartao.pagamento.id]);
});

test('duplicidade: pagou duas vezes na página do cartão — o segundo pagamento ganha registro próprio', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const ini = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'cartao' });
  await rpc('registrar_cobranca', { p_pagamento_id: ini.pagamento.id, p_dados: { provedor_preferencia_id: 'pref-2', link_pagamento: 'https://mp.test/y', expira_em: NO_PRAZO() } });
  await aplicar(ini.pagamento.id, estadoPago('mp-c1', 40));
  const segundo = await aplicar(ini.pagamento.id, estadoPago('mp-c2', 40));
  assert.notEqual(segundo.pagamento.id, ini.pagamento.id);
  assert.deepEqual([segundo.duplicado, segundo.pagamento.provedor_pagamento_id, segundo.pagamento.duplicidade_de], [true, 'mp-c2', ini.pagamento.id]);
  // Notificacoes repetidas de cada um atualizam o proprio registro, sem criar outro
  await aplicar(ini.pagamento.id, estadoPago('mp-c2', 40));
  await aplicar(ini.pagamento.id, estadoPago('mp-c1', 40));
  const { rows } = await db.query('SELECT provedor_pagamento_id, status FROM public.pagamentos WHERE agendamento_id = $1 ORDER BY criado_em', [id]);
  assert.deepEqual(rows.map((p) => [p.provedor_pagamento_id, p.status]), [['mp-c1', 'approved'], ['mp-c2', 'approved']]);
});

test('duplicidade: devolver a duplicada não mexe na comissão; o pagamento principal só é reembolsado depois', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  const pix = await pixAberto(id, CLIENTE_A, 'mp-pix-2');
  // Pagou na barbearia; o PIX que estava aberto deixa de valer (e precisa ser cancelado no provedor)
  const presencial = await comoAdmin(() => rpc('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'dinheiro' }));
  assert.deepEqual(presencial.cancelados.map((c) => c.id), [pix]);
  assert.equal((await pagamento(pix)).cancelamento_provedor, 'pendente');
  // ... mas o cliente pagou o PIX tambem
  assert.equal((await aplicar(pix, estadoPago('mp-pix-2', 50))).duplicado, true);
  await concluir(id);
  assert.deepEqual((await lancamentos(id)).map((l) => [l.pagamento_id, n(l.valor_comissao)]), [[presencial.pagamento.id, 30]]);

  // Reembolsar o principal antes de devolver a duplicidade: recusado (evita devolver o pagamento errado)
  assert.equal((await recusa(comoAdmin(() => rpc('registrar_reembolso_presencial', { p_pagamento_id: presencial.pagamento.id, p_valor: 10 })))).detail,
    'DUPLICIDADE_PENDENTE');

  // Devolucao da duplicidade como o backend faz: confere e registra o pedido, depois aplica o estado do provedor
  const preparo = await rpc('preparar_reembolso', { p_pagamento_id: pix, p_valor: null, p_ator: ADMIN, p_motivo: 'Pagamento em duplicidade' });
  assert.deepEqual([n(preparo.valor), preparo.total], [50, true]);
  await aplicar(pix, estadoPago('mp-pix-2', 50, {
    status: 'refunded', valor_reembolsado: 50, reembolsos: [{ id: 'r-dup', valor: 50 }],
    ator: ADMIN, solicitacao: { id: 'r-dup', motivo: 'Pagamento em duplicidade', ator: ADMIN },
  }));
  const [rb] = (await db.query('SELECT motivo, registrado_por FROM public.pagamento_reembolsos WHERE pagamento_id = $1', [pix])).rows;
  assert.deepEqual([rb.motivo, rb.registrado_por], ['Pagamento em duplicidade', ADMIN]);
  // Comissao intacta: a duplicidade nunca entrou no servico
  assert.deepEqual((await lancamentos(id)).map((l) => [l.tipo, n(l.valor_comissao)]), [['servico', 30]]);

  // Agora o principal pode ser reembolsado e a comissao e ajustada
  await comoAdmin(() => rpc('registrar_reembolso_presencial', { p_pagamento_id: presencial.pagamento.id, p_valor: 10, p_motivo: 'desconto' }));
  assert.deepEqual((await lancamentos(id)).map((l) => [l.tipo, n(l.valor_comissao)]), [['servico', 30], ['reembolso', -6]]);

  // Consulta de reembolsos do admin
  const rs = await comoAdmin(() => linhas('financeiro_reembolsos', { p_inicio: INICIO, p_fim: DIA }));
  assert.deepEqual(rs.map((x) => [n(x.valor), x.duplicidade, x.origem, x.registrado_por, x.motivo]).sort((a, b) => a[0] - b[0]),
    [[10, false, 'admin', 'Dono', 'desconto'], [50, true, 'admin', 'Dono', 'Pagamento em duplicidade']]);
  const resumo = await comoAdmin(() => rpc('financeiro_resumo', { p_inicio: INICIO, p_fim: DIA }));
  assert.deepEqual([n(resumo.total_recebido), n(resumo.reembolsos), n(resumo.duplicados_quantidade)], [100, 60, 0]);
});

test('reembolso online: o banco confere antes de chamar o provedor', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pag = await pagarOnline(id, CLIENTE_A);
  const preparar = (valor) => rpc('preparar_reembolso', { p_pagamento_id: pag.id, p_valor: valor, p_ator: ADMIN, p_motivo: null });
  const acima = await recusa(preparar(41));
  assert.deepEqual([acima.detail, acima.message], ['VALOR_INVALIDO', 'Informe um valor entre R$ 0,01 e R$ 40,00.']);
  assert.equal((await recusa(preparar(0))).detail, 'VALOR_INVALIDO');
  const parcial = await preparar(15);
  assert.deepEqual([n(parcial.valor), parcial.total], [15, false]);

  const presencial = await agendar(CLIENTE_B, JOAO, CORTE_30, '10:00');
  const { pagamento: p } = await comoAdmin(() => rpc('registrar_pagamento_presencial', { p_agendamento_id: presencial, p_forma: 'pix' }));
  assert.equal((await recusa(rpc('preparar_reembolso', { p_pagamento_id: p.id, p_valor: 10, p_ator: ADMIN, p_motivo: null }))).detail, 'PAGAMENTO_PRESENCIAL');
});

test('cobrança cancelada aqui não volta a ficar pendente; o cancelamento no provedor é acompanhado', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await pixAberto(id, CLIENTE_A, 'mp-3');
  await comoAdmin(() => rpc('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'dinheiro' }));
  assert.deepEqual((await rpc('cobrancas_abertas_no_provedor', { p_agendamento_id: id })).map((c) => c.id), [pix]);

  // O provedor ainda diz "pendente": a cobranca continua cancelada aqui
  const r = await aplicar(pix, estadoPago('mp-3', 40, { status: 'pending', aprovado_em: null }));
  assert.equal(r.ignorado, true);
  assert.equal((await pagamento(pix)).status, 'canceled');

  // Falhou ao cancelar no provedor: continua na lista e no resumo
  await rpc('confirmar_cancelamento_provedor', { p_pagamento_id: pix, p_ok: false, p_erro: 'timeout' });
  assert.equal((await pagamento(pix)).cancelamento_provedor, 'falhou');
  assert.equal(n((await comoAdmin(() => rpc('financeiro_resumo', { p_inicio: INICIO, p_fim: DIA }))).cobrancas_abertas), 1);
  // Confirmado: sai da lista
  await rpc('confirmar_cancelamento_provedor', { p_pagamento_id: pix, p_ok: true, p_erro: null });
  assert.equal((await pagamento(pix)).cancelamento_provedor, 'confirmado');
  assert.deepEqual(await rpc('cobrancas_abertas_no_provedor', { p_agendamento_id: id }), []);
  assert.equal(n((await comoAdmin(() => rpc('financeiro_resumo', { p_inicio: INICIO, p_fim: DIA }))).cobrancas_abertas), 0);
});

test('atendimento contabilizado e devolvido não recebe nova cobrança (o valor ficaria fora do financeiro)', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pag = await pagarOnline(id, CLIENTE_A);
  await concluir(id);
  await aplicar(pag.id, estadoPago(`mp-${id}`, 40, { status: 'refunded', valor_reembolsado: 40, reembolsos: [{ id: 'r1', valor: 40 }] }));
  assert.equal((await recusa(rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'pix' }))).detail, 'JA_REEMBOLSADO');
  assert.equal((await recusa(comoAdmin(() => rpc('registrar_pagamento_presencial', { p_agendamento_id: id, p_forma: 'dinheiro' })))).detail, 'JA_REEMBOLSADO');
});

test('histórico auditável: cada operação com origem e autor; não pode ser alterado; só o admin lê', async () => {
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const pix = await pixAberto(id, CLIENTE_A, 'mp-h');
  await aplicar(pix, estadoPago('mp-h', 40));
  await rpc('preparar_reembolso', { p_pagamento_id: pix, p_valor: 10, p_ator: ADMIN, p_motivo: 'insatisfeito' });
  await aplicar(pix, estadoPago('mp-h', 40, {
    status: 'partially_refunded', valor_reembolsado: 10, reembolsos: [{ id: 'r-h', valor: 10 }],
    ator: ADMIN, solicitacao: { id: 'r-h', motivo: 'insatisfeito', ator: ADMIN },
  }));
  await rpc('registrar_falha_reembolso', { p_pagamento_id: pix, p_ator: ADMIN, p_erro: 'Mercado Pago respondeu 500' });

  const h = await comoAdmin(() => linhas('pagamento_historico', { p_pagamento_id: pix }));
  assert.deepEqual(h.map((e) => [e.evento, e.origem, e.ator]), [
    ['criado', 'cliente', 'Ana'],
    ['cobranca_gerada', 'sistema', null],
    ['status', 'provedor', null],
    ['reembolso_solicitado', 'admin', 'Dono'],
    ['status', 'provedor', 'Dono'],
    ['reembolso', 'provedor', 'Dono'],
    ['reembolso_falhou', 'admin', 'Dono'],
  ]);
  assert.deepEqual(h.filter((e) => e.evento === 'status').map((e) => [e.status_anterior, e.status_novo]),
    [['pending', 'approved'], ['approved', 'partially_refunded']]);
  assert.equal(h.find((e) => e.evento === 'reembolso_solicitado').detalhe, 'insatisfeito');
  assert.equal(n(h.find((e) => e.evento === 'reembolso').valor), 10);

  // Nao pode ser alterado
  assert.equal((await recusa(db.query('UPDATE public.pagamento_auditoria SET detalhe = NULL'))).detail, 'REGISTRO_IMUTAVEL');

  // Cliente e barbeiro: sem acesso ao historico nem as funcoes do backend
  for (const quem of [CLIENTE_A, USUARIO_JOAO]) {
    await comoUsuario(quem);
    assert.equal((await recusa(linhas('pagamento_historico', { p_pagamento_id: pix }))).detail, 'SEM_PERMISSAO');
    assert.equal((await recusa(linhas('financeiro_reembolsos', { p_inicio: INICIO, p_fim: DIA }))).detail, 'SEM_PERMISSAO');
    assert.equal((await recusa(linhas('financeiro_duplicidades'))).detail, 'SEM_PERMISSAO');
    await db.exec('SET ROLE authenticated');
    try {
      assert.equal(n((await db.query('SELECT count(*) AS c FROM public.pagamento_auditoria')).rows[0].c), 0);
      await assert.rejects(db.query("INSERT INTO public.pagamento_auditoria (pagamento_id, agendamento_id, evento, origem) VALUES ($1, $2, 'status', 'admin')", [pix, id]), /permission denied/);
      await assert.rejects(db.query("SELECT public.auditar_pagamento_evento($1, $2, 'status', NULL, NULL, NULL, 'x')", [pix, id]), /permission denied/);
      await assert.rejects(db.query('SELECT public.preparar_reembolso($1, 1, $2, NULL)', [pix, quem]), /permission denied/);
      await assert.rejects(db.query('SELECT public.confirmar_cancelamento_provedor($1, true, NULL)', [pix]), /permission denied/);
      await assert.rejects(db.query('SELECT public.cobrancas_abertas_no_provedor(NULL)'), /permission denied/);
    } finally {
      await db.exec('RESET ROLE');
    }
  }
});

test('migration 19 em dados antigos: dois pagamentos valendo viram principal e duplicidade (rodar de novo não muda nada)', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  // Como podia ficar antes da migration 19: dois aprovados sem marcacao
  const inserir = (mpId, aprovado) => db.query(
    `INSERT INTO public.pagamentos (agendamento_id, cliente_id, metodo, status, valor_original, valor, provedor, provedor_pagamento_id, aprovado_em)
     VALUES ($1, $2, 'pix', 'approved', 40, 40, 'mercadopago', $3, $4) RETURNING id`, [id, CLIENTE_A, mpId, aprovado]);
  const primeiro = (await inserir('antigo-1', '2026-11-01T10:00:00Z')).rows[0].id;
  const segundo = (await inserir('antigo-2', '2026-11-01T10:05:00Z')).rows[0].id;
  await concluir(id);
  assert.equal((await lancamentos(id))[0].pagamento_id, primeiro);

  await db.exec(migration('20261105000019_pagamentos_duplicidade_auditoria.sql'));
  await db.exec(migration('20261105000019_pagamentos_duplicidade_auditoria.sql'));
  assert.deepEqual([(await pagamento(primeiro)).duplicidade_de, (await pagamento(segundo)).duplicidade_de], [null, primeiro]);
  const marcacoes = (await db.query("SELECT origem FROM public.pagamento_auditoria WHERE pagamento_id = $1 AND evento = 'duplicidade'", [segundo])).rows;
  assert.deepEqual(marcacoes.map((m) => m.origem), ['sistema']);
});
