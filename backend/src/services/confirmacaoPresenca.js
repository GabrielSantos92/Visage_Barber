// Confirmacao de presenca pelo WhatsApp (migration 20261113000025) e
// cancelamento com confirmacao dupla (migration 20261116000026).
//
// As regras ficam no banco; aqui o backend so:
//   * le a fila do canal whatsapp (reservar_whatsapp), monta a mensagem, envia
//     pela Cloud API (services/whatsapp.js) e grava o resultado
//     (concluir_envio_whatsapp);
//   * recebe do webhook as respostas (botoes e texto) e os estados de entrega
//     e os repassa ao banco (whatsapp_registrar_resposta e
//     whatsapp_registrar_status), que reconfere o agendamento antes de aceitar
//     qualquer resposta. Quem decide o que cancelar e sempre o banco.
//
// Mensagens:
//   confirmacao_presenca      template; botoes SIM e NAO (payload VB_SIM/VB_NAO)
//   confirmacao_cancelamento  depois do NAO: mensagem interativa (sem template,
//                             dentro da janela de 24 h aberta pelo toque do
//                             cliente) com SIM, CANCELAR e NAO, MANTER
//                             (VB_CANCELAR/VB_MANTER + id da solicitacao)
//   cancelamento_whatsapp     template ao barbeiro: o cliente cancelou
//   cancelamento_nao_concluido  ao cliente, quando a segunda mensagem nao
//                             chegou: nada foi cancelado, o horario continua
//                             reservado, use o app, o site ou a barbearia.
//                             Template, se houver um aprovado; senao, texto
//                             (so chega dentro da janela de 24 h: com a
//                             janela fechada e sem template, nao chama a Meta)
//   presenca_negada           template ao barbeiro (fluxo da migration 25)
//
// Funciona com o banco so com a 25 (NAO apenas registra) e com a 26.
//
// Sem duplicar: o banco grava a tentativa antes de devolver o aviso; se o
// resultado nao puder ser gravado agora, fica guardado e e gravado depois, sem
// reenviar; resultado incerto nunca e reenviado.
//
// Erros da Meta (services/whatsapp.js, classificarErroMeta): temporario volta
// para a fila (o banco espera e tenta no prazo, no maximo 4 vezes);
// autenticacao ou conta PAUSAM o canal (nenhum envio por config.pausaMs, 30
// min por padrao): o aviso em maos e os demais da rodada voltam para a fila
// sem chamar a Meta, e o log diz o que conferir. Os demais sao definitivos.

// Modo teste (config.destinatariosTeste, ver services/notificacoesConfig.js): so
// os celulares da lista recebem, e mensagens recebidas de outros numeros sao
// ignoradas antes do banco (nao respondem pedido, nao revogam autorizacao e nao
// recebem retorno).

const { chaveNumero, limpar, CATEGORIAS_QUE_PAUSAM } = require('./whatsapp');

const FUSO = 'America/Sao_Paulo';

const formato = new Intl.DateTimeFormat('en-CA', {
  timeZone: FUSO, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

// "13/11" e "14h" ou "9h30", no horario de Brasilia
function dataEHora(iso) {
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) throw new Error('data_hora invalida');
  const p = Object.fromEntries(formato.formatToParts(data).map((x) => [x.type, x.value]));
  const hora = Number(p.hour);
  return { data: `${p.day}/${p.month}`, hora: p.minute === '00' ? `${hora}h` : `${hora}h${p.minute}` };
}

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Segunda mensagem (confirmacao do cancelamento). Os titulos dos botoes tem
// no maximo 20 caracteres (limite da Meta para botoes de resposta), por isso
// "NÃO, MANTER" em vez de "NÃO, MANTER AGENDAMENTO" (23).
const BOTAO_CANCELAR = 'SIM, CANCELAR';
const BOTAO_MANTER = 'NÃO, MANTER';
const RODAPE_CANCELAMENTO = 'Se não responder, o agendamento continua ativo.';

function textoConfirmacaoCancelamento(d, data, hora) {
  return [
    'Você solicitou o cancelamento deste agendamento. Tem certeza de que deseja cancelar?',
    '',
    `${limpar(d.servico || 'Atendimento')} com ${limpar(d.barbeiro_nome || 'seu barbeiro')}`,
    `${data} às ${hora}`,
    '',
    'Se confirmar, o agendamento será cancelado e o horário ficará disponível novamente.',
  ].join('\n');
}

// A segunda mensagem nao chegou ao cliente: o pedido foi recebido, nada foi
// cancelado, o horario continua reservado e o cancelamento deve ser feito por
// outro meio
function textoCancelamentoNaoConcluido(data, hora) {
  return `Recebemos seu pedido de cancelamento do agendamento de ${data} às ${hora}, `
    + 'mas não conseguimos concluí-lo pelo WhatsApp. O cancelamento NÃO foi feito e o horário continua reservado. '
    + 'Para cancelar, use o aplicativo ou o site da Visage Barber, ou fale com a barbearia.';
}

// Falha que fechou a janela de 24 h: so template chega ao cliente
const JANELA_FECHADA = /(^|\D)131047(\D|$)/;

// Como enviar cada tipo de aviso:
//   { modo: 'template', template, parametros, botoes }  (botoes = payloads)
//   { modo: 'botoes', texto, rodape, botoes: [{ id, titulo }] }
//   { modo: 'texto', texto }
// cancelamento_nao_concluido (template opcional): {{1}} data, {{2}} hora.
// confirmacao_presenca: {{1}} cliente, {{2}} servico, {{3}} barbeiro, {{4}} data,
//   {{5}} hora; dois botoes de resposta rapida (SIM e NAO).
// presenca_negada e cancelamento_whatsapp (para o barbeiro): {{1}} cliente,
//   {{2}} servico, {{3}} data, {{4}} hora.
function montarEnvio(item, config) {
  const d = item.dados ?? {};
  const { data, hora } = dataEHora(d.data_hora);
  if (item.tipo === 'confirmacao_presenca') {
    if (!UUID_RX.test(d.confirmacao_id ?? '')) throw new Error('confirmacao_id invalido');
    return {
      modo: 'template',
      template: config.templateConfirmacao,
      parametros: [d.cliente_nome || 'Cliente', d.servico || 'atendimento', d.barbeiro_nome || 'seu barbeiro', data, hora],
      botoes: [`VB_SIM:${d.confirmacao_id}`, `VB_NAO:${d.confirmacao_id}`],
    };
  }
  if (item.tipo === 'confirmacao_cancelamento') {
    if (!UUID_RX.test(d.solicitacao_id ?? '')) throw new Error('solicitacao_id invalido');
    return {
      modo: 'botoes',
      texto: textoConfirmacaoCancelamento(d, data, hora),
      rodape: RODAPE_CANCELAMENTO,
      botoes: [
        { id: `VB_CANCELAR:${d.solicitacao_id}`, titulo: BOTAO_CANCELAR },
        { id: `VB_MANTER:${d.solicitacao_id}`, titulo: BOTAO_MANTER },
      ],
    };
  }
  if (item.tipo === 'cancelamento_nao_concluido') {
    if (!UUID_RX.test(d.solicitacao_id ?? '')) throw new Error('solicitacao_id invalido');
    if (config.templateCancelamentoNaoConcluido) {
      return { modo: 'template', template: config.templateCancelamentoNaoConcluido, parametros: [data, hora], botoes: [] };
    }
    return { modo: 'texto', texto: textoCancelamentoNaoConcluido(data, hora), janelaFechada: JANELA_FECHADA.test(String(d.falha ?? '')) };
  }
  // novo_agendamento (migration 28) e cancelamento (migration 29), sem botoes.
  // Cliente: {{1}} cliente, {{2}} servico, {{3}} barbeiro, {{4}} data, {{5}}
  // hora. Barbeiro: {{1}} cliente, {{2}} servico, {{3}} data, {{4}} hora.
  if (item.tipo === 'novo_agendamento' || item.tipo === 'cancelamento') {
    if (d.papel !== 'cliente' && d.papel !== 'barbeiro') throw new Error('papel invalido');
    const barbeiro = d.papel === 'barbeiro';
    const templates = item.tipo === 'cancelamento'
      ? [config.templateCancelamentoCliente, config.templateCancelamentoBarbeiro]
      : [config.templateNovoAgendamentoCliente, config.templateNovoAgendamentoBarbeiro];
    return {
      modo: 'template',
      template: barbeiro ? templates[1] : templates[0],
      parametros: barbeiro
        ? [d.cliente_nome || 'Cliente', d.servico || 'atendimento', data, hora]
        : [d.cliente_nome || 'Cliente', d.servico || 'atendimento', d.barbeiro_nome || 'seu barbeiro', data, hora],
      botoes: [],
    };
  }
  if (item.tipo === 'presenca_negada' || item.tipo === 'cancelamento_whatsapp') {
    return {
      modo: 'template',
      template: item.tipo === 'presenca_negada' ? config.templatePresencaNegada : config.templateCancelamento,
      parametros: [d.cliente_nome || 'Cliente', d.servico || 'atendimento', data, hora],
      botoes: [],
    };
  }
  throw new Error(`tipo desconhecido: ${item.tipo}`);
}

const TEXTO_INVALIDO = 'Esse agendamento não está mais ativo ou mudou de horário. Confira seus agendamentos no aplicativo.';
const TEXTO_JA_CANCELADO = 'Este agendamento já foi cancelado.';
const TEXTO_MANTIDO = 'Seu agendamento continua confirmado.';
const TEXTO_NAO_CONFIRMADO = 'O cancelamento não foi confirmado e o agendamento continua ativo. '
  + 'Se ainda quiser cancelar, use o aplicativo ou o site, ou fale com a barbearia.';
const TEXTO_PEDIDO_EM_ANDAMENTO = 'Você já pediu o cancelamento deste agendamento. Para confirmar ou manter, use os botões da mensagem "Tem certeza de que deseja cancelar?".';

// Situacao de uma solicitacao de cancelamento ja existente, para o cliente
function textoDaSolicitacao(estado) {
  switch (estado) {
    case 'pendente':
    case 'aguardando':
      return TEXTO_PEDIDO_EM_ANDAMENTO;
    case 'confirmada':
      return TEXTO_JA_CANCELADO;
    case 'desistiu':
      return TEXTO_MANTIDO;
    case 'expirada':
    case 'nao_enviada':
      return TEXTO_NAO_CONFIRMADO;
    case 'invalidada':
      return TEXTO_INVALIDO;
    default:
      return null;
  }
}

// Resposta ao cliente depois de processar o que ele mandou (texto livre, dentro
// da janela de atendimento que a propria mensagem dele abriu). Sem resposta
// para o que nao foi reconhecido: evita conversa em laco.
function textoDeResposta(r) {
  switch (r?.resultado) {
    case 'confirmada': {
      const { data, hora } = dataEHora(r.data_hora);
      return `Presença confirmada para ${data} às ${hora}. Até lá!`;
    }
    // Banco so com a migration 25: NAO apenas registra
    case 'recusada':
      return 'Obrigado por avisar. O barbeiro foi informado. O horário continua reservado: se quiser liberá-lo, cancele pelo aplicativo.';
    // A propria segunda mensagem (com os botoes) e a resposta
    case 'cancelamento_solicitado':
      return null;
    case 'cancelamento_confirmado': {
      const { data, hora } = dataEHora(r.data_hora);
      return `Pronto: o agendamento de ${data} às ${hora} foi cancelado e o horário foi liberado. `
        + 'Se você pagou online, a devolução não é automática: fale com a barbearia.';
    }
    case 'cancelamento_desistido': {
      const { data, hora } = dataEHora(r.data_hora);
      return `Tudo certo: seu agendamento de ${data} às ${hora} continua confirmado.`;
    }
    case 'cancelamento_expirado':
      return 'O prazo para confirmar o cancelamento terminou e o agendamento continua ativo. '
        + 'Se ainda quiser cancelar, use o aplicativo ou o site, ou fale com a barbearia.';
    case 'solicitacao_encerrada':
      return textoDaSolicitacao(r.estado) ?? TEXTO_INVALIDO;
    case 'usar_botao':
      return 'Mensagens escritas não cancelam agendamentos. Para confirmar ou desistir do cancelamento, toque em um dos botões da mensagem "Tem certeza de que deseja cancelar?".';
    case 'ja_respondida':
      return textoDaSolicitacao(r.cancelamento) ?? 'Sua resposta para esse agendamento já tinha sido registrada.';
    case 'agendamento_invalido':
      return TEXTO_INVALIDO;
    case 'ambigua':
      return 'Você tem mais de um agendamento aguardando confirmação. Responda pelos botões da mensagem de cada um.';
    case 'descadastro':
      return 'Pronto: você não receberá mais mensagens da Visage Barber pelo WhatsApp. Para voltar a receber, ative a opção no seu perfil.';
    // Botao da confirmacao de cancelamento que nao confere: avisa que nada mudou
    case 'invalida':
      return r.etapa === 'cancelamento'
        ? 'Não foi possível identificar o agendamento deste botão. Nada foi alterado. Confira seus agendamentos no aplicativo.'
        : null;
    default:
      return null;
  }
}

// Resultados que podem ter gerado mensagem nova na fila (segunda mensagem ou
// aviso ao barbeiro): a fila e lida logo em seguida
const GERAM_AVISO = new Set(['recusada', 'cancelamento_solicitado', 'cancelamento_confirmado']);

const codigoDoErro = (e) => String(e?.code ?? e?.name ?? 'erro').slice(0, 40);

function criarConfirmacaoPresenca({
  chamar,
  whatsapp,
  config = {},
  log = console,
  esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  agora = Date.now,
}) {
  const limite = config.limite ?? 20;
  // Pausa do canal depois de erro de autenticacao ou de conta da Meta
  const pausaMs = config.pausaMs ?? 30 * 60 * 1000;
  let pausadoAte = 0;
  let motivoPausa = null;
  const pausado = () => agora() < pausadoAte;
  function pausar(erro) {
    const jaEstava = pausado();
    pausadoAte = agora() + pausaMs;
    motivoPausa = String(erro ?? '?').slice(0, 60);
    if (!jaEstava) {
      log.error(`[whatsapp] envios PAUSADOS por ${Math.round(pausaMs / 60000)} min: a Meta recusou (${motivoPausa}). `
        + 'Confira o token, o numero e a conta no Meta Business. Os avisos continuam na fila (cada um ate o seu prazo).');
    }
  }
  // O banco gerou aviso novo ao gravar um resultado (cancelamento nao concluido)
  let novoAviso = false;
  const maxRodadas = config.maxRodadas ?? 5;
  const esperasRegistro = config.esperasRegistro ?? [500, 2000];
  const idioma = config.idioma ?? 'pt_BR';
  // Piloto: se a lista existir, so esses usuarios recebem
  const piloto = Array.isArray(config.piloto) && config.piloto.length ? new Set(config.piloto) : null;
  // Modo teste: celulares autorizados (comparados sem o 9, como faz o banco).
  // Lista vazia no modo teste = ninguem recebe.
  const listaTeste = Array.isArray(config.destinatariosTeste)
    ? new Set(config.destinatariosTeste.map(chaveNumero).filter(Boolean))
    : null;
  const autorizadoNoTeste = (numero) => !listaTeste || listaTeste.has(chaveNumero(numero));

  // Envios feitos cujo resultado o banco ainda nao gravou (id -> resultado)
  const naoGravados = new Map();

  async function gravar(id, resultado) {
    for (let tentativa = 0; ; tentativa++) {
      try {
        const r = await chamar('concluir_envio_whatsapp', { p_notificacao_id: id, p_resultado: resultado });
        naoGravados.delete(id);
        if (r?.novo_aviso) novoAviso = true;
        return true;
      } catch (e) {
        if (/^PT4\d\d$/.test(e?.code ?? '')) {
          naoGravados.delete(id);
          log.error(`[whatsapp] resultado de ${id} recusado pelo banco: ${codigoDoErro(e)}`);
          return false;
        }
        if (tentativa >= esperasRegistro.length) {
          naoGravados.set(id, resultado);
          log.error(`[whatsapp] nao foi possivel gravar o resultado de ${id} (guardado para gravar depois): ${codigoDoErro(e)}`);
          return false;
        }
        await esperar(esperasRegistro[tentativa]);
      }
    }
  }

  async function enviarItem(item) {
    if (piloto && !piloto.has(item.destinatario_id)) return { status: 'recusado', erro: 'fora_do_piloto' };
    let envio;
    try {
      envio = montarEnvio(item, config);
    } catch (e) {
      log.error(`[whatsapp] aviso ${item.id} com dados invalidos: ${String(e.message).slice(0, 60)}`);
      return { status: 'recusado', erro: 'dados_invalidos' };
    }
    if (envio.modo === 'template' && !envio.template) return { status: 'recusado', erro: 'template_nao_configurado' };
    if (typeof item.telefone !== 'string' || !/^55\d{11}$/.test(item.telefone)) return { status: 'recusado', erro: 'telefone_invalido' };
    if (!autorizadoNoTeste(item.telefone)) return { status: 'recusado', erro: 'fora_da_lista_de_teste' };
    // Janela de 24 h fechada e sem template aprovado: o texto nao chegaria
    if (envio.modo === 'texto' && envio.janelaFechada) {
      return { status: 'recusado', erro: 'janela_fechada:sem_template', categoria: 'janela_fechada' };
    }
    try {
      if (envio.modo === 'botoes') {
        return await whatsapp.enviarBotoes({ para: item.telefone, texto: envio.texto, rodape: envio.rodape, botoes: envio.botoes });
      }
      if (envio.modo === 'texto') return await whatsapp.enviarTexto({ para: item.telefone, texto: envio.texto });
      return await whatsapp.enviarTemplate({
        para: item.telefone, idioma, template: envio.template, parametros: envio.parametros, botoes: envio.botoes,
      });
    } catch (e) {
      // O cliente da Meta nao deveria lancar; se lancar, nao se sabe se enviou
      log.error(`[whatsapp] falha inesperada no envio de ${item.id}: ${codigoDoErro(e)}`);
      return { status: 'incerto', erro: 'falha_inesperada' };
    }
  }

  async function processarFila() {
    const resumo = { avisos: 0, aceitos: 0, recusados: 0, erros: 0, incertos: 0, nao_gravados: 0 };
    for (const [id, resultado] of [...naoGravados]) await gravar(id, resultado);
    // Pausado: nem reserva (os avisos ficam pendentes no banco)
    if (pausado()) return resumo;

    for (let rodada = 0; rodada < maxRodadas; rodada++) {
      novoAviso = false;
      const itens = await chamar('reservar_whatsapp', { p_limite: limite });
      if (!Array.isArray(itens) || itens.length === 0) break;
      resumo.avisos += itens.length;
      for (const item of itens) {
        // Ja enviado, faltou gravar: so grava. Canal pausado no meio da rodada:
        // os que faltam voltam para a fila sem chamar a Meta
        const resultado = naoGravados.get(item.id)
          ?? (pausado() ? { status: 'erro', erro: `pausado:${motivoPausa}`, categoria: 'pausado' } : await enviarItem(item));
        if (CATEGORIAS_QUE_PAUSAM.has(resultado.categoria)) pausar(resultado.erro);
        if (resultado.status === 'aceito') resumo.aceitos++;
        else if (resultado.status === 'recusado') resumo.recusados++;
        else if (resultado.status === 'erro') resumo.erros++;
        else resumo.incertos++;
        if (!(await gravar(item.id, resultado))) resumo.nao_gravados++;
      }
      if (pausado()) break;
      // Aviso novo gerado nesta rodada (cancelamento nao concluido): le de novo
      if (itens.length < limite && !novoAviso) break;
    }
    return resumo;
  }

  // Uma execucao por vez neste processo; pedido durante a execucao roda de novo
  let execucao = null;
  let pedidoNovo = false;
  function solicitarProcessamento() {
    if (execucao) {
      pedidoNovo = true;
      return execucao;
    }
    execucao = (async () => {
      const total = { avisos: 0, aceitos: 0, recusados: 0, erros: 0, incertos: 0, nao_gravados: 0 };
      try {
        for (let volta = 0; volta < 5; volta++) {
          pedidoNovo = false;
          try {
            const r = await processarFila();
            for (const k of Object.keys(total)) total[k] += r[k];
          } catch (e) {
            log.error(`[whatsapp] falha ao ler a fila: ${codigoDoErro(e)}`);
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
    return execucao ?? Promise.resolve(null);
  }

  // Eventos ja extraidos e autenticados do webhook. Erro em um evento nao
  // impede os outros; a Meta reentrega o que nao for confirmado, e o banco
  // ignora o que ja processou.
  async function tratarEventos({ mensagens = [], status = [] }) {
    const resumo = { respostas: 0, status: 0, falhas: 0, ignoradas: 0, novosAvisos: false };
    for (const s of status) {
      try {
        const r = await chamar('whatsapp_registrar_status', { p_wamid: s.wamid, p_status: s.status, p_erro: s.erro });
        resumo.status++;
        // Falha da segunda mensagem pode ter gerado o aviso de cancelamento nao concluido
        if (r === 'falhou') resumo.novosAvisos = true;
        if (s.status === 'falhou' && CATEGORIAS_QUE_PAUSAM.has(s.categoria)) pausar(s.erro);
      } catch (e) {
        resumo.falhas++;
        log.error(`[whatsapp] nao foi possivel gravar o estado de uma mensagem: ${codigoDoErro(e)}`);
      }
    }
    for (const m of mensagens) {
      if (!autorizadoNoTeste(m.de)) {
        resumo.ignoradas++;
        continue;
      }
      let r;
      try {
        r = await chamar('whatsapp_registrar_resposta', {
          p_evento: m.id, p_de: m.de, p_tipo: m.tipo, p_payload: m.payload, p_contexto: m.contexto, p_texto: m.texto,
        });
        resumo.respostas++;
      } catch (e) {
        resumo.falhas++;
        log.error(`[whatsapp] nao foi possivel gravar uma resposta: ${codigoDoErro(e)}`);
        continue;
      }
      if (GERAM_AVISO.has(r?.resultado)) resumo.novosAvisos = true;
      let texto = null;
      try {
        texto = textoDeResposta(r);
      } catch {
        texto = null;
      }
      if (texto && pausado()) {
        log.warn('[whatsapp] retorno ao cliente nao enviado: envios pausados');
      } else if (texto) {
        // Melhor esforco: a resposta ja esta gravada; falha aqui so e registrada
        const envio = await whatsapp.enviarTexto({ para: m.de, texto }).catch(() => ({ status: 'incerto', erro: 'falha_inesperada' }));
        if (envio.status !== 'aceito') log.warn(`[whatsapp] retorno ao cliente nao enviado (${envio.status}: ${envio.erro ?? '?'})`);
        if (CATEGORIAS_QUE_PAUSAM.has(envio.categoria)) pausar(envio.erro);
      }
    }
    // NAO gera a segunda mensagem; SIM, CANCELAR pode gerar o aviso ao barbeiro;
    // falha de entrega da segunda pode gerar o de cancelamento nao concluido
    if (resumo.novosAvisos) solicitarProcessamento();
    return resumo;
  }

  return {
    processarFila, solicitarProcessamento, tratarEventos, iniciar, parar, aguardar: () => execucao ?? Promise.resolve(null),
    pausado, motivoPausa: () => (pausado() ? motivoPausa : null),
  };
}

module.exports = {
  criarConfirmacaoPresenca, montarEnvio, textoDeResposta, textoCancelamentoNaoConcluido, dataEHora,
  BOTAO_CANCELAR, BOTAO_MANTER, RODAPE_CANCELAMENTO,
};
