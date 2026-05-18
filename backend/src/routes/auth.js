const express = require('express');
const { createClient } = require('@supabase/supabase-js');

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

module.exports = router;
