const express = require('express');
const router = express.Router();

const PROMPT_VISAGISMO = `Você é um especialista em visagismo e consultoria de imagem masculina.
Analise esta foto do rosto e retorne SOMENTE um JSON válido, sem markdown, sem explicações extras.

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
    console.log('[visagismo] refusal:', choice?.message?.refusal);
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

module.exports = router;
