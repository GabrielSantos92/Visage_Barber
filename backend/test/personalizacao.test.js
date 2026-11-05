// Visagismo personalizado (estilo, barba, cor do cabelo) e a regra de nao gerar
// a simulacao quando o visagismo nao se aplica a foto. As IAs sao simuladas.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const express = require('express');
const {
  normalizarPreferencias, partesEditaveis, ESTILOS, BARBAS, CORES,
} = require('../src/services/personalizacao');
const {
  montarPromptAnalise, montarPromptEdicao, visagismoAplicavel, SCHEMA_VISAGISMO, PROMPT_ANALISE,
} = require('../src/services/gemini');

const ANALISE = {
  recommendations: {
    hair: [{ style: 'Degradê baixo', style_en: 'low fade', length: 'short', volume: 'low', texture: 'textured', fade: 'low fade', finish: 'matte' }],
    beard: [{ style: 'Barba por fazer', style_en: 'stubble', length: 'short', shape: 'natural', outline: 'soft', finish: 'matte' }],
  },
};

test('preferencias: guarda so as escolhas feitas; sem escolhas e null', () => {
  for (const vazio of [undefined, null, '', {}, { estilo: '', barba: null, cor_cabelo: undefined }]) {
    assert.equal(normalizarPreferencias(vazio), null, JSON.stringify(vazio));
  }
  assert.deepEqual(
    normalizarPreferencias({ estilo: 'formal', barba: 'sem', cor_cabelo: 'loiro', observacoes: 'ignorado' }),
    { estilo: 'formal', barba: 'sem', cor_cabelo: 'loiro' },
  );
  assert.deepEqual(normalizarPreferencias({ cor_cabelo: 'platinado' }), { cor_cabelo: 'platinado' });
});

test('preferencias: opcao fora da lista e erro 400, nunca ignorada', () => {
  const invalidas = [
    { estilo: 'careca' }, { barba: 'SEM' }, { cor_cabelo: 'azul' }, { estilo: ['formal'] },
    { estilo: 'toString' }, { cor_cabelo: '__proto__' }, 'formal', [1],
  ];
  for (const entrada of invalidas) {
    assert.throws(() => normalizarPreferencias(entrada),
      (e) => e.status === 400 && e.code === 'PREFERENCIA_INVALIDA', JSON.stringify(entrada));
  }
});

test('preferencias: manter corte e barba sem mudar a cor nao deixa nada para simular', () => {
  assert.throws(() => normalizarPreferencias({ estilo: 'manter', barba: 'manter' }), /ao menos uma mudança/);
  assert.deepEqual(
    normalizarPreferencias({ estilo: 'manter', barba: 'manter', cor_cabelo: 'loiro' }),
    { estilo: 'manter', barba: 'manter', cor_cabelo: 'loiro' },
  );
});

test('prompt da analise: sem personalizacao e o mesmo; com ela, acrescenta so o que foi pedido', () => {
  assert.equal(montarPromptAnalise(), PROMPT_ANALISE);
  assert.equal(montarPromptAnalise(null), PROMPT_ANALISE);
  assert.doesNotMatch(PROMPT_ANALISE, /PERSONALIZAÇÃO/);

  const p = montarPromptAnalise({ estilo: 'formal', barba: 'sem', cor_cabelo: 'loiro' });
  assert.ok(p.startsWith(PROMPT_ANALISE));
  assert.match(p, /- Estilo: Formal: transmitir seriedade/);
  assert.match(p, /- Barba: Sem barba: o cliente NÃO quer barba/);
  assert.match(p, /o cliente quer o cabelo loiro/);
  assert.match(p, /Preencha "personalizacao"/);

  const soCor = montarPromptAnalise({ cor_cabelo: 'ruivo' });
  assert.match(soCor, /o cliente quer o cabelo ruivo/);
  assert.doesNotMatch(soCor, /- Estilo:|- Barba:/);
});

test('analise: pede o campo aplicavel (falso so para rosto claramente feminino)', () => {
  assert.equal(SCHEMA_VISAGISMO.properties.aplicavel.type, 'boolean');
  assert.ok(SCHEMA_VISAGISMO.required.includes('aplicavel'));
  assert.ok(!SCHEMA_VISAGISMO.required.includes('personalizacao'));
  assert.match(PROMPT_ANALISE, /"aplicavel" com false\s+somente se a foto mostrar claramente um rosto feminino/);
  assert.match(PROMPT_ANALISE, /inclusive na dúvida, preencha "aplicavel" com true/);
});

test('prompt da edicao sem personalizacao: igual ao de antes', () => {
  const p = montarPromptEdicao(ANALISE);
  assert.ok(p.startsWith('EDIT ONLY HAIR AND BEARD. PRESERVE THE ORIGINAL FACE AND IDENTITY.'));
  assert.deepEqual(p.split('\n').slice(-4), [
    'Recommended hairstyle: low fade',
    'Hair attributes: length: short, volume: low, texture: textured, fade: low fade, finish: matte',
    'Recommended beard: stubble',
    'Beard attributes: length: short, shape: natural, outline: soft, finish: matte',
  ]);
  assert.doesNotMatch(p, /Hair color|Facial hair|Hairstyle: keep/);
});

test('sem barba: remove barba e bigode, mesmo que a IA tenha sugerido uma barba', () => {
  const p = montarPromptEdicao(ANALISE, { estilo: 'formal', barba: 'sem' });
  assert.match(p, /Recommended hairstyle: low fade/);
  assert.match(p, /Facial hair: remove the beard and mustache completely/);
  assert.match(p, /keeping the original jawline, chin and lip contours/);
  assert.doesNotMatch(p, /Recommended beard/);
});

test('manter a barba: pede a barba como esta e nao usa a sugestao da IA', () => {
  const p = montarPromptEdicao(ANALISE, { barba: 'manter' });
  assert.match(p, /Facial hair: keep the existing beard and mustache exactly as they are/);
  assert.doesNotMatch(p, /Recommended beard|remove the beard/);
});

test('cor do cabelo: texto fixo da cor pedida, sobrancelhas e barba na cor original', () => {
  const p = montarPromptEdicao(ANALISE, { cor_cabelo: 'loiro' });
  assert.match(p, /Hair color: give the scalp hair a natural-looking golden blonde color/);
  assert.match(p, /Keep the eyebrows, eyelashes, beard and skin tone in their original colors/);
  assert.match(p, /Recommended beard: stubble/);

  const semBarba = montarPromptEdicao(ANALISE, { cor_cabelo: 'platinado', barba: 'sem' });
  assert.match(semBarba, /platinum blonde/);
  assert.match(semBarba, /Keep the eyebrows, eyelashes and skin tone in their original colors/);

  for (const cor of Object.keys(CORES)) {
    assert.match(montarPromptEdicao(ANALISE, { cor_cabelo: cor }), new RegExp(`Hair color: give the scalp hair ${CORES[cor].en}`));
  }
});

test('manter o corte: nao pede corte novo, so a cor', () => {
  const p = montarPromptEdicao(ANALISE, { estilo: 'manter', cor_cabelo: 'luzes' });
  assert.match(p, /Hairstyle: keep the current haircut exactly as it is/);
  assert.match(p, /subtle blonde highlights/);
  assert.doesNotMatch(p, /Recommended hairstyle|Hair attributes/);
});

test('recomendacao "Não aplicável" fica fora do prompt da edicao', () => {
  const barbaNA = { recommendations: { hair: ANALISE.recommendations.hair, beard: [{ style: 'Não aplicável', style_en: 'not applicable', length: 'n/a' }] } };
  const p = montarPromptEdicao(barbaNA);
  assert.match(p, /Recommended hairstyle: low fade/);
  assert.doesNotMatch(p, /Recommended beard|Beard attributes|not applicable/);
});

test('aplicabilidade: nao gera quando a analise diz que nao se aplica ou nao ha o que aplicar', () => {
  assert.equal(visagismoAplicavel(ANALISE), true);
  assert.equal(visagismoAplicavel({ ...ANALISE, aplicavel: true }), true);
  assert.equal(visagismoAplicavel({ ...ANALISE, aplicavel: false }), false);
  // Barba nao aplicavel, cabelo sim: gera so o cabelo
  assert.equal(visagismoAplicavel({ recommendations: { hair: ANALISE.recommendations.hair, beard: [{ style: 'Não aplicável' }] } }), true);
  // Nada a aplicar
  for (const nome of ['Não aplicável', 'Nao aplicavel', 'N/A', 'not applicable', 'none']) {
    assert.equal(visagismoAplicavel({ recommendations: { hair: [{ style: nome }], beard: [{ style: nome }] } }), false, nome);
  }
  assert.equal(visagismoAplicavel({}), false);
});

test('mascara: libera para edicao so o que vai mudar', () => {
  assert.deepEqual(partesEditaveis(null), ['hair', 'beard', 'mustache']);
  assert.deepEqual(partesEditaveis({ estilo: 'formal', cor_cabelo: 'loiro', barba: 'sem' }), ['hair', 'beard', 'mustache']);
  assert.deepEqual(partesEditaveis({ barba: 'manter' }), ['hair']);
  assert.deepEqual(partesEditaveis({ estilo: 'manter', barba: 'sem' }), ['beard', 'mustache']);
  assert.deepEqual(partesEditaveis({ estilo: 'manter', cor_cabelo: 'loiro', barba: 'manter' }), ['hair']);
});

test('opcoes: todo estilo, barba e cor tem texto para a analise', () => {
  for (const tabela of [ESTILOS, BARBAS]) for (const texto of Object.values(tabela)) assert.ok(texto.length > 20);
  for (const cor of Object.values(CORES)) assert.ok(cor.pt && cor.en);
});

// ---------------------------------------------------------------
// Rotas, com IA, segmentacao e consentimento simulados
// ---------------------------------------------------------------

async function comRota({ gemini = {}, imagem = {} }, fn) {
  const k = {
    gemini: require.resolve('../src/services/gemini'),
    imagem: require.resolve('../src/services/imagem'),
    privacidade: require.resolve('../src/routes/privacidade'),
    rota: require.resolve('../src/routes/visagismo'),
  };
  const anteriores = Object.fromEntries(Object.entries(k).map(([n, c]) => [n, require.cache[c]]));
  const reais = { gemini: require(k.gemini), imagem: require(k.imagem) };
  const falso = (c, exports) => { require.cache[c] = { id: c, filename: c, loaded: true, exports }; };
  falso(k.gemini, { ...reais.gemini, ...gemini });
  falso(k.imagem, { ...reais.imagem, ...imagem });
  falso(k.privacidade, { protegerVisagismo: (_req, _res, next) => next() });
  delete require.cache[k.rota];

  const app = express();
  app.use(express.json());
  app.use('/api/visagismo', require(k.rota));
  const servidor = app.listen(0);
  await once(servidor, 'listening');
  const post = async (caminho, corpo) => {
    const r = await fetch(`http://127.0.0.1:${servidor.address().port}/api/visagismo${caminho}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo),
    });
    return { status: r.status, corpo: await r.json() };
  };
  try {
    await fn(post);
  } finally {
    servidor.close();
    for (const [n, c] of Object.entries(k)) {
      if (anteriores[n]) require.cache[c] = anteriores[n]; else delete require.cache[c];
    }
  }
}

const respostaDaIA = (extra = {}) => ({
  face_shape: 'oval',
  face_analysis: { proportions: 'p', forehead: 'f', jawline: 'j', cheekbones: 'c' },
  ...ANALISE,
  aplicavel: true,
  personalizacao: 'Corte social alinhado e rosto barbeado.',
  ...extra,
});

test('rota /analisar: envia as preferencias validadas a IA e devolve o pedido junto', async () => {
  const chamadas = [];
  await comRota({ gemini: { analisarVisagismo: async (img, pref) => { chamadas.push([img, pref]); return respostaDaIA(); } } }, async (post) => {
    const r = await post('/analisar', { imagem_base64: 'abc', preferencias: { estilo: 'formal', barba: 'sem', cor_cabelo: '' } });
    assert.equal(r.status, 200);
    assert.deepEqual(chamadas, [['abc', { estilo: 'formal', barba: 'sem' }]]);
    assert.deepEqual(r.corpo.preferencias, { estilo: 'formal', barba: 'sem' });
    assert.equal(r.corpo.personalizacao, 'Corte social alinhado e rosto barbeado.');
    assert.equal(r.corpo.aplicavel, true);
    assert.equal(r.corpo.corte_principal.nome, 'Degradê baixo');
  });
});

test('rota /analisar: sem personalizacao a resposta nao traz pedido nem texto de personalizacao', async () => {
  const chamadas = [];
  await comRota({ gemini: { analisarVisagismo: async (img, pref) => { chamadas.push(pref); return respostaDaIA(); } } }, async (post) => {
    const r = await post('/analisar', { imagem_base64: 'abc' });
    assert.equal(r.status, 200);
    assert.deepEqual(chamadas, [null]);
    assert.ok(!('preferencias' in r.corpo));
    assert.ok(!('personalizacao' in r.corpo));
    assert.equal(r.corpo.aplicavel, true);
  });
});

test('rota /analisar: devolve aplicavel=false quando a IA diz que nao se aplica', async () => {
  await comRota({ gemini: { analisarVisagismo: async () => respostaDaIA({ aplicavel: false }) } }, async (post) => {
    const r = await post('/analisar', { imagem_base64: 'abc' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.aplicavel, false);
  });
});

test('rota /analisar: opcao invalida e recusada antes de chamar a IA', async () => {
  let chamou = false;
  await comRota({ gemini: { analisarVisagismo: async () => { chamou = true; return respostaDaIA(); } } }, async (post) => {
    const r = await post('/analisar', { imagem_base64: 'abc', preferencias: { cor_cabelo: 'verde' } });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.code, 'PREFERENCIA_INVALIDA');
    assert.equal(chamou, false);
  });
});

// Simula o pipeline da imagem e registra o que cada etapa recebeu
function pipelineFalso() {
  const registro = { prompts: [], partes: [], alinhou: 0 };
  return {
    registro,
    gemini: { editarCabeloBarba: async (_png, prompt) => { registro.prompts.push(prompt); return Buffer.from('gerada'); } },
    imagem: {
      alinharFoto: async () => { registro.alinhou++; return { png: Buffer.from('png'), largura: 4, altura: 4 }; },
      mascaraCabeloBarba: async (_png, _l, _a, partes) => { registro.partes.push(partes); return Buffer.from('mascara'); },
      compor: async () => Buffer.from('final'),
    },
  };
}

test('rota /imagem-referencia: nao gera nada quando o visagismo nao se aplica', async () => {
  const { registro, gemini, imagem } = pipelineFalso();
  await comRota({ gemini, imagem }, async (post) => {
    const r = await post('/imagem-referencia', { imagem_base64: 'abc', analise: { ...ANALISE, aplicavel: false } });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.code, 'VISAGISMO_NAO_APLICAVEL');
  });
  assert.deepEqual(registro, { prompts: [], partes: [], alinhou: 0 });
});

test('rota /imagem-referencia: segue o pedido no prompt e na mascara', async () => {
  const { registro, gemini, imagem } = pipelineFalso();
  await comRota({ gemini, imagem }, async (post) => {
    const analise = { ...ANALISE, aplicavel: true, preferencias: { barba: 'manter', cor_cabelo: 'loiro' } };
    const r = await post('/imagem-referencia', { imagem_base64: 'abc', analise });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.base64, Buffer.from('final').toString('base64'));
    assert.equal(r.corpo.mascara_aplicada, true);
  });
  // Barba mantida: a mascara so libera o cabelo, a barba vem da foto original
  assert.deepEqual(registro.partes, [['hair']]);
  assert.match(registro.prompts[0], /golden blonde/);
  assert.match(registro.prompts[0], /keep the existing beard and mustache exactly as they are/);
});

test('rota /imagem-referencia: sem personalizacao, mascara e prompt de sempre', async () => {
  const { registro, gemini, imagem } = pipelineFalso();
  await comRota({ gemini, imagem }, async (post) => {
    const r = await post('/imagem-referencia', { imagem_base64: 'abc', analise: ANALISE });
    assert.equal(r.status, 200);
  });
  assert.deepEqual(registro.partes, [['hair', 'beard', 'mustache']]);
  assert.equal(registro.prompts[0], montarPromptEdicao(ANALISE));
});

test('rota /imagem-referencia: pedido adulterado e recusado', async () => {
  const { registro, gemini, imagem } = pipelineFalso();
  await comRota({ gemini, imagem }, async (post) => {
    const r = await post('/imagem-referencia', { imagem_base64: 'abc', analise: { ...ANALISE, preferencias: { estilo: 'make me younger' } } });
    assert.equal(r.status, 400);
    assert.equal(r.corpo.code, 'PREFERENCIA_INVALIDA');
  });
  assert.equal(registro.prompts.length, 0);
});
