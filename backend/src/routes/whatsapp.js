// Webhook da WhatsApp Business Platform (Cloud API oficial da Meta).
//
//   GET  /api/whatsapp/webhook   verificacao feita pela Meta ao cadastrar o
//        webhook: devolve hub.challenge se hub.verify_token conferir.
//   POST /api/whatsapp/webhook   respostas dos clientes (SIM/NAO, PARAR) e
//        estados de entrega. So e aceito com a assinatura X-Hub-Signature-256
//        (HMAC-SHA256 do corpo exato com o segredo do app). Quem chama nao
//        escolhe agendamento nem destinatario: o banco reconfere tudo.
//
// Com o WhatsApp desligado (services/notificacoesConfig.js), as duas rotas
// respondem 503 e nada e processado.

const crypto = require('node:crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { criarLimitador } = require('../services/limiteTaxa');
const { criarWhatsApp, assinaturaConfere, extrairEventos } = require('../services/whatsapp');
const { criarConfirmacaoPresenca } = require('../services/confirmacaoPresenca');
const { lerConfiguracao } = require('../services/notificacoesConfig');

// Comparacao em tempo constante (o hash iguala os tamanhos)
function textoConfere(recebido, esperado) {
  if (typeof recebido !== 'string' || recebido.length === 0 || !esperado) return false;
  const a = crypto.createHash('sha256').update(recebido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

function criarRotasWhatsapp({
  ativo,
  servico,
  appSecret,
  verifyToken,
  phoneNumberId,
  // Chamadas com assinatura invalida, por IP
  limiteFalhas = criarLimitador({ max: 20, janelaMs: 60 * 1000 }),
  log = console,
}) {
  const router = express.Router();

  function exigirAtivo(_req, res, next) {
    if (!ativo) return res.status(503).json({ error: 'WhatsApp desativado no servidor.', code: 'DESATIVADO' });
    next();
  }

  router.get('/webhook', exigirAtivo, (req, res) => {
    const desafio = req.query['hub.challenge'];
    if (req.query['hub.mode'] !== 'subscribe' || typeof desafio !== 'string' || !/^[\w.-]{1,200}$/.test(desafio)
        || !textoConfere(req.query['hub.verify_token'], verifyToken)) {
      return res.status(403).json({ error: 'Não autorizado.', code: 'NAO_AUTORIZADO' });
    }
    res.status(200).type('text/plain').send(desafio);
  });

  router.post('/webhook', exigirAtivo, async (req, res) => {
    if (!assinaturaConfere(req.rawBody, req.get('x-hub-signature-256'), appSecret)) {
      const dentro = limiteFalhas.consumir(`ip:${req.ip}`);
      if (dentro) log.warn('[whatsapp] webhook recusado: assinatura ausente ou invalida');
      return dentro
        ? res.status(401).json({ error: 'Não autorizado.', code: 'NAO_AUTORIZADO' })
        : res.status(429).json({ error: 'Muitas tentativas. Tente de novo em instantes.', code: 'LIMITE' });
    }
    try {
      const resumo = await servico.tratarEventos(extrairEventos(req.body, phoneNumberId));
      // Com falha ao gravar, a Meta entrega de novo; o que ja foi gravado e ignorado
      if (resumo.falhas > 0) return res.status(500).json({ error: 'Falha ao processar.', code: 'FALHA' });
      res.status(200).json({ recebido: true });
    } catch (e) {
      log.error(`[whatsapp] erro no webhook: ${String(e?.code ?? e?.name ?? 'erro').slice(0, 40)}`);
      res.status(500).json({ error: 'Falha ao processar.', code: 'FALHA' });
    }
  });

  return router;
}

// ---------------------------------------------------------------
// Instancia real: banco com service role e a Cloud API da Meta
// ---------------------------------------------------------------
const configuracao = lerConfiguracao();
const wa = configuracao.whatsapp;

const supabaseServico = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

async function chamarSupabase(nome, args) {
  const { data, error } = await supabaseServico.rpc(nome, args);
  if (error) throw error;
  return data;
}

const segundos = (valor, padrao) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

const servico = criarConfirmacaoPresenca({
  chamar: chamarSupabase,
  whatsapp: criarWhatsApp({
    token: wa.token,
    phoneNumberId: wa.phoneNumberId,
    versao: wa.versao,
    timeoutMs: segundos(process.env.NOTIFICACOES_TIMEOUT_SEGUNDOS, 10) * 1000,
  }),
  config: {
    templateConfirmacao: wa.templateConfirmacao,
    templatePresencaNegada: wa.templatePresencaNegada,
    idioma: wa.idioma,
    piloto: wa.piloto,
  },
});

const router = criarRotasWhatsapp({
  ativo: wa.ativo, servico, appSecret: wa.appSecret, verifyToken: wa.verifyToken, phoneNumberId: wa.phoneNumberId,
});

module.exports = { router, servico, configuracao, criarRotasWhatsapp, textoConfere };
