// Cliente da WhatsApp Business Platform (Cloud API oficial da Meta), sem SDK.
//
//   enviarTemplate({ para, template, idioma, parametros, botoes })
//   enviarTexto({ para, texto })        so dentro da janela de 24 h (resposta)
//   enviarBotoes({ para, texto, rodape, botoes: [{ id, titulo }] })
//                                       mensagem interativa com botoes de
//                                       resposta; tambem so dentro da janela
//                                       de 24 h aberta pela mensagem do cliente
//
// Todo envio devolve um destes resultados (nunca lanca):
//   { status: 'aceito', wamid, wa_id }       a Meta aceitou a mensagem
//   { status: 'recusado', erro, categoria }  recusa definitiva: nao tenta de novo
//   { status: 'erro', erro, categoria }      a Meta respondeu que NAO enviou; vale
//                                            tentar de novo (com espera, no prazo)
//   { status: 'incerto', erro, categoria }   sem resposta confiavel: pode ter saido
//
// `categoria` (classificarErroMeta) separa o motivo; `erro` = "categoria:codigo"
// (ex.: janela_fechada:131047), gravado no banco como motivo:
//   temporario      limite de taxa, servico fora do ar, erro desconhecido que a
//                   Meta manda repetir (131000): status 'erro'
//   janela_fechada  131047: mais de 24 h desde a ultima mensagem do cliente;
//                   so template chega. Definitivo para esta mensagem
//   autenticacao    token invalido, vencido ou sem permissao: status 'erro' (a
//                   mensagem nao saiu) e quem chama PAUSA o canal
//   conta           numero ou conta da Meta restritos, sem pagamento, nao
//                   registrados: igual a autenticacao (pausa o canal)
//   configuracao    template ou parametros errados (nosso pedido): definitivo
//   destinatario    numero sem WhatsApp, bloqueou a empresa etc.: definitivo
//   definitivo      outro erro 4xx sem codigo conhecido: definitivo
//   incerto         timeout, falha de rede depois de enviar, 5xx sem codigo
//                   conhecido, resposta sem id: NUNCA reenviado
// A Cloud API nao tem chave de idempotencia: quem chama nunca reenvia um
// resultado "incerto". `erro` leva so o codigo, nunca o texto da Meta (que pode
// repetir o numero do destinatario). O token e os numeros nunca vao para o log.

const crypto = require('node:crypto');

const VERSAO_PADRAO = 'v23.0';

// Codigos de erro da Cloud API por categoria (documentacao oficial, "Error
// codes": developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes)
const CODIGOS_META = {
  // A Meta manda tentar de novo depois (limites de taxa, fora do ar, manutencao)
  temporario: [2, 4, 80007, 130429, 131000, 131016, 131056, 131057, 133004, 2494100],
  janela_fechada: [131047],
  // 200 a 299 tambem (permissoes): ver categoriaDoCodigo
  autenticacao: [0, 3, 10, 190, 131005],
  conta: [33, 368, 130497, 131031, 131037, 131042, 131045, 131048, 131064, 133010],
  configuracao: [100, 131008, 131009, 131051, 131053, 132000, 132001, 132005, 132007, 132012, 132015, 132016,
    132018, 132068, 132069, 135000],
  destinatario: [130403, 130472, 131021, 131026, 131049, 131050, 131052],
};
const CATEGORIA_DO_CODIGO = new Map(
  Object.entries(CODIGOS_META).flatMap(([categoria, codigos]) => codigos.map((c) => [c, categoria])),
);
// Categorias que nao sao do pedido, e sim do canal: o envio para (pausa)
const CATEGORIAS_QUE_PAUSAM = new Set(['autenticacao', 'conta']);

function categoriaDoCodigo(codigo) {
  if (!Number.isFinite(codigo)) return null;
  if (codigo >= 200 && codigo <= 299) return 'autenticacao';
  return CATEGORIA_DO_CODIGO.get(codigo) ?? null;
}

// { status, categoria } de uma resposta de erro da Meta (codigo do corpo e
// status HTTP). O codigo conhecido decide; sem ele, o HTTP: 429/503 =
// temporario, 5xx = incerto (nao se sabe se enviou), 4xx = definitivo.
function classificarErroMeta({ codigo, http = null }) {
  const categoria = categoriaDoCodigo(codigo);
  if (categoria) {
    const status = categoria === 'temporario' || CATEGORIAS_QUE_PAUSAM.has(categoria) ? 'erro' : 'recusado';
    return { status, categoria };
  }
  if (http === 429 || http === 503) return { status: 'erro', categoria: 'temporario' };
  if (http === null || http >= 500) return { status: 'incerto', categoria: 'incerto' };
  return { status: 'recusado', categoria: 'definitivo' };
}

// Falhas de rede em que o pedido nem chegou a sair
const REDE_SEM_ENVIO = new Set(['ENOTFOUND', 'ECONNREFUSED', 'EAI_AGAIN']);

// Texto de parametro de template: a Meta recusa quebras de linha, tabulacoes e
// mais de quatro espacos seguidos
const limpar = (texto, max = 60) => String(texto ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || '-';

// Limites da mensagem interativa com botoes de resposta (documentacao da
// Cloud API, "Interactive reply buttons messages"): ate 3 botoes, titulo de
// ate 20 caracteres (unico), id de ate 256, corpo de ate 1024, rodape de ate 60
const LIMITES_BOTOES = { botoes: 3, titulo: 20, id: 256, corpo: 1024, rodape: 60 };

// Fora dos limites nao chega a Meta: cortar um titulo mudaria o que o cliente le
function botoesValidos({ texto, rodape, botoes }) {
  if (typeof texto !== 'string' || !texto.trim() || texto.length > LIMITES_BOTOES.corpo) return false;
  if (rodape != null && (typeof rodape !== 'string' || rodape.length > LIMITES_BOTOES.rodape)) return false;
  if (!Array.isArray(botoes) || botoes.length === 0 || botoes.length > LIMITES_BOTOES.botoes) return false;
  const titulos = new Set(botoes.map((b) => b?.titulo));
  return titulos.size === botoes.length && botoes.every((b) => typeof b?.id === 'string' && b.id.length > 0
    && b.id.length <= LIMITES_BOTOES.id && typeof b.titulo === 'string' && b.titulo.trim().length > 0
    && [...b.titulo].length <= LIMITES_BOTOES.titulo);
}

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
      if (REDE_SEM_ENVIO.has(codigo)) return { status: 'erro', erro: `temporario:${codigo}`, categoria: 'temporario' };
      const motivo = e?.name === 'AbortError' ? 'timeout' : (codigo || 'rede').slice(0, 40);
      return { status: 'incerto', erro: `incerto:${motivo}`, categoria: 'incerto' };
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
      if (typeof wamid !== 'string' || !wamid) return { status: 'incerto', erro: 'incerto:resposta_sem_id', categoria: 'incerto' };
      const waId = json?.contacts?.[0]?.wa_id;
      return { status: 'aceito', wamid, wa_id: typeof waId === 'string' ? waId : null };
    }
    // Erro do servidor sem codigo conhecido: nao se sabe se enviou (incerto)
    const codigo = json?.error?.code == null ? NaN : Number(json.error.code);
    const { status, categoria } = classificarErroMeta({ codigo, http: resposta.status });
    const erro = `${categoria}:${Number.isFinite(codigo) ? codigo : `http_${resposta.status}`}`;
    return { status, erro, categoria };
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
    // Botoes de resposta: o toque volta pelo webhook como interactive.button_reply
    // com o mesmo id e com context.id = o wamid desta mensagem
    async enviarBotoes({ para, texto, rodape = null, botoes }) {
      if (!botoesValidos({ texto, rodape, botoes })) return { status: 'recusado', erro: 'configuracao:botoes_invalidos', categoria: 'configuracao' };
      return enviar({
        to: para,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: texto },
          ...(rodape ? { footer: { text: rodape } } : {}),
          action: { buttons: botoes.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.titulo } })) },
        },
      });
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

// Numero para comparacao, igual a public.whatsapp_chave_numero (migration 25):
// so digitos, e o celular brasileiro sem o 9 inicial, porque a Meta pode
// devolver o numero sem ele. Os dois formatos viram a mesma chave.
function chaveNumero(numero) {
  const d = String(numero ?? '').replace(/\D/g, '');
  if (/^55[1-9][1-9]9\d{8}$/.test(d)) return d.slice(0, 4) + d.slice(5);
  return d || null;
}

const STATUS_DA_META = { sent: 'enviado', delivered: 'entregue', read: 'lido', failed: 'falhou' };

// Tira do corpo do webhook so o que o sistema usa. Ignora o que for de outro
// numero da empresa (phone_number_id diferente) e qualquer formato inesperado.
//   mensagens: [{ id, de, tipo: 'botao' | 'texto', payload, contexto, texto }]
//   status:    [{ wamid, status, erro, categoria }]  (erro so na falha)
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
        // Falha informada depois do envio: a mensagem nao chegou. O codigo
        // vira "categoria:codigo", como nas respostas do envio
        const bruto = s.errors?.[0]?.code;
        const codigo = bruto == null ? NaN : Number(bruto);
        let erro = null;
        let categoria = null;
        if (estado === 'falhou') {
          categoria = categoriaDoCodigo(codigo) ?? 'definitivo';
          erro = `${categoria}:${Number.isFinite(codigo) ? codigo : 'sem_codigo'}`;
        }
        status.push({ wamid: s.id, status: estado, erro, categoria });
      }
    }
  }
  return { mensagens, status };
}

module.exports = {
  criarWhatsApp, assinaturaConfere, extrairEventos, chaveNumero, limpar, botoesValidos, classificarErroMeta,
  categoriaDoCodigo, LIMITES_BOTOES, VERSAO_PADRAO, CODIGOS_META, CATEGORIAS_QUE_PAUSAM,
};
