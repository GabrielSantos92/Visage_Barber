// Chaves de ativacao dos avisos, uma por canal. Nada liga por padrao.
//
//   WhatsApp: NOTIFICACOES_WHATSAPP_ATIVO=true E todas as credenciais da Meta
//             do ambiente escolhido.
//   Push:     NOTIFICACOES_PUSH_ATIVO=true E EXPO_ACCESS_TOKEN (o push foi
//             cancelado; a chave existe so para o codigo antigo nao ligar sozinho).
//
// Ambiente do WhatsApp (WHATSAPP_AMBIENTE), sempre explicito e IGUAL ao do
// backend (BACKEND_AMBIENTE, services/ambienteServidor.js):
//   producao             le WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_ACCESS_TOKEN e
//                        WHATSAPP_TEMPLATE_*; envia para quem autorizou.
//   teste                le SO as variaveis WHATSAPP_TESTE_* (numero de teste da
//                        Meta, token e templates proprios) e so envia para os
//                        celulares de WHATSAPP_TESTE_DESTINATARIOS (no maximo 5,
//                        o limite do numero de teste). As credenciais de
//                        producao nunca sao usadas nesse modo.
//   vazio ou outro valor o WhatsApp nao liga (vazio NAO vale como producao).
//   Diferente do BACKEND_AMBIENTE (ou backend em desenvolvimento): nao liga.
// O segredo do app e o token de verificacao do webhook sao do app da Meta, e
// nao do numero: valem para os dois ambientes.
// Teste e producao nunca podem ter o mesmo Phone Number ID nem o mesmo token;
// se tiverem, o WhatsApp nao liga.
//
// NOTIFICACOES_ATIVAS e a chave antiga (commit 83d45a6), em que "true" ligava o
// envio pela Expo. Ela nunca deve ser configurada: se aparecer preenchida,
// nenhum canal liga, para que um rollback no Render nao ative nada por engano.
//
// Esta funcao so le nomes e valores do ambiente; nenhum valor vai para o log.

const SEGREDO_MINIMO = 32;
const TOKEN_VERIFICACAO_MINIMO = 16;
const AMBIENTES_WHATSAPP = ['producao', 'teste'];
// Limite de destinatarios do numero de teste da Meta
const MAX_DESTINATARIOS_TESTE = 5;
// Celular brasileiro como o banco o envia (public.whatsapp_telefone): 55 + DDD + 9 digitos
const CELULAR_BR = /^55[1-9][1-9]9\d{8}$/;

function lerConfiguracao(env = process.env) {
  const valor = (nome) => (typeof env[nome] === 'string' ? env[nome].trim() : '');
  const chaveAntiga = valor('NOTIFICACOES_ATIVAS') !== '';

  const ambiente = valor('WHATSAPP_AMBIENTE');
  const teste = ambiente === 'teste';
  // Cada ambiente le so as proprias credenciais do numero
  const doAmbiente = (nome) => (teste ? `WHATSAPP_TESTE_${nome}` : `WHATSAPP_${nome}`);

  const faltandoWhatsapp = [];
  if (!AMBIENTES_WHATSAPP.includes(ambiente)) {
    faltandoWhatsapp.push('WHATSAPP_AMBIENTE (use producao ou teste)');
  } else if (valor('BACKEND_AMBIENTE') !== ambiente) {
    faltandoWhatsapp.push(`BACKEND_AMBIENTE igual a WHATSAPP_AMBIENTE (${ambiente})`);
  }
  faltandoWhatsapp.push(...[
    doAmbiente('PHONE_NUMBER_ID'), doAmbiente('ACCESS_TOKEN'), 'WHATSAPP_APP_SECRET',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN', doAmbiente('TEMPLATE_CONFIRMACAO'),
    ...(teste ? ['WHATSAPP_TESTE_DESTINATARIOS'] : []),
  ].filter((nome) => valor(nome) === ''));
  if (valor('WHATSAPP_WEBHOOK_VERIFY_TOKEN') !== '' && valor('WHATSAPP_WEBHOOK_VERIFY_TOKEN').length < TOKEN_VERIFICACAO_MINIMO) {
    faltandoWhatsapp.push(`WHATSAPP_WEBHOOK_VERIFY_TOKEN (mínimo de ${TOKEN_VERIFICACAO_MINIMO} caracteres)`);
  }

  // Destinatarios autorizados no modo teste: lista inteira valida, ou nenhum
  let destinatariosTeste = [];
  if (teste && valor('WHATSAPP_TESTE_DESTINATARIOS') !== '') {
    const lista = valor('WHATSAPP_TESTE_DESTINATARIOS').split(',')
      .map((x) => x.replace(/[\s()+.-]/g, '')).filter(Boolean);
    if (lista.length === 0 || !lista.every((n) => CELULAR_BR.test(n))) {
      faltandoWhatsapp.push('WHATSAPP_TESTE_DESTINATARIOS (cada número com 55, DDD e o celular com o 9)');
    } else if (new Set(lista).size > MAX_DESTINATARIOS_TESTE) {
      faltandoWhatsapp.push(`WHATSAPP_TESTE_DESTINATARIOS (no máximo ${MAX_DESTINATARIOS_TESTE} números)`);
    } else {
      destinatariosTeste = [...new Set(lista)];
    }
  }

  // Teste e producao nunca compartilham numero nem token (nos dois sentidos)
  const iguais = (a, b) => valor(a) !== '' && valor(a) === valor(b);
  if (iguais('WHATSAPP_TESTE_PHONE_NUMBER_ID', 'WHATSAPP_PHONE_NUMBER_ID')) {
    faltandoWhatsapp.push('WHATSAPP_TESTE_PHONE_NUMBER_ID diferente de WHATSAPP_PHONE_NUMBER_ID (teste e produção não podem usar o mesmo número)');
  }
  if (iguais('WHATSAPP_TESTE_ACCESS_TOKEN', 'WHATSAPP_ACCESS_TOKEN')) {
    faltandoWhatsapp.push('WHATSAPP_TESTE_ACCESS_TOKEN diferente de WHATSAPP_ACCESS_TOKEN (teste e produção não podem usar o mesmo token)');
  }
  const whatsappPedido = valor('NOTIFICACOES_WHATSAPP_ATIVO') === 'true';

  const faltandoPush = valor('EXPO_ACCESS_TOKEN') === '' ? ['EXPO_ACCESS_TOKEN'] : [];
  const pushPedido = valor('NOTIFICACOES_PUSH_ATIVO') === 'true';

  return {
    chaveAntiga,
    segredo: valor('NOTIFICACOES_SEGREDO'),
    whatsapp: {
      pedido: whatsappPedido,
      faltando: faltandoWhatsapp,
      ativo: !chaveAntiga && whatsappPedido && faltandoWhatsapp.length === 0,
      ambiente,
      phoneNumberId: valor(doAmbiente('PHONE_NUMBER_ID')),
      token: valor(doAmbiente('ACCESS_TOKEN')),
      appSecret: valor('WHATSAPP_APP_SECRET'),
      verifyToken: valor('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
      templateConfirmacao: valor(doAmbiente('TEMPLATE_CONFIRMACAO')),
      // Opcional: sem ele, o barbeiro so ve a resposta NAO na agenda (fluxo da migration 25)
      templatePresencaNegada: valor(doAmbiente('TEMPLATE_PRESENCA_NEGADA')) || null,
      // Opcional: aviso ao barbeiro quando o cliente confirma o cancelamento
      // pelo WhatsApp (migration 26). Sem ele, o barbeiro ve so na agenda.
      templateCancelamento: valor(doAmbiente('TEMPLATE_CANCELAMENTO')) || null,
      // Opcional: aviso ao CLIENTE quando a segunda mensagem nao chegou
      // (variaveis: data, hora). Sem ele, vai como texto, que so chega com a
      // janela de 24 h aberta.
      templateCancelamentoNaoConcluido: valor(doAmbiente('TEMPLATE_CANCELAMENTO_NAO_CONCLUIDO')) || null,
      // Modo teste: so estes celulares recebem e so as mensagens deles sao
      // processadas. null = producao (sem essa lista)
      destinatariosTeste: teste ? destinatariosTeste : null,
      idioma: valor('WHATSAPP_TEMPLATE_IDIOMA') || 'pt_BR',
      versao: valor('WHATSAPP_API_VERSAO') || undefined,
      // Piloto: ids de usuarios separados por virgula; vazio = todos
      piloto: valor('WHATSAPP_PILOTO_USUARIOS').split(',').map((x) => x.trim()).filter(Boolean),
    },
    push: {
      pedido: pushPedido,
      faltando: faltandoPush,
      ativo: !chaveAntiga && pushPedido && faltandoPush.length === 0,
    },
  };
}

module.exports = { lerConfiguracao, SEGREDO_MINIMO, TOKEN_VERIFICACAO_MINIMO, MAX_DESTINATARIOS_TESTE };
