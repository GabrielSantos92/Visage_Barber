// Chaves de ativacao dos avisos, uma por canal. Nada liga por padrao.
//
//   WhatsApp: NOTIFICACOES_WHATSAPP_ATIVO=true E todas as credenciais da Meta.
//   Push:     NOTIFICACOES_PUSH_ATIVO=true E EXPO_ACCESS_TOKEN (o push foi
//             cancelado; a chave existe so para o codigo antigo nao ligar sozinho).
//
// NOTIFICACOES_ATIVAS e a chave antiga (commit 83d45a6), em que "true" ligava o
// envio pela Expo. Ela nunca deve ser configurada: se aparecer preenchida,
// nenhum canal liga, para que um rollback no Render nao ative nada por engano.
//
// Esta funcao so le nomes e valores do ambiente; nenhum valor vai para o log.

const SEGREDO_MINIMO = 32;
const TOKEN_VERIFICACAO_MINIMO = 16;

function lerConfiguracao(env = process.env) {
  const valor = (nome) => (typeof env[nome] === 'string' ? env[nome].trim() : '');
  const chaveAntiga = valor('NOTIFICACOES_ATIVAS') !== '';

  const faltandoWhatsapp = [
    'WHATSAPP_PHONE_NUMBER_ID', 'WHATSAPP_ACCESS_TOKEN', 'WHATSAPP_APP_SECRET',
    'WHATSAPP_WEBHOOK_VERIFY_TOKEN', 'WHATSAPP_TEMPLATE_CONFIRMACAO',
  ].filter((nome) => valor(nome) === '');
  if (valor('WHATSAPP_WEBHOOK_VERIFY_TOKEN') !== '' && valor('WHATSAPP_WEBHOOK_VERIFY_TOKEN').length < TOKEN_VERIFICACAO_MINIMO) {
    faltandoWhatsapp.push(`WHATSAPP_WEBHOOK_VERIFY_TOKEN (mínimo de ${TOKEN_VERIFICACAO_MINIMO} caracteres)`);
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
      phoneNumberId: valor('WHATSAPP_PHONE_NUMBER_ID'),
      token: valor('WHATSAPP_ACCESS_TOKEN'),
      appSecret: valor('WHATSAPP_APP_SECRET'),
      verifyToken: valor('WHATSAPP_WEBHOOK_VERIFY_TOKEN'),
      templateConfirmacao: valor('WHATSAPP_TEMPLATE_CONFIRMACAO'),
      // Opcional: sem ele, o barbeiro so ve a resposta NAO na agenda
      templatePresencaNegada: valor('WHATSAPP_TEMPLATE_PRESENCA_NEGADA') || null,
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

module.exports = { lerConfiguracao, SEGREDO_MINIMO, TOKEN_VERIFICACAO_MINIMO };
