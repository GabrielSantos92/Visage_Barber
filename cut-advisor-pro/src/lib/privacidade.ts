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
