// Mercado Pago: cobranca PIX, Checkout Pro (cartao), consulta, cancelamento e
// reembolso pela API REST oficial, mais a validacao da assinatura do webhook.
//
// O access token fica so no backend (MERCADOPAGO_ACCESS_TOKEN). O cartao e
// digitado na pagina do proprio Mercado Pago (Checkout Pro): o numero nunca
// passa pelo app nem por este servidor.
//
// Documentacao: https://www.mercadopago.com.br/developers/pt/reference
//   POST /v1/payments                 (PIX: payment_method_id "pix")
//   POST /checkout/preferences        (Checkout Pro)
//   GET  /v1/payments/{id}, /v1/payments/search
//   POST /v1/payments/{id}/refunds
//   Webhooks: cabecalho x-signature "ts=...,v1=..." = HMAC-SHA256 do manifesto
//   "id:{data.id};request-id:{x-request-id};ts:{ts};" com a chave secreta.

const crypto = require('node:crypto');

const API = 'https://api.mercadopago.com';

class MercadoPagoErro extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// O Mercado Pago espera data com fuso (yyyy-MM-ddTHH:mm:ss.SSS+00:00)
const dataComFuso = (d) => d.toISOString().replace('Z', '+00:00');

function criarMercadoPago({ accessToken, fetch: fazerFetch = fetch }) {
  async function chamar(metodo, caminho, corpo, idempotencia) {
    const r = await fazerFetch(`${API}${caminho}`, {
      method: metodo,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        ...(idempotencia ? { 'X-Idempotency-Key': idempotencia } : {}),
      },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
    });
    const dados = await r.json().catch(() => ({}));
    if (!r.ok) throw new MercadoPagoErro(r.status, dados.message ?? `Mercado Pago respondeu ${r.status}`);
    return dados;
  }

  return {
    // A chave de idempotencia (id do nosso pagamento) faz uma repeticao do
    // pedido devolver a mesma cobranca em vez de criar outra
    async criarPix({ idempotencia, valor, descricao, email, referencia, expiraEm, urlNotificacao }) {
      const p = await chamar('POST', '/v1/payments', {
        transaction_amount: Number(valor),
        description: descricao,
        payment_method_id: 'pix',
        payer: { email },
        external_reference: referencia,
        date_of_expiration: dataComFuso(expiraEm),
        ...(urlNotificacao ? { notification_url: urlNotificacao } : {}),
      }, idempotencia);
      const dados = p.point_of_interaction?.transaction_data ?? {};
      return { id: String(p.id), status: p.status, copiaCola: dados.qr_code, qrBase64: dados.qr_code_base64 };
    },

    // Checkout Pro so com cartao de credito
    async criarPreferenciaCartao({ referencia, titulo, valor, email, urlNotificacao, urlRetorno, expiraEm, sandbox }) {
      const https = typeof urlRetorno === 'string' && urlRetorno.startsWith('https://');
      const p = await chamar('POST', '/checkout/preferences', {
        items: [{ id: referencia, title: titulo, quantity: 1, unit_price: Number(valor), currency_id: 'BRL' }],
        payer: { email },
        external_reference: referencia,
        payment_methods: {
          excluded_payment_types: [{ id: 'ticket' }, { id: 'bank_transfer' }, { id: 'atm' }, { id: 'debit_card' }, { id: 'prepaid_card' }],
          installments: 1,
        },
        expires: true,
        expiration_date_to: dataComFuso(expiraEm),
        ...(urlNotificacao ? { notification_url: urlNotificacao } : {}),
        ...(urlRetorno ? { back_urls: { success: urlRetorno, pending: urlRetorno, failure: urlRetorno } } : {}),
        // auto_return so e aceito com endereco https
        ...(https ? { auto_return: 'approved' } : {}),
      });
      return { id: String(p.id), link: (sandbox && p.sandbox_init_point) || p.init_point };
    },

    buscarPagamento: (id) => chamar('GET', `/v1/payments/${encodeURIComponent(id)}`),

    async buscarPorReferencia(referencia) {
      const r = await chamar('GET', `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(referencia)}`);
      return r.results ?? [];
    },

    cancelarPagamento: (id) => chamar('PUT', `/v1/payments/${encodeURIComponent(id)}`, { status: 'cancelled' }),

    expirarPreferencia: (id) => chamar('PUT', `/checkout/preferences/${encodeURIComponent(id)}`, {
      expires: true, expiration_date_to: dataComFuso(new Date()),
    }),

    // Sem valor: reembolso total
    reembolsar: (id, valor, idempotencia) => chamar('POST', `/v1/payments/${encodeURIComponent(id)}/refunds`,
      valor == null ? {} : { amount: Number(valor) }, idempotencia),
  };
}

// Valida a notificacao (webhook) pela chave secreta configurada no painel.
// data.id alfanumerico vai em minusculas, como manda a documentacao.
function validarAssinatura({ assinatura, requestId, dataId, segredo }) {
  if (!assinatura || !segredo || !dataId) return false;
  const partes = {};
  for (const trecho of String(assinatura).split(',')) {
    const [chave, ...resto] = trecho.split('=');
    if (chave && resto.length) partes[chave.trim()] = resto.join('=').trim();
  }
  if (!partes.ts || !partes.v1) return false;
  const id = /^[a-z0-9]+$/i.test(dataId) ? String(dataId).toLowerCase() : String(dataId);
  const manifesto = `id:${id};${requestId ? `request-id:${requestId};` : ''}ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
  const recebido = Buffer.from(partes.v1);
  return recebido.length === esperado.length && crypto.timingSafeEqual(recebido, Buffer.from(esperado));
}

// Estado do pagamento no Mercado Pago -> estado no nosso banco
function estadoDoMercadoPago(p) {
  const detalhe = p.status_detail ?? null;
  const valor = Number(p.transaction_amount);
  let reembolsado = Number(p.transaction_amount_refunded ?? 0);
  let reembolsos = (p.refunds ?? []).map((r) => ({ id: String(r.id), valor: Number(r.amount), data: r.date_created ?? null }));
  let status;
  switch (p.status) {
    case 'approved':
      status = detalhe === 'partially_refunded' || reembolsado > 0 ? 'partially_refunded' : 'approved';
      break;
    case 'refunded':
      status = 'refunded';
      break;
    case 'charged_back':
      // Estorno pela operadora do cartao: o dinheiro voltou ao cliente
      status = 'refunded';
      if (!reembolsos.length) reembolsos = [{ id: `chargeback-${p.id}`, valor, data: p.date_last_updated ?? null }];
      reembolsado = valor;
      break;
    case 'rejected':
      status = 'rejected';
      break;
    case 'cancelled':
      status = detalhe === 'expired' ? 'expired' : 'canceled';
      break;
    default:
      // pending, in_process, authorized, in_mediation
      status = 'pending';
  }
  const taxa = (p.fee_details ?? []).reduce((s, f) => s + Number(f.amount ?? 0), 0);
  return {
    status,
    provedor_pagamento_id: String(p.id),
    valor,
    taxa: Math.round(taxa * 100) / 100,
    valor_reembolsado: reembolsado,
    aprovado_em: p.date_approved ?? null,
    detalhe,
    reembolsos,
  };
}

module.exports = { criarMercadoPago, validarAssinatura, estadoDoMercadoPago, MercadoPagoErro };
