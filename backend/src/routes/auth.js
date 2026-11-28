const express = require('express');
const { criarRecuperacaoSenha, RecuperacaoErro } = require('../services/recuperacaoSenha');
// Cliente unico, protegido pela conferencia do ambiente
const { supabase: supabaseAdmin } = require('../services/supabaseServico');

const router = express.Router();

// Cadastro de clientes: o site e o app chamam o Supabase Auth direto (signUp),
// com a confirmacao de e-mail configurada no projeto. A antiga POST /register
// foi retirada: era publica, sem limite, e criava contas ja confirmadas com a
// chave de servico (pulando a confirmacao de e-mail). Nenhuma tela a usava.

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
