// Confirmacao de presenca pelo WhatsApp (migration 20261113000025).
//
// As regras ficam no banco; aqui o backend so:
//   * le a fila do canal whatsapp (reservar_whatsapp), monta o template, envia
//     pela Cloud API (services/whatsapp.js) e grava o resultado
//     (concluir_envio_whatsapp);
//   * recebe do webhook as respostas SIM/NAO e os estados de entrega e os
//     repassa ao banco (whatsapp_registrar_resposta e whatsapp_registrar_status),
//     que reconfere o agendamento antes de aceitar qualquer resposta.
//
// Sem duplicar: o banco grava a tentativa antes de devolver o aviso; se o
// resultado nao puder ser gravado agora, fica guardado e e gravado depois, sem
// reenviar; resultado incerto nunca e reenviado.

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

// Template, parametros e botoes de cada tipo de aviso.
// confirmacao_presenca: {{1}} cliente, {{2}} servico, {{3}} barbeiro, {{4}} data,
//   {{5}} hora; botoes de resposta rapida "Sim" e "Não".
// presenca_negada (para o barbeiro): {{1}} cliente, {{2}} servico, {{3}} data, {{4}} hora.
function montarEnvio(item, config) {
  const d = item.dados ?? {};
  const { data, hora } = dataEHora(d.data_hora);
  if (item.tipo === 'confirmacao_presenca') {
    if (!UUID_RX.test(d.confirmacao_id ?? '')) throw new Error('confirmacao_id invalido');
    return {
      template: config.templateConfirmacao,
      parametros: [d.cliente_nome || 'Cliente', d.servico || 'atendimento', d.barbeiro_nome || 'seu barbeiro', data, hora],
      botoes: [`VB_SIM:${d.confirmacao_id}`, `VB_NAO:${d.confirmacao_id}`],
    };
  }
  if (item.tipo === 'presenca_negada') {
    return {
      template: config.templatePresencaNegada,
      parametros: [d.cliente_nome || 'Cliente', d.servico || 'atendimento', data, hora],
      botoes: [],
    };
  }
  throw new Error(`tipo desconhecido: ${item.tipo}`);
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
    case 'recusada':
      return 'Obrigado por avisar. O barbeiro foi informado. O horário continua reservado: se quiser liberá-lo, cancele pelo aplicativo.';
    case 'ja_respondida':
      return 'Sua resposta para esse agendamento já tinha sido registrada.';
    case 'agendamento_invalido':
      return 'Esse agendamento não está mais ativo ou mudou de horário. Confira seus agendamentos no aplicativo.';
    case 'ambigua':
      return 'Você tem mais de um agendamento aguardando confirmação. Responda pelos botões da mensagem de cada um.';
    case 'descadastro':
      return 'Pronto: você não receberá mais mensagens da Visage Barber pelo WhatsApp. Para voltar a receber, ative a opção no seu perfil.';
    default:
      return null;
  }
}

const codigoDoErro = (e) => String(e?.code ?? e?.name ?? 'erro').slice(0, 40);

function criarConfirmacaoPresenca({
  chamar,
  whatsapp,
  config = {},
  log = console,
  esperar = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
}) {
  const limite = config.limite ?? 20;
  const maxRodadas = config.maxRodadas ?? 5;
  const esperasRegistro = config.esperasRegistro ?? [500, 2000];
  const idioma = config.idioma ?? 'pt_BR';
  // Piloto: se a lista existir, so esses usuarios recebem
  const piloto = Array.isArray(config.piloto) && config.piloto.length ? new Set(config.piloto) : null;

  // Envios feitos cujo resultado o banco ainda nao gravou (id -> resultado)
  const naoGravados = new Map();

  async function gravar(id, resultado) {
    for (let tentativa = 0; ; tentativa++) {
      try {
        await chamar('concluir_envio_whatsapp', { p_notificacao_id: id, p_resultado: resultado });
        naoGravados.delete(id);
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
    if (!envio.template) return { status: 'recusado', erro: 'template_nao_configurado' };
    if (typeof item.telefone !== 'string' || !/^55\d{11}$/.test(item.telefone)) return { status: 'recusado', erro: 'telefone_invalido' };
    try {
      return await whatsapp.enviarTemplate({ para: item.telefone, idioma, ...envio });
    } catch (e) {
      // O cliente da Meta nao deveria lancar; se lancar, nao se sabe se enviou
      log.error(`[whatsapp] falha inesperada no envio de ${item.id}: ${codigoDoErro(e)}`);
      return { status: 'incerto', erro: 'falha_inesperada' };
    }
  }

  async function processarFila() {
    const resumo = { avisos: 0, aceitos: 0, recusados: 0, erros: 0, incertos: 0, nao_gravados: 0 };
    for (const [id, resultado] of [...naoGravados]) await gravar(id, resultado);

    for (let rodada = 0; rodada < maxRodadas; rodada++) {
      const itens = await chamar('reservar_whatsapp', { p_limite: limite });
      if (!Array.isArray(itens) || itens.length === 0) break;
      resumo.avisos += itens.length;
      for (const item of itens) {
        // Ja enviado, faltou gravar: so grava
        const resultado = naoGravados.get(item.id) ?? await enviarItem(item);
        if (resultado.status === 'aceito') resumo.aceitos++;
        else if (resultado.status === 'recusado') resumo.recusados++;
        else if (resultado.status === 'erro') resumo.erros++;
        else resumo.incertos++;
        if (!(await gravar(item.id, resultado))) resumo.nao_gravados++;
      }
      if (itens.length < limite) break;
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
    const resumo = { respostas: 0, status: 0, falhas: 0, novosAvisos: false };
    for (const s of status) {
      try {
        await chamar('whatsapp_registrar_status', { p_wamid: s.wamid, p_status: s.status, p_erro: s.erro });
        resumo.status++;
      } catch (e) {
        resumo.falhas++;
        log.error(`[whatsapp] nao foi possivel gravar o estado de uma mensagem: ${codigoDoErro(e)}`);
      }
    }
    for (const m of mensagens) {
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
      if (r?.resultado === 'recusada') resumo.novosAvisos = true;
      let texto = null;
      try {
        texto = textoDeResposta(r);
      } catch {
        texto = null;
      }
      if (texto) {
        // Melhor esforco: a resposta ja esta gravada; falha aqui so e registrada
        const envio = await whatsapp.enviarTexto({ para: m.de, texto }).catch(() => ({ status: 'incerto', erro: 'falha_inesperada' }));
        if (envio.status !== 'aceito') log.warn(`[whatsapp] retorno ao cliente nao enviado (${envio.status}: ${envio.erro ?? '?'})`);
      }
    }
    // Resposta NAO pode ter gerado o aviso do barbeiro
    if (resumo.novosAvisos) solicitarProcessamento();
    return resumo;
  }

  return { processarFila, solicitarProcessamento, tratarEventos, iniciar, parar, aguardar: () => execucao ?? Promise.resolve(null) };
}

module.exports = { criarConfirmacaoPresenca, montarEnvio, textoDeResposta, dataEHora };
