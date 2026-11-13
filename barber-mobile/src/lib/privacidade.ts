import { api } from './api';

// Consentimento para envio de foto ao visagismo (LGPD). Quem decide se a foto
// pode ser enviada e o backend; aqui so mostramos o aviso e registramos a escolha.
export const FINALIDADE_VISAGISMO = 'visagismo_foto';

// Versao do texto do aviso exibido no app. Deve ser igual a
// FINALIDADES.visagismo_foto.versaoAviso em backend/src/services/consentimento.js
// (e a da web). Ao mudar o texto, mude a versao nos tres lugares.
export const VERSAO_AVISO_VISAGISMO = '2026-11-04';

// Canal para o titular exercer seus direitos (art. 18 e 41 da LGPD).
// PENDENTE: definir com o responsavel juridico antes de publicar.
export const CANAL_PRIVACIDADE: string | null = null;

export type SituacaoConsentimento = {
  finalidade: string;
  versao_atual: string;
  consentido: boolean;
  concedido_em: string | null;
  origem: 'web' | 'mobile' | null;
};

const URL = `/api/privacidade/consentimentos/${FINALIDADE_VISAGISMO}`;

export const buscarConsentimentoVisagismo = () => api.get<SituacaoConsentimento>(URL);

export const concederConsentimentoVisagismo = () =>
  api.post<SituacaoConsentimento>(URL, { versao: VERSAO_AVISO_VISAGISMO, origem: 'mobile' });

export const revogarConsentimentoVisagismo = () =>
  api.post<SituacaoConsentimento>(`${URL}/revogar`, { origem: 'mobile' });

// Texto do aviso exibido antes do envio da foto (igual ao da web)
export const AVISO_VISAGISMO = {
  titulo: 'Privacidade e proteção dos seus dados',
  introducao: 'Antes de enviar sua fotografia para a análise de visagismo, queremos explicar como ela será utilizada.',
  usos: [
    'Analisar características visuais do rosto para recomendar cortes de cabelo.',
    'Gerar uma simulação visual do corte recomendado.',
    'Apresentar o resultado dentro do Visage Barber.',
  ],
  ia: 'Sua fotografia poderá ser processada por serviços de inteligência artificial utilizados pelo Visage Barber para realizar a análise e gerar a simulação. O processamento poderá envolver o compartilhamento da imagem com os fornecedores responsáveis por esses serviços, que podem estar localizados fora do Brasil, conforme as condições descritas no Aviso de Privacidade.',
  direitos: 'Você poderá solicitar informações sobre o tratamento dos seus dados, bem como exercer os direitos previstos na LGPD pelos canais de atendimento indicados no Aviso de Privacidade. Você pode revogar esta autorização a qualquer momento no seu Perfil.',
  concordancia: 'Li e concordo com o tratamento da minha fotografia para a análise de visagismo e geração da simulação, conforme o Aviso de Privacidade.',
};

// Aviso de Privacidade completo (igual ao da web). So descreve o que o sistema
// faz de fato. Texto sujeito a validacao juridica.
export const AVISO_COMPLETO: { titulo: string; paragrafos: string[]; itens?: string[] }[] = [
  {
    titulo: '1. A quem se aplica',
    paragrafos: [
      'Este aviso explica como o Visage Barber trata a fotografia que você envia para a análise de visagismo por inteligência artificial, no site e no aplicativo.',
    ],
  },
  {
    titulo: '2. Quais dados tratamos',
    paragrafos: ['Para esta funcionalidade, tratamos:'],
    itens: [
      'A fotografia do seu rosto que você escolher ou tirar no momento da análise.',
      'O resultado da análise: formato do rosto, características observadas e cortes e barba recomendados.',
      'A imagem de simulação gerada com o corte recomendado.',
      'O registro da sua concordância com este aviso: data e hora, versão do aviso, se foi feita pelo site ou pelo aplicativo e, se houver, a data da revogação.',
    ],
  },
  {
    titulo: '3. Para que usamos',
    paragrafos: ['A fotografia é usada somente para:'],
    itens: [
      'Analisar características visuais do rosto para recomendar cortes de cabelo e estilos de barba.',
      'Gerar uma simulação visual do corte recomendado sobre a sua própria foto.',
      'Apresentar o resultado para você dentro do Visage Barber.',
    ],
  },
  {
    titulo: '4. Base legal',
    paragrafos: [
      'O envio da foto para análise depende da sua concordância, manifestada de forma específica antes do envio. Sem ela, a análise por foto não é realizada. Você pode usar as demais funções do Visage Barber sem concordar.',
    ],
  },
  {
    titulo: '5. Processamento por inteligência artificial e compartilhamento',
    paragrafos: [
      'Para realizar a análise e gerar a simulação, a fotografia é enviada aos seguintes fornecedores de serviços de inteligência artificial, que podem estar localizados fora do Brasil:',
    ],
    itens: [
      'Google (modelos Gemini), para a análise e a geração da simulação.',
      'Replicate, plataforma que pode executar esses mesmos modelos e o modelo que identifica as áreas de cabelo e barba na foto.',
    ],
  },
  {
    titulo: '6. Armazenamento',
    paragrafos: [
      'O servidor do Visage Barber processa a foto apenas durante a análise e não a grava em banco de dados nem em registros de sistema.',
      'No aplicativo, se você tocar em "Salvar no app", a comparação (antes e depois) é guardada em uma área privada vinculada à sua conta. Só você tem acesso, além do barbeiro a quem você escolher enviá-la pelo chat. Você pode excluir uma análise salva a qualquer momento em "Análises salvas"; ao excluir, ela também deixa de aparecer no chat.',
      'O tratamento da imagem pelos fornecedores de inteligência artificial segue as condições desses fornecedores.',
    ],
  },
  {
    titulo: '7. Revogação',
    paragrafos: [
      'Você pode revogar sua concordância a qualquer momento, sem custo, na seção Privacidade do seu Perfil, no site ou no aplicativo. Depois da revogação, nenhuma nova foto é enviada para análise até que você concorde novamente.',
      'A revogação não desfaz análises já realizadas. Análises salvas no aplicativo continuam disponíveis até que você as exclua.',
    ],
  },
  {
    titulo: '8. Seus direitos',
    paragrafos: [
      'Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode solicitar: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos; portabilidade; eliminação dos dados tratados com base no consentimento; informação sobre as entidades com as quais os dados são compartilhados; informação sobre a possibilidade de não consentir e suas consequências; e revogação do consentimento.',
    ],
  },
  {
    titulo: '9. Como entrar em contato',
    paragrafos: [
      CANAL_PRIVACIDADE
        ? `Para exercer seus direitos ou tirar dúvidas sobre este aviso, entre em contato por: ${CANAL_PRIVACIDADE}.`
        : 'O canal específico para solicitações sobre privacidade será informado nesta página. Enquanto isso, a revogação da concordância pode ser feita diretamente no seu Perfil.',
    ],
  },
];

// ---------------------------------------------------------------
// Pagamentos online (Mercado Pago): segunda parte do Aviso de Privacidade, com
// versao propria. Nao depende de concordancia (o tratamento e necessario para
// cobrar o servico escolhido), por isso nao muda a versao do aviso do
// visagismo. So descreve o que o sistema faz de fato, conferido no backend
// (services/mercadoPago.js e services/pagamentos.js). Texto sujeito a
// validacao juridica.
// ---------------------------------------------------------------
export const VERSAO_AVISO_PAGAMENTOS = '2026-11-05';

// Resumo exibido na tela de pagamento, antes de escolher PIX ou cartao
export const AVISO_PAGAMENTO_RESUMO =
  'Ao pagar com PIX ou cartão, enviamos ao Mercado Pago o seu e-mail, o serviço e o valor. Os dados do cartão são digitados na página do Mercado Pago e não passam pelo Visage Barber.';

export const AVISO_PAGAMENTOS: { titulo: string; paragrafos: string[]; itens?: string[] }[] = [
  {
    titulo: 'Quando se aplica',
    paragrafos: [
      'Quando você paga um agendamento com PIX ou cartão de crédito, no site ou no aplicativo. O pagamento é processado pelo Mercado Pago e o valor é recebido na conta da barbearia.',
      'Se você escolher pagar na barbearia, nenhum dado seu é enviado ao Mercado Pago.',
    ],
  },
  {
    titulo: 'O que o Visage Barber envia ao Mercado Pago',
    paragrafos: ['Para gerar a cobrança, enviamos somente:'],
    itens: [
      'O e-mail da sua conta no Visage Barber, para identificar quem paga.',
      'O nome do serviço e o valor do agendamento.',
      'Códigos internos do pagamento e do agendamento, que não contêm dados pessoais, para relacionar a confirmação do Mercado Pago ao seu agendamento.',
      'O prazo de validade da cobrança.',
      'Não enviamos seu nome, telefone, CPF, a data e o horário do atendimento, o barbeiro escolhido nem fotos.',
    ],
  },
  {
    titulo: 'O que o Mercado Pago recebe diretamente de você',
    paragrafos: [
      'No cartão, os dados do cartão (como número, validade, código de segurança e dados do titular) são digitados na página do próprio Mercado Pago. Eles não passam pelo Visage Barber e não são guardados por nós.',
      'No PIX, você paga pelo aplicativo do seu banco, e as informações da transferência são tratadas pelo seu banco e pelo Mercado Pago.',
      'O tratamento desses dados pelo Mercado Pago segue a política de privacidade do próprio Mercado Pago.',
    ],
  },
  {
    titulo: 'O que guardamos',
    paragrafos: ['Não guardamos os dados do cartão nem os dados de quem pagou informados ao Mercado Pago. Para cada pagamento, guardamos:'],
    itens: [
      'A forma de pagamento, o valor, o desconto, a situação (aguardando, pago, recusado, expirado, cancelado ou reembolsado) e as datas.',
      'As taxas cobradas pelo meio de pagamento.',
      'Os códigos do pagamento no Mercado Pago e o código PIX (copia e cola e QR Code) ou o link de pagamento.',
      'Os reembolsos: valor, data, motivo e quem fez a devolução.',
      'Um histórico das operações de cada pagamento (por exemplo: cobrança criada, pagamento confirmado, reembolso pedido), com a data, a origem e quem fez a operação, para controle financeiro e auditoria.',
    ],
  },
  {
    titulo: 'Para que usamos e base legal',
    paragrafos: [
      'Usamos esses dados para cobrar o agendamento, confirmar o pagamento, fazer reembolsos, calcular a comissão dos barbeiros e manter o controle financeiro da barbearia.',
      'O tratamento é necessário para executar o serviço que você contratou e para cumprir obrigações legais (art. 7º, incisos V e II, da LGPD). Por isso, ele não depende da concordância pedida no visagismo.',
    ],
  },
  {
    titulo: 'Quem vê os seus pagamentos',
    paragrafos: [
      'No Visage Barber, os seus pagamentos são vistos por você e pelo administrador da barbearia. O barbeiro vê apenas o valor dos serviços que realizou e a comissão dele, sem o seu nome e sem os dados do pagamento.',
    ],
  },
  {
    titulo: 'Por quanto tempo guardamos',
    paragrafos: [
      'Os registros de pagamento não são apagados pelo sistema, porque fazem parte do histórico financeiro da barbearia. O prazo de guarda será definido pela barbearia de acordo com as obrigações legais e fiscais.',
    ],
  },
  {
    titulo: 'Seus direitos',
    paragrafos: [
      'Os direitos previstos na LGPD e o canal de contato descritos na primeira parte deste aviso (itens 8 e 9) também valem para os dados de pagamento.',
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
export const FINALIDADE_WHATSAPP = 'whatsapp_avisos';
export const VERSAO_AVISO_WHATSAPP = '2026-11-13';

const URL_WHATSAPP = `/api/privacidade/consentimentos/${FINALIDADE_WHATSAPP}`;

export const buscarConsentimentoWhatsapp = () => api.get<SituacaoConsentimento>(URL_WHATSAPP);

export const concederConsentimentoWhatsapp = () =>
  api.post<SituacaoConsentimento>(URL_WHATSAPP, { versao: VERSAO_AVISO_WHATSAPP, origem: 'mobile' });

export const revogarConsentimentoWhatsapp = () =>
  api.post<SituacaoConsentimento>(`${URL_WHATSAPP}/revogar`, { origem: 'mobile' });

// So celular brasileiro (DDD + 9 digitos) recebe WhatsApp pelo numero do cadastro
export const celularParaWhatsapp = (telefone: string | null | undefined) =>
  /^[1-9][1-9]9\d{8}$/.test((telefone ?? '').replace(/\D/g, '').replace(/^0+/, '').replace(/^55(?=\d{11}$)/, ''));

// Resumo exibido no Perfil, junto da opcao de ativar
export const AVISO_WHATSAPP_RESUMO =
  'Duas horas antes de cada atendimento, enviamos uma mensagem ao celular do seu cadastro perguntando se você confirma a presença. Você responde Sim ou Não. Responder Não não cancela o agendamento.';

export const AVISO_WHATSAPP_CONCORDANCIA =
  'Autorizo o Visage Barber a enviar mensagens sobre os meus agendamentos para o celular do meu cadastro pelo WhatsApp, conforme o Aviso de Privacidade.';

export const AVISO_WHATSAPP: { titulo: string; paragrafos: string[]; itens?: string[] }[] = [
  {
    titulo: 'Quando se aplica',
    paragrafos: [
      'Só depois que você ativa a opção “Mensagens pelo WhatsApp” no seu Perfil. Sem essa autorização, nenhuma mensagem é enviada.',
      'Cerca de duas horas antes de cada atendimento confirmado, enviamos uma mensagem ao celular do seu cadastro perguntando se você confirma a presença. Quem agenda com menos de duas horas de antecedência não recebe a mensagem.',
    ],
  },
  {
    titulo: 'O que a mensagem leva e quem a envia',
    paragrafos: ['O envio é feito pela WhatsApp Business Platform, serviço oficial da Meta. Para isso, a Meta recebe:'],
    itens: [
      'O número do celular do seu cadastro.',
      'O texto da mensagem: seu primeiro nome, o serviço, o primeiro nome do barbeiro, a data e o horário.',
      'Não enviamos valores, pagamentos, fotos nem mensagens do chat.',
    ],
  },
  {
    titulo: 'A sua resposta',
    paragrafos: [
      'Sua resposta (Sim ou Não) é registrada e mostrada ao barbeiro do atendimento. Responder Não não cancela o agendamento: o horário continua reservado até que você ou a barbearia o cancele.',
      'Se você não responder, o agendamento continua valendo e o barbeiro vê “Sem resposta”.',
    ],
  },
  {
    titulo: 'O que guardamos',
    paragrafos: ['Para cada mensagem, guardamos:'],
    itens: [
      'A situação do envio (enviada, entregue, lida ou com falha) e as datas.',
      'O código da mensagem na Meta e o número pelo qual ela foi entregue.',
      'A sua resposta e quando ela chegou.',
      'O registro da sua autorização e, se houver, da revogação.',
    ],
  },
  {
    titulo: 'Como parar de receber',
    paragrafos: [
      'Desative a opção no seu Perfil, ou responda PARAR a qualquer mensagem. Nos dois casos, nenhuma nova mensagem é enviada; para voltar a receber, ative de novo no Perfil.',
    ],
  },
  {
    titulo: 'Barbeiros',
    paragrafos: [
      'O barbeiro que ativa a opção recebe pelo WhatsApp um aviso quando um cliente informa que não virá, com o primeiro nome do cliente, o serviço, a data e o horário.',
    ],
  },
];
