// Envio das notificacoes push. A fila, as regras e a validacao de cada aviso
// ficam no banco (migrations 20261109000021 e 20261109000022); aqui o backend
// so monta o texto, envia pela Expo (services/expoPush.js) e devolve o
// resultado ao banco:
//
//   reservar_notificacoes(p_limite)          reserva sem duplicar (bloqueio + prazo de
//                                            2 min) e devolve so o que ainda vale, ja
//                                            com as preferencias aplicadas e os
//                                            aparelhos ativos do destinatario
//   concluir_envio_notificacao(id, lista)     grava o resultado por aparelho; falha
//                                            temporaria volta para a fila com espera
//                                            (30 s, 2, 8 e 32 min; desiste na 5a);
//                                            DeviceNotRegistered desativa o aparelho
//   recibos_pendentes / registrar_recibos    confirmacao do Google (~15 min depois)
//
// "enviada" no banco quer dizer aceita pela Expo; a entrega so e confirmada pelo
// recibo (envio "entregue"). O texto de uma mensagem do chat nunca vai no aviso.

const FUSO = 'America/Sao_Paulo';
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Canais do Android (criados pelo app; o usuario ajusta som e vibracao de cada um)
const CANAIS = {
  mensagem: 'mensagens',
  novo_agendamento: 'agendamentos',
  cancelamento: 'cancelamentos',
  lembrete: 'lembretes',
  teste: 'mensagens',
};

const TTL_MAXIMO = 28 * 24 * 3600; // limite da Expo/FCM
const TTL_MENSAGEM = 24 * 3600; // o aviso de mensagem vale 24 h (migration 22)
const TTL_TESTE = 10 * 60;

class NotificacaoErro extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// ---------------------------------------------------------------
// Textos (horario de Brasilia)
// ---------------------------------------------------------------
const formatoData = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

function partes(data) {
  const p = Object.fromEntries(formatoData.formatToParts(data).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, ddmm: `${p.day}/${p.month}`, hora: Number(p.hour), minuto: p.minute };
}

// 14h, 9h30
function horaCurta(data) {
  const { hora, minuto } = partes(data);
  return minuto === '00' ? `${hora}h` : `${hora}h${minuto}`;
}

// "hoje às 14h", "amanhã às 9h30", "dia 20/11 às 10h"
function quando(data, agora) {
  const alvo = partes(data);
  const hoje = partes(agora);
  const [a, m, d] = hoje.dia.split('-').map(Number);
  const amanha = partes(new Date(Date.UTC(a, m - 1, d + 1, 15))); // meio-dia em Brasilia
  const dia = alvo.dia === hoje.dia ? 'hoje' : alvo.dia === amanha.dia ? 'amanhã' : `dia ${alvo.ddmm}`;
  return `${dia} às ${horaCurta(data)}`;
}

// Titulo e corpo do aviso. Os nomes ja chegam do banco so com o primeiro nome.
function textoDoAviso(item, agora) {
  const d = item.dados ?? {};
  const cliente = d.cliente_nome || 'Cliente';
  const barbeiro = d.barbeiro_nome || 'Barbeiro';
  const servico = d.servico || 'atendimento';
  const dataHora = () => {
    const data = new Date(d.data_hora);
    if (Number.isNaN(data.getTime())) throw new Error('data_hora invalida');
    return data;
  };

  switch (item.tipo) {
    case 'novo_agendamento':
      return { titulo: 'Novo agendamento', corpo: `${cliente} agendou ${servico} para ${quando(dataHora(), agora)}.` };
    case 'cancelamento': {
      const q = quando(dataHora(), agora);
      let corpo;
      if (d.ator === 'cliente') corpo = `${cliente} cancelou o atendimento de ${q} (${servico}).`;
      else if (d.ator === 'barbeiro') corpo = `${barbeiro} cancelou o seu atendimento de ${q} (${servico}).`;
      else if (d.papel === 'cliente') corpo = `A barbearia cancelou o seu atendimento de ${q} (${servico}).`;
      else corpo = `A barbearia cancelou o atendimento de ${cliente} de ${q} (${servico}).`;
      return { titulo: 'Agendamento cancelado', corpo };
    }
    case 'lembrete': {
      const hora = horaCurta(dataHora());
      return d.papel === 'barbeiro'
        ? { titulo: 'Atendimento em breve', corpo: `${cliente} às ${hora} (${servico}).` }
        : { titulo: 'Seu atendimento está próximo', corpo: `${servico} com ${barbeiro} às ${hora}.` };
    }
    case 'mensagem': {
      const nome = d.outro_nome || 'um contato';
      const total = Number(item.nao_lidas) || 1;
      return {
        titulo: 'Nova mensagem',
        corpo: total > 1 ? `Você tem ${total} mensagens novas de ${nome}.` : `Você recebeu uma mensagem de ${nome}.`,
      };
    }
    case 'teste':
      return { titulo: 'Visage Barber', corpo: 'Notificação de teste: este aparelho está pronto para receber os avisos.' };
    default:
      throw new Error(`tipo desconhecido: ${item.tipo}`);
  }
}

// So o necessario para o app abrir a tela certa (e conferir se a conta logada
// e a destinataria). Nada de token, texto de mensagem ou dado de terceiros.
function dadosDoAviso(item) {
  const d = item.dados ?? {};
  const base = { tipo: item.tipo, destinatario: item.destinatario_id };
  if (item.tipo === 'mensagem') {
    return { ...base, conversa_id: d.conversa_id, barbeiro_id: d.barbeiro_id, cliente_id: d.cliente_id, outro_nome: d.outro_nome };
  }
  if (item.tipo === 'teste') return base;
  return { ...base, agendamento_id: d.agendamento_id };
}

// Avisos da mesma conversa (ou do mesmo agendamento) se substituem na barra do
// Android: uma notificacao por conversa, atualizada a cada mensagem
function tagDoAviso(item) {
  const d = item.dados ?? {};
  if (item.tipo === 'mensagem') return `conversa:${d.conversa_id}`;
  if (item.tipo === 'teste') return 'teste';
  return `agendamento:${d.agendamento_id}`;
}

function ttlDoAviso(item, agora) {
  if (item.tipo === 'mensagem') return TTL_MENSAGEM;
  if (item.tipo === 'teste') return TTL_TESTE;
  const segundos = Math.floor((new Date(item.dados?.data_hora).getTime() - agora.getTime()) / 1000);
  return Math.min(Math.max(Number.isFinite(segundos) ? segundos : 60, 60), TTL_MAXIMO);
}

function montarMensagem(item, token, agora) {
  const { titulo, corpo } = textoDoAviso(item, agora);
  return {
    to: token,
    title: titulo,
    body: corpo,
    data: dadosDoAviso(item),
    channelId: CANAIS[item.tipo],
    priority: 'high',
    sound: 'default',
    ttl: ttlDoAviso(item, agora),
    tag: tagDoAviso(item),
  };
}

// Mensagens da mesma conversa, para o mesmo destinatario e aparelhos, no mesmo
// lote: um envio so (o mais recente, que ja traz o total de nao lidas)
function agrupar(itens) {
  const grupos = [];
  const porChave = new Map();
  for (const item of itens) {
    if (item.tipo !== 'mensagem') {
      grupos.push({ principal: item, juntos: [] });
      continue;
    }
    const aparelhos = (item.dispositivos ?? []).map((d) => d.id).sort().join(',');
    const chave = `${item.destinatario_id}|${item.dados?.conversa_id}|${aparelhos}`;
    const grupo = porChave.get(chave);
    if (grupo) {
      grupo.juntos.push(grupo.principal);
      grupo.principal = item;
    } else {
      const novo = { principal: item, juntos: [] };
      porChave.set(chave, novo);
      grupos.push(novo);
    }
  }
  return grupos;
}

// Codigo do erro para o log, sem dados pessoais nem tokens
const codigoDoErro = (e) => String(e?.code ?? e?.name ?? 'erro').slice(0, 40) + (e?.message ? `: ${String(e.message).slice(0, 120)}` : '');

function criarServicoNotificacoes({
  chamar,
  expo,
  buscarDispositivos = async () => [],
  config = {},
  agora = () => new Date(),
  log = console,
  esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const limite = config.limite ?? 50;
  const maxRodadas = config.maxRodadas ?? 10;
  const esperasRegistro = config.esperasRegistro ?? [500, 2000];
  const intervaloRecibosMs = config.intervaloRecibosMs ?? 60000;
  const atrasoReciboMin = config.atrasoReciboMin ?? 15;
  const esperaReciboTesteMs = config.esperaReciboTesteMs ?? 3000;

  // Envios ja feitos cujo resultado o banco ainda nao gravou (id -> resultados).
  // Se o banco devolver o aviso de novo, so grava: nunca reenvia.
  const naoGravados = new Map();

  async function gravar(id, resultados) {
    for (let tentativa = 0; ; tentativa++) {
      try {
        await chamar('concluir_envio_notificacao', { p_notificacao_id: id, p_resultados: resultados });
        naoGravados.delete(id);
        return true;
      } catch (e) {
        // Recusa definitiva do banco (ex.: aviso apagado): nao adianta insistir
        if (/^PT4\d\d$/.test(e?.code ?? '')) {
          naoGravados.delete(id);
          log.error(`[notificacoes] resultado de ${id} recusado pelo banco: ${codigoDoErro(e)}`);
          return false;
        }
        if (tentativa >= esperasRegistro.length) {
          naoGravados.set(id, resultados);
          log.error(`[notificacoes] nao foi possivel gravar o resultado de ${id} (guardado para gravar depois): ${codigoDoErro(e)}`);
          return false;
        }
        await esperar(esperasRegistro[tentativa]);
      }
    }
  }

  // Envia um lote reservado. Devolve Map(id do aviso -> resultados por aparelho).
  async function enviarItens(itens, resumo) {
    const momento = agora();
    const porAviso = new Map();
    const envios = [];

    for (const grupo of agrupar(itens)) {
      const { principal } = grupo;
      const aparelhos = principal.dispositivos ?? [];
      let mensagens;
      try {
        mensagens = aparelhos.map((d) => montarMensagem(principal, d.token, momento));
      } catch (e) {
        // Dados que nao formam um aviso: falha definitiva, sem tentar de novo
        log.error(`[notificacoes] aviso ${principal.id} com dados invalidos: ${codigoDoErro(e)}`);
        for (const item of [principal, ...grupo.juntos]) {
          porAviso.set(item.id, (item.dispositivos ?? []).map((d) => ({ dispositivo_id: d.id, status: 'recusado', erro: 'DadosInvalidos' })));
        }
        continue;
      }
      for (const item of [principal, ...grupo.juntos]) porAviso.set(item.id, []);
      aparelhos.forEach((d, i) => envios.push({ grupo, dispositivo: d, mensagem: mensagens[i] }));
    }

    let resultados;
    try {
      resultados = await expo.enviar(envios.map((e) => e.mensagem));
    } catch (e) {
      log.error(`[notificacoes] falha inesperada no envio: ${codigoDoErro(e)}`);
      resultados = envios.map(() => ({ status: 'erro', erro: 'FalhaInesperada' }));
    }

    envios.forEach((envio, i) => {
      const r = resultados[i] ?? { status: 'erro', erro: 'SemResultado' };
      const registro = {
        dispositivo_id: envio.dispositivo.id,
        status: r.status,
        ...(r.erro ? { erro: r.erro } : {}),
      };
      porAviso.get(envio.grupo.principal.id).push({ ...registro, ...(r.ticket_id ? { ticket_id: r.ticket_id } : {}) });
      // Os avisos agrupados compartilham o resultado (o ticket fica so com o principal)
      for (const junto of envio.grupo.juntos) porAviso.get(junto.id).push(registro);
      resumo.mensagens++;
      if (r.status === 'aceito') resumo.aceitas++;
      else if (r.status === 'recusado') resumo.recusadas++;
      else resumo.falhas_temporarias++;
    });
    return porAviso;
  }

  async function processarFila() {
    const resumo = { avisos: 0, mensagens: 0, aceitas: 0, recusadas: 0, falhas_temporarias: 0, nao_gravados: 0 };

    // Primeiro, o que ja foi enviado e faltou gravar
    for (const [id, resultados] of [...naoGravados]) await gravar(id, resultados);

    for (let rodada = 0; rodada < maxRodadas; rodada++) {
      const itens = await chamar('reservar_notificacoes', { p_limite: limite });
      if (!Array.isArray(itens) || itens.length === 0) break;
      resumo.avisos += itens.length;

      const paraEnviar = [];
      for (const item of itens) {
        if (naoGravados.has(item.id)) await gravar(item.id, naoGravados.get(item.id));
        else paraEnviar.push(item);
      }

      const porAviso = await enviarItens(paraEnviar, resumo);
      for (const [id, resultados] of porAviso) {
        if (!(await gravar(id, resultados))) resumo.nao_gravados++;
      }
      if (itens.length < limite) break;
    }
    return resumo;
  }

  async function conferirRecibos() {
    const ids = await chamar('recibos_pendentes', { p_atraso_min: atrasoReciboMin, p_limite: 1000 });
    if (!Array.isArray(ids) || ids.length === 0) return { conferidos: 0 };
    let recibos;
    try {
      recibos = await expo.recibos(ids);
    } catch (e) {
      log.warn(`[notificacoes] recibos indisponiveis agora: ${codigoDoErro(e)}`);
      return { conferidos: 0 };
    }
    if (recibos.length === 0) return { conferidos: 0 };
    const r = await chamar('registrar_recibos', { p_recibos: recibos });
    return { conferidos: recibos.length, ...r };
  }

  // Uma execucao por vez neste processo. Pedido durante uma execucao: roda de
  // novo ao terminar (no maximo algumas vezes seguidas).
  let execucao = null;
  let pedidoNovo = false;
  let ultimaConferencia = -Infinity;

  function solicitarProcessamento() {
    if (execucao) {
      pedidoNovo = true;
      return execucao;
    }
    execucao = (async () => {
      const total = { avisos: 0, mensagens: 0, aceitas: 0, recusadas: 0, falhas_temporarias: 0, nao_gravados: 0 };
      try {
        for (let volta = 0; volta < 5; volta++) {
          pedidoNovo = false;
          try {
            const r = await processarFila();
            for (const k of Object.keys(total)) total[k] += r[k];
          } catch (e) {
            log.error(`[notificacoes] falha ao ler a fila: ${codigoDoErro(e)}`);
          }
          const instante = agora().getTime();
          if (instante - ultimaConferencia >= intervaloRecibosMs) {
            ultimaConferencia = instante;
            try {
              await conferirRecibos();
            } catch (e) {
              log.warn(`[notificacoes] falha ao conferir recibos: ${codigoDoErro(e)}`);
            }
          }
          if (!pedidoNovo) break;
        }
        return total;
      } finally {
        execucao = null;
      }
    })();
    return execucao;
  }

  // Leitura periodica da fila enquanto o servidor esta acordado
  let timer = null;
  function iniciar(intervaloMs) {
    if (timer) return;
    solicitarProcessamento();
    timer = setInterval(() => { solicitarProcessamento(); }, intervaloMs);
    timer.unref?.();
  }
  function parar() {
    if (timer) clearInterval(timer);
    timer = null;
    return aguardar();
  }
  const aguardar = () => execucao ?? Promise.resolve(null);

  // Aviso de teste para os aparelhos do proprio usuario. Nao grava nada na fila
  // nem no banco: so le os aparelhos ativos dele e envia.
  async function enviarTeste({ usuarioId, dispositivoId = null }) {
    if (dispositivoId != null && (typeof dispositivoId !== 'string' || !UUID_RX.test(dispositivoId))) {
      throw new NotificacaoErro(400, 'DISPOSITIVO_INVALIDO', 'Aparelho inválido.');
    }
    const aparelhos = await buscarDispositivos(usuarioId, dispositivoId);
    if (!aparelhos.length) {
      throw dispositivoId
        ? new NotificacaoErro(404, 'DISPOSITIVO_NAO_ENCONTRADO', 'Aparelho não encontrado nesta conta.')
        : new NotificacaoErro(404, 'SEM_APARELHO',
          'Nenhum aparelho com notificações ativas nesta conta. Abra o app no celular e permita as notificações.');
    }

    const momento = agora();
    const item = { tipo: 'teste', destinatario_id: usuarioId, dados: {} };
    const resultados = await expo.enviar(aparelhos.map((d) => montarMensagem(item, d.token, momento)));

    // Recibo rapido para o diagnostico (ex.: credencial do FCM errada so
    // aparece no recibo). Se ainda nao existir, fica "pendente".
    const recibos = new Map();
    const tickets = resultados.filter((r) => r.ticket_id).map((r) => r.ticket_id);
    if (tickets.length && esperaReciboTesteMs > 0) {
      await esperar(esperaReciboTesteMs);
      try {
        for (const r of await expo.recibos(tickets)) recibos.set(r.ticket_id, r);
      } catch (e) {
        log.warn(`[notificacoes] recibo do teste indisponivel: ${codigoDoErro(e)}`);
      }
    }

    return {
      aparelhos: aparelhos.length,
      resultados: aparelhos.map((d, i) => {
        const r = resultados[i] ?? { status: 'erro', erro: 'SemResultado' };
        const recibo = r.ticket_id ? recibos.get(r.ticket_id) : null;
        return {
          dispositivo_id: d.id,
          plataforma: d.plataforma,
          status: r.status,
          ...(r.erro ? { erro: r.erro } : {}),
          ...(r.ticket_id ? { ticket_id: r.ticket_id, recibo: recibo ? (recibo.status === 'ok' ? 'ok' : recibo.erro) : 'pendente' } : {}),
        };
      }),
    };
  }

  return { solicitarProcessamento, processarFila, conferirRecibos, enviarTeste, iniciar, parar, aguardar };
}

module.exports = {
  criarServicoNotificacoes, NotificacaoErro, textoDoAviso, dadosDoAviso, montarMensagem, quando, horaCurta, CANAIS,
};
