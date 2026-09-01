const express = require('express');
const router = express.Router();

const PROMPT_VISAGISMO = `Você é um consultor profissional de visagismo em uma barbearia.
Analise a GEOMETRIA e ESTRUTURA FACIAL desta imagem para recomendar cortes de cabelo masculinos.
Foque apenas nos traços geométricos (formato, proporções, ângulos faciais) sem identificar a pessoa.
Retorne SOMENTE um JSON válido, sem markdown, sem explicações extras.

Estrutura obrigatória:
{
  "formato_rosto": "oval|redondo|quadrado|triangular|losango|oblongo",
  "tracos": "descrição breve dos traços marcantes",
  "corte_principal": {
    "nome": "nome do corte ideal",
    "descricao": "por que este corte valoriza este rosto",
    "caracteristicas": ["característica 1", "característica 2", "característica 3", "característica 4"]
  },
  "cortes_alternativos": ["corte 2", "corte 3", "corte 4"],
  "barba": {
    "estilo": "estilo de barba ideal",
    "motivo": "por que este estilo de barba combina"
  },
  "cores_ideais": ["cor 1", "cor 2", "cor 3", "cor 4"],
  "o_que_evitar": ["evitar 1", "evitar 2", "evitar 3"],
  "resumo": "parágrafo curto resumindo o visual ideal para esta pessoa"
}`;

// POST /api/visagismo/analisar
router.post('/analisar', async (req, res) => {
  try {
    const { imagem_base64 } = req.body;
    if (!imagem_base64) {
      return res.status(400).json({ error: 'imagem_base64 é obrigatório.' });
    }

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 1200,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'Você é um especialista em visagismo masculino. Responda APENAS com JSON válido, sem texto adicional.',
          },
          {
            role: 'user',
            content: [
              { type: 'text', text: PROMPT_VISAGISMO },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${imagem_base64}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
      }),
    });

    if (!openaiRes.ok) {
      const err = await openaiRes.json().catch(() => ({}));
      return res.status(502).json({ error: err.error?.message ?? 'Erro na API OpenAI.' });
    }

    const openaiData = await openaiRes.json();
    const choice = openaiData.choices?.[0];
    console.log('[visagismo] finish_reason:', choice?.finish_reason);
    if (choice?.message?.refusal) {
      console.error('[visagismo] recusado pelo modelo:', choice.message.refusal);
      return res.status(502).json({ error: 'A IA recusou analisar a imagem. Tente com outra foto.' });
    }
    const texto = choice?.message?.content ?? '';
    console.log('[visagismo] resposta bruta:', texto.substring(0, 500));

    // Extrai o JSON da resposta (remove markdown se vier)
    const jsonMatch = texto.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[visagismo] JSON não encontrado na resposta:', texto);
      return res.status(502).json({ error: 'Resposta inesperada da IA.', raw: texto });
    }

    const resultado = JSON.parse(jsonMatch[0]);
    return res.json(resultado);
  } catch (err) {
    console.error('[visagismo]', err);
    return res.status(500).json({ error: err.message ?? 'Erro interno.' });
  }
});

// POST /api/visagismo/imagem-referencia
router.post('/imagem-referencia', async (req, res) => {
  try {
    const { formato_rosto, corte, barba, imagem_base64 } = req.body;

    const prompt = `professional barbershop portrait of a young man with ${corte} haircut and ${barba} beard, sharp clean lines, freshly styled, studio lighting, white background, high-end grooming magazine photo, photorealistic, 8k`;

    console.log('[visagismo] gerando imagem via Replicate FLUX para:', corte);

    const createRes = await fetch('https://api.replicate.com/v1/models/black-forest-labs/flux-dev/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.REPLICATE_API_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait=60',
      },
      body: JSON.stringify({
        input: {
          prompt,
          num_inference_steps: 30,
          guidance: 3.5,
          aspect_ratio: '3:4',
          output_format: 'jpg',
          output_quality: 95,
        },
      }),
    });

    if (!createRes.ok) {
      const err = await createRes.json().catch(() => ({}));
      throw new Error(`Replicate erro ${createRes.status}: ${err.detail ?? JSON.stringify(err)}`);
    }

    let prediction = await createRes.json();
    console.log('[visagismo] prediction id:', prediction.id, 'status:', prediction.status);

    let tentativas = 0;
    while (prediction.status !== 'succeeded' && prediction.status !== 'failed' && tentativas < 100) {
      await new Promise(r => setTimeout(r, 3000));
      const pollRes = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
        headers: { 'Authorization': `Bearer ${process.env.REPLICATE_API_KEY}` },
      });
      prediction = await pollRes.json();
      console.log('[visagismo] status:', prediction.status);
      tentativas++;
    }

    if (prediction.status === 'failed') throw new Error('Replicate falhou: ' + (prediction.error ?? 'erro desconhecido'));
    if (prediction.status !== 'succeeded') throw new Error('Timeout na geração');

    const outputUrl = Array.isArray(prediction.output) ? prediction.output[0] : prediction.output;
    if (!outputUrl) throw new Error('Sem imagem de saída');

    console.log('[visagismo] baixando imagem gerada...');
    const imgRes = await fetch(outputUrl);
    if (!imgRes.ok) throw new Error(`Erro ao baixar imagem: ${imgRes.status}`);

    const buffer = await imgRes.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    const contentType = imgRes.headers.get('content-type') ?? 'image/png';

    console.log('[visagismo] imagem pronta, tamanho base64:', base64.length);
    return res.json({ base64, contentType });
  } catch (err) {
    console.error('[visagismo] erro imagem-referencia:', err.message);
    return res.status(502).json({ error: err.message ?? 'Erro ao gerar imagem.' });
  }
});

module.exports = router;
