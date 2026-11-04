// Nomes de cortes e barbas em portugues brasileiro, como sao chamados nas
// barbearias do Brasil. E so uma camada de apresentacao: os campos "_en" da
// analise (que alimentam o modelo de imagem) continuam em ingles.
//
// O prompt ja pede os nomes em portugues; esta tabela cobre o que o modelo
// ainda devolver em ingles e as analises antigas salvas no app. A troca e
// idempotente: um nome que ja esta em portugues sai igual.
//
// A mesma tabela existe em barber-mobile/src/lib/nomesCortes.ts (historico salvo).
// Ao mudar uma, mude a outra.

// Da expressao mais longa para a mais curta, para "Low Taper Fade" nao virar
// "Low Taper Degradê".
const NOMES = [
  // Degradês
  ['low taper fade', 'degradê baixo nas laterais e nuca'],
  ['mid taper fade', 'degradê médio nas laterais e nuca'],
  ['high taper fade', 'degradê alto nas laterais e nuca'],
  ['taper fade', 'degradê nas laterais e nuca'],
  ['skin fade', 'degradê navalhado'],
  ['bald fade', 'degradê navalhado'],
  ['low fade', 'degradê baixo'],
  ['mid fade', 'degradê médio'],
  ['medium fade', 'degradê médio'],
  ['high fade', 'degradê alto'],
  ['burst fade', 'degradê em meia-lua'],
  ['drop fade', 'degradê em curva'],
  ['temple fade', 'degradê nas têmporas'],
  ['fade', 'degradê'],
  ['low taper', 'degradê suave baixo'],
  ['mid taper', 'degradê suave médio'],
  ['high taper', 'degradê suave alto'],
  ['taper', 'degradê suave'],
  // Cortes
  ['high and tight', 'corte militar alto'],
  ['buzz cut', 'corte militar'],
  ['crew cut', 'corte militar curto'],
  ['ivy league', 'corte social curto'],
  ['caesar cut', 'corte César'],
  ['french crop', 'corte francês'],
  ['textured crop', 'corte texturizado'],
  ['crop top', 'corte curto texturizado'],
  ['crop', 'corte curto com franja'],
  ['modern pompadour', 'topete moderno'],
  ['pompadour', 'topete clássico'],
  ['textured quiff', 'topete texturizado'],
  ['messy quiff', 'topete despojado'],
  ['modern quiff', 'topete moderno'],
  ['classic pompadour', 'topete clássico'],
  ['textured pompadour', 'topete texturizado'],
  ['quiff', 'topete'],
  ['disconnected undercut', 'corte desconectado'],
  ['undercut', 'corte desconectado'],
  ['hard part', 'risca marcada'],
  ['side part', 'corte com risca lateral'],
  ['side swept', 'penteado de lado'],
  ['comb over', 'penteado lateral'],
  ['slicked back', 'cabelo penteado para trás'],
  ['slick back', 'cabelo penteado para trás'],
  ['faux hawk', 'moicano disfarçado'],
  ['fohawk', 'moicano disfarçado'],
  ['mohawk', 'moicano'],
  ['top knot', 'coque alto'],
  ['topknot', 'coque alto'],
  ['man bun', 'coque masculino'],
  ['textured fringe', 'franja texturizada'],
  ['messy fringe', 'franja despojada'],
  ['fringe', 'franja'],
  ['curtain hair', 'cabelo cortininha'],
  ['curtains', 'cabelo cortininha'],
  ['curly top', 'cachos no topo'],
  ['spiky hair', 'cabelo espetado'],
  ['flat top', 'corte reto no topo'],
  // Barbas
  ['light stubble', 'barba por fazer curta'],
  ['heavy stubble', 'barba por fazer cheia'],
  ['stubble', 'barba por fazer'],
  ['short boxed beard', 'barba curta aparada'],
  ['boxed beard', 'barba aparada'],
  ['corporate beard', 'barba social aparada'],
  ['full beard', 'barba cheia'],
  ['lumberjack beard', 'barba lenhador'],
  ['circle beard', 'cavanhaque fechado'],
  ['van dyke', 'cavanhaque com bigode'],
  ['goatee', 'cavanhaque'],
  ['anchor beard', 'barba âncora'],
  ['chin strap', 'barba fina no contorno do rosto'],
  ['chinstrap', 'barba fina no contorno do rosto'],
  ['ducktail', 'barba em ponta'],
  ['moustache', 'bigode'],
  ['mustache', 'bigode'],
  ['clean shaven', 'rosto barbeado'],
  // Conectores que vem junto ("Pompadour with Low Fade")
  ['with', 'com'],
  ['and', 'e'],
].sort((a, b) => b[0].length - a[0].length);

const escapar = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PADRAO = new RegExp(`\\b(${NOMES.map(([en]) => escapar(en).replace(/ /g, '[\\s-]+')).join('|')})\\b`, 'gi');
const TRADUCAO = new Map(NOMES.map(([en, pt]) => [en, pt]));

// "Low Fade" -> "Degradê baixo"; "Textured Crop com franja" -> "Corte texturizado com franja"
function nomeCortePtBR(nome) {
  if (typeof nome !== 'string' || !nome.trim()) return nome;
  const traduzido = nome.replace(PADRAO, (achado) =>
    TRADUCAO.get(achado.toLowerCase().replace(/[\s-]+/g, ' ')) ?? achado);
  if (traduzido === nome) return nome;
  // Primeira letra maiuscula, como os nomes que o modelo ja devolve em portugues
  const limpo = traduzido.replace(/\s+/g, ' ').trim();
  return limpo.charAt(0).toUpperCase() + limpo.slice(1);
}

// Aplica nos nomes de cabelo e barba da analise (schema novo e o antigo derivado).
// Nao toca nos campos "_en", usados para gerar a imagem.
function analiseEmPtBR(analise) {
  if (!analise || typeof analise !== 'object') return analise;
  const recs = analise.recommendations;
  const traduzirLista = (lista) => Array.isArray(lista)
    ? lista.map((item) => (item && typeof item === 'object' ? { ...item, style: nomeCortePtBR(item.style) } : item))
    : lista;
  return {
    ...analise,
    ...(recs ? { recommendations: { ...recs, hair: traduzirLista(recs.hair), beard: traduzirLista(recs.beard) } } : {}),
    ...(analise.corte_principal ? { corte_principal: { ...analise.corte_principal, nome: nomeCortePtBR(analise.corte_principal.nome) } } : {}),
    ...(Array.isArray(analise.cortes_alternativos) ? { cortes_alternativos: analise.cortes_alternativos.map(nomeCortePtBR) } : {}),
    ...(analise.barba ? { barba: { ...analise.barba, estilo: nomeCortePtBR(analise.barba.estilo) } } : {}),
  };
}

module.exports = { nomeCortePtBR, analiseEmPtBR };
