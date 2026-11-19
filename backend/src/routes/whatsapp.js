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
// respondem 503 e nada e processado. Ligado, elas (como todo /api) so atendem
// depois de conferido QUAL banco esta conectado (services/ambienteServidor.js,
// no app.js): o modo teste exige o banco de teste marcado, e producao recusa
// um banco de teste. O WhatsApp so liga com WHATSAPP_AMBIENTE igual a
// BACKEND_AMBIENTE. So os eventos do Phone Number ID do ambiente ligado
// (producao ou teste) sao lidos; no modo teste, mensagens de numeros fora de
// WHATSAPP_TESTE_DESTINATARIOS sao ignoradas.

const crypto = require('node:crypto');
const express = require('express');
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
  // ativo: valor fixo ou funcao (ligado so depois de conferir o banco)
  const ligado = () => (typeof ativo === 'function' ? ativo() : ativo);

  function exigirAtivo(_req, res, next) {
    if (!ligado()) return res.status(503).json({ error: 'WhatsApp desativado no servidor.', code: 'DESATIVADO' });
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
// Instancia real: o cliente Supabase unico (protegido pela conferencia do
// ambiente) e a Cloud API da Meta
// ---------------------------------------------------------------
const { chamar: chamarSupabase } = require('../services/supabaseServico');

const configuracao = lerConfiguracao();
const wa = configuracao.whatsapp;

const segundos = (valor, padrao) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

// Monta o servico a partir da configuracao do ambiente escolhido
// (lerConfiguracao().whatsapp): o numero, o token e os templates sao sempre os
// do mesmo ambiente, e no modo teste vai junto a lista de destinatarios.
function criarServicoWhatsapp(waConfig, { chamar, fetch, timeoutMs = 10000, log } = {}) {
  return criarConfirmacaoPresenca({
    chamar,
    whatsapp: criarWhatsApp({
      token: waConfig.token,
      phoneNumberId: waConfig.phoneNumberId,
      versao: waConfig.versao,
      timeoutMs,
      ...(fetch ? { fetch } : {}),
    }),
    config: {
      templateConfirmacao: waConfig.templateConfirmacao,
      templatePresencaNegada: waConfig.templatePresencaNegada,
      templateCancelamento: waConfig.templateCancelamento,
      templateCancelamentoNaoConcluido: waConfig.templateCancelamentoNaoConcluido,
      templateNovoAgendamentoCliente: waConfig.templateNovoAgendamentoCliente,
      templateNovoAgendamentoBarbeiro: waConfig.templateNovoAgendamentoBarbeiro,
      templateCancelamentoCliente: waConfig.templateCancelamentoCliente,
      templateCancelamentoBarbeiro: waConfig.templateCancelamentoBarbeiro,
      idioma: waConfig.idioma,
      piloto: waConfig.piloto,
      destinatariosTeste: waConfig.destinatariosTeste,
    },
    ...(log ? { log } : {}),
  });
}

const servico = criarServicoWhatsapp(wa, {
  chamar: chamarSupabase,
  timeoutMs: segundos(process.env.NOTIFICACOES_TIMEOUT_SEGUNDOS, 10) * 1000,
});

const router = criarRotasWhatsapp({
  ativo: wa.ativo, servico, appSecret: wa.appSecret, verifyToken: wa.verifyToken, phoneNumberId: wa.phoneNumberId,
});

module.exports = { router, servico, configuracao, criarRotasWhatsapp, criarServicoWhatsapp, textoConfere };
