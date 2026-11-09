// Pagamentos dos clientes. As regras e a conta ficam no banco (migrations
// 20261105000018_financeiro.sql e 20261105000019_pagamentos_duplicidade_auditoria.sql);
// aqui o backend fala com o Mercado Pago:
//
//   criar           valor vem do agendamento no banco, nunca do app
//   sincronizar     consulta o Mercado Pago e aplica o estado confirmado por ele
//   webhook         valida a assinatura, registra a notificacao (idempotencia) e
//                   consulta o Mercado Pago; o corpo da notificacao nao e confiavel
//   reembolsar      (admin) confere no banco, reembolsa no Mercado Pago e sincroniza
//   cancelarAbertas (admin) cancela no Mercado Pago as cobrancas que deixaram de
//                   valer aqui (ex.: o cliente pagou na barbearia)
//
// Nenhum pagamento e aprovado porque o app recebeu uma resposta positiva: so
// pelo estado consultado na API do provedor com o nosso access token. Pagamento
// em duplicidade fica registrado e marcado no banco; nada e devolvido sem o admin.

const { validarAssinatura, estadoDoMercadoPago } = require('./mercadoPago');

const METODOS = ['pix', 'cartao', 'presencial'];
const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class PagamentoErro extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

// Erro do banco (RAISE ... ERRCODE 'PT404', DETAIL 'CODIGO') -> erro da API
function doBanco(e) {
  const codigo = e?.details ?? e?.detail;
  const http = /^PT(\d{3})$/.exec(e?.code ?? '')?.[1];
  if (codigo && http) return new PagamentoErro(Number(http), codigo, e.message);
  return e;
}

// Campos que o app pode ver
function publico(p) {
  if (!p) return null;
  return {
    id: p.id,
    agendamento_id: p.agendamento_id,
    metodo: p.metodo,
    status: p.status,
    valor_original: Number(p.valor_original),
    desconto: Number(p.desconto),
    valor: Number(p.valor),
    valor_reembolsado: Number(p.valor_reembolsado ?? 0),
    pix_copia_cola: p.pix_copia_cola ?? null,
    pix_qr_base64: p.pix_qr_base64 ?? null,
    link_pagamento: p.link_pagamento ?? null,
    expira_em: p.expira_em ?? null,
    aprovado_em: p.aprovado_em ?? null,
  };
}

// Entre varias tentativas da mesma preferencia (cartao), a que vale
const PRIORIDADE = { approved: 4, refunded: 4, charged_back: 4, authorized: 3, in_process: 3, in_mediation: 3, pending: 3 };
function melhorTentativa(lista) {
  return [...lista].sort((a, b) =>
    (PRIORIDADE[b.status] ?? 1) - (PRIORIDADE[a.status] ?? 1)
    || String(b.date_created ?? '').localeCompare(String(a.date_created ?? '')))[0] ?? null;
}

// Tentativas em que o dinheiro entrou, da primeira para a ultima (a primeira
// quita o atendimento; as outras ficam como duplicidade)
const PAGAS = ['approved', 'refunded', 'charged_back'];
const tentativasPagas = (lista) => lista.filter((t) => PAGAS.includes(t.status))
  .sort((a, b) => String(a.date_approved ?? a.date_created ?? '').localeCompare(String(b.date_approved ?? b.date_created ?? '')));

function criarServicoPagamentos({ chamar, mp, config = {}, agora = () => new Date() }) {
  const minutosPix = config.minutosPix ?? 30;
  const minutosCartao = config.minutosCartao ?? 60;

  async function banco(nome, args) {
    try {
      return await chamar(nome, args);
    } catch (e) {
      throw doBanco(e);
    }
  }

  // Cobrancas que deixaram de valer aqui: cancela tambem no provedor e grava o
  // resultado. Se nao der (ex.: o cliente acabou de pagar), consulta o provedor:
  // se foi pago, o banco registra e marca a duplicidade para o admin devolver.
  async function cancelarNoProvedor(cancelados) {
    const resultado = { canceladas: 0, falharam: 0 };
    if (!mp) return resultado;
    for (const c of cancelados ?? []) {
      const pix = c.metodo === 'pix' && c.provedor_pagamento_id;
      const cartao = c.metodo === 'cartao' && c.provedor_preferencia_id;
      if (!pix && !cartao) continue;
      let erro = null;
      try {
        if (pix) await mp.cancelarPagamento(c.provedor_pagamento_id);
        else await mp.expirarPreferencia(c.provedor_preferencia_id);
      } catch (e) {
        erro = String(e.message ?? e).slice(0, 300);
        console.warn('[pagamentos] nao foi possivel cancelar no provedor:', erro);
      }
      await banco('confirmar_cancelamento_provedor', { p_pagamento_id: c.id, p_ok: !erro, p_erro: erro })
        .catch((e) => console.warn('[pagamentos] nao foi possivel registrar o cancelamento:', e.message));
      if (!erro) {
        resultado.canceladas++;
        continue;
      }
      resultado.falharam++;
      try {
        if (pix) await aplicar(c.id, await mp.buscarPagamento(c.provedor_pagamento_id));
        else for (const t of tentativasPagas(await mp.buscarPorReferencia(c.id))) await aplicar(c.id, t);
      } catch (e) {
        console.warn('[pagamentos] nao foi possivel conferir a cobranca no provedor:', e.message);
      }
    }
    return resultado;
  }

  // `extra`: quem pediu (admin) e, no reembolso, o motivo e o id do reembolso
  async function aplicar(pagamentoId, pagamentoMp, extra = {}) {
    if (pagamentoMp.external_reference !== pagamentoId) {
      throw new PagamentoErro(409, 'REFERENCIA_DIVERGENTE', 'O pagamento do provedor não corresponde a esta cobrança.');
    }
    const r = await banco('aplicar_estado_pagamento', {
      p_pagamento_id: pagamentoId, p_estado: { ...estadoDoMercadoPago(pagamentoMp), ...extra },
    });
    await cancelarNoProvedor(r.cancelados);
    return r.pagamento;
  }

  async function criar({ usuario, agendamentoId, metodo }) {
    if (!METODOS.includes(metodo)) throw new PagamentoErro(400, 'METODO_INVALIDO', 'Forma de pagamento inválida.');
    if (!UUID_RX.test(String(agendamentoId ?? ''))) throw new PagamentoErro(404, 'AGENDAMENTO_NAO_ENCONTRADO', 'Agendamento não encontrado.');
    if (metodo !== 'presencial' && !mp) {
      throw new PagamentoErro(503, 'PAGAMENTO_ONLINE_INDISPONIVEL',
        'O pagamento online ainda não está disponível. Escolha pagar na barbearia.');
    }

    const inicio = await banco('iniciar_pagamento', { p_agendamento_id: agendamentoId, p_cliente_id: usuario.id, p_metodo: metodo });
    const { falharam } = await cancelarNoProvedor(inicio.cancelados);
    const pag = inicio.pagamento;
    if (falharam) {
      // A cobranca anterior pode ter sido paga enquanto o cliente trocava de meio:
      // nesse caso a nova ja foi cancelada e nao se gera outra cobranca
      const atual = await banco('pagamento_para_sincronizar', { p_pagamento_id: pag.id, p_cliente_id: usuario.id });
      if (atual.status !== 'pending') throw new PagamentoErro(409, 'JA_PAGO', 'Este agendamento já está pago.');
    }
    if (inicio.reaproveitado || metodo === 'presencial') return publico(pag);

    let dados;
    try {
      if (metodo === 'pix') {
        const expiraEm = new Date(agora().getTime() + minutosPix * 60000);
        const pix = await mp.criarPix({
          idempotencia: pag.id, valor: pag.valor, descricao: inicio.descricao, email: usuario.email,
          referencia: pag.id, expiraEm, urlNotificacao: config.urlNotificacao,
        });
        dados = {
          provedor_pagamento_id: pix.id, pix_copia_cola: pix.copiaCola, pix_qr_base64: pix.qrBase64,
          expira_em: expiraEm.toISOString(),
        };
      } else {
        const expiraEm = new Date(agora().getTime() + minutosCartao * 60000);
        const pref = await mp.criarPreferenciaCartao({
          referencia: pag.id, titulo: inicio.descricao, valor: pag.valor, email: usuario.email,
          urlNotificacao: config.urlNotificacao, expiraEm, sandbox: config.sandbox,
          urlRetorno: config.urlRetorno ? `${config.urlRetorno.replace(/\/$/, '')}/${agendamentoId}?retorno=1` : undefined,
        });
        dados = { provedor_preferencia_id: pref.id, link_pagamento: pref.link, expira_em: expiraEm.toISOString() };
      }
    } catch (e) {
      console.error('[pagamentos] falha ao criar cobranca:', e.message);
      await banco('falhar_cobranca', { p_pagamento_id: pag.id, p_detalhe: 'erro ao criar no provedor' });
      throw new PagamentoErro(502, 'PROVEDOR_INDISPONIVEL',
        'Não foi possível gerar a cobrança agora. Tente novamente ou escolha pagar na barbearia.');
    }
    return publico(await banco('registrar_cobranca', { p_pagamento_id: pag.id, p_dados: dados }));
  }

  // Consulta o provedor (ex.: o cliente voltou do Checkout Pro ou tocou em
  // "Já paguei"). So o dono do pagamento, ou o admin. No cartao, cada tentativa
  // paga e aplicada (um segundo pagamento na mesma pagina fica registrado).
  async function sincronizar({ usuario, pagamentoId, admin = false }) {
    if (!UUID_RX.test(String(pagamentoId ?? ''))) throw new PagamentoErro(404, 'PAGAMENTO_NAO_ENCONTRADO', 'Pagamento não encontrado.');
    const pag = await banco('pagamento_para_sincronizar', { p_pagamento_id: pagamentoId, p_cliente_id: admin ? null : usuario.id });
    if (pag.metodo === 'presencial' || !mp) return publico(pag);
    const extra = admin ? { ator: usuario.id } : {};

    if (pag.metodo === 'cartao') {
      const tentativas = await mp.buscarPorReferencia(pag.id);
      const pagas = tentativasPagas(tentativas);
      const aplicaveis = pagas.length ? pagas : [melhorTentativa(tentativas)].filter(Boolean);
      if (!aplicaveis.length) return publico(pag);
      // A primeira tentativa paga fica nesta cobranca; as seguintes viram registros proprios
      for (const t of aplicaveis) await aplicar(pag.id, t, extra);
      return publico(await banco('pagamento_para_sincronizar', { p_pagamento_id: pag.id, p_cliente_id: admin ? null : usuario.id }));
    }
    if (!pag.provedor_pagamento_id) return publico(pag);
    return publico(await aplicar(pag.id, await mp.buscarPagamento(pag.provedor_pagamento_id), extra));
  }

  // Reembolso de pagamento online (admin). Sem valor: o que falta reembolsar.
  // O banco confere (estado, valor, duplicidade a devolver antes) e registra o
  // pedido com motivo e autor antes de chamar o provedor.
  async function reembolsar({ usuario, pagamentoId, valor, motivo }) {
    if (!mp) throw new PagamentoErro(503, 'PAGAMENTO_ONLINE_INDISPONIVEL', 'O pagamento online não está configurado.');
    if (!UUID_RX.test(String(pagamentoId ?? ''))) throw new PagamentoErro(404, 'PAGAMENTO_NAO_ENCONTRADO', 'Pagamento não encontrado.');
    const pedido = valor == null || valor === '' ? null : Number(valor);
    if (pedido !== null && !Number.isFinite(pedido)) throw new PagamentoErro(400, 'VALOR_INVALIDO', 'Informe um valor válido.');
    const texto = typeof motivo === 'string' && motivo.trim() ? motivo.trim().slice(0, 300) : null;

    const preparo = await banco('preparar_reembolso', {
      p_pagamento_id: pagamentoId, p_valor: pedido, p_ator: usuario.id, p_motivo: texto,
    });
    const pag = preparo.pagamento;
    const v = Number(preparo.valor);
    let reembolso;
    try {
      reembolso = await mp.reembolsar(pag.provedor_pagamento_id, preparo.total ? null : v,
        `reembolso-${pag.id}-${pag.valor_reembolsado}-${v}`);
    } catch (e) {
      console.error('[pagamentos] falha no reembolso:', e.message);
      await banco('registrar_falha_reembolso', { p_pagamento_id: pag.id, p_ator: usuario.id, p_erro: String(e.message ?? e) })
        .catch(() => {});
      throw new PagamentoErro(502, 'PROVEDOR_INDISPONIVEL',
        'O Mercado Pago não confirmou o reembolso. Confira o pagamento em alguns minutos antes de tentar de novo.');
    }
    return publico(await aplicar(pag.id, await mp.buscarPagamento(pag.provedor_pagamento_id), {
      ator: usuario.id,
      solicitacao: { id: reembolso?.id == null ? null : String(reembolso.id), motivo: texto, ator: usuario.id },
    }));
  }

  // Cobrancas canceladas aqui que ainda podem ser pagas no Mercado Pago (de um
  // agendamento ou todas): tenta cancelar de novo
  async function cancelarAbertas({ agendamentoId } = {}) {
    if (agendamentoId != null && !UUID_RX.test(String(agendamentoId))) {
      throw new PagamentoErro(404, 'AGENDAMENTO_NAO_ENCONTRADO', 'Agendamento não encontrado.');
    }
    if (!mp) return { canceladas: 0, falharam: 0 };
    return cancelarNoProvedor(await banco('cobrancas_abertas_no_provedor', { p_agendamento_id: agendamentoId ?? null }));
  }

  // Notificacao do Mercado Pago
  async function processarNotificacao({ headers = {}, query = {}, body = {} }) {
    if (!mp || !config.segredoWebhook) {
      throw new PagamentoErro(503, 'WEBHOOK_NAO_CONFIGURADO', 'Notificações de pagamento não configuradas.');
    }
    const dataId = String(query['data.id'] ?? body?.data?.id ?? '');
    const valida = validarAssinatura({
      assinatura: headers['x-signature'], requestId: headers['x-request-id'], dataId, segredo: config.segredoWebhook,
    });
    if (!valida) throw new PagamentoErro(401, 'ASSINATURA_INVALIDA', 'Notificação com assinatura inválida.');

    const tipo = body?.type ?? query.type ?? query.topic;
    if (tipo !== 'payment' || !dataId) return { situacao: 'ignorado' };

    const chave = String(body?.id ?? headers['x-request-id'] ?? `${dataId}:${body?.action ?? ''}`);
    const evento = await banco('registrar_evento_pagamento', {
      p_provedor: 'mercadopago', p_chave: chave, p_tipo: tipo, p_recurso_id: dataId,
    });
    if (!evento.processar) return { situacao: 'repetido' };

    const concluir = (situacao, erro = null) => banco('concluir_evento_pagamento', {
      p_provedor: 'mercadopago', p_chave: chave, p_situacao: situacao, p_erro: erro,
    });
    try {
      const pagamentoMp = await mp.buscarPagamento(dataId);
      const referencia = pagamentoMp.external_reference;
      if (!UUID_RX.test(String(referencia ?? ''))) {
        await concluir('ignorado', 'sem referencia do Visage Barber');
        return { situacao: 'ignorado' };
      }
      try {
        await aplicar(referencia, pagamentoMp);
      } catch (e) {
        if (e instanceof PagamentoErro && e.status === 404) {
          await concluir('ignorado', 'pagamento desconhecido');
          return { situacao: 'ignorado' };
        }
        throw e;
      }
      await concluir('processado');
      return { situacao: 'processado' };
    } catch (e) {
      await concluir('erro', String(e.message ?? e).slice(0, 500)).catch(() => {});
      throw e;
    }
  }

  return { criar, sincronizar, reembolsar, cancelarAbertas, processarNotificacao };
}

module.exports = { criarServicoPagamentos, PagamentoErro, publico, melhorTentativa };
