// Visagismo personalizado: o cliente pode pedir um estilo, o que fazer com a
// barba e uma cor de cabelo. As opcoes sao fechadas de proposito:
//   - cada uma vira um texto fixo no pedido as IAs (nada digitado pelo cliente
//     chega aos modelos), entao nao ha como pedir para mexer no rosto;
//   - so oferecemos o que a edicao entrega com realismo dentro da mascara de
//     cabelo e barba (services/imagem.js), que continua garantindo o rosto.
//
// As mesmas chaves existem nas telas (cut-advisor-pro/src/lib/personalizacaoVisagismo.ts
// e barber-mobile/src/lib/personalizacaoVisagismo.ts); um teste confere.

// Texto que vai para a IA de analise (pt-BR), por opcao
const ESTILOS = {
  formal: 'Formal: transmitir seriedade e elegância (trabalho, eventos). Linhas alinhadas, acabamento limpo, nada chamativo.',
  moderno: 'Moderno: visual atual, na moda, com acabamento bem definido.',
  descolado: 'Descolado: visual despojado e com personalidade, com mais textura e movimento, sem perder a harmonia com o rosto.',
  discreto: 'Discreto: visual simples e natural, fácil de manter no dia a dia, sem contrastes fortes.',
  manter: 'Manter o corte atual: o cliente NÃO quer mudar o corte. A recomendação principal de cabelo deve ser o corte que ele já usa, com o mesmo comprimento e formato.',
};

const BARBAS = {
  sem: 'Sem barba: o cliente NÃO quer barba. A recomendação principal de barba deve ser o rosto barbeado (style "Sem barba", style_en "clean-shaven"), explicando em reason como isso valoriza o rosto.',
  manter: 'Manter a barba atual: o cliente quer a barba exatamente como está hoje (ou continuar sem barba, se não tiver). A recomendação principal de barba deve descrever a barba atual.',
};

// pt: para a analise; en: para a edicao da imagem (os modelos de imagem
// entendem melhor ingles)
const CORES = {
  loiro: { pt: 'loiro', en: 'a natural-looking golden blonde color' },
  platinado: { pt: 'platinado (loiro quase branco)', en: 'a platinum blonde color, icy and almost white' },
  castanho: { pt: 'castanho', en: 'a natural medium brown color' },
  preto: { pt: 'preto', en: 'a natural deep black color' },
  ruivo: { pt: 'ruivo (acobreado)', en: 'a natural copper red color' },
  luzes: { pt: 'com luzes (mechas loiras sobre a cor natural)', en: 'subtle blonde highlights over the natural base color' },
};

const CAMPOS = { estilo: ESTILOS, barba: BARBAS, cor_cabelo: CORES };

function erroPreferencia(mensagem) {
  const erro = new Error(mensagem);
  erro.status = 400;
  erro.code = 'PREFERENCIA_INVALIDA';
  return erro;
}

// Devolve so as escolhas feitas ({ estilo?, barba?, cor_cabelo? }) ou null se o
// cliente nao personalizou nada. Valor fora da lista e erro, nunca ignorado: a
// simulacao nao pode sair diferente do que foi pedido.
function normalizarPreferencias(entrada) {
  if (entrada == null || entrada === '') return null;
  if (typeof entrada !== 'object' || Array.isArray(entrada)) throw erroPreferencia('Preferências inválidas.');

  const saida = {};
  for (const [campo, opcoes] of Object.entries(CAMPOS)) {
    const valor = entrada[campo];
    if (valor == null || valor === '') continue;
    if (typeof valor !== 'string' || !Object.hasOwn(opcoes, valor)) {
      throw erroPreferencia('Opção de personalização inválida.');
    }
    saida[campo] = valor;
  }
  if (!Object.keys(saida).length) return null;
  if (saida.estilo === 'manter' && saida.barba === 'manter' && !saida.cor_cabelo) {
    throw erroPreferencia('Escolha ao menos uma mudança: no corte, na barba ou na cor do cabelo.');
  }
  return saida;
}

// Bloco acrescentado ao prompt da analise quando ha personalizacao.
function textoPersonalizacao(pref) {
  if (!pref) return '';
  const linhas = [
    'PERSONALIZAÇÃO PEDIDA PELO CLIENTE',
    'O cliente escolheu as preferências abaixo e elas têm prioridade. Dentro delas,',
    'escolha o corte e a barba que mais valorizam o formato do rosto. Se alguma não for',
    'a ideal para o rosto, atenda mesmo assim, com a versão que mais o favorece.',
  ];
  if (pref.estilo) linhas.push(`- Estilo: ${ESTILOS[pref.estilo]}`);
  if (pref.barba) linhas.push(`- Barba: ${BARBAS[pref.barba]}`);
  if (pref.cor_cabelo) {
    linhas.push(`- Cor do cabelo: o cliente quer o cabelo ${CORES[pref.cor_cabelo].pt}. Considere essa cor ao escolher e descrever o corte.`);
  }
  linhas.push('Preencha "personalizacao" com 1 ou 2 frases, em português, explicando como as preferências foram aplicadas ao rosto do cliente.');
  return linhas.join('\n');
}

// Linhas fixas do prompt de edicao. A IA de analise escolhe o corte; manter o
// corte, a cor e a barba seguem exatamente o que o cliente marcou.
const EDICAO = {
  manterCorte: 'Hairstyle: keep the current haircut exactly as it is (same length, shape, volume and parting).',
  semBarba: 'Facial hair: remove the beard and mustache completely for a clean-shaven look. Show natural, freshly shaved skin with the same skin tone, texture and lighting as the rest of the face, keeping the original jawline, chin and lip contours.',
  manterBarba: 'Facial hair: keep the existing beard and mustache exactly as they are (same shape, length, density and color).',
};

function linhaCorDoCabelo(pref) {
  const preservar = pref.barba === 'sem'
    ? 'eyebrows, eyelashes and skin tone'
    : 'eyebrows, eyelashes, beard and skin tone';
  return `Hair color: give the scalp hair ${CORES[pref.cor_cabelo].en}, as a real professional salon coloring would look: natural strand-to-strand variation, shine and shadows that match the original lighting. Keep the ${preservar} in their original colors.`;
}

// Regioes que a mascara libera para a edicao. O que fica de fora vem pixel a
// pixel da foto original, garantia mais forte que qualquer instrucao no prompt:
// quem pediu para manter a barba recebe a barba original, nao uma copia dela.
function partesEditaveis(pref) {
  const partes = [];
  if (!(pref?.estilo === 'manter' && !pref?.cor_cabelo)) partes.push('hair');
  if (pref?.barba !== 'manter') partes.push('beard', 'mustache');
  return partes;
}

module.exports = {
  ESTILOS, BARBAS, CORES, EDICAO,
  normalizarPreferencias, textoPersonalizacao, linhaCorDoCabelo, partesEditaveis,
};
