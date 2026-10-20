// Agenda com pausa (coloracao/tintura), testada direto no banco (PGlite) com as
// migrations reais: o trigger validar_agendamento decide o que pode ser gravado
// e a funcao horarios_livres decide o que web e mobile oferecem.
const { test, before } = require('node:test');
const assert = require('node:assert/strict');

const {
  criarBanco, auxiliares, recusa, as,
  JOAO, PEDRO, CORTE_30, COMBO_60, CLIENTE_A, CLIENTE_B, CLIENTE_C, ADMIN, USUARIO_JOAO,
} = require('./helpers/bancoAgenda');

// Coloracao do exemplo: 20 min de aplicacao, 40 de pausa, 30 de finalizacao e
// 5 de margem. Agendada as 14:00 => barbeiro presente 14:00-14:25 e 14:55-15:30;
// pausa aproveitavel 14:25-14:55.
const COLORACAO = '50000000-0000-4000-8000-0000000000c1';
const COLOR_SEM_TEMPOS = '50000000-0000-4000-8000-0000000000c2';
const BARBA_15 = '50000000-0000-4000-8000-0000000000b1';

let db;
let limpar, agendar, total, comoUsuario;

before(async () => {
  db = await criarBanco();
  ({ limpar, agendar, total, comoUsuario } = auxiliares(db));
  await db.exec(`
    INSERT INTO public.servicos (id, nome, preco, duracao_min, com_pausa, ativo_inicial_min, pausa_min, ativo_final_min, margem_min) VALUES
      ('${COLORACAO}', 'Coloração', 120, 90, true, 20, 40, 30, 5),
      ('${COLOR_SEM_TEMPOS}', 'Tintura', 90, 60, true, NULL, NULL, NULL, 0),
      ('${BARBA_15}', 'Barba', 25, 15, false, NULL, NULL, NULL, 0);
    INSERT INTO public.barbeiro_servicos
      SELECT b.id, s.id FROM public.barbeiros b, public.servicos s
       WHERE s.id IN ('${COLORACAO}', '${COLOR_SEM_TEMPOS}', '${BARBA_15}');
  `);
});

async function livres(barbeiro, servico, cliente = null) {
  await comoUsuario(cliente);
  const { rows } = await db.query('SELECT horario FROM public.horarios_livres($1, $2, $3::date)', [barbeiro, servico, as('00:00').slice(0, 10)]);
  return rows.map((r) => r.horario);
}

async function configurar(uid, servico, comPausa, ini, pausa, fim, margem) {
  await comoUsuario(uid);
  const { rows } = await db.query(
    'SELECT public.configurar_etapas_servico($1, $2, $3, $4, $5, $6) AS futuros',
    [servico, comPausa, ini, pausa, fim, margem],
  );
  await comoUsuario(null);
  return rows[0].futuros;
}

async function restaurarColoracao() {
  await db.query(
    `UPDATE public.servicos SET com_pausa = true, ativo_inicial_min = 20, pausa_min = 40, ativo_final_min = 30,
            margem_min = 5, duracao_min = 90 WHERE id = $1`, [COLORACAO]);
}

test('1. coloração sem outro atendimento na pausa: um único agendamento com as etapas copiadas', async () => {
  await limpar();
  const id = await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  const { rows } = await db.query(
    'SELECT duracao_min, ativo_inicial_min, pausa_min, ativo_final_min, margem_min FROM public.agendamentos WHERE id = $1', [id]);
  assert.deepEqual(rows[0], { duracao_min: 90, ativo_inicial_min: 20, pausa_min: 40, ativo_final_min: 30, margem_min: 5 });
  assert.equal(await total(), 1);
  // os períodos ativos ficam ocupados para outra coloração
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, COLORACAO, '14:00'))).detail, 'CONFLITO_BARBEIRO');
});

test('2. corte que cabe inteiro na pausa é aceito pelo backend e oferecido nos horários', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  assert.ok((await livres(JOAO, CORTE_30, CLIENTE_B)).includes('14:25'));
  await agendar(CLIENTE_B, JOAO, CORTE_30, '14:25'); // 14:25-14:55
  // um serviço mais curto também cabe, em qualquer ponto da parte aproveitável
  await agendar(CLIENTE_C, PEDRO, COLORACAO, '16:00'); // pausa aproveitável 16:25-16:55
  await agendar(CLIENTE_B, PEDRO, BARBA_15, '16:30');  // 16:30-16:45
  assert.equal(await total(), 4);
});

test('3. corte que ultrapassa o fim da pausa é recusado e não é oferecido', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  for (const h of ['14:30', '14:40', '14:50']) {
    const r = await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, h));
    assert.equal(r.code, 'PT409');
    assert.equal(r.detail, 'CONFLITO_BARBEIRO', h);
  }
  const slots = await livres(JOAO, CORTE_30, CLIENTE_B);
  assert.ok(!slots.includes('14:30'));
  assert.ok(!slots.includes('15:00'));
  assert.equal(await total(), 1);
});

test('4. serviço que invade a aplicação (período ativo inicial) é recusado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '14:10'))).detail, 'CONFLITO_BARBEIRO');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '13:45'))).detail, 'CONFLITO_BARBEIRO');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, BARBA_15, '14:05'))).detail, 'CONFLITO_BARBEIRO');
  // logo antes da coloração continua livre (bloco termina exatamente às 14:00)
  await agendar(CLIENTE_B, JOAO, CORTE_30, '13:30');
});

test('5. serviço que invade a finalização (período ativo final) é recusado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '15:00'))).detail, 'CONFLITO_BARBEIRO');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, BARBA_15, '15:20'))).detail, 'CONFLITO_BARBEIRO');
  // uma nova coloração cuja aplicação cairia na finalização da primeira
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, COLORACAO, '14:55'))).detail, 'CONFLITO_BARBEIRO');
  await agendar(CLIENTE_B, JOAO, CORTE_30, '15:30'); // depois da finalização
});

test('6. dois serviços não ocupam o mesmo período ativo (inclusive dentro da pausa)', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  await agendar(CLIENTE_B, JOAO, CORTE_30, '14:25');
  // a pausa já foi aproveitada pelo corte do cliente B
  assert.equal((await recusa(agendar(CLIENTE_C, JOAO, BARBA_15, '14:30'))).detail, 'CONFLITO_BARBEIRO');
  assert.equal((await recusa(agendar(CLIENTE_C, JOAO, CORTE_30, '14:25'))).detail, 'CONFLITO_BARBEIRO');
  assert.ok(!(await livres(JOAO, BARBA_15, CLIENTE_C)).some((h) => h >= '14:00' && h < '15:30'));
});

test('7. o mesmo cliente não marca outro serviço durante a própria coloração, nem com outro barbeiro', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  const r = await recusa(agendar(CLIENTE_A, PEDRO, CORTE_30, '14:25'));
  assert.equal(r.code, 'PT409');
  assert.equal(r.detail, 'CONFLITO_CLIENTE');
  assert.ok(!(await livres(PEDRO, CORTE_30, CLIENTE_A)).includes('14:30'));
  await agendar(CLIENTE_A, PEDRO, CORTE_30, '15:30'); // depois que a coloração termina
});

test('8. cancelar libera os períodos correspondentes', async () => {
  await limpar();
  const coloracao = await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  const corte = await agendar(CLIENTE_B, JOAO, CORTE_30, '14:25');

  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [corte]);
  assert.ok((await livres(JOAO, BARBA_15, CLIENTE_C)).includes('14:25'));
  await agendar(CLIENTE_C, JOAO, BARBA_15, '14:25');

  // com a coloração cancelada, a aplicação e a finalização ficam livres
  await db.query("UPDATE public.agendamentos SET status = 'cancelado' WHERE id = $1", [coloracao]);
  await agendar(CLIENTE_A, JOAO, BARBA_15, '14:05');
  await agendar(CLIENTE_B, JOAO, CORTE_30, '15:00');
});

test('9. duas reservas simultâneas para o mesmo intervalo da pausa: só uma é gravada', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  const resultados = await Promise.allSettled([
    agendar(CLIENTE_B, JOAO, CORTE_30, '14:25'),
    agendar(CLIENTE_C, JOAO, CORTE_30, '14:25'),
  ]);
  assert.equal(resultados.filter((r) => r.status === 'fulfilled').length, 1);
  const falha = resultados.find((r) => r.status === 'rejected');
  assert.equal(falha.reason.detail, 'CONFLITO_BARBEIRO');
  assert.equal(await total(), 2);
});

test('10. serviço com pausa sem os tempos configurados não é agendável nem oferecido', async () => {
  await limpar();
  const r = await recusa(agendar(CLIENTE_A, JOAO, COLOR_SEM_TEMPOS, '14:00'));
  assert.equal(r.code, 'PT400');
  assert.equal(r.detail, 'SERVICO_SEM_ETAPAS');
  assert.equal(r.message, 'Este serviço ainda não tem os tempos de atendimento configurados.');
  assert.deepEqual(await livres(JOAO, COLOR_SEM_TEMPOS, CLIENTE_A), []);
  assert.equal(await total(), 0);
});

test('11. tempos inválidos ou inconsistentes são recusados (restrição e função de configuração)', async () => {
  const restricao = (sql) => recusa(db.query(sql, [COLORACAO]));
  // direto na tabela: a restrição do banco barra
  assert.equal((await restricao('UPDATE public.servicos SET pausa_min = -10 WHERE id = $1')).code, '23514');
  assert.equal((await restricao('UPDATE public.servicos SET duracao_min = 60 WHERE id = $1')).code, '23514');
  assert.equal((await restricao('UPDATE public.servicos SET ativo_final_min = NULL WHERE id = $1')).code, '23514');
  assert.equal((await restricao('UPDATE public.servicos SET margem_min = 20 WHERE id = $1')).code, '23514');
  assert.equal((await restricao('UPDATE public.servicos SET com_pausa = false WHERE id = $1')).code, '23514');

  // pela função de configuração: mensagem clara
  const cfg = (...args) => recusa(configurar(ADMIN, COLORACAO, true, ...args));
  assert.equal((await cfg(-5, 40, 30, 5)).detail, 'ETAPA_INVALIDA');
  assert.equal((await cfg(20, 0, 30, 5)).detail, 'ETAPA_INVALIDA');
  assert.equal((await cfg(20, null, 30, 5)).detail, 'ETAPAS_INCOMPLETAS');
  assert.equal((await cfg(20, 10, 30, 5)).detail, 'MARGEM_INVALIDA'); // pausa <= 2 x margem
  assert.equal((await cfg(20, 40, 30, -1)).detail, 'MARGEM_INVALIDA');
  await comoUsuario(null);

  // quem não é admin nem barbeiro do serviço não configura
  const semPermissao = await recusa(configurar(CLIENTE_A, COLORACAO, true, 20, 40, 30, 5));
  assert.equal(semPermissao.detail, 'SEM_PERMISSAO');
  await comoUsuario(null);

  const { rows } = await db.query('SELECT duracao_min, ativo_inicial_min, pausa_min, ativo_final_min, margem_min FROM public.servicos WHERE id = $1', [COLORACAO]);
  assert.deepEqual(rows[0], { duracao_min: 90, ativo_inicial_min: 20, pausa_min: 40, ativo_final_min: 30, margem_min: 5 });
});

test('12. alterar os tempos do serviço não muda os agendamentos já feitos', async () => {
  await limpar();
  const id = await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');

  // o barbeiro que oferece o serviço reconfigura: 30 + 20 + 30, sem margem
  const futuros = await configurar(USUARIO_JOAO, COLORACAO, true, 30, 20, 30, 0);
  assert.equal(futuros, 1);
  const { rows: srv } = await db.query('SELECT duracao_min FROM public.servicos WHERE id = $1', [COLORACAO]);
  assert.equal(srv[0].duracao_min, 80);

  const { rows } = await db.query(
    'SELECT duracao_min, ativo_inicial_min, pausa_min, ativo_final_min, margem_min FROM public.agendamentos WHERE id = $1', [id]);
  assert.deepEqual(rows[0], { duracao_min: 90, ativo_inicial_min: 20, pausa_min: 40, ativo_final_min: 30, margem_min: 5 });

  // o app não consegue reescrever a cópia dos tempos
  await db.query('UPDATE public.agendamentos SET pausa_min = 60, duracao_min = 10 WHERE id = $1', [id]);
  const { rows: depois } = await db.query('SELECT duracao_min, pausa_min FROM public.agendamentos WHERE id = $1', [id]);
  assert.deepEqual(depois[0], { duracao_min: 90, pausa_min: 40 });

  // a disponibilidade continua usando os tempos com que a coloração foi marcada
  await agendar(CLIENTE_B, JOAO, CORTE_30, '14:25');
  // novos agendamentos usam a configuração nova: 15:00 aplicação 15:00-15:30, pausa 15:30-15:50
  const novo = await agendar(CLIENTE_C, PEDRO, COLORACAO, '15:00');
  const { rows: n } = await db.query('SELECT duracao_min, pausa_min FROM public.agendamentos WHERE id = $1', [novo]);
  assert.deepEqual(n[0], { duracao_min: 80, pausa_min: 20 });

  // desligar a pausa: o serviço volta a ser contínuo (com a mesma duração total)
  await configurar(ADMIN, COLORACAO, false, null, null, null, 0);
  const { rows: cont } = await db.query('SELECT com_pausa, pausa_min, duracao_min FROM public.servicos WHERE id = $1', [COLORACAO]);
  assert.deepEqual(cont[0], { com_pausa: false, pausa_min: null, duracao_min: 80 });
  await restaurarColoracao();
});

test('13. a margem de segurança é respeitada nos dois lados da pausa', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00'); // pausa real 14:20-15:00, margem 5
  // começa assim que a aplicação termina: sem a margem
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '14:20'))).detail, 'CONFLITO_BARBEIRO');
  // termina às 15:00, no instante em que o barbeiro precisa voltar: sem a margem
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, BARBA_15, '14:45'))).detail, 'CONFLITO_BARBEIRO');
  await agendar(CLIENTE_B, JOAO, BARBA_15, '14:40'); // 14:40-14:55

  // sem margem, a pausa inteira (14:20-15:00) pode ser usada
  await limpar();
  await configurar(ADMIN, COLORACAO, true, 20, 40, 30, 0);
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  assert.ok((await livres(JOAO, CORTE_30, CLIENTE_B)).includes('14:20'));
  await agendar(CLIENTE_B, JOAO, CORTE_30, '14:20');
  // 14:50-15:05 invadiria a finalização
  assert.equal((await recusa(agendar(CLIENTE_C, JOAO, BARBA_15, '14:50'))).detail, 'CONFLITO_BARBEIRO');
  await restaurarColoracao();
});

test('14. o atendimento inteiro, pausa inclusa, respeita o expediente do barbeiro', async () => {
  await limpar();
  // 17:00 + 90 min passaria das 18:00
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, COLORACAO, '17:00'))).detail, 'FORA_DO_EXPEDIENTE');
  // 11:00 + 90 min invadiria o almoço (12:00-13:00), mesmo com a pausa no meio
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, COLORACAO, '11:00'))).detail, 'FORA_DO_EXPEDIENTE');
  assert.equal((await recusa(agendar(CLIENTE_A, JOAO, COLORACAO, '2020-01-08 14:00 America/Sao_Paulo'))).detail, 'HORARIO_PASSADO');
  const slots = await livres(JOAO, COLORACAO, CLIENTE_A);
  assert.ok(slots.includes('16:30')); // termina exatamente às 18:00
  assert.ok(!slots.includes('17:00'));
  assert.ok(!slots.includes('11:00'));
  await agendar(CLIENTE_A, JOAO, COLORACAO, '16:30');
});

test('15. serviços convencionais seguem como bloco contínuo e não abrem espaço no meio', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COMBO_60, '14:00');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, BARBA_15, '14:20'))).detail, 'CONFLITO_BARBEIRO');
  assert.equal((await recusa(agendar(CLIENTE_B, JOAO, CORTE_30, '14:30'))).detail, 'CONFLITO_BARBEIRO');
  const slots = await livres(JOAO, BARBA_15, CLIENTE_B);
  assert.ok(!slots.some((h) => h >= '14:00' && h < '15:00'));
  assert.ok(slots.includes('15:00'));
  const { rows } = await db.query('SELECT pausa_min, duracao_min FROM public.agendamentos');
  assert.deepEqual(rows[0], { pausa_min: null, duracao_min: 60 });
});

test('16. todo horário oferecido aos apps é aceito pelo backend, e o resto da grade é recusado', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '10:00');
  await agendar(CLIENTE_A, JOAO, CORTE_30, '13:30');
  await agendar(CLIENTE_C, JOAO, COLORACAO, '15:00');

  for (const servico of [CORTE_30, BARBA_15, COMBO_60, COLORACAO]) {
    const oferecidos = new Set(await livres(JOAO, servico, CLIENTE_B));
    const candidatos = new Set(oferecidos);
    for (let m = 9 * 60; m < 18 * 60; m += 5) {
      candidatos.add(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
    }
    for (const h of candidatos) {
      await db.exec('BEGIN');
      let aceito = true;
      try {
        await agendar(CLIENTE_B, JOAO, servico, h);
      } catch {
        aceito = false;
      }
      await db.exec('ROLLBACK');
      if (oferecidos.has(h)) assert.ok(aceito, `${h} foi oferecido mas o backend recusou`);
      else if (aceito) assert.ok(!/^\d\d:(00|30)$/.test(h), `${h} está na grade, é aceito, mas não foi oferecido`);
    }
  }
  // as pausas das colorações aparecem como horários livres para um corte
  const corte = await livres(JOAO, CORTE_30, CLIENTE_B);
  assert.ok(corte.includes('10:25'));
  assert.ok(corte.includes('15:25'));
});

test('horarios_ocupados (apps antigos) devolve só os períodos de presença do barbeiro', async () => {
  await limpar();
  await agendar(CLIENTE_A, JOAO, COLORACAO, '14:00');
  await comoUsuario(CLIENTE_B);
  const { rows } = await db.query(
    `SELECT to_char(inicio AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS inicio,
            to_char(fim AT TIME ZONE 'America/Sao_Paulo', 'HH24:MI') AS fim
       FROM public.horarios_ocupados($1, $2, $3) ORDER BY 1`,
    [JOAO, as('00:00'), as('23:59')],
  );
  assert.deepEqual(rows, [{ inicio: '14:00', fim: '14:25' }, { inicio: '14:55', fim: '15:30' }]);
});

test('conclusão automática usa a duração gravada no agendamento', async () => {
  await limpar();
  await db.exec(`
    ALTER TABLE public.agendamentos DISABLE TRIGGER validar_agendamento;
    INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, duracao_min, ativo_inicial_min, pausa_min, ativo_final_min, margem_min)
      VALUES ('${CLIENTE_A}', '${JOAO}', '${COLORACAO}', now() - interval '80 minutes', 90, 20, 40, 30, 5),
             ('${CLIENTE_B}', '${JOAO}', '${CORTE_30}', now() - interval '40 minutes', 30, NULL, NULL, NULL, NULL);
    ALTER TABLE public.agendamentos ENABLE TRIGGER validar_agendamento;
  `);
  await db.query('SELECT public.concluir_agendamentos_passados()');
  const { rows } = await db.query('SELECT servico_id, status FROM public.agendamentos ORDER BY data_hora');
  assert.deepEqual(rows.map((r) => r.status), ['confirmado', 'concluido']); // coloração ainda em andamento
});

test('migration: agendamentos existentes mantêm a duração que já ocupavam', async () => {
  const legado = await criarBanco({
    antesDasMigrations: `
      INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora, status) VALUES
        ('${CLIENTE_A}', '${JOAO}', '${COMBO_60}', '${as('14:00')}', 'confirmado'),
        ('${CLIENTE_B}', '${JOAO}', '${CORTE_30}', '2020-01-08 10:00 America/Sao_Paulo', 'concluido'),
        ('${CLIENTE_B}', '${PEDRO}', '${CORTE_30}', '${as('09:00')}', 'cancelado');
    `,
  });
  const { rows } = await legado.query(
    'SELECT status, duracao_min, pausa_min FROM public.agendamentos ORDER BY data_hora');
  assert.deepEqual(rows, [
    { status: 'concluido', duracao_min: 30, pausa_min: null },
    { status: 'cancelado', duracao_min: 30, pausa_min: null },
    { status: 'confirmado', duracao_min: 60, pausa_min: null },
  ]);

  // mudar a duração do serviço depois não encolhe o agendamento já feito
  await legado.query('UPDATE public.servicos SET duracao_min = 30 WHERE id = $1', [COMBO_60]);
  const r = await recusa(legado.query(
    'INSERT INTO public.agendamentos (cliente_id, barbeiro_id, servico_id, data_hora) VALUES ($1, $2, $3, $4)',
    [CLIENTE_C, JOAO, CORTE_30, as('14:30')]));
  assert.equal(r.detail, 'CONFLITO_BARBEIRO');
  await legado.close();
});
