// Mercado Pago: cobranca PIX (API de Orders), Checkout Pro (cartao), consulta,
// cancelamento e reembolso pela API REST oficial, mais a validacao da
// assinatura do webhook.
//
// O access token fica so no backend (MERCADOPAGO_ACCESS_TOKEN). O cartao e
// digitado na pagina do proprio Mercado Pago (Checkout Pro): o numero nunca
// passa pelo app nem por este servidor.
//
// Documentacao: https://www.mercadopago.com.br/developers/pt/reference
//   POST /v1/orders                   (PIX: payment_method pix / bank_transfer)
//   GET  /v1/orders/{id}, POST /v1/orders/{id}/cancel, POST /v1/orders/{id}/refund
//   POST /checkout/preferences        (Checkout Pro: cartao)
//   GET  /v1/payments/{id}, /v1/payments/search
//   POST /v1/payments/{id}/refunds
//
// O PIX usa a API de Orders porque as credenciais de teste das contas novas
// (APP_USR- de usuario de teste) sao recusadas no POST /v1/payments com
// "Unauthorized use of live credentials" (conferido em 15/11/2026).
//   Webhooks: cabecalho x-signature "ts=...,v1=..." = HMAC-SHA256 do manifesto
//   "id:{data.id};request-id:{x-request-id};ts:{ts};" com a chave secreta.

const crypto = require('node:crypto');

const API = 'https://api.mercadopago.com';

// `codigo`: o codigo do erro na API de Orders (ex.: order_already_canceled)
class MercadoPagoErro extends Error {
  constructor(status, message, codigo = null) {
    super(message);
    this.status = status;
    this.codigo = codigo;
  }
}

const enc = encodeURIComponent;
const reais = (v) => Number(v).toFixed(2);

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
    if (!r.ok) {
      const erro = dados.errors?.[0] ?? {};
      const codigo = erro.code ?? dados.error ?? null;
      const texto = dados.message ?? erro.message ?? `Mercado Pago respondeu ${r.status}`;
      throw new MercadoPagoErro(r.status, codigo && !texto.includes(codigo) ? `${texto} (${codigo})` : texto, codigo);
    }
    return dados;
  }

  return {
    // PIX pela API de Orders. A chave de idempotencia e o id do nosso pagamento:
    // uma repeticao do pedido nao cria outra cobranca (a API responde 409).
    // `minutos`: validade do QR Code (o Mercado Pago aceita de 30 min a 30 dias).
    async criarPix({ idempotencia, valor, email, referencia, minutos }) {
      const o = await chamar('POST', '/v1/orders', {
        type: 'online',
        processing_mode: 'automatic',
        external_reference: referencia,
        total_amount: reais(valor),
        payer: { email },
        transactions: {
          payments: [{
            amount: reais(valor),
            payment_method: { id: 'pix', type: 'bank_transfer' },
            expiration_time: `PT${minutos}M`,
          }],
        },
      }, idempotencia);
      const p = o.transactions?.payments?.[0] ?? {};
      return {
        id: String(o.id),
        status: o.status,
        copiaCola: p.payment_method?.qr_code,
        qrBase64: p.payment_method?.qr_code_base64,
        expiraEm: p.date_of_expiration ?? null,
      };
    },

    buscarPedido: (id) => chamar('GET', `/v1/orders/${enc(id)}`),

    // Pedido ja cancelado conta como cancelado
    async cancelarPedido(id) {
      try {
        await chamar('POST', `/v1/orders/${enc(id)}/cancel`, undefined, crypto.randomUUID());
      } catch (e) {
        if (e.codigo !== 'order_already_canceled') throw e;
      }
    },

    // Sem valor: reembolso total. O parcial precisa do id do pagamento dentro do pedido.
    async reembolsarPedido(id, valor, idempotencia) {
      let corpo;
      if (valor != null) {
        const o = await chamar('GET', `/v1/orders/${enc(id)}`);
        corpo = { transactions: [{ id: o.transactions?.payments?.[0]?.id, amount: reais(valor) }] };
      }
      const r = await chamar('POST', `/v1/orders/${enc(id)}/refund`, corpo, idempotencia);
      const ultimo = (r.transactions?.refunds ?? []).at(-1);
      return { id: ultimo?.id ?? null };
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

    buscarPagamento: (id) => chamar('GET', `/v1/payments/${enc(id)}`),

    async buscarPorReferencia(referencia) {
      const r = await chamar('GET', `/v1/payments/search?sort=date_created&criteria=desc&external_reference=${encodeURIComponent(referencia)}`);
      return r.results ?? [];
    },

    expirarPreferencia: (id) => chamar('PUT', `/checkout/preferences/${enc(id)}`, {
      expires: true, expiration_date_to: dataComFuso(new Date()),
    }),

    // Sem valor: reembolso total
    reembolsar: (id, valor, idempotencia) => chamar('POST', `/v1/payments/${enc(id)}/refunds`,
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

// Estado do pedido (API de Orders, usado no PIX) -> estado no nosso banco.
// O pedido nao informa a taxa: ela fica como esta no banco.
function estadoDoPedido(o) {
  const pagamento = o.transactions?.payments?.[0] ?? {};
  const detalhe = o.status_detail ?? pagamento.status_detail ?? null;
  const valor = Number(o.total_amount);
  let reembolsos = (o.transactions?.refunds ?? [])
    .filter((r) => !['failed', 'rejected', 'canceled', 'cancelled'].includes(r.status))
    .map((r) => ({ id: String(r.id), valor: Number(r.amount), data: r.date_created ?? null }));
  let reembolsado = Math.round(reembolsos.reduce((s, r) => s + r.valor, 0) * 100) / 100;
  let status;
  switch (o.status) {
    case 'processed':
      status = detalhe === 'partially_refunded' || reembolsado > 0 ? 'partially_refunded' : 'approved';
      break;
    case 'refunded':
      status = 'refunded';
      reembolsado = valor;
      break;
    case 'charged_back':
      status = 'refunded';
      if (!reembolsos.length) reembolsos = [{ id: `chargeback-${o.id}`, valor, data: o.last_updated_date ?? null }];
      reembolsado = valor;
      break;
    case 'failed':
      status = detalhe === 'expired' ? 'expired' : 'rejected';
      break;
    case 'canceled':
    case 'cancelled':
      status = detalhe === 'expired' ? 'expired' : 'canceled';
      break;
    case 'expired':
      status = 'expired';
      break;
    default:
      // created, processing, action_required
      status = 'pending';
  }
  const pago = ['approved', 'partially_refunded', 'refunded'].includes(status);
  return {
    status,
    provedor_pagamento_id: String(o.id),
    valor,
    taxa: null,
    valor_reembolsado: reembolsado,
    aprovado_em: pago ? pagamento.date_approved ?? o.last_updated_date ?? null : null,
    detalhe,
    reembolsos,
  };
}

module.exports = { criarMercadoPago, validarAssinatura, estadoDoMercadoPago, estadoDoPedido, MercadoPagoErro };
