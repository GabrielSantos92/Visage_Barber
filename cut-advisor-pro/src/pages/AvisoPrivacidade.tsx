import { useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Navbar from "@/components/Navbar";
import { CANAL_PRIVACIDADE, VERSAO_AVISO_VISAGISMO } from "@/lib/privacidade";

// Aviso de Privacidade da analise de visagismo por foto. So descreve o que o
// sistema faz de fato (conferido no codigo). Texto sujeito a validacao juridica.
const SECOES: { titulo: string; paragrafos: string[]; itens?: string[] }[] = [
  {
    titulo: "1. A quem se aplica",
    paragrafos: [
      "Este aviso explica como o Visage Barber trata a fotografia que você envia para a análise de visagismo por inteligência artificial, no site e no aplicativo.",
    ],
  },
  {
    titulo: "2. Quais dados tratamos",
    paragrafos: ["Para esta funcionalidade, tratamos:"],
    itens: [
      "A fotografia do seu rosto que você escolher ou tirar no momento da análise.",
      "O resultado da análise: formato do rosto, características observadas e cortes e barba recomendados.",
      "A imagem de simulação gerada com o corte recomendado.",
      "O registro da sua concordância com este aviso: data e hora, versão do aviso, se foi feita pelo site ou pelo aplicativo e, se houver, a data da revogação.",
    ],
  },
  {
    titulo: "3. Para que usamos",
    paragrafos: ["A fotografia é usada somente para:"],
    itens: [
      "Analisar características visuais do rosto para recomendar cortes de cabelo e estilos de barba.",
      "Gerar uma simulação visual do corte recomendado sobre a sua própria foto.",
      "Apresentar o resultado para você dentro do Visage Barber.",
    ],
  },
  {
    titulo: "4. Base legal",
    paragrafos: [
      "O envio da foto para análise depende da sua concordância, manifestada de forma específica antes do envio. Sem ela, a análise por foto não é realizada. Você pode usar as demais funções do Visage Barber sem concordar.",
    ],
  },
  {
    titulo: "5. Processamento por inteligência artificial e compartilhamento",
    paragrafos: [
      "Para realizar a análise e gerar a simulação, a fotografia é enviada aos seguintes fornecedores de serviços de inteligência artificial, que podem estar localizados fora do Brasil:",
    ],
    itens: [
      "Google (modelos Gemini), para a análise e a geração da simulação.",
      "Replicate, plataforma que pode executar esses mesmos modelos e o modelo que identifica as áreas de cabelo e barba na foto.",
    ],
  },
  {
    titulo: "6. Armazenamento",
    paragrafos: [
      "O servidor do Visage Barber processa a foto apenas durante a análise e não a grava em banco de dados nem em registros de sistema.",
      "No aplicativo, se você tocar em \"Salvar no app\", a comparação (antes e depois) é guardada em uma área privada vinculada à sua conta. Só você tem acesso, além do barbeiro a quem você escolher enviá-la pelo chat. Você pode excluir uma análise salva a qualquer momento em \"Análises salvas\"; ao excluir, ela também deixa de aparecer no chat.",
      "O tratamento da imagem pelos fornecedores de inteligência artificial segue as condições desses fornecedores.",
    ],
  },
  {
    titulo: "7. Revogação",
    paragrafos: [
      "Você pode revogar sua concordância a qualquer momento, sem custo, na seção Privacidade do seu Perfil, no site ou no aplicativo. Depois da revogação, nenhuma nova foto é enviada para análise até que você concorde novamente.",
      "A revogação não desfaz análises já realizadas. Análises salvas no aplicativo continuam disponíveis até que você as exclua.",
    ],
  },
  {
    titulo: "8. Seus direitos",
    paragrafos: [
      "Nos termos da Lei Geral de Proteção de Dados (Lei nº 13.709/2018), você pode solicitar: confirmação da existência de tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários ou excessivos; portabilidade; eliminação dos dados tratados com base no consentimento; informação sobre as entidades com as quais os dados são compartilhados; informação sobre a possibilidade de não consentir e suas consequências; e revogação do consentimento.",
    ],
  },
];

export default function AvisoPrivacidade() {
  const navigate = useNavigate();
  const data = new Date(`${VERSAO_AVISO_VISAGISMO}T12:00:00`).toLocaleDateString("pt-BR");

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-12">
        <button
          onClick={() => (window.history.length > 1 ? navigate(-1) : navigate("/"))}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-6"
        >
          <ArrowLeft className="size-3" /> Voltar
        </button>
        <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-3">PRIVACIDADE // LGPD</p>
        <h1 className="text-4xl font-light text-primary tracking-tighter mb-3">Aviso de Privacidade</h1>
        <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mb-10 border-b border-border pb-8">
          Análise de visagismo por foto · Versão de {data}
        </p>

        <div className="space-y-8">
          {SECOES.map((s) => (
            <section key={s.titulo}>
              <h2 className="text-lg font-semibold text-primary mb-3">{s.titulo}</h2>
              {s.paragrafos.map((p) => (
                <p key={p} className="text-sm text-foreground leading-relaxed mb-3">{p}</p>
              ))}
              {s.itens && (
                <ul className="space-y-2">
                  {s.itens.map((i) => (
                    <li key={i} className="flex gap-3 text-sm text-foreground leading-relaxed">
                      <span aria-hidden className="size-1.5 bg-accent flex-shrink-0 mt-2" />
                      {i}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section>
            <h2 className="text-lg font-semibold text-primary mb-3">9. Como entrar em contato</h2>
            <p className="text-sm text-foreground leading-relaxed">
              {CANAL_PRIVACIDADE
                ? `Para exercer seus direitos ou tirar dúvidas sobre este aviso, entre em contato por: ${CANAL_PRIVACIDADE}.`
                : "O canal específico para solicitações sobre privacidade será informado nesta página. Enquanto isso, a revogação da concordância pode ser feita diretamente no seu Perfil."}
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}
