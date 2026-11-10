// Servico de push da Expo (envio para Android pelo FCM, por baixo).
// Documentacao: https://docs.expo.dev/push-notifications/sending-notifications/
//   POST https://exp.host/--/api/v2/push/send         ate 100 mensagens por pedido;
//        devolve um ticket por mensagem, na mesma ordem
//   POST https://exp.host/--/api/v2/push/getReceipts  ate 1000 ids por pedido;
//        o recibo diz se o Google aceitou (fica 24 h; conferir ~15 min depois)
// Com a "seguranca de push" ligada no painel da Expo, todo pedido precisa de
// Authorization: Bearer EXPO_ACCESS_TOKEN. O token fica so no backend.
//
// Cada mensagem volta classificada no formato que o banco grava
// (concluir_envio_notificacao):
//   aceito    a Expo recebeu (ainda nao e entrega: o recibo confirma depois)
//   recusado  erro definitivo (DeviceNotRegistered, mensagem invalida...)
//   erro      falha temporaria (rede, timeout, 429, 5xx...): tentar de novo
// O texto de erro da Expo pode conter o token do aparelho: so o codigo do erro
// e guardado ou registrado em log.

const API = 'https://exp.host/--/api/v2/push';
const MAX_MENSAGENS = 100;
const MAX_RECIBOS = 1000;

// Erros por mensagem que nao se resolvem tentando de novo
const DEFINITIVOS = new Set(['DeviceNotRegistered', 'MessageTooBig', 'InvalidCredentials', 'MismatchSenderId']);

class ExpoErro extends Error {
  // temporario = vale tentar de novo; status/codigo para o log
  constructor(message, { temporario, status = null, codigo = null }) {
    super(message);
    this.temporario = temporario;
    this.status = status;
    this.codigo = codigo;
  }
}

const emLotes = (lista, tamanho) => Array.from(
  { length: Math.ceil(lista.length / tamanho) }, (_, i) => lista.slice(i * tamanho, (i + 1) * tamanho));

// Ticket da Expo -> resultado por mensagem (sem o texto da Expo, que pode ter o token)
function classificarTicket(ticket) {
  if (ticket?.status === 'ok' && ticket.id) return { status: 'aceito', ticket_id: String(ticket.id) };
  if (ticket?.status === 'error') {
    const codigo = typeof ticket.details?.error === 'string' ? ticket.details.error : 'ErroDesconhecido';
    return { status: DEFINITIVOS.has(codigo) ? 'recusado' : 'erro', erro: codigo };
  }
  return { status: 'erro', erro: 'SemTicket' };
}

function criarExpoPush({ accessToken = null, fetch: fazerFetch = fetch, timeoutMs = 10000 } = {}) {
  async function chamar(caminho, corpo) {
    const controle = new AbortController();
    const timer = setTimeout(() => controle.abort(), timeoutMs);
    try {
      let r;
      try {
        r = await fazerFetch(`${API}${caminho}`, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Accept-Encoding': 'gzip, deflate',
            'Content-Type': 'application/json',
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
          body: JSON.stringify(corpo),
          signal: controle.signal,
        });
      } catch (e) {
        throw new ExpoErro(controle.signal.aborted ? 'Timeout' : 'FalhaDeConexao', { temporario: true });
      }
      const dados = await r.json().catch(() => null);
      if (!r.ok) {
        const codigo = typeof dados?.errors?.[0]?.code === 'string' ? dados.errors[0].code : null;
        // 401/403: token de acesso da Expo ausente ou errado (configuracao): tenta
        // de novo nas proximas tentativas, dando tempo de corrigir
        const temporario = r.status === 408 || r.status === 429 || r.status >= 500 || r.status === 401 || r.status === 403;
        throw new ExpoErro(`HTTP ${r.status}${codigo ? ` ${codigo}` : ''}`, { temporario, status: r.status, codigo });
      }
      if (!dados) throw new ExpoErro('RespostaInvalida', { temporario: true, status: r.status });
      return dados;
    } catch (e) {
      if (e instanceof ExpoErro) throw e;
      throw new ExpoErro(controle.signal.aborted ? 'Timeout' : 'RespostaInvalida', { temporario: true });
    } finally {
      clearTimeout(timer);
    }
  }

  async function enviarLote(lote) {
    try {
      const dados = await chamar('/send', lote);
      // Uma mensagem so pode voltar como objeto em vez de lista
      const tickets = Array.isArray(dados.data) ? dados.data : [dados.data];
      return lote.map((_, i) => classificarTicket(tickets[i]));
    } catch (e) {
      // Pedido recusado por inteiro (ex.: um token de outro projeto no lote):
      // manda uma a uma para isolar a mensagem com problema
      if (!e.temporario && lote.length > 1) {
        const resultados = [];
        for (const mensagem of lote) resultados.push(...await enviarLote([mensagem]));
        return resultados;
      }
      return lote.map(() => ({ status: e.temporario ? 'erro' : 'recusado', erro: e.message }));
    }
  }

  return {
    // Envia as mensagens em lotes de ate 100. Nunca lanca: devolve um
    // resultado por mensagem, na mesma ordem.
    async enviar(mensagens) {
      const resultados = [];
      for (const lote of emLotes(mensagens, MAX_MENSAGENS)) resultados.push(...await enviarLote(lote));
      return resultados;
    },

    // Recibos dos tickets: [{ ticket_id, status: 'ok'|'error', erro? }]. Ticket
    // sem recibo ainda nao aparece. Lanca ExpoErro se o pedido falhar.
    async recibos(ids) {
      const recibos = [];
      for (const lote of emLotes(ids, MAX_RECIBOS)) {
        const dados = await chamar('/getReceipts', { ids: lote });
        for (const [id, recibo] of Object.entries(dados.data ?? {})) {
          if (recibo?.status === 'ok') recibos.push({ ticket_id: id, status: 'ok' });
          else if (recibo?.status === 'error') {
            const codigo = typeof recibo.details?.error === 'string' ? recibo.details.error : 'ErroDesconhecido';
            recibos.push({ ticket_id: id, status: 'error', erro: codigo });
          }
        }
      }
      return recibos;
    },
  };
}

module.exports = { criarExpoPush, classificarTicket, ExpoErro, MAX_MENSAGENS, MAX_RECIBOS };
