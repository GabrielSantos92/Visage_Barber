// Cliente da WhatsApp Business Platform (Cloud API oficial da Meta), sem SDK.
//
//   enviarTemplate({ para, template, idioma, parametros, botoes })
//   enviarTexto({ para, texto })        so dentro da janela de 24 h (resposta)
//
// Todo envio devolve um destes resultados (nunca lanca):
//   { status: 'aceito', wamid, wa_id }  a Meta aceitou a mensagem
//   { status: 'recusado', erro }        recusa definitiva (numero sem WhatsApp,
//                                       template invalido, token recusado...)
//   { status: 'erro', erro }            a Meta respondeu que NAO enviou e vale
//                                       tentar de novo (limite de taxa, fora do ar)
//   { status: 'incerto', erro }         sem resposta confiavel: pode ter saido
//
// A Cloud API nao tem chave de idempotencia: quem chama nunca reenvia um
// resultado "incerto". `erro` leva so o codigo, nunca o texto da Meta (que pode
// repetir o numero do destinatario). O token e os numeros nunca vao para o log.

const crypto = require('node:crypto');

const VERSAO_PADRAO = 'v23.0';
// Codigos da Meta que dizem "nao enviado agora, tente depois"
const CODIGOS_TEMPORARIOS = new Set([4, 80007, 130429, 131048, 131056, 131016]);
// Falhas de rede em que o pedido nem chegou a sair
const REDE_SEM_ENVIO = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

// Texto de parametro de template: a Meta recusa quebras de linha, tabulacoes e
// mais de quatro espacos seguidos
const limpar = (texto, max = 60) => String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || '-';

function criarWhatsApp({
  token,
  phoneNumberId,
  versao = VERSAO_PADRAO,
  timeoutMs = 10000,
  fetch: fetchImpl = globalThis.fetch,
  base = 'https://graph.facebook.com',
}) {
  const url = `${base}/${versao}/${phoneNumberId}/messages`;

  async function enviar(corpo) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeoutMs);
    let resposta;
    try {
      resposta = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', recipient_type: 'individual', ...corpo }),
        signal: controle.signal,
      });
    } catch (e) {
      const codigo = String(e?.cause?.code ?? e?.code ?? '');
      if (REDE_SEM_ENVIO.has(codigo)) return { status: 'erro', erro: codigo };
      return { status: 'incerto', erro: e?.name === 'AbortError' ? 'timeout' : (codigo || 'rede').slice(0, 40) };
    } finally {
      clearTimeout(timer);
    }

    let json = null;
    try {
      json = await resposta.json();
    } catch {
      json = null;
    }
    if (resposta.ok) {
      const wamid = json?.messages?.[0]?.id;
      if (typeof wamid !== 'string' || !wamid) return { status: 'incerto', erro: 'resposta_sem_id' };
      const waId = json?.contacts?.[0]?.wa_id;
      return { status: 'aceito', wamid, wa_id: typeof waId === 'string' ? waId : null };
    }
    const codigo = Number(json?.error?.code);
    const erro = Number.isFinite(codigo) ? String(codigo) : `http_${resposta.status}`;
    if (resposta.status === 429 || resposta.status === 503 || CODIGOS_TEMPORARIOS.has(codigo)) return { status: 'erro', erro };
    // Erro do servidor sem dizer se enviou: nao arrisca repetir
    if (resposta.status >= 500) return { status: 'incerto', erro };
    return { status: 'recusado', erro };
  }

  return {
    // parametros: textos do corpo, na ordem; botoes: payload de cada resposta rapida
    enviarTemplate({ para, template, idioma = 'pt_BR', parametros = [], botoes = [] }) {
      const components = [];
      if (parametros.length) {
        components.push({ type: 'body', parameters: parametros.map((t) => ({ type: 'text', text: limpar(t) })) });
      }
      botoes.forEach((payload, i) => components.push({
        type: 'button', sub_type: 'quick_reply', index: String(i), parameters: [{ type: 'payload', payload }],
      }));
      return enviar({ to: para, type: 'template', template: { name: template, language: { code: idioma }, components } });
    },
    enviarTexto({ para, texto }) {
      return enviar({ to: para, type: 'text', text: { preview_url: false, body: String(texto).slice(0, 1000) } });
    },
  };
}

// Assinatura do webhook: X-Hub-Signature-256 = "sha256=" + HMAC-SHA256(corpo
// bruto, segredo do app). Comparacao em tempo constante.
function assinaturaConfere(corpoBruto, cabecalho, segredoDoApp) {
  if (!Buffer.isBuffer(corpoBruto) || typeof cabecalho !== 'string' || !segredoDoApp) return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(cabecalho.trim());
  if (!m) return false;
  const esperado = crypto.createHmac('sha256', segredoDoApp).update(corpoBruto).digest();
  return crypto.timingSafeEqual(esperado, Buffer.from(m[1], 'hex'));
}

const STATUS_DA_META = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' };

// Tira do corpo do webhook so o que o sistema usa. Ignora o que for de outro
// numero da empresa (phone_number_id diferente) e qualquer formato inesperado.
//   mensagens: [{ id, de, tipo: 'botao' | 'texto', payload, contexto, texto }]
//   status:    [{ wamid, status, erro }]
function extrairEventos(corpo, phoneNumberId) {
  const mensagens = [];
  const status = [];
  if (corpo?.object !== 'whatsapp_business_account' || !Array.isArray(corpo.entry)) return { mensagens, status };
  for (const entrada of corpo.entry) {
    for (const mudanca of Array.isArray(entrada?.changes) ? entrada.changes : []) {
      const v = mudanca?.value;
      if (mudanca?.field !== 'messages' || !v) continue;
      if (phoneNumberId && String(v.metadata?.phone_number_id ?? '') !== String(phoneNumberId)) continue;
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (typeof m?.id !== 'string' || typeof m?.from !== 'string') continue;
        const contexto = typeof m.context?.id === 'string' ? m.context.id : null;
        if (m.type === 'button' && typeof m.button?.payload === 'string') {
          mensagens.push({ id: m.id, de: m.from, tipo: 'botao', payload: m.button.payload, contexto, texto: null });
        } else if (m.type === 'interactive' && typeof m.interactive?.button_reply?.id === 'string') {
          mensagens.push({ id: m.id, de: m.from, tipo: 'botao', payload: m.interactive.button_reply.id, contexto, texto: null });
        } else if (m.type === 'text' && typeof m.text?.body === 'string') {
          mensagens.push({ id: m.id, de: m.from, tipo: 'texto', payload: null, contexto, texto: m.text.body.slice(0, 200) });
        }
      }
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        const estado = STATUS_DA_META[s?.status];
        if (typeof s?.id !== 'string' || !estado) continue;
        const codigo = Number(s.errors?.[0]?.code);
        status.push({ wamid: s.id, status: estado, erro: Number.isFinite(codigo) ? String(codigo) : null });
      }
    }
  }
  return { mensagens, status };
}

module.exports = { criarWhatsApp, assinaturaConfere, extrairEventos, limpar, VERSAO_PADRAO };
