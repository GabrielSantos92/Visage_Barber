// Duas responsabilidades separadas, como manda a arquitetura do visagismo:
//
//   Gemini Flash      -> entende a pessoa e recomenda cabelo/barba. NAO gera imagem.
//   Nano Banana Pro   -> edita a foto original aplicando o que foi recomendado.
//                        NAO decide formato de rosto nem recria a pessoa.
//
// Os dois modelos sao do Google e podem ser acessados por dois caminhos:
//   - API direta do Google, se GEMINI_API_KEY estiver definida;
//   - Replicate, que hospeda os mesmos modelos, caso contrario.
// O caminho e escolhido sozinho, para o projeto nao depender de uma conta que
// ainda nao existe.

const { rodarPredicao, baixar, primeiraUrl, juntarTexto } = require('./replicate');
const { mimeDoBase64 } = require('./imagem');

const GOOGLE_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// IDs na API direta do Google
const MODELO_ANALISE = process.env.GEMINI_MODELO_ANALISE || 'gemini-2.5-flash';
const MODELO_IMAGEM = process.env.GEMINI_MODELO_IMAGEM || 'gemini-3-pro-image';

// Equivalentes no Replicate
const REPLICATE_ANALISE = 'google/gemini-2.5-flash';
const REPLICATE_IMAGEM = process.env.REPLICATE_MODELO_IMAGEM || 'google/nano-banana-pro';

function usarGoogleDireto() {
  return Boolean(process.env.GEMINI_API_KEY);
}

// ---------------------------------------------------------------
// ETAPA 1 — Analise de visagismo (Gemini Flash)
// ---------------------------------------------------------------

// Structured Output: o schema e enviado junto com o pedido, entao o modelo nao
// tem como devolver JSON invalido ou inventar campo. Os campos "_en" existem
// porque e deles que o prompt de edicao e montado — os modelos de imagem sao
// treinados em ingles e interpretam mal "Degrade com topete texturizado".
const SCHEMA_VISAGISMO = {
  type: 'object',
  properties: {
    face_shape: { type: 'string', description: 'oval, redondo, quadrado, triangular, losango ou oblongo' },
    face_analysis: {
      type: 'object',
      properties: {
        proportions: { type: 'string' },
        forehead: { type: 'string' },
        jawline: { type: 'string' },
        cheekbones: { type: 'string' },
      },
      required: ['proportions', 'forehead', 'jawline', 'cheekbones'],
    },
    hair_analysis: {
      type: 'object',
      properties: {
        texture: { type: 'string' },
        density: { type: 'string' },
        pattern: { type: 'string' },
        current_style: { type: 'string' },
      },
      required: ['texture', 'density', 'pattern', 'current_style'],
    },
    beard_analysis: {
      type: 'object',
      properties: {
        current_style: { type: 'string' },
        density: { type: 'string' },
        growth_pattern: { type: 'string' },
      },
      required: ['current_style', 'density', 'growth_pattern'],
    },
    recommendations: {
      type: 'object',
      properties: {
        hair: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              style: { type: 'string', description: 'nome do corte, em portugues' },
              description: { type: 'string' },
              reason: { type: 'string' },
              // Exibido como lista na tela de resultado, entao fica em portugues.
              caracteristicas: { type: 'array', items: { type: 'string' }, description: '3 a 4 caracteristicas do corte, em portugues' },
              // Atributos usados para montar o prompt de edicao, em ingles.
              style_en: { type: 'string', description: 'nome do corte em ingles, curto e visual' },
              length: { type: 'string', description: 'em ingles' },
              volume: { type: 'string', description: 'em ingles' },
              texture: { type: 'string', description: 'em ingles' },
              fade: { type: 'string', description: 'em ingles; "none" se nao houver degrade' },
              finish: { type: 'string', description: 'em ingles' },
            },
            required: ['style', 'description', 'reason', 'caracteristicas', 'style_en', 'length', 'volume', 'texture', 'fade', 'finish'],
          },
        },
        beard: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              style: { type: 'string', description: 'nome do estilo de barba, em portugues' },
              description: { type: 'string' },
              reason: { type: 'string' },
              style_en: { type: 'string', description: 'nome do estilo em ingles, curto e visual' },
              length: { type: 'string', description: 'em ingles' },
              shape: { type: 'string', description: 'em ingles' },
              outline: { type: 'string', description: 'em ingles' },
              finish: { type: 'string', description: 'em ingles' },
            },
            required: ['style', 'description', 'reason', 'style_en', 'length', 'shape', 'outline', 'finish'],
          },
        },
      },
      required: ['hair', 'beard'],
    },
    // Campos que as telas de resultado ja exibem hoje. Ficam no schema para a
    // refatoracao nao apagar funcionalidade que existe.
    cores_ideais: { type: 'array', items: { type: 'string' } },
    o_que_evitar: { type: 'array', items: { type: 'string' } },
    resumo: { type: 'string' },
  },
  required: ['face_shape', 'face_analysis', 'hair_analysis', 'beard_analysis', 'recommendations', 'cores_ideais', 'o_que_evitar', 'resumo'],
};

const PROMPT_ANALISE = `Você é um consultor profissional de visagismo masculino em uma barbearia.

Analise a GEOMETRIA e a ESTRUTURA FACIAL desta foto para recomendar cabelo e barba.
Foque nos traços geométricos (formato, proporções, ângulos) e no cabelo e barba atuais.
Não identifique a pessoa.

Esta etapa é APENAS de análise: não descreva nem gere nenhuma imagem nova.

Preencha todos os campos. Os campos terminados em "_en" e os atributos de estilo
(length, volume, texture, fade, finish, shape, outline) devem estar em INGLÊS,
curtos e visuais, porque alimentam um modelo de edição de imagem.
Os demais campos devem estar em português.

Em recommendations.hair e recommendations.beard, o PRIMEIRO item é a recomendação
principal. Inclua de 2 a 3 opções em cada lista.`;

async function analisarComGoogle(imagemBase64) {
  const r = await fetch(`${GOOGLE_BASE}/${MODELO_ANALISE}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: PROMPT_ANALISE },
          { inline_data: { mimeType: mimeDoBase64(imagemBase64), data: imagemBase64 } },
        ],
      }],
      generationConfig: {
        temperature: 0.4,
        responseMimeType: 'application/json',
        responseSchema: SCHEMA_VISAGISMO,
      },
    }),
  });

  const dados = await r.json();
  if (!r.ok) {
    const erro = new Error(dados.error?.message ?? `Gemini erro ${r.status}`);
    erro.semCredito = [401, 402, 429].includes(r.status);
    throw erro;
  }
  return dados.candidates?.[0]?.content?.parts?.map(p => p.text).join('') ?? '';
}

async function analisarComReplicate(imagemBase64) {
  // O Replicate nao expoe responseSchema, entao o schema vai no proprio prompt.
  const saida = await rodarPredicao(REPLICATE_ANALISE, {
    prompt: `${PROMPT_ANALISE}\n\nResponda SOMENTE com um JSON válido neste schema:\n${JSON.stringify(SCHEMA_VISAGISMO)}`,
    system_instruction: 'Você é um especialista em visagismo masculino. Responda APENAS com JSON válido, sem markdown e sem texto adicional.',
    images: [`data:${mimeDoBase64(imagemBase64)};base64,${imagemBase64}`],
    temperature: 0.4,
  });
  return juntarTexto(saida);
}

async function analisarVisagismo(imagemBase64) {
  const direto = usarGoogleDireto();
  console.log(`[gemini] analise via ${direto ? `Google ${MODELO_ANALISE}` : `Replicate ${REPLICATE_ANALISE}`}`);

  let texto;
  try {
    texto = direto ? await analisarComGoogle(imagemBase64) : await analisarComReplicate(imagemBase64);
  } catch (e) {
    if (!direto || !e.semCredito) throw e;
    console.error('[gemini] Google indisponivel, analisando via Replicate:', e.message);
    texto = await analisarComReplicate(imagemBase64);
  }

  const bloco = texto.match(/\{[\s\S]*\}/);
  if (!bloco) throw new Error('A IA nao devolveu JSON na analise.');
  return JSON.parse(bloco[0]);
}

// ---------------------------------------------------------------
// ETAPA 2 — Edicao da foto (Nano Banana Pro)
// ---------------------------------------------------------------

// A regra principal vem primeiro e em caixa alta porque e a instrucao que o
// modelo mais respeita. Mas o prompt e a camada MAIS FRACA da defesa: quem
// garante o rosto sao a mascara e a composicao, em services/imagem.js.
const REGRA_EDICAO = `Edit the provided original photograph.
Apply ONLY the recommended hairstyle and beard style to the existing person.
Do not generate a new person.
Preserve the person's original identity and facial features exactly.
The face must remain unchanged.
Do not modify facial geometry, facial proportions, eyes, eyebrows, nose, mouth, lips, ears, jawline, chin, cheekbones, forehead, skin texture, facial expression, apparent age, or any natural facial characteristics.
Do not beautify or reconstruct the face.
Do not change the person's identity.
Do not change the camera angle, pose, clothing, background, lighting, or composition.
ONLY modify the hair and beard.
The hairstyle and beard must be realistically integrated into the original photograph.
The final image must look like the original photograph with only the hairstyle and beard changed.
The face must remain the same person and must remain visually unchanged.`;

// Do JSON da analise entram SO os atributos de estilo. O resto (formato do
// rosto, justificativas, proporcoes) fica de fora de proposito: o formato do
// rosto serve para ESCOLHER o corte, nunca para o modelo redesenhar o rosto.
function montarPromptEdicao(analise) {
  const cabelo = analise?.recommendations?.hair?.[0];
  const barba = analise?.recommendations?.beard?.[0];

  const atributos = (obj, campos) => campos
    .map(c => [c, obj?.[c]])
    .filter(([, v]) => v && String(v).toLowerCase() !== 'none')
    .map(([c, v]) => `${c}: ${v}`)
    .join(', ');

  const linhas = ['EDIT ONLY HAIR AND BEARD. PRESERVE THE ORIGINAL FACE AND IDENTITY.', '', REGRA_EDICAO, ''];

  if (cabelo) {
    linhas.push(`Recommended hairstyle: ${cabelo.style_en || cabelo.style}`);
    const attr = atributos(cabelo, ['length', 'volume', 'texture', 'fade', 'finish']);
    if (attr) linhas.push(`Hair attributes: ${attr}`);
  }
  if (barba) {
    linhas.push(`Recommended beard: ${barba.style_en || barba.style}`);
    const attr = atributos(barba, ['length', 'shape', 'outline', 'finish']);
    if (attr) linhas.push(`Beard attributes: ${attr}`);
  }

  return linhas.join('\n');
}

async function editarComGoogle(pngAlinhado, prompt) {
  const r = await fetch(`${GOOGLE_BASE}/${MODELO_IMAGEM}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inline_data: { mimeType: 'image/png', data: pngAlinhado.toString('base64') } },
        ],
      }],
      generationConfig: { responseModalities: ['IMAGE'] },
    }),
  });

  const dados = await r.json();
  if (!r.ok) {
    const erro = new Error(dados.error?.message ?? `Gemini erro ${r.status}`);
    erro.semCredito = [401, 402, 429].includes(r.status);
    throw erro;
  }

  const parte = dados.candidates?.[0]?.content?.parts?.find(p => p.inline_data || p.inlineData);
  const dadosImagem = (parte?.inline_data ?? parte?.inlineData)?.data;
  if (!dadosImagem) throw new Error('Gemini nao devolveu imagem.');
  return Buffer.from(dadosImagem, 'base64');
}

async function editarComReplicate(pngAlinhado, prompt) {
  const saida = await rodarPredicao(REPLICATE_IMAGEM, {
    prompt,
    // Atencao: o nano-banana usa image_input (ARRAY), nao input_image.
    image_input: [`data:image/png;base64,${pngAlinhado.toString('base64')}`],
    aspect_ratio: 'match_input_image',
    output_format: 'png',
  });
  return baixar(primeiraUrl(saida));
}

async function editarCabeloBarba(pngAlinhado, prompt) {
  const direto = usarGoogleDireto();
  console.log(`[gemini] edicao via ${direto ? `Google ${MODELO_IMAGEM}` : `Replicate ${REPLICATE_IMAGEM}`}`);

  try {
    return direto ? await editarComGoogle(pngAlinhado, prompt) : await editarComReplicate(pngAlinhado, prompt);
  } catch (e) {
    if (!direto || !e.semCredito) throw e;
    console.error('[gemini] Google indisponivel, editando via Replicate:', e.message);
    return editarComReplicate(pngAlinhado, prompt);
  }
}

module.exports = { analisarVisagismo, montarPromptEdicao, editarCabeloBarba, SCHEMA_VISAGISMO };
