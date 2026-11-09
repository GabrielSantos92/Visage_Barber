// Pagamentos dos clientes (ver services/pagamentos.js).
//
//   POST /api/pagamentos                     { agendamento_id, metodo }  cria a cobranca
//   POST /api/pagamentos/:id/sincronizar     consulta o provedor (dono ou admin)
//   POST /api/pagamentos/:id/reembolsar      { valor?, motivo? }  reembolso online (admin)
//   POST /api/pagamentos/cobrancas-abertas/cancelar  { agendamento_id? }  cancela no
//        Mercado Pago as cobrancas que deixaram de valer aqui (admin)
//   POST /api/pagamentos/webhook             notificacao do Mercado Pago (publica, assinada)
//
// O cliente e sempre o do token: nao ha parametro de usuario. Valores enviados
// pelo app sao ignorados; o preco vem do agendamento no banco.

const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { criarMercadoPago } = require('../services/mercadoPago');
const { criarServicoPagamentos, PagamentoErro } = require('../services/pagamentos');

function criarRotasPagamentos({ servico, verificarToken, ehAdmin }) {
  const router = express.Router();

  async function autenticar(req, res, next) {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const usuario = token ? await verificarToken(token) : null;
      if (!usuario) return res.status(401).json({ error: 'Faça login para continuar.', code: 'NAO_AUTENTICADO' });
      req.usuario = usuario;
      next();
    } catch (err) {
      console.error('[pagamentos] erro ao autenticar:', err.message);
      res.status(500).json({ error: 'Não foi possível verificar sua sessão.' });
    }
  }

  async function exigirAdmin(req, res, next) {
    try {
      if (!(await ehAdmin(req.usuario.id))) return res.status(403).json({ error: 'Acesso restrito ao administrador.', code: 'SEM_PERMISSAO' });
      next();
    } catch (err) {
      console.error('[pagamentos] erro ao verificar admin:', err.message);
      res.status(500).json({ error: 'Erro ao verificar permissão.' });
    }
  }

  const responder = (acao, sucesso = 200) => async (req, res) => {
    try {
      res.status(sucesso).json(await acao(req));
    } catch (err) {
      if (err instanceof PagamentoErro) return res.status(err.status).json({ error: err.message, code: err.code });
      console.error('[pagamentos] erro:', err.message);
      res.status(500).json({ error: 'Não foi possível concluir a operação de pagamento. Tente novamente.' });
    }
  };

  // Antes das rotas com :id. Responde 200 rapido; erro de processamento devolve
  // 500 para o Mercado Pago tentar de novo.
  router.post('/webhook', responder((req) => servico.processarNotificacao({
    headers: req.headers, query: req.query, body: req.body,
  })));

  router.post('/', autenticar, responder((req) => servico.criar({
    usuario: req.usuario, agendamentoId: req.body?.agendamento_id, metodo: req.body?.metodo,
  }), 201));

  router.post('/:id/sincronizar', autenticar, responder(async (req) => servico.sincronizar({
    usuario: req.usuario, pagamentoId: req.params.id, admin: await ehAdmin(req.usuario.id),
  })));

  router.post('/:id/reembolsar', autenticar, exigirAdmin, responder((req) => servico.reembolsar({
    usuario: req.usuario, pagamentoId: req.params.id, valor: req.body?.valor, motivo: req.body?.motivo,
  })));

  router.post('/cobrancas-abertas/cancelar', autenticar, exigirAdmin, responder((req) => servico.cancelarAbertas({
    agendamentoId: req.body?.agendamento_id,
  })));

  return router;
}

// Instancia real: banco com service role, token validado no Supabase Auth e
// Mercado Pago so se o access token estiver configurado
const supabaseServico = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function chamarSupabase(nome, args) {
  const { data, error } = await supabaseServico.rpc(nome, args);
  if (error) throw error; // { code: 'PT404', details: 'CODIGO', message }
  return data;
}

async function verificarToken(token) {
  const { data, error } = await supabaseServico.auth.getUser(token);
  return error ? null : data?.user ?? null;
}

async function ehAdmin(userId) {
  const { data, error } = await supabaseServico.from('user_roles').select('role').eq('user_id', userId).eq('role', 'admin');
  if (error) throw error;
  return (data ?? []).length > 0;
}

const accessToken = process.env.MERCADOPAGO_ACCESS_TOKEN;
const servico = criarServicoPagamentos({
  chamar: chamarSupabase,
  mp: accessToken ? criarMercadoPago({ accessToken }) : null,
  config: {
    segredoWebhook: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    urlNotificacao: process.env.MERCADOPAGO_NOTIFICATION_URL,
    urlRetorno: process.env.PAGAMENTO_RETORNO_URL,
    sandbox: process.env.MERCADOPAGO_AMBIENTE === 'teste',
    minutosPix: Number(process.env.PAGAMENTO_PIX_MINUTOS) || 30,
  },
});
if (!accessToken) console.warn('[pagamentos] MERCADOPAGO_ACCESS_TOKEN ausente: só o pagamento presencial está disponível.');

const router = criarRotasPagamentos({ servico, verificarToken, ehAdmin });

module.exports = { router, criarRotasPagamentos };
