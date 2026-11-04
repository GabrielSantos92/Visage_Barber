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
