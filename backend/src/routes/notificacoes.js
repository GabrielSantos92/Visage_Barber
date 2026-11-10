// Notificacoes push (ver services/notificacoes.js e services/expoPush.js).
//
//   POST /api/notificacoes/processar  chamada pelo banco (pg_net) quando ha aviso
//        na fila. Exige o cabecalho X-Notificacoes-Segredo, igual a
//        NOTIFICACOES_SEGREDO. Nao recebe nem devolve dados: so faz o backend ler
//        a fila (quem recebe o que e decidido no banco, nunca por quem chama).
//   POST /api/notificacoes/teste      { dispositivo_id? } usuario logado: envia um
//        aviso de teste aos proprios aparelhos. Nao grava nada na fila.
//
// Desligado (NOTIFICACOES_ATIVAS diferente de "true"): as duas rotas respondem
// 503 e nada e enviado. Sem segredo valido, a rota do banco fica fechada.

const crypto = require('node:crypto');
const express = require('express');
const { createClient } = require('@supabase/supabase-js');
const { criarLimitador } = require('../services/limiteTaxa');
const { criarExpoPush } = require('../services/expoPush');
const { criarServicoNotificacoes, NotificacaoErro } = require('../services/notificacoes');

const SEGREDO_MINIMO = 32;
const segredoConfigurado = (segredo) => typeof segredo === 'string' && segredo.length >= SEGREDO_MINIMO;

// Comparacao em tempo constante (o hash iguala os tamanhos)
function segredoConfere(recebido, esperado) {
  if (typeof recebido !== 'string' || recebido.length === 0) return false;
  const a = crypto.createHash('sha256').update(recebido).digest();
  const b = crypto.createHash('sha256').update(esperado).digest();
  return crypto.timingSafeEqual(a, b);
}

function criarRotasNotificacoes({
  servico,
  verificarToken,
  segredo,
  ativo,
  // Chamadas autenticadas (so o banco tem o segredo): uma conta so, sem IP
  limiteProcessar = criarLimitador({ max: 120, janelaMs: 60 * 1000 }),
  // Tentativas sem segredo ou com segredo errado, por IP. Nao afeta as autenticadas.
  limiteFalhas = criarLimitador({ max: 20, janelaMs: 60 * 1000 }),
  limiteTeste = criarLimitador({ max: 3, janelaMs: 10 * 60 * 1000 }),
  log = console,
}) {
  const router = express.Router();

  function exigirAtivo(_req, res, next) {
    if (!ativo) return res.status(503).json({ error: 'Notificações desativadas no servidor.', code: 'DESATIVADO' });
    next();
  }

  async function autenticar(req, res, next) {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const usuario = token ? await verificarToken(token) : null;
      if (!usuario) return res.status(401).json({ error: 'Faça login para continuar.', code: 'NAO_AUTENTICADO' });
      req.usuario = usuario;
      next();
    } catch (err) {
      log.error('[notificacoes] erro ao autenticar:', err.message);
      res.status(500).json({ error: 'Não foi possível verificar sua sessão.' });
    }
  }

  // Chamada do banco: valida o segredo e so pede a leitura da fila. Responde
  // logo (202): o banco nao espera o envio.
  // O segredo e conferido ANTES de qualquer limite: tentativas invalidas tem
  // um limite proprio (por IP) e nunca gastam o limite das chamadas do banco.
  // O IP so serve para frear tentativas invalidas; nunca autentica ninguem.
  router.post('/processar', exigirAtivo, (req, res) => {
    if (!segredoConfigurado(segredo)) {
      return res.status(503).json({ error: 'Processamento de notificações não configurado.', code: 'NAO_CONFIGURADO' });
    }
    if (!segredoConfere(req.get('x-notificacoes-segredo'), segredo)) {
      const chave = `ip:${req.ip}`;
      const dentro = limiteFalhas.consumir(chave);
      // Um log por IP ate o limite; depois, silencio (evita inundar os logs)
      if (dentro) log.warn('[notificacoes] chamada de processamento recusada: segredo ausente ou errado');
      return dentro
        ? res.status(401).json({ error: 'Não autorizado.', code: 'NAO_AUTORIZADO' })
        : res.status(429).json({ error: 'Muitas tentativas. Tente de novo em instantes.', code: 'LIMITE' });
    }
    if (!limiteProcessar.consumir('autenticado')) {
      return res.status(429).json({ error: 'Muitas chamadas. Tente de novo em instantes.', code: 'LIMITE' });
    }
    servico.solicitarProcessamento().catch((e) => log.error('[notificacoes] falha no processamento:', e.message));
    res.status(202).json({ recebido: true });
  });

  router.post('/teste', exigirAtivo, autenticar, async (req, res) => {
    if (!limiteTeste.consumir(`usuario:${req.usuario.id}`)) {
      return res.status(429).json({ error: 'Muitos testes seguidos. Tente de novo em alguns minutos.', code: 'LIMITE' });
    }
    try {
      res.json(await servico.enviarTeste({ usuarioId: req.usuario.id, dispositivoId: req.body?.dispositivo_id ?? null }));
    } catch (err) {
      if (err instanceof NotificacaoErro) return res.status(err.status).json({ error: err.message, code: err.code });
      log.error('[notificacoes] erro no teste:', err.message);
      res.status(500).json({ error: 'Não foi possível enviar o teste. Tente novamente.' });
    }
  });

  return router;
}

// ---------------------------------------------------------------
// Instancia real: banco com service role, sessao validada no Supabase Auth
// ---------------------------------------------------------------
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

async function verificarToken(token) {
  const { data, error } = await supabaseServico.auth.getUser(token);
  return error ? null : data?.user ?? null;
}

// Aparelhos ativos do proprio usuario (para o teste)
async function buscarDispositivos(usuarioId, dispositivoId) {
  let consulta = supabaseServico.from('dispositivos_push')
    .select('id, token, plataforma')
    .eq('user_id', usuarioId)
    .eq('ativo', true)
    .order('criado_em');
  if (dispositivoId) consulta = consulta.eq('id', dispositivoId);
  const { data, error } = await consulta;
  if (error) throw error;
  return data ?? [];
}

const segundos = (valor, padrao) => {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : padrao;
};

const ativo = process.env.NOTIFICACOES_ATIVAS === 'true';
const servico = criarServicoNotificacoes({
  chamar: chamarSupabase,
  expo: criarExpoPush({
    accessToken: process.env.EXPO_ACCESS_TOKEN || null,
    timeoutMs: segundos(process.env.NOTIFICACOES_TIMEOUT_SEGUNDOS, 10) * 1000,
  }),
  buscarDispositivos,
});

const router = criarRotasNotificacoes({ servico, verificarToken, segredo: process.env.NOTIFICACOES_SEGREDO, ativo });

// Chamado pelo app.js depois de subir o servidor
function iniciarNotificacoes() {
  if (!ativo) {
    console.log('[notificacoes] desligadas (NOTIFICACOES_ATIVAS diferente de "true"): nada sera enviado.');
    return;
  }
  if (!segredoConfigurado(process.env.NOTIFICACOES_SEGREDO)) {
    console.warn(`[notificacoes] NOTIFICACOES_SEGREDO ausente ou com menos de ${SEGREDO_MINIMO} caracteres: `
      + 'o banco nao consegue acordar o backend; a fila so e lida enquanto o servidor estiver acordado.');
  }
  if (!process.env.EXPO_ACCESS_TOKEN) {
    console.warn('[notificacoes] EXPO_ACCESS_TOKEN ausente: se a seguranca de push estiver ligada na Expo, os envios serao recusados.');
  }
  servico.iniciar(segundos(process.env.NOTIFICACOES_INTERVALO_SEGUNDOS, 20) * 1000);
}

module.exports = { router, iniciarNotificacoes, criarRotasNotificacoes, segredoConfere, SEGREDO_MINIMO };
