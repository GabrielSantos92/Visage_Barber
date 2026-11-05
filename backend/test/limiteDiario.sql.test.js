// Limite de 3 agendamentos por cliente por dia e servicos com componentes
// repetidos no mesmo dia. Roda as migrations reais em um Postgres embutido
// (PGlite) e confere as regras no trigger validar_agendamento, que vale para
// web, app e chamadas diretas a API.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  criarBanco, auxiliares, recusa, as, DIA,
  JOAO, PEDRO, CORTE_30, COMBO_60, BARBA_30, SOBRANCELHA_30, CLIENTE_A, CLIENTE_B, ADMIN,
} = require('./helpers/bancoAgenda');

const MSG_LIMITE = 'Você atingiu o limite máximo de 3 agendamentos por dia. Escolha outra data para realizar um novo agendamento.';
// Servico cadastrado depois da migration, sem componentes: conta como componente proprio
const HIDRATACAO = '50000000-0000-4000-8000-000000000009';
// A quarta-feira seguinte (os barbeiros de teste so atendem as quartas)
const DIA2 = new Date(Date.parse(`${DIA}T12:00:00Z`) + 7 * 86400000).toISOString().slice(0, 10);

let db;
let limpar, agendar, total, comoUsuario;

before(async () => {
  db = await criarBanco();
  ({ limpar, agendar, total, comoUsuario } = auxiliares(db));
  await db.exec(`
    INSERT INTO public.servicos (id, nome, preco, duracao_min) VALUES ('${HIDRATACAO}', 'Hidratação', 30, 30);
    INSERT INTO public.barbeiro_servicos SELECT id, '${HIDRATACAO}' FROM public.barbeiros;
  `);
});

const doCliente = async (cliente) =>
  Number((await db.query("SELECT count(*) AS n FROM public.agendamentos WHERE cliente_id = $1 AND status <> 'cancelado'", [cliente])).rows[0].n);

test('carga inicial: servicos existentes recebem componentes; os novos ficam sem', async () => {
  const { rows } = await db.query(`
    SELECT s.nome, coalesce(string_agg(sc.componente, ',' ORDER BY sc.componente), '') AS comp
      FROM public.servicos s LEFT JOIN public.servico_componentes sc ON sc.servico_id = s.id
     GROUP BY s.nome ORDER BY s.nome`);
  assert.deepEqual(Object.fromEntries(rows.map((r) => [r.nome, r.comp])), {
    'Barba completa': 'barba',
    'Corte': 'corte',
    'Corte + Barba': 'barba,corte',
    'Hidratação': '',
    'Outro': '',
    'Sobrancelha': 'sobrancelha',
  });
});

test('1. quarto agendamento no mesmo dia é bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await agendar(CLIENTE_A, JOAO, BARBA_30, '10:00');
  await agendar(CLIENTE_A, JOAO, SOBRANCELHA_30, '11:00');
  const r = await recusa(agendar(CLIENTE_A, JOAO, HIDRATACAO, '14:00'));
  assert.equal(r.code, 'PT400');
  assert.equal(r.detail, 'LIMITE_DIARIO');
  assert.equal(r.message, MSG_LIMITE);
  assert.equal(await doCliente(CLIENTE_A), 3);
});

test('2. Barba completa e depois Corte + Barba: bloqueado (barba repetida)', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, BARBA_30, '09:00');
  const r = await recusa(agendar(CLIENTE_A, JOAO, COMBO_60, '14:00'));
  assert.equal(r.code, 'PT400');
  assert.equal(r.detail, 'SERVICO_REPETIDO');
  assert.equal(r.message, 'Você já tem um agendamento neste dia que inclui barba. Escolha um serviço diferente ou outra data.');
});

test('2b. Corte + Barba e depois Barba completa: bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COMBO_60, '09:00');
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, BARBA_30, '14:00'))).detail, 'SERVICO_REPETIDO');
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, CORTE_30, '14:00'))).detail, 'SERVICO_REPETIDO');
});

test('3. Corte e depois outro Corte: bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const r = await recusa(agendar(CLIENTE_A, JOAO, CORTE_30, '15:00'));
  assert.equal(r.detail, 'SERVICO_REPETIDO');
  assert.match(r.message, /inclui corte de cabelo\./);
});

test('4. Corte e depois Barba completa: permitido', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await agendar(CLIENTE_A, JOAO, BARBA_30, '09:30');
  assert.equal(await doCliente(CLIENTE_A), 2);
});

test('5. Corte, Barba e Sobrancelha no mesmo dia: permitido', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await agendar(CLIENTE_A, PEDRO, BARBA_30, '10:00');
  await agendar(CLIENTE_A, JOAO, SOBRANCELHA_30, '14:00');
  assert.equal(await doCliente(CLIENTE_A), 3);
});

test('6. um quarto serviço diferente (sem componente repetido) também é bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await agendar(CLIENTE_A, JOAO, BARBA_30, '10:00');
  await agendar(CLIENTE_A, JOAO, SOBRANCELHA_30, '11:00');
  assert.equal((await recusa(agendar(CLIENTE_A, PEDRO, HIDRATACAO, '15:00'))).detail, 'LIMITE_DIARIO');
});

test('7. cancelados não contam: cancelar libera o limite e o serviço', async () => {
  await limpar();
  const corte = await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await agendar(CLIENTE_A, JOAO, BARBA_30, '10:00');
  await agendar(CLIENTE_A, JOAO, SOBRANCELHA_30, '11:00');
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [corte]);
  // Libera uma vaga e o proprio componente "corte"
  await agendar(CLIENTE_A, PEDRO, CORTE_30, '15:00');
  assert.equal(await doCliente(CLIENTE_A), 3);
  // Agendamento ja cancelado de antemao tambem nao conta
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00', 'cancelado');
  await agendar(CLIENTE_A, JOAO, CORTE_30, '10:00');
  assert.equal(await doCliente(CLIENTE_A), 1);
});

test('8. repetir o serviço com outro barbeiro não contorna a regra', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  assert.equal((await recusa(agendar(CLIENTE_A, PEDRO, CORTE_30, '15:00'))).detail, 'SERVICO_REPETIDO');
  assert.equal((await recusa(agendar(CLIENTE_A, PEDRO, COMBO_60, '15:00'))).detail, 'SERVICO_REPETIDO');
});

test('9. editar para um serviço já reservado no dia é bloqueado; editar o próprio não conta como nova reserva', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const barba = await agendar(CLIENTE_A, JOAO, BARBA_30, '10:00');
  await agendar(CLIENTE_A, JOAO, SOBRANCELHA_30, '11:00');

  // Trocar a barba por corte: corte ja reservado no dia
  const r = await recusa(db.query('UPDATE public.agendamentos SET servico_id = $1 WHERE id = $2', [CORTE_30, barba]));
  assert.equal(r.detail, 'SERVICO_REPETIDO');

  // Com 3 no dia, mudar o horario ou o barbeiro do proprio agendamento e permitido
  await db.query('UPDATE public.agendamentos SET data_hora = $1, barbeiro_id = $2 WHERE id = $3', [as('15:00'), PEDRO, barba]);
  assert.equal(await doCliente(CLIENTE_A), 3);

  // Mudar a data revalida tudo na nova data
  await agendar(CLIENTE_B, JOAO, BARBA_30, `${DIA2} 09:00 America/Sao_Paulo`);
  await agendar(CLIENTE_A, JOAO, BARBA_30, `${DIA2} 10:00 America/Sao_Paulo`);
  const outraData = await recusa(db.query('UPDATE public.agendamentos SET data_hora = $1 WHERE id = $2',
    [`${DIA2} 14:00 America/Sao_Paulo`, barba]));
  assert.equal(outraData.detail, 'SERVICO_REPETIDO');

  // Reativar um cancelado tambem passa pela regra
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  const cancelado = await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00', 'cancelado');
  const reativar = await recusa(db.query("UPDATE public.agendamentos SET status = 'confirmado' WHERE id = $1", [cancelado]));
  assert.equal(reativar.detail, 'SERVICO_REPETIDO');
});

test('10. duas requisições simultâneas não ultrapassam o limite', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await agendar(CLIENTE_A, JOAO, BARBA_30, '10:00');
  const resultados = await Promise.allSettled([
    agendar(CLIENTE_A, JOAO, SOBRANCELHA_30, '14:00'),
    agendar(CLIENTE_A, PEDRO, HIDRATACAO, '15:00'),
  ]);
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(resultados.find((r) => r.status === 'rejected').reason.detail, 'LIMITE_DIARIO');
  assert.equal(await doCliente(CLIENTE_A), 3);

  // Mesmo servico em duas requisicoes ao mesmo tempo: so uma grava
  await limpar();
  const mesmos = await Promise.allSettled([
    agendar(CLIENTE_A, JOAO, BARBA_30, '09:00'),
    agendar(CLIENTE_A, PEDRO, COMBO_60, '14:00'),
  ]);
  assert.equal(mesmos.filter((r) => r.status === 'fulfilled').length, 1);
  assert.equal(mesmos.find((r) => r.status === 'rejected').reason.detail, 'SERVICO_REPETIDO');
});

test('limite e por cliente: outro cliente agenda normalmente', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  await agendar(CLIENTE_B, PEDRO, CORTE_30, '09:00');
  assert.equal(await total(), 2);
});

test('dia local da barbearia: o mesmo dia em Sao Paulo, mesmo que já seja outro dia em UTC', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  // 22:30 em Sao Paulo = 01:30 UTC do dia seguinte: ainda e o mesmo dia local
  const noite = await db.query(
    'SELECT motivo FROM public.regra_diaria_cliente($1, $2, $3)', [CLIENTE_A, CORTE_30, as('22:30')]);
  assert.deepEqual(noite.rows, [{ motivo: 'SERVICO_REPETIDO' }]);
  // 00:30 do dia seguinte em Sao Paulo: outro dia, permitido
  const proximoDia = new Date(Date.parse(`${DIA}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  const madrugada = await db.query(
    'SELECT motivo FROM public.regra_diaria_cliente($1, $2, $3)', [CLIENTE_A, CORTE_30, `${proximoDia} 00:30 America/Sao_Paulo`]);
  assert.deepEqual(madrugada.rows, []);
});

test('servico sem componentes: repetir o mesmo e bloqueado, servicos diferentes nao', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, HIDRATACAO, '09:00');
  const r = await recusa(agendar(CLIENTE_A, JOAO, HIDRATACAO, '14:00'));
  assert.equal(r.detail, 'SERVICO_REPETIDO');
  assert.match(r.message, /inclui hidratação\./);
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
});

test('verificar_regra_diaria (telas): avisa antes de escolher o horário, sempre para o cliente logado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, BARBA_30, '09:00');
  await comoUsuario(CLIENTE_A);
  const repetido = await db.query('SELECT * FROM public.verificar_regra_diaria($1, $2)', [COMBO_60, DIA]);
  assert.equal(repetido.rows[0].motivo, 'SERVICO_REPETIDO');
  const livre = await db.query('SELECT * FROM public.verificar_regra_diaria($1, $2)', [CORTE_30, DIA]);
  assert.deepEqual(livre.rows, []);
  const outroDia = await db.query('SELECT * FROM public.verificar_regra_diaria($1, $2)', [COMBO_60, DIA2]);
  assert.deepEqual(outroDia.rows, []);
  // Outro cliente nao enxerga a agenda do cliente A
  await comoUsuario(CLIENTE_B);
  assert.deepEqual((await db.query('SELECT * FROM public.verificar_regra_diaria($1, $2)', [COMBO_60, DIA])).rows, []);
  // Sem login: nada
  await comoUsuario(null);
  assert.deepEqual((await db.query('SELECT * FROM public.verificar_regra_diaria($1, $2)', [COMBO_60, DIA])).rows, []);
});

test('definir_componentes_servico: só o admin altera, com componentes válidos, e a regra passa a usar o cadastro', async () => {
  await limpar();
  await comoUsuario(CLIENTE_A);
  assert.equal((await recusa(db.query('SELECT public.definir_componentes_servico($1, $2)', [HIDRATACAO, ['barba']]))).detail, 'SEM_PERMISSAO');

  await comoUsuario(ADMIN);
  assert.equal((await recusa(db.query('SELECT public.definir_componentes_servico($1, $2)', [HIDRATACAO, ['massagem']]))).detail, 'COMPONENTE_INVALIDO');
  await db.query('SELECT public.definir_componentes_servico($1, $2)', [HIDRATACAO, ['barba']]);

  // Agora "Hidratação" inclui barba: depois de Barba completa, fica bloqueada
  await agendar(CLIENTE_A, JOAO, BARBA_30, '09:00');
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, HIDRATACAO, '14:00'))).detail, 'SERVICO_REPETIDO');

  // Volta ao estado inicial (sem componentes)
  await db.query('SELECT public.definir_componentes_servico($1, $2)', [HIDRATACAO, []]);
  await comoUsuario(null);
  await agendar(CLIENTE_A, JOAO, HIDRATACAO, '14:00');
});

test('as regras de horário continuam valendo antes da regra diária', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '09:00');
  // Conflito de horario do proprio cliente continua com a mensagem de conflito
  assert.equal((await recusa(agendar(CLIENTE_A, PEDRO, BARBA_30, '09:00'))).detail, 'CONFLITO_CLIENTE');
  // Fora do expediente continua com a mensagem de expediente
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, BARBA_30, '12:30'))).detail, 'FORA_DO_EXPEDIENTE');
});
