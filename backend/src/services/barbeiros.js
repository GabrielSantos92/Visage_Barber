const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Violação de chave estrangeira: restrict_violation e foreign_key_violation
const FK_VIOLADA = ['23001', '23503'];

const MSG_TEM_AGENDAMENTOS =
  'Não é possível excluir este barbeiro, pois existem agendamentos vinculados a ele. ' +
  'Para preservar o histórico dos atendimentos, a exclusão não pode ser realizada.';

const naoEncontrado = () => ({ status: 404, body: { error: 'Barbeiro não encontrado.', code: 'BARBER_NOT_FOUND' } });
const temAgendamentos = () => ({ status: 409, body: { error: MSG_TEM_AGENDAMENTOS, code: 'BARBER_HAS_APPOINTMENTS' } });

// Exclui um barbeiro somente se ele não tiver NENHUM agendamento, em qualquer status.
// `db` é um client Supabase com a service role. Retorna { status, body } para a rota.
//
// A consulta prévia serve para dar a resposta certa no caso comum; quem garante a
// regra mesmo com um agendamento criado no meio do caminho é a FK
// agendamentos.barbeiro_id com ON DELETE RESTRICT (migration 20261009000013):
// nesse caso o DELETE falha (23001 ou 23503, conforme a versão do Postgres) e
// nada é apagado.
async function excluirBarbeiro(db, id) {
  if (!UUID_RX.test(String(id ?? ''))) return naoEncontrado();

  const { data: barbeiro, error: buscaError } = await db
    .from('barbeiros').select('id, nome, user_id').eq('id', id).maybeSingle();
  if (buscaError) throw buscaError;
  if (!barbeiro) return naoEncontrado();

  // Só verifica a existência: no máximo uma linha, apenas o id
  const { data: agendamentos, error: agError } = await db
    .from('agendamentos').select('id').eq('barbeiro_id', id).limit(1);
  if (agError) throw agError;
  if (agendamentos && agendamentos.length > 0) return temAgendamentos();

  const { data: removidos, error: delError } = await db
    .from('barbeiros').delete().eq('id', id).select('id');
  if (delError) {
    if (FK_VIOLADA.includes(delError.code)) return temAgendamentos();
    throw delError;
  }
  if (!removidos || removidos.length === 0) return naoEncontrado();

  const conta = barbeiro.user_id ? await encerrarContaDoBarbeiro(db, barbeiro.user_id) : 'sem_conta';

  return { status: 200, body: { success: true, message: 'Barbeiro excluído com sucesso.', conta } };
}

// A conta de login foi criada junto com o barbeiro. Ela só é apagada quando é
// exclusivamente de barbeiro; se o mesmo usuário também é admin ou tem
// agendamentos como cliente, a conta fica e perde apenas a role 'barbeiro'
// (apagar o usuário levaria esses dados junto, por cascata).
async function encerrarContaDoBarbeiro(db, userId) {
  try {
    const [rolesRes, comoClienteRes] = await Promise.all([
      db.from('user_roles').select('role').eq('user_id', userId),
      db.from('agendamentos').select('id').eq('cliente_id', userId).limit(1),
    ]);
    if (rolesRes.error) throw rolesRes.error;
    if (comoClienteRes.error) throw comoClienteRes.error;

    const ehAdmin = (rolesRes.data ?? []).some((r) => r.role === 'admin');
    const temHistoricoComoCliente = (comoClienteRes.data ?? []).length > 0;

    if (!ehAdmin && !temHistoricoComoCliente) {
      const { error } = await db.auth.admin.deleteUser(userId);
      if (error) throw error;
      return 'excluida';
    }

    const { error } = await db.from('user_roles').delete().eq('user_id', userId).eq('role', 'barbeiro');
    if (error) throw error;
    return 'mantida';
  } catch (err) {
    // O barbeiro já foi excluído; a conta fica para ajuste manual
    console.error('[excluirBarbeiro] falha ao encerrar a conta', userId, err);
    return 'pendente';
  }
}

module.exports = { excluirBarbeiro, MSG_TEM_AGENDAMENTOS };
