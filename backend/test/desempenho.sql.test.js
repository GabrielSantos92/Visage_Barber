// "Meu Desempenho" do barbeiro (migration 20): dias com mais cortes e origem
// do percentual, junto do resumo oficial de meu_financeiro. Roda as migrations
// reais em um Postgres embutido (PGlite).
const { test, before, beforeEach } = require('node:test');
const assert = require('node:assert/strict');

const {
  criarBanco, auxiliares, recusa, DIA,
  JOAO, PEDRO, CORTE_30, CLIENTE_A, CLIENTE_B, CLIENTE_C, ADMIN, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

const SERVICO_50 = '50000000-0000-4000-8000-000000000050';
// Periodo que inclui hoje (data dos reembolsos) e DIA (data dos atendimentos)
const INICIO = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
const somarDias = (iso, n) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
// DIA e quarta-feira: indice 2 em dias_semana (segunda = 0)
const QUARTA = 2;

let db;
let agendar, comoUsuario;

before(async () => {
  db = await criarBanco();
  ({ agendar, comoUsuario } = auxiliares(db));
  await db.exec(`
    INSERT INTO public.servicos (id, nome, preco, duracao_min) VALUES ('${SERVICO_50}', 'Corte premium', 50, 30);
    INSERT INTO public.barbeiro_servicos SELECT id, '${SERVICO_50}' FROM public.barbeiros;
    -- Como no Supabase: anonimos enxergam o esquema, a recusa vem da funcao
    GRANT USAGE ON SCHEMA public TO anon;
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

async function rpc(nome, args = {}) {
  const chaves = Object.keys(args);
  const lista = chaves.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const valores = chaves.map((k) => (args[k] !== null && typeof args[k] === 'object' ? JSON.stringify(args[k]) : args[k]));
  return (await db.query(`SELECT public.${nome}(${lista}) AS r`, valores)).rows[0].r;
}
const n = (v) => (v == null ? v : Number(v));

async function comoAdmin(fn) {
  await comoUsuario(ADMIN);
  try { return await fn(); } finally { await comoUsuario(null); }
}
const configurar = (barbeiro, pct) => comoAdmin(() => rpc('configurar_comissao', { p_barbeiro_id: barbeiro, p_percentual: pct }));
const concluir = (id) => db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE id = $1", [id]);
const cancelar = (id) => db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [id]);
const estadoPago = (mpId, valor, extra = {}) =>
  ({ status: 'approved', provedor_pagamento_id: mpId, valor, taxa: 0, valor_reembolsado: 0, aprovado_em: new Date().toISOString(), reembolsos: [], ...extra });
const aplicar = (id, estado) => rpc('aplicar_estado_pagamento', { p_pagamento_id: id, p_estado: estado });

async function pagarOnline(agendamento, cliente, { taxa = 0 } = {}) {
  const { pagamento } = await rpc('iniciar_pagamento', { p_agendamento_id: agendamento, p_cliente_id: cliente, p_metodo: 'pix' });
  const mpId = `mp-${agendamento}`;
  await rpc('registrar_cobranca', { p_pagamento_id: pagamento.id, p_dados: { provedor_pagamento_id: mpId, pix_copia_cola: '0002', expira_em: new Date(Date.now() + 1800e3).toISOString() } });
  await aplicar(pagamento.id, estadoPago(mpId, n(pagamento.valor), { taxa }));
  return { ...pagamento, mpId };
}

// O que a tela do barbeiro le: resumo oficial + desempenho, como o JOAO
async function painel(inicio = INICIO, fim = DIA) {
  await comoUsuario(USUARIO_JOAO);
  try {
    const fin = await rpc('meu_financeiro', { p_inicio: inicio, p_fim: fim });
    const des = await rpc('meu_desempenho', { p_inicio: inicio, p_fim: fim });
    return {
      faturamento: n(fin.faturamento), comissao: n(fin.comissao), servicos: n(fin.servicos),
      percentual: n(des.percentual), origem: des.percentual_origem, dias: des.dias_semana.map(Number),
    };
  } finally {
    await comoUsuario(null);
  }
}
const cortes = (dias) => dias.reduce((s, v) => s + v, 0);

// Atendimento concluido em qualquer dia/hora (fora da grade de quarta), so
// para a contagem por dia da semana
async function concluidoEm(barbeiro, cliente, quando) {
  await db.exec('ALTER TABLE public.agendamentos DISABLE TRIGGER USER');
  try {
    await db.query(
      "INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status) VALUES ($1, $2, $3, $4, 'concluido')",
      [cliente, barbeiro, CORTE_30, `${quando} America/Sao_Paulo`],
    );
  } finally {
    await db.exec('ALTER TABLE public.agendamentos ENABLE TRIGGER USER');
  }
}

test('1. percentual individual configurado: prevalece sobre o padrão', async () => {
  await configurar(null, 40);
  await configurar(JOAO, 60);
  const p = await painel();
  assert.deepEqual([p.percentual, p.origem], [60, 'individual']);
});

test('2. sem percentual individual: usa o padrão da barbearia', async () => {
  await configurar(null, 40);
  await configurar(PEDRO, 70);
  let p = await painel();
  assert.deepEqual([p.percentual, p.origem], [40, 'padrao']);
  // Individual removido depois: volta para o padrao
  await configurar(JOAO, 60);
  await configurar(JOAO, null);
  p = await painel();
  assert.deepEqual([p.percentual, p.origem], [40, 'padrao']);
});

test('3. sem percentual configurado: pendente, sem comissão inventada; o corte conta no gráfico', async () => {
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  await pagarOnline(id, CLIENTE_A);
  await concluir(id);
  const p = await painel();
  assert.deepEqual([p.percentual, p.origem], [null, null]);
  assert.deepEqual([p.faturamento, p.comissao, p.servicos], [0, 0, 0]);
  assert.equal(p.dias[QUARTA], 1);
});

test('4. concluído e pago: faturamento com desconto, comissão sem descontar a taxa do Mercado Pago', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  await pagarOnline(id, CLIENTE_A, { taxa: 2 });
  await concluir(id);
  // Presencial com desconto: o faturamento e o valor pago, nao o preco
  const outro = await agendar(CLIENTE_B, JOAO, CORTE_30, '10:00');
  await concluir(outro);
  await comoAdmin(() => rpc('registrar_pagamento_presencial', { p_agendamento_id: outro, p_forma: 'dinheiro', p_desconto: 10 }));
  const p = await painel();
  assert.deepEqual([p.faturamento, p.comissao, p.servicos], [80, 48, 2]); // 50 + 30; 60% de 80
  assert.deepEqual(p.dias, [0, 0, 2, 0, 0, 0, 0]);
});

test('5/6. só agendado, cancelado e cancelado depois de concluído: nada no gráfico nem no financeiro', async () => {
  await configurar(JOAO, 50);
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');                    // so agendado
  const pago = await agendar(CLIENTE_B, JOAO, SERVICO_50, '10:00');     // pago, ainda nao realizado
  await pagarOnline(pago, CLIENTE_B);
  const cancelado = await agendar(CLIENTE_C, JOAO, CORTE_30, '11:00');
  await cancelar(cancelado);
  let p = await painel();
  assert.deepEqual([p.faturamento, p.comissao, cortes(p.dias)], [0, 0, 0]);

  // Concluido e depois cancelado (ex.: falta registrada depois): estornado
  await concluir(pago);
  p = await painel();
  assert.deepEqual([p.faturamento, p.comissao, cortes(p.dias)], [50, 25, 1]);
  await cancelar(pago);
  p = await painel();
  assert.deepEqual([p.faturamento, p.comissao, cortes(p.dias)], [0, 0, 0]);
});

test('7. reembolso parcial e integral: faturamento e comissão estornados na proporção', async () => {
  await configurar(JOAO, 55);
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00'); // R$ 40, comissao R$ 22
  const pag = await pagarOnline(id, CLIENTE_A);
  await concluir(id);
  await aplicar(pag.id, { status: 'partially_refunded', provedor_pagamento_id: pag.mpId, valor: 40, valor_reembolsado: 10, reembolsos: [{ id: 'r1', valor: 10 }] });
  let p = await painel();
  assert.deepEqual([p.faturamento, p.comissao], [30, 16.5]);
  await aplicar(pag.id, { status: 'refunded', provedor_pagamento_id: pag.mpId, valor: 40, valor_reembolsado: 40,
    reembolsos: [{ id: 'r1', valor: 10 }, { id: 'r2', valor: 30 }] });
  p = await painel();
  assert.deepEqual([p.faturamento, p.comissao], [0, 0]);
  // O atendimento foi feito: continua contando como corte
  assert.equal(cortes(p.dias), 1);
});

test('8. pagamento duplicado: não soma faturamento, não gera comissão e conta um corte só', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  const pix = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'pix' });
  await rpc('registrar_cobranca', { p_pagamento_id: pix.pagamento.id, p_dados: { provedor_pagamento_id: 'mp-pix', pix_copia_cola: '0002', expira_em: new Date(Date.now() + 1800e3).toISOString() } });
  const cartao = await rpc('iniciar_pagamento', { p_agendamento_id: id, p_cliente_id: CLIENTE_A, p_metodo: 'cartao' });
  await aplicar(cartao.pagamento.id, estadoPago('mp-cartao', 50));
  const dup = await aplicar(pix.pagamento.id, estadoPago('mp-pix', 50));
  assert.equal(dup.duplicado, true);
  await concluir(id);
  const p = await painel();
  assert.deepEqual([p.faturamento, p.comissao, cortes(p.dias)], [50, 30, 1]);
});

test('9. mudar o percentual não recalcula o histórico', async () => {
  await configurar(JOAO, 50);
  const antigo = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await pagarOnline(antigo, CLIENTE_A);
  await concluir(antigo);
  await configurar(JOAO, 70);
  const novo = await agendar(CLIENTE_B, JOAO, CORTE_30, '10:00');
  await pagarOnline(novo, CLIENTE_B);
  await concluir(novo);
  const p = await painel();
  // 50% de 40 + 70% de 40, e nao 70% dos dois
  assert.deepEqual([p.faturamento, p.comissao, p.percentual, p.origem], [80, 48, 70, 'individual']);
});

test('10. barbeiro só vê os próprios dados; quem não é barbeiro é recusado', async () => {
  await configurar(JOAO, 50);
  await configurar(PEDRO, 80);
  const doPedro = await agendar(CLIENTE_A, PEDRO, SERVICO_50, '09:00');
  await pagarOnline(doPedro, CLIENTE_A);
  await concluir(doPedro);
  const p = await painel();
  assert.deepEqual([p.faturamento, p.comissao, cortes(p.dias), p.percentual], [0, 0, 0, 50]);

  // A funcao nao aceita outro barbeiro: um parametro extra e recusado pelo banco
  await comoUsuario(USUARIO_JOAO);
  await assert.rejects(db.query('SELECT public.meu_desempenho($1, $2, $3)', [INICIO, DIA, PEDRO]));
  for (const quem of [CLIENTE_A, ADMIN, null]) {
    await comoUsuario(quem);
    assert.equal((await recusa(rpc('meu_desempenho', { p_inicio: INICIO, p_fim: DIA }))).detail, 'SEM_PERMISSAO');
  }
  await comoUsuario(null);
  // Sem permissao de execucao para anonimos
  await db.exec('SET ROLE anon');
  try {
    await assert.rejects(db.query('SELECT public.meu_desempenho($1, $2)', [INICIO, DIA]));
  } finally {
    await db.exec('RESET ROLE');
  }
});

test('11. gráfico por dia da semana: período respeitado e data no horário de Brasília', async () => {
  const segunda = somarDias(DIA, -2);
  const sabado = somarDias(DIA, 3);
  const domingo = somarDias(DIA, 4);
  await concluidoEm(JOAO, CLIENTE_A, `${segunda} 10:00`);
  await concluidoEm(JOAO, CLIENTE_B, `${segunda} 11:00`);
  // 23:30 de sabado em Brasilia ja e domingo em UTC: conta no sabado
  await concluidoEm(JOAO, CLIENTE_A, `${sabado} 23:30`);
  // 00:30 de domingo em Brasilia ainda e sabado em UTC: conta no domingo
  await concluidoEm(JOAO, CLIENTE_B, `${domingo} 00:30`);
  await concluidoEm(PEDRO, CLIENTE_C, `${sabado} 10:00`);

  let p = await painel(segunda, domingo);
  assert.deepEqual(p.dias, [2, 0, 0, 0, 0, 1, 1]);
  // So o sabado no periodo
  p = await painel(sabado, sabado);
  assert.deepEqual(p.dias, [0, 0, 0, 0, 0, 1, 0]);
  // Fora do periodo: zero, mas sempre os 7 dias
  p = await painel(somarDias(DIA, 10), somarDias(DIA, 12));
  assert.deepEqual(p.dias, [0, 0, 0, 0, 0, 0, 0]);
  await comoUsuario(USUARIO_JOAO);
  assert.equal((await recusa(rpc('meu_desempenho', { p_inicio: domingo, p_fim: segunda }))).detail, 'PERIODO_INVALIDO');
});

test('12. atualizar várias vezes e notificações repetidas não duplicam valores', async () => {
  await configurar(JOAO, 60);
  const id = await agendar(CLIENTE_A, JOAO, SERVICO_50, '09:00');
  const pag = await pagarOnline(id, CLIENTE_A);
  await concluir(id);
  // Mesmo estado aplicado de novo (webhook repetido) e lancamentos regerados
  await aplicar(pag.id, estadoPago(pag.mpId, 50));
  await rpc('gerar_lancamentos', { p_agendamento_id: id });
  await concluir(id);
  const a = await painel();
  const b = await painel();
  assert.deepEqual(a, b);
  assert.deepEqual([a.faturamento, a.comissao, a.servicos, cortes(a.dias)], [50, 30, 1, 1]);
});
