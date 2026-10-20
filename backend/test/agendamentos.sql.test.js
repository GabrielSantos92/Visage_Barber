// Executa as migrations de agendamento em um Postgres embutido (PGlite) e
// confere as regras de conflito de horario direto no banco, que e onde elas valem.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  criarBanco, auxiliares, recusa: recusaBanco, as,
  JOAO, PEDRO, INATIVO, CORTE_30, COMBO_60, SEM_VINCULO, CLIENTE_A, CLIENTE_B,
} = require('./helpers/bancoAgenda');

// Os casos abaixo cobrem os servicos convencionais (bloco continuo) e rodam com
// todas as migrations de agenda aplicadas, inclusive a da agenda com pausa.
let db;
let limpar, agendar, total;

before(async () => {
  db = await criarBanco();
  ({ limpar, agendar, total } = auxiliares(db));
});

async function recusa(promessa) {
  try {
    return await recusaBanco(promessa);
  } catch (e) {
    assert.fail(e.message);
  }
}

test('1. dois clientes, mesmo barbeiro, mesmo horário: só o primeiro consegue', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  const r = await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '14:00'));
  assert.equal(r.code, 'PT409');
  assert.equal(r.detail, 'CONFLITO_BARBEIRO');
  assert.equal(r.message, 'Esse horário não está mais disponível para este barbeiro. Por favor, escolha outro horário.');
  assert.equal(await total(), 1);
});

test('2. mesmo barbeiro, horários parcialmente sobrepostos: bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '14:15'))).detail, 'CONFLITO_BARBEIRO');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '13:45'))).detail, 'CONFLITO_BARBEIRO');
});

test('3. mesmo cliente, barbeiros diferentes, mesmo horário: bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  const r = await recusa(agendar(CLIENTE_A, PEDRO, CORTE_30, '14:00'));
  assert.equal(r.code, 'PT409');
  assert.equal(r.detail, 'CONFLITO_CLIENTE');
  assert.equal(r.message, 'Você já possui um agendamento nesse horário. Escolha outro horário para evitar conflitos.');
});

test('4. mesmo cliente, barbeiros diferentes, sobreposição parcial: bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  assert.equal((await recusa(agendar(CLIENTE_A, PEDRO, CORTE_30, '14:15'))).detail, 'CONFLITO_CLIENTE');
  assert.equal((await recusa(agendar(CLIENTE_A, PEDRO, CORTE_30, '14:25'))).detail, 'CONFLITO_CLIENTE');
});

test('5. atendimentos consecutivos são permitidos', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  await agendar(CLIENTE_B, JOAO, CORTE_30, '13:30');
  await agendar(CLIENTE_B, JOAO, CORTE_30, '14:30');
  await agendar(CLIENTE_A, PEDRO, CORTE_30, '14:30');
  assert.equal(await total(), 4);
});

test('6. agendamento cancelado libera o horário', async () => {
  await limpar();
  const id = await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [id]);
  await agendar(CLIENTE_B, JOAO, CORTE_30, '14:00');
  await agendar(CLIENTE_A, PEDRO, CORTE_30, '14:00');
  assert.equal(await total(), 3);
});

test('7. serviço mais longo bloqueia todo o intervalo', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COMBO_60, '14:00');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '14:30'))).detail, 'CONFLITO_BARBEIRO');
  // um serviço longo novo também não pode invadir uma reserva existente
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, COMBO_60, '13:30'))).detail, 'CONFLITO_BARBEIRO');
  await agendar(CLIENTE_B, JOAO, CORTE_30, '15:00');
});

test('9. chamada direta: remarcar ou reativar para um horário ocupado é bloqueado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  const outro = await agendar(CLIENTE_B, JOAO, CORTE_30, '15:00');

  const remarcar = db.query('UPDATE public.agendamentos SET data_hora = $1 WHERE id = $2', [as('14:15'), outro]);
  assert.equal((await recusa(remarcar)).detail, 'CONFLITO_BARBEIRO');

  await db.query("UPDATE public.agendamentos SET status = 'cancelado', data_hora = $1 WHERE id = $2", [as('14:00'), outro]);
  const reativar = db.query("UPDATE public.agendamentos SET status = 'confirmado' WHERE id = $1", [outro]);
  assert.equal((await recusa(reativar)).detail, 'CONFLITO_BARBEIRO');
});

test('9. chamada direta: passado, fora do expediente, barbeiro inativo e serviço sem vínculo são recusados', async () => {
  await limpar();
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, CORTE_30, '2020-01-08 14:00 America/Sao_Paulo'))).detail, 'HORARIO_PASSADO');
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, CORTE_30, '12:00'))).detail, 'FORA_DO_EXPEDIENTE'); // almoço
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, COMBO_60, '17:30'))).detail, 'FORA_DO_EXPEDIENTE'); // passaria das 18:00
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, COMBO_60, '11:30'))).detail, 'FORA_DO_EXPEDIENTE'); // invadiria o almoço
  assert.equal((await recusa(agendar(CLIENTE_A, INATIVO, CORTE_30, '14:00'))).detail, 'BARBEIRO_INDISPONIVEL');
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, SEM_VINCULO, '14:00'))).detail, 'SERVICO_INDISPONIVEL');
  assert.equal(await total(), 0);
  await agendar(CLIENTE_A, JOAO, COMBO_60, '17:00'); // termina exatamente às 18:00
});

test('concluir ou cancelar um agendamento antigo continua funcionando', async () => {
  await limpar();
  await db.exec(`
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
    INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora)
      VALUES ('${CLIENTE_A}', '${JOAO}', '${CORTE_30}', '2020-01-08 14:00 America/Sao_Paulo'),
             ('${CLIENTE_B}', '${JOAO}', '${CORTE_30}', '2020-01-08 15:00 America/Sao_Paulo');
    ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;
  `);
  await db.query("UPDATE public.agendamentos SET status = 'concluido' WHERE cliente_id = $1", [CLIENTE_A]);
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE cliente_id = $1", [CLIENTE_B]);
  const { rows } = await db.query('SELECT status FROM public.agendamentos ORDER BY data_hora');
  assert.deepEqual(rows.map((r) => r.status), ['concluido', 'cancelado']);
});

test('horarios_ocupados devolve os intervalos do barbeiro e os do próprio cliente, sem os cancelados', async () => {
  await limpar();
  await agendar(CLIENTE_B, JOAO, COMBO_60, '14:00');   // outro cliente, barbeiro consultado
  await agendar(CLIENTE_A, PEDRO, CORTE_30, '16:00');  // o próprio cliente, outro barbeiro
  await agendar(CLIENTE_B, PEDRO, CORTE_30, '10:00');  // não diz respeito à consulta
  await agendar(CLIENTE_B, JOAO, CORTE_30, '09:00', 'cancelado');

  await db.query("SELECT set_config('test.uid', $1, false)", [CLIENTE_A]);
  const { rows, fields } = await db.query(
    `SELECT to_char(inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS inicio,
            to_char(fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS fim
       FROM public.horarios_ocupados($1, $2, $3) ORDER BY 1`,
    [JOAO, as('00:00'), as('23:59')],
  );
  assert.deepEqual(rows, [{ inicio: '14:00', fim: '15:00' }, { inicio: '16:00', fim: '16:30' }]);
  assert.deepEqual(fields.map((f) => f.name), ['inicio', 'fim']);
});

test('migration 13: excluir barbeiro com agendamento é barrado pelo banco e nada é apagado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, CORTE_30, '14:00');
  const r = await recusa(db.query('DELETE FROM public.barbeiros WHERE id = $1', [JOAO]));
  assert.ok(['23001', '23503'].includes(r.code), `código inesperado: ${r.code}`);
  assert.equal(await total(), 1);
});
