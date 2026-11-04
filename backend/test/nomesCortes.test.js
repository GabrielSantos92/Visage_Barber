// Nomes de cortes e barbas em pt-BR: camada de apresentacao sobre a resposta da
// IA, catalogo do questionario e a rota /analisar (com a IA simulada).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { nomeCortePtBR, analiseEmPtBR } = require('../src/services/nomesCortes');

const CASOS = {
  'Fade': 'Degradê',
  'Low Fade': 'Degradê baixo',
  'Mid Fade': 'Degradê médio',
  'High Fade': 'Degradê alto',
  'Buzz Cut': 'Corte militar',
  'Pompadour': 'Topete clássico',
  'Undercut': 'Corte desconectado',
  'Side Part': 'Corte com risca lateral',
  'Crew Cut': 'Corte militar curto',
  'Slick Back': 'Cabelo penteado para trás',
  'French Crop': 'Corte francês',
  'Textured Crop': 'Corte texturizado',
  'Taper Fade': 'Degradê nas laterais e nuca',
  'Comb Over': 'Penteado lateral',
  'Skin Fade': 'Degradê navalhado',
  'Quiff': 'Topete',
  'Textured Quiff': 'Topete texturizado',
  'Faux Hawk': 'Moicano disfarçado',
  'Stubble': 'Barba por fazer',
  'Full Beard': 'Barba cheia',
  'Goatee': 'Cavanhaque',
  'Van Dyke': 'Cavanhaque com bigode',
  // Variacoes de escrita e combinacoes que o modelo costuma devolver
  'low fade': 'Degradê baixo',
  'Low-Fade': 'Degradê baixo',
  'Pompadour with Low Fade': 'Topete clássico com degradê baixo',
  'Textured Crop com franja': 'Corte texturizado com franja',
  'Degradê baixo com Quiff': 'Degradê baixo com topete',
};

test('traduz os nomes do catalogo e as variacoes', () => {
  for (const [en, pt] of Object.entries(CASOS)) assert.equal(nomeCortePtBR(en), pt, en);
});

test('nome ja em portugues sai igual (sem traducao dupla)', () => {
  for (const pt of new Set(Object.values(CASOS))) assert.equal(nomeCortePtBR(pt), pt, pt);
  for (const pt of ['Degradê baixo com topete texturizado', 'Corte social', 'Barba desenhada', 'Corte César']) {
    assert.equal(nomeCortePtBR(pt), pt);
  }
  assert.equal(nomeCortePtBR(''), '');
  assert.equal(nomeCortePtBR(undefined), undefined);
});

test('toda traducao da tabela e estavel ao ser aplicada de novo', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'nomesCortes.js'), 'utf8');
  const pares = [...fonte.matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => [m[1], m[2]]);
  assert.ok(pares.length > 50);
  for (const [en] of pares) {
    const uma = nomeCortePtBR(en);
    assert.equal(nomeCortePtBR(uma), uma, `${en} -> ${uma}`);
  }
});

test('analise: traduz nomes de corte e barba e preserva os campos _en da imagem', () => {
  const antiga = {
    face_shape: 'oval',
    recommendations: {
      hair: [
        { style: 'Low Fade', style_en: 'low fade', fade: 'low fade', caracteristicas: ['Laterais curtas'] },
        { style: 'Textured Crop', style_en: 'textured crop', fade: 'none' },
      ],
      beard: [{ style: 'Stubble', style_en: 'stubble', length: 'short' }],
    },
    corte_principal: { nome: 'Low Fade', nome_en: 'low fade', caracteristicas: ['Laterais curtas'] },
    cortes_alternativos: ['Textured Crop', 'Side Part'],
    barba: { estilo: 'Stubble', estilo_en: 'stubble', motivo: 'equilibra o rosto' },
    resumo: 'Resumo',
  };
  const r = analiseEmPtBR(antiga);
  assert.equal(r.recommendations.hair[0].style, 'Degradê baixo');
  assert.equal(r.recommendations.hair[1].style, 'Corte texturizado');
  assert.equal(r.recommendations.beard[0].style, 'Barba por fazer');
  assert.equal(r.corte_principal.nome, 'Degradê baixo');
  assert.deepEqual(r.cortes_alternativos, ['Corte texturizado', 'Corte com risca lateral']);
  assert.equal(r.barba.estilo, 'Barba por fazer');
  // Campos que montam o prompt da imagem: intactos
  assert.equal(r.recommendations.hair[0].style_en, 'low fade');
  assert.equal(r.recommendations.hair[0].fade, 'low fade');
  assert.equal(r.recommendations.beard[0].style_en, 'stubble');
  assert.equal(r.corte_principal.nome_en, 'low fade');
  assert.equal(r.barba.estilo_en, 'stubble');
  assert.equal(r.resumo, 'Resumo');
  // Nao altera o objeto recebido e e idempotente
  assert.equal(antiga.corte_principal.nome, 'Low Fade');
  assert.deepEqual(analiseEmPtBR(r), r);
});

test('catalogo do questionario sem nomes em ingles', () => {
  const { RECOMENDACOES } = carregarCatalogo();
  for (const [formato, { cortes }] of Object.entries(RECOMENDACOES)) {
    for (const c of cortes) assert.equal(nomeCortePtBR(c), c, `${formato}: ${c}`);
  }
});

// Le o catalogo direto do arquivo da rota (ele nao e exportado)
function carregarCatalogo() {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'routes', 'recommendation.js'), 'utf8');
  const bloco = fonte.match(/const RECOMENDACOES = (\{[\s\S]*?\n\});/)[1];
  return { RECOMENDACOES: Function(`return (${bloco});`)() };
}

test('rota /analisar devolve os nomes em pt-BR (IA simulada)', async () => {
  // Substitui a IA e a protecao de consentimento antes de carregar a rota
  const respostaDaIA = {
    face_shape: 'oval',
    face_analysis: { proportions: 'equilibradas', forehead: 'media', jawline: 'marcada', cheekbones: 'discretas' },
    recommendations: {
      hair: [
        { style: 'Mid Fade', description: 'd', style_en: 'mid fade', caracteristicas: [] },
        { style: 'Pompadour', description: 'd', style_en: 'pompadour' },
      ],
      beard: [{ style: 'Full Beard', reason: 'r', style_en: 'full beard' }],
    },
  };
  const gemini = require.resolve('../src/services/gemini');
  const privacidade = require.resolve('../src/routes/privacidade');
  const rota = require.resolve('../src/routes/visagismo');
  const anteriores = [gemini, privacidade, rota].map((k) => require.cache[k]);
  require.cache[gemini] = { id: gemini, filename: gemini, loaded: true, exports: {
    analisarVisagismo: async () => respostaDaIA, montarPromptEdicao: () => '', editarCabeloBarba: async () => Buffer.alloc(0),
  } };
  require.cache[privacidade] = { id: privacidade, filename: privacidade, loaded: true, exports: {
    protegerVisagismo: (_req, _res, next) => next(),
  } };
  delete require.cache[rota];

  const app = express();
  app.use(express.json());
  app.use('/api/visagismo', require('../src/routes/visagismo'));
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${s.address().port}/api/visagismo/analisar`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagem_base64: 'abc' }),
    });
    const r = await res.json();
    assert.equal(res.status, 200);
    assert.equal(r.corte_principal.nome, 'Degradê médio');
    assert.equal(r.corte_principal.nome_en, 'mid fade');
    assert.deepEqual(r.cortes_alternativos, ['Topete clássico']);
    assert.equal(r.barba.estilo, 'Barba cheia');
    assert.equal(r.barba.estilo_en, 'full beard');
    assert.equal(r.recommendations.hair[0].style, 'Degradê médio');
  } finally {
    s.close();
    [gemini, privacidade, rota].forEach((k, i) => { if (anteriores[i]) require.cache[k] = anteriores[i]; else delete require.cache[k]; });
  }
});

test('prompt da analise pede nomes em pt-BR e mantem os campos _en em ingles', () => {
  const fonte = fs.readFileSync(path.join(__dirname, '..', 'src', 'services', 'gemini.js'), 'utf8');
  assert.match(fonte, /devem ser\s+apresentados em português brasileiro \(pt-BR\)/);
  assert.match(fonte, /NÃO vale para os campos "_en"/);
});
