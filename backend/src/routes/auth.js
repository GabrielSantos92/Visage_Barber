const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { criarRecuperacaoSenha, RecuperacaoErro } = require('../services/recuperacaoSenha');

const router = express.Router();

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

// POST /api/auth/register
// Cria o usuário já confirmado usando a chave admin (bypassa confirmação de email)
router.post('/register', async (req, res) => {
  const { email, password, nome, telefone } = req.body;

  if (!email || !password || !nome) {
    return res.status(400).json({ error: 'email, password e nome são obrigatórios.' });
  }

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { nome, telefone: telefone ?? '' },
  });

  if (error) {
    if (error.message.includes('already been registered')) {
      return res.status(409).json({ error: 'Este email já está cadastrado.' });
    }
    return res.status(400).json({ error: error.message });
  }

  return res.status(201).json({ user_id: data.user.id });
});

// ---------------------------------------------------------------------------
// Esqueceu a senha? (rotas publicas, sem token de sessao)
// ---------------------------------------------------------------------------
const recuperacao = criarRecuperacaoSenha({ supabase: supabaseAdmin });

function responderErro(res, err) {
  if (err instanceof RecuperacaoErro) return res.status(err.status).json({ error: err.message });
  console.error('[recuperar-senha]', err.message);
  return res.status(500).json({ error: 'Não foi possível concluir a operação. Tente novamente.' });
}

// POST /api/auth/recuperar-senha/email  { email, redirectTo }
router.post('/recuperar-senha/email', (req, res) => {
  try {
    const { email, redirectTo } = req.body ?? {};
    const { message } = recuperacao.solicitarEmail({ email, redirectTo, ip: req.ip });
    res.json({ message });
  } catch (err) {
    responderErro(res, err);
  }
});

module.exports = router;
