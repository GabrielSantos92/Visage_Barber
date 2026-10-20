const express = require('express');
const router = express.Router();
const { createClient } = require('@supabase/supabase-js');
const { excluirBarbeiro } = require('../services/barbeiros');

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
);

// Cliente separado com configuração correta para auth.admin em Node.js
const supabaseAuth = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// Todas as rotas /api/admin exigem o token de sessão (Authorization: Bearer ...)
// de um usuário com role 'admin'. Sem isso qualquer pessoa conseguiria criar barbeiros.
async function requireAdmin(req, res, next) {
  try {
    const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!token) return res.status(401).json({ error: 'Não autenticado.' });

    const { data, error } = await supabaseAuth.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: 'Sessão inválida ou expirada. Faça login novamente.' });
    }

    const { data: roles, error: roleError } = await supabaseAuth
      .from('user_roles')
      .select('role')
      .eq('user_id', data.user.id)
      .eq('role', 'admin');

    if (roleError) return res.status(500).json({ error: 'Erro ao verificar permissão.' });
    if (!roles || roles.length === 0) {
      return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
    }

    next();
  } catch (err) {
    console.error('[requireAdmin]', err);
    res.status(500).json({ error: 'Erro ao verificar permissão.' });
  }
}

router.use(requireAdmin);

// GET /api/admin/metrics
router.get('/metrics', async (_req, res) => {
  try {
    const [agendamentosRes, barb, clientesRes] = await Promise.all([
      supabaseAdmin.from('agendamentos').select('status, created_at, barbeiro_id'),
      supabaseAdmin.from('barbeiros').select('id, nome').eq('ativo', true),
      supabaseAdmin.from('profiles').select('id', { count: 'exact' }),
    ]);

    const agendamentos = agendamentosRes.data ?? [];
    const barbeiros = barb.data ?? [];

    const porStatus = agendamentos.reduce((acc, a) => {
      acc[a.status] = (acc[a.status] ?? 0) + 1;
      return acc;
    }, {});

    const agora = new Date();
    const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);
    const doMes = agendamentos.filter((a) => new Date(a.created_at) >= inicioMes).length;

    const contagemBarbeiro = agendamentos.reduce((acc, a) => {
      acc[a.barbeiro_id] = (acc[a.barbeiro_id] ?? 0) + 1;
      return acc;
    }, {});

    let barbeiroMaisRequisitado = null;
    const maxId = Object.entries(contagemBarbeiro).sort((a, b) => b[1] - a[1])[0]?.[0];
    if (maxId) {
      barbeiroMaisRequisitado = barbeiros.find((b) => b.id === maxId)?.nome ?? maxId;
    }

    res.json({
      totalAgendamentos: agendamentos.length,
      agendamentosDoMes: doMes,
      porStatus,
      barbeiroMaisRequisitado,
      totalBarbeiros: barbeiros.length,
      totalClientes: clientesRes.count ?? 0,
    });
  } catch (err) {
    res.status(500).json({ erro: 'Erro ao buscar métricas', detalhe: err.message });
  }
});

// POST /api/admin/create-barbeiro
// Cria o usuário barbeiro completo: auth + profile + barbeiro + user_role
router.post('/create-barbeiro', async (req, res) => {
  try {
    const { email, password, nome, telefone, especialidade } = req.body;

    if (!email || !password || !nome) {
      return res.status(400).json({ error: 'email, password e nome são obrigatórios.' });
    }

    // O telefone vira o link de WhatsApp do barbeiro: exige DDD + número (com ou sem o 55)
    const digitos = String(telefone ?? '').replace(/\D/g, '').replace(/^0+/, '');
    const telefoneValido = digitos.length === 10 || digitos.length === 11
      || ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith('55'));
    if (!telefoneValido) {
      return res.status(400).json({ error: 'Telefone é obrigatório e deve ter DDD + número.' });
    }

    const { data: authData, error: authError } = await supabaseAuth.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, telefone: telefone ?? '' },
    });

    if (authError) {
      if (authError.message.includes('already been registered')) {
        return res.status(409).json({ error: 'Este email já está cadastrado.' });
      }
      return res.status(400).json({ error: authError.message });
    }

    const userId = authData.user.id;

    const [profileRes, roleRes, barbeiroRes] = await Promise.all([
      supabaseAdmin.from('profiles').upsert({ id: userId, nome: nome.trim(), telefone: telefone?.trim() ?? '' }),
      supabaseAdmin.from('user_roles').insert({ user_id: userId, role: 'barbeiro' }),
      supabaseAdmin.from('barbeiros').insert({ user_id: userId, nome: nome.trim(), especialidade: especialidade?.trim() || null }).select().single(),
    ]);

    if (barbeiroRes.error) {
      await supabaseAuth.auth.admin.deleteUser(userId);
      return res.status(500).json({ error: barbeiroRes.error.message });
    }

    return res.status(201).json({ user_id: userId, barbeiro_id: barbeiroRes.data.id });
  } catch (err) {
    console.error('[create-barbeiro]', err);
    return res.status(500).json({ error: err.message ?? 'Erro interno ao criar barbeiro.' });
  }
});

// DELETE /api/admin/barbeiros/:id
// Exclui o barbeiro somente se ele não tiver nenhum agendamento (qualquer status)
router.delete('/barbeiros/:id', async (req, res) => {
  try {
    const { status, body } = await excluirBarbeiro(supabaseAuth, req.params.id);
    return res.status(status).json(body);
  } catch (err) {
    console.error('[delete-barbeiro]', err);
    return res.status(500).json({ error: 'Erro interno ao excluir barbeiro.' });
  }
});

module.exports = router;
