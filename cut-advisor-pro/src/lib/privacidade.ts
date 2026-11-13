import { apiGet, apiPost } from "@/lib/api";

// Consentimento para envio de foto ao visagismo (LGPD). Quem decide se a foto
// pode ser enviada e o backend; aqui so mostramos o aviso e registramos a escolha.
export const FINALIDADE_VISAGISMO = "visagismo_foto";

// Versao do texto do aviso exibido no app. Deve ser igual a
// FINALIDADES.visagismo_foto.versaoAviso em backend/src/services/consentimento.js
// (e a do mobile). Ao mudar o texto, mude a versao nos tres lugares.
export const VERSAO_AVISO_VISAGISMO = "2026-11-04";

// Canal para o titular exercer seus direitos (art. 18 e 41 da LGPD).
// PENDENTE: definir com o responsavel juridico antes de publicar.
export const CANAL_PRIVACIDADE: string | null = null;

export type SituacaoConsentimento = {
  finalidade: string;
  versao_atual: string;
  consentido: boolean;
  concedido_em: string | null;
  origem: "web" | "mobile" | null;
};

const URL = `/api/privacidade/consentimentos/${FINALIDADE_VISAGISMO}`;

export const buscarConsentimentoVisagismo = () => apiGet<SituacaoConsentimento>(URL);

export const concederConsentimentoVisagismo = () =>
  apiPost<SituacaoConsentimento>(URL, { versao: VERSAO_AVISO_VISAGISMO, origem: "web" });

export const revogarConsentimentoVisagismo = () =>
  apiPost<SituacaoConsentimento>(`${URL}/revogar`, { origem: "web" });

// Texto do aviso exibido antes do envio da foto
export const AVISO_VISAGISMO = {
  titulo: "Privacidade e proteção dos seus dados",
  introducao: "Antes de enviar sua fotografia para a análise de visagismo, queremos explicar como ela será utilizada.",
  usos: [
    "Analisar características visuais do rosto para recomendar cortes de cabelo.",
    "Gerar uma simulação visual do corte recomendado.",
    "Apresentar o resultado dentro do Visage Barber.",
  ],
  ia: "Sua fotografia poderá ser processada por serviços de inteligência artificial utilizados pelo Visage Barber para realizar a análise e gerar a simulação. O processamento poderá envolver o compartilhamento da imagem com os fornecedores responsáveis por esses serviços, que podem estar localizados fora do Brasil, conforme as condições descritas no Aviso de Privacidade.",
  direitos: "Você poderá solicitar informações sobre o tratamento dos seus dados, bem como exercer os direitos previstos na LGPD pelos canais de atendimento indicados no Aviso de Privacidade. Você pode revogar esta autorização a qualquer momento no seu Perfil.",
  concordancia: "Li e concordo com o tratamento da minha fotografia para a análise de visagismo e geração da simulação, conforme o Aviso de Privacidade.",
};

// ---------------------------------------------------------------
// Pagamentos online (Mercado Pago): segunda parte do Aviso de Privacidade, com
// versao propria. Nao depende de concordancia (o tratamento e necessario para
// cobrar o servico escolhido), por isso nao muda a versao do aviso do
// visagismo. So descreve o que o sistema faz de fato, conferido no backend
// (services/mercadoPago.js e services/pagamentos.js). Texto sujeito a
// validacao juridica.
// ---------------------------------------------------------------
export const VERSAO_AVISO_PAGAMENTOS = "2026-11-05";

// Resumo exibido na tela de pagamento, antes de escolher PIX ou cartao
export const AVISO_PAGAMENTO_RESUMO =
  "Ao pagar com PIX ou cartão, enviamos ao Mercado Pago o seu e-mail, o serviço e o valor. Os dados do cartão são digitados na página do Mercado Pago e não passam pelo Visage Barber.";

export const AVISO_PAGAMENTOS: { titulo: string; paragrafos: string[]; itens?: string[] }[] = [
  {
    titulo: "Quando se aplica",
    paragrafos: [
      "Quando você paga um agendamento com PIX ou cartão de crédito, no site ou no aplicativo. O pagamento é processado pelo Mercado Pago e o valor é recebido na conta da barbearia.",
      "Se você escolher pagar na barbearia, nenhum dado seu é enviado ao Mercado Pago.",
    ],
  },
  {
    titulo: "O que o Visage Barber envia ao Mercado Pago",
    paragrafos: ["Para gerar a cobrança, enviamos somente:"],
    itens: [
      "O e-mail da sua conta no Visage Barber, para identificar quem paga.",
      "O nome do serviço e o valor do agendamento.",
      "Códigos internos do pagamento e do agendamento, que não contêm dados pessoais, para relacionar a confirmação do Mercado Pago ao seu agendamento.",
      "O prazo de validade da cobrança.",
      "Não enviamos seu nome, telefone, CPF, a data e o horário do atendimento, o barbeiro escolhido nem fotos.",
    ],
  },
  {
    titulo: "O que o Mercado Pago recebe diretamente de você",
    paragrafos: [
      "No cartão, os dados do cartão (como número, validade, código de segurança e dados do titular) são digitados na página do próprio Mercado Pago. Eles não passam pelo Visage Barber e não são guardados por nós.",
      "No PIX, você paga pelo aplicativo do seu banco, e as informações da transferência são tratadas pelo seu banco e pelo Mercado Pago.",
      "O tratamento desses dados pelo Mercado Pago segue a política de privacidade do próprio Mercado Pago.",
    ],
  },
  {
    titulo: "O que guardamos",
    paragrafos: ["Não guardamos os dados do cartão nem os dados de quem pagou informados ao Mercado Pago. Para cada pagamento, guardamos:"],
    itens: [
      "A forma de pagamento, o valor, o desconto, a situação (aguardando, pago, recusado, expirado, cancelado ou reembolsado) e as datas.",
      "As taxas cobradas pelo meio de pagamento.",
      "Os códigos do pagamento no Mercado Pago e o código PIX (copia e cola e QR Code) ou o link de pagamento.",
      "Os reembolsos: valor, data, motivo e quem fez a devolução.",
      "Um histórico das operações de cada pagamento (por exemplo: cobrança criada, pagamento confirmado, reembolso pedido), com a data, a origem e quem fez a operação, para controle financeiro e auditoria.",
    ],
  },
  {
    titulo: "Para que usamos e base legal",
    paragrafos: [
      "Usamos esses dados para cobrar o agendamento, confirmar o pagamento, fazer reembolsos, calcular a comissão dos barbeiros e manter o controle financeiro da barbearia.",
      "O tratamento é necessário para executar o serviço que você contratou e para cumprir obrigações legais (art. 7º, incisos V e II, da LGPD). Por isso, ele não depende da concordância pedida no visagismo.",
    ],
  },
  {
    titulo: "Quem vê os seus pagamentos",
    paragrafos: [
      "No Visage Barber, os seus pagamentos são vistos por você e pelo administrador da barbearia. O barbeiro vê apenas o valor dos serviços que realizou e a comissão dele, sem o seu nome e sem os dados do pagamento.",
    ],
  },
  {
    titulo: "Por quanto tempo guardamos",
    paragrafos: [
      "Os registros de pagamento não são apagados pelo sistema, porque fazem parte do histórico financeiro da barbearia. O prazo de guarda será definido pela barbearia de acordo com as obrigações legais e fiscais.",
    ],
  },
  {
    titulo: "Seus direitos",
    paragrafos: [
      "Os direitos previstos na LGPD e o canal de contato descritos na primeira parte deste aviso (itens 8 e 9) também valem para os dados de pagamento.",
    ],
  },
];

// ---------------------------------------------------------------
// WhatsApp: confirmacao de presenca 2 horas antes do atendimento. Depende da
// concordancia do titular, dada no Perfil, e pode ser desfeita la ou
// respondendo PARAR. A versao deve ser igual a
// FINALIDADES.whatsapp_avisos.versaoAviso em backend/src/services/consentimento.js
// (e a da outra plataforma). So descreve o que o sistema faz de fato (migration
// 20261113000025 e backend/src/services/confirmacaoPresenca.js). Texto sujeito
// a validacao juridica.
// ---------------------------------------------------------------
export const FINALIDADE_WHATSAPP = "whatsapp_avisos";
export const VERSAO_AVISO_WHATSAPP = "2026-11-13";

const URL_WHATSAPP = `/api/privacidade/consentimentos/${FINALIDADE_WHATSAPP}`;

export const buscarConsentimentoWhatsapp = () => apiGet<SituacaoConsentimento>(URL_WHATSAPP);

export const concederConsentimentoWhatsapp = () =>
  apiPost<SituacaoConsentimento>(URL_WHATSAPP, { versao: VERSAO_AVISO_WHATSAPP, origem: "web" });

export const revogarConsentimentoWhatsapp = () =>
  apiPost<SituacaoConsentimento>(`${URL_WHATSAPP}/revogar`, { origem: "web" });

// So celular brasileiro (DDD + 9 digitos) recebe WhatsApp pelo numero do cadastro
export const celularParaWhatsapp = (telefone: string | null | undefined) =>
  /^[1-9][1-9]9\d{8}$/.test((telefone ?? "").replace(/\D/g, "").replace(/^0+/, "").replace(/^55(?=\d{11}$)/, ""));

// Resumo exibido no Perfil, junto da opcao de ativar
export const AVISO_WHATSAPP_RESUMO =
  "Duas horas antes de cada atendimento, enviamos uma mensagem ao celular do seu cadastro perguntando se você confirma a presença. Você responde Sim ou Não. Responder Não não cancela o agendamento.";

export const AVISO_WHATSAPP_CONCORDANCIA =
  "Autorizo o Visage Barber a enviar mensagens sobre os meus agendamentos para o celular do meu cadastro pelo WhatsApp, conforme o Aviso de Privacidade.";

export const AVISO_WHATSAPP: { titulo: string; paragrafos: string[]; itens?: string[] }[] = [
  {
    titulo: "Quando se aplica",
    paragrafos: [
      "Só depois que você ativa a opção “Mensagens pelo WhatsApp” no seu Perfil. Sem essa autorização, nenhuma mensagem é enviada.",
      "Cerca de duas horas antes de cada atendimento confirmado, enviamos uma mensagem ao celular do seu cadastro perguntando se você confirma a presença. Quem agenda com menos de duas horas de antecedência não recebe a mensagem.",
    ],
  },
  {
    titulo: "O que a mensagem leva e quem a envia",
    paragrafos: ["O envio é feito pela WhatsApp Business Platform, serviço oficial da Meta. Para isso, a Meta recebe:"],
    itens: [
      "O número do celular do seu cadastro.",
      "O texto da mensagem: seu primeiro nome, o serviço, o primeiro nome do barbeiro, a data e o horário.",
      "Não enviamos valores, pagamentos, fotos nem mensagens do chat.",
    ],
  },
  {
    titulo: "A sua resposta",
    paragrafos: [
      "Sua resposta (Sim ou Não) é registrada e mostrada ao barbeiro do atendimento. Responder Não não cancela o agendamento: o horário continua reservado até que você ou a barbearia o cancele.",
      "Se você não responder, o agendamento continua valendo e o barbeiro vê “Sem resposta”.",
    ],
  },
  {
    titulo: "O que guardamos",
    paragrafos: ["Para cada mensagem, guardamos:"],
    itens: [
      "A situação do envio (enviada, entregue, lida ou com falha) e as datas.",
      "O código da mensagem na Meta e o número pelo qual ela foi entregue.",
      "A sua resposta e quando ela chegou.",
      "O registro da sua autorização e, se houver, da revogação.",
    ],
  },
  {
    titulo: "Como parar de receber",
    paragrafos: [
      "Desative a opção no seu Perfil, ou responda PARAR a qualquer mensagem. Nos dois casos, nenhuma nova mensagem é enviada; para voltar a receber, ative de novo no Perfil.",
    ],
  },
  {
    titulo: "Barbeiros",
    paragrafos: [
      "O barbeiro que ativa a opção recebe pelo WhatsApp um aviso quando um cliente informa que não virá, com o primeiro nome do cliente, o serviço, a data e o horário.",
    ],
  },
];
