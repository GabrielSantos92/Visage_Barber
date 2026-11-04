// Consentimentos do titular. Todas as rotas agem sobre o usuario do token:
// nao ha parametro de usuario, entao ninguem consulta ou altera o de outra pessoa.
//
//   GET  /api/privacidade/consentimentos/:finalidade          situacao atual
//   POST /api/privacidade/consentimentos/:finalidade          { versao, origem } concede
//   POST /api/privacidade/consentimentos/:finalidade/revogar  { origem } revoga

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const {
  ConsentimentoErro, criarConsentimentos, criarProtecaoConsentimento, repositorioSupabase,
} = require('../services/consentimento');

function criarRotasPrivacidade({ consentimentos, verificarToken }) {
  const router = express.Router();

  async function autenticar(req, res, next) {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const usuario = token ? await verificarToken(token) : null;
      if (!usuario) return res.status(401).json({ error: 'Faça login para continuar.', code: 'NAO_AUTENTICADO' });
      req.usuario = usuario;
      next();
    } catch (err) {
      console.error('[privacidade] erro ao autenticar:', err.message);
      res.status(500).json({ error: 'Não foi possível verificar sua sessão.' });
    }
  }

  const responder = (acao) => async (req, res) => {
    try {
      res.json(await acao(req));
    } catch (err) {
      if (err instanceof ConsentimentoErro) return res.status(err.status).json({ error: err.message, code: err.code });
      console.error('[privacidade] erro:', err.message);
      res.status(500).json({ error: 'Não foi possível registrar sua escolha. Tente novamente.' });
    }
  };

  router.get('/consentimentos/:finalidade', autenticar, responder((req) =>
    consentimentos.status(req.usuario.id, req.params.finalidade)));

  router.post('/consentimentos/:finalidade', autenticar, responder((req) =>
    consentimentos.conceder(req.usuario.id, req.params.finalidade, {
      versao: req.body?.versao, origem: req.body?.origem,
    })));

  router.post('/consentimentos/:finalidade/revogar', autenticar, responder((req) =>
    consentimentos.revogar(req.usuario.id, req.params.finalidade, { origem: req.body?.origem })));

  return router;
}

// Instancia real: banco com service role e validacao do token no Supabase Auth
const supabaseServico = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function verificarToken(token) {
  const { data, error } = await supabaseServico.auth.getUser(token);
  return error ? null : data?.user ?? null;
}

const consentimentos = criarConsentimentos({ repositorio: repositorioSupabase(supabaseServico) });

const router = criarRotasPrivacidade({ consentimentos, verificarToken });

// Usado pelas rotas do visagismo: sem login e consentimento vigente, a foto nao entra
const protegerVisagismo = criarProtecaoConsentimento({ verificarToken, consentimentos, finalidade: 'visagismo_foto' });

module.exports = { router, protegerVisagismo, criarRotasPrivacidade };
