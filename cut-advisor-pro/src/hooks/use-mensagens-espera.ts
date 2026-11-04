import { useEffect, useState } from "react";

// O backend devolve a imagem de uma vez, sem progresso real. As mensagens so
// mostram que a espera continua; nenhuma afirma que uma etapa terminou.
export const MENSAGENS_ESPERA = [
  "Analisando o formato do rosto...",
  "Identificando o corte mais adequado...",
  "Preparando o estilo recomendado...",
  "Aplicando o corte à sua foto...",
  "Ajustando os detalhes do cabelo...",
  "Finalizando a simulação...",
  "Quase pronto...",
];

// Depois da sequencia, a espera pode durar mais um bom tempo: alterna frases
// neutras em vez de ficar parado em "Quase pronto...".
export const MENSAGENS_ESPERA_LONGA = [
  "Ainda trabalhando na sua foto...",
  "Isso pode levar até 2 minutos...",
  "Ajustando os detalhes do cabelo...",
];

export const INTERVALO_MENSAGEM_MS = 4000;

export function mensagemDoPasso(passo: number) {
  if (passo < MENSAGENS_ESPERA.length) return MENSAGENS_ESPERA[passo];
  const resto = (passo - MENSAGENS_ESPERA.length) % MENSAGENS_ESPERA_LONGA.length;
  return MENSAGENS_ESPERA_LONGA[resto];
}

// Enquanto `ativo`, troca a mensagem a cada intervalo e conta os segundos.
// Volta ao inicio sempre que uma nova espera comeca.
export function useMensagensEspera(ativo: boolean) {
  const [passo, setPasso] = useState(0);
  const [segundos, setSegundos] = useState(0);

  useEffect(() => {
    if (!ativo) return;
    setPasso(0);
    setSegundos(0);
    const inicio = Date.now();
    const timer = setInterval(() => {
      const decorrido = Date.now() - inicio;
      setSegundos(Math.floor(decorrido / 1000));
      setPasso(Math.floor(decorrido / INTERVALO_MENSAGEM_MS));
    }, 1000);
    return () => clearInterval(timer);
  }, [ativo]);

  return { passo, mensagem: mensagemDoPasso(passo), segundos };
}
