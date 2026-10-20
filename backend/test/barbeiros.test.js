const { test } = require('node:test');
const assert = require('node:assert/strict');
const { excluirBarbeiro, MSG_TEM_AGENDAMENTOS } = require('../src/services/barbeiros');

const ID = '11111111-1111-4111-8111-111111111111';
const OUTRO = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

// Client Supabase em memória: só o que excluirBarbeiro usa (select/delete com eq e limit).
// `restrict` simula a FK agendamentos.barbeiro_id ON DELETE RESTRICT.
function fakeDb(tabelas, { restrict = true, aoApagarBarbeiro, codigoFk = '23503' } = {}) {
  const usuariosApagados = [];

  function query(nome) {
    const q = { op: 'select', filtros: [], limite: null };
    const filtra = () => tabelas[nome].filter((l) => q.filtros.every(([c, v]) => l[c] === v));

    function executa() {
      if (q.op === 'select') {
        const linhas = filtra();
        return { data: q.limite ? linhas.slice(0, q.limite) : linhas, error: null };
      }
      const alvo = filtra();
      if (nome === 'barbeiros') {
        if (aoApagarBarbeiro) aoApagarBarbeiro(tabelas);
        const presos = alvo.some((b) => tabelas.agendamentos.some((a) => a.barbeiro_id === b.id));
        if (presos && restrict) return { data: null, error: { code: codigoFk, message: 'violates foreign key constraint' } };
      }
      tabelas[nome] = tabelas[nome].filter((l) => !alvo.includes(l));
      return { data: alvo, error: null };
    }

    const builder = {
      select() { return builder; },
      delete() { q.op = 'delete'; return builder; },
      eq(c, v) { q.filtros.push([c, v]); return builder; },
      limit(n) { q.limite = n; return builder; },
      maybeSingle() { const r = executa(); return Promise.resolve({ data: r.data[0] ?? null, error: null }); },
      then(ok, falha) { return Promise.resolve(executa()).then(ok, falha); },
    };
    return builder;
  }

  return {
    usuariosApagados,
    tabelas,
    from: query,
    auth: { admin: { deleteUser: async (id) => { usuariosApagados.push(id); return { error: null }; } } },
  };
}

const base = (extra = {}) => ({
  barbeiros: [{ id: ID, nome: 'João', user_id: USER }],
  agendamentos: [],
  user_roles: [{ user_id: USER, role: 'cliente' }, { user_id: USER, role: 'barbeiro' }],
  ...extra,
});

test('exclui barbeiro sem nenhum agendamento e apaga a conta de login', async () => {
  const db = fakeDb(base());
  const r = await excluirBarbeiro(db, ID);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { success: true, message: 'Barbeiro excluído com sucesso.', conta: 'excluida' });
  assert.equal(db.tabelas.barbeiros.length, 0);
  assert.deepEqual(db.usuariosApagados, [USER]);
});

for (const status of ['confirmado', 'concluido', 'cancelado']) {
  test(`bloqueia barbeiro com agendamento ${status} e não apaga nada`, async () => {
    const db = fakeDb(base({ agendamentos: [{ id: 'a1', barbeiro_id: ID, cliente_id: 'c1', status }] }));
    const r = await excluirBarbeiro(db, ID);
    assert.equal(r.status, 409);
    assert.equal(r.body.code, 'BARBER_HAS_APPOINTMENTS');
    assert.equal(r.body.error, MSG_TEM_AGENDAMENTOS);
    assert.equal(db.tabelas.barbeiros.length, 1);
    assert.equal(db.tabelas.agendamentos.length, 1);
    assert.deepEqual(db.usuariosApagados, []);
  });
}

test('agendamento de outro barbeiro não impede a exclusão', async () => {
  const db = fakeDb(base({ agendamentos: [{ id: 'a1', barbeiro_id: OUTRO, cliente_id: 'c1', status: 'confirmado' }] }));
  const r = await excluirBarbeiro(db, ID);
  assert.equal(r.status, 200);
  assert.equal(db.tabelas.agendamentos.length, 1);
});

test('agendamento criado entre a verificação e a exclusão é barrado pela FK', async () => {
  const db = fakeDb(base(), {
    aoApagarBarbeiro: (t) => t.agendamentos.push({ id: 'a9', barbeiro_id: ID, cliente_id: 'c1', status: 'confirmado' }),
  });
  const r = await excluirBarbeiro(db, ID);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'BARBER_HAS_APPOINTMENTS');
  assert.equal(db.tabelas.barbeiros.length, 1);
  assert.equal(db.tabelas.agendamentos.length, 1);
});

test('barbeiro inexistente e id malformado retornam 404', async () => {
  const db = fakeDb(base());
  assert.equal((await excluirBarbeiro(db, OUTRO)).status, 404);
  assert.equal((await excluirBarbeiro(db, 'abc')).status, 404);
  assert.equal((await excluirBarbeiro(db, undefined)).status, 404);
  assert.equal(db.tabelas.barbeiros.length, 1);
});

test('mantém a conta quando o usuário também é admin, removendo só a role barbeiro', async () => {
  const db = fakeDb(base({
    user_roles: [{ user_id: USER, role: 'admin' }, { user_id: USER, role: 'barbeiro' }],
  }));
  const r = await excluirBarbeiro(db, ID);
  assert.equal(r.body.conta, 'mantida');
  assert.deepEqual(db.usuariosApagados, []);
  assert.deepEqual(db.tabelas.user_roles, [{ user_id: USER, role: 'admin' }]);
});

test('mantém a conta quando o usuário tem agendamentos como cliente', async () => {
  const db = fakeDb(base({ agendamentos: [{ id: 'a1', barbeiro_id: OUTRO, cliente_id: USER, status: 'concluido' }] }));
  const r = await excluirBarbeiro(db, ID);
  assert.equal(r.status, 200);
  assert.equal(r.body.conta, 'mantida');
  assert.deepEqual(db.usuariosApagados, []);
  assert.equal(db.tabelas.agendamentos.length, 1);
});

test('barbeiro sem conta de login é excluído sem tocar em usuários', async () => {
  const db = fakeDb(base({ barbeiros: [{ id: ID, nome: 'Seed', user_id: null }] }));
  const r = await excluirBarbeiro(db, ID);
  assert.equal(r.body.conta, 'sem_conta');
  assert.deepEqual(db.usuariosApagados, []);
});

test('a recusa do banco por RESTRICT (23001) também vira 409', async () => {
  const db = fakeDb(base(), {
    codigoFk: '23001',
    aoApagarBarbeiro: (t) => t.agendamentos.push({ id: 'a9', barbeiro_id: ID, cliente_id: 'c1', status: 'confirmado' }),
  });
  const r = await excluirBarbeiro(db, ID);
  assert.equal(r.status, 409);
  assert.equal(r.body.code, 'BARBER_HAS_APPOINTMENTS');
});
