// Rotas do visagismo. A logica de IA fica em services/gemini.js e o tratamento
// de pixels em services/imagem.js — aqui so orquestramos.
//
//   FOTO DO USUARIO
//        v
//   Gemini Flash          ETAPA 1: analisa e recomenda (JSON estruturado)
//        v
//   VISAGISM JSON
//        v
//   recomendacao principal de cabelo + barba
//        v
//   Nano Banana Pro       ETAPA 2: edita a foto original
//        v
//   mascara + composicao  garante que so cabelo e barba mudaram
//        v
//   RESULTADO

const express = require('express');
const sharp = require('sharp');
const router = express.Router();

const { analisarVisagismo, montarPromptEdicao, editarCabeloBarba } = require('../services/gemini');
const { alinharFoto, mascaraCabeloBarba, compor } = require('../services/imagem');

// As telas de resultado (web e mobile) ja consomem o formato antigo. A analise
// passou a devolver o schema novo, entao devolvemos os dois: o novo como fonte
// de verdade e o antigo derivado dele, para nao quebrar o que ja funciona.
function comCompatibilidade(analise) {
  const cabelos = analise.recommendations?.hair ?? [];
  const barbas = analise.recommendations?.beard ?? [];
  const cabelo = cabelos[0] ?? {};
  const barba = barbas[0] ?? {};
  const rosto = analise.face_analysis ?? {};

  return {
    ...analise,
    formato_rosto: analise.face_shape,
    tracos: [rosto.proportions, rosto.forehead, rosto.jawline, rosto.cheekbones]
      .filter(Boolean).join(' '),
    corte_principal: {
      nome: cabelo.style,
      descricao: cabelo.description,
      caracteristicas: cabelo.caracteristicas ?? [],
      nome_en: cabelo.style_en,
    },
    cortes_alternativos: cabelos.slice(1).map(c => c.style).filter(Boolean),
    barba: {
      estilo: barba.style,
      motivo: barba.reason,
      estilo_en: barba.style_en,
    },
  };
}

// Aceita a analise inteira (novo) ou os campos soltos (frontends antigos).
function analiseDoCorpo(corpo) {
  if (corpo.analise?.recommendations) return corpo.analise;

  return {
    face_shape: corpo.formato_rosto,
    recommendations: {
      hair: corpo.corte || corpo.corte_en ? [{ style: corpo.corte, style_en: corpo.corte_en }] : [],
      beard: corpo.barba || corpo.barba_en ? [{ style: corpo.barba, style_en: corpo.barba_en }] : [],
    },
  };
}

// ETAPA 1 — so analise, nenhuma imagem gerada aqui.
router.post('/analisar', async (req, res) => {
  try {
    const { imagem_base64 } = req.body;
    if (!imagem_base64) {
      return res.status(400).json({ error: 'imagem_base64 é obrigatório.' });
    }

    const analise = await analisarVisagismo(imagem_base64);
    console.log('[visagismo] analise:', analise.face_shape, '->', analise.recommendations?.hair?.[0]?.style);
    return res.json(comCompatibilidade(analise));
  } catch (err) {
    console.error('[visagismo] erro analisar:', err.message);
    return res.status(502).json({ error: err.message ?? 'Erro ao analisar a imagem.' });
  }
});

// ETAPA 2 — edita a foto original com o que a etapa 1 recomendou.
router.post('/imagem-referencia', async (req, res) => {
  try {
    const { imagem_base64 } = req.body;
    if (!imagem_base64) {
      return res.status(400).json({ error: 'imagem_base64 é obrigatório para editar a foto.' });
    }

    const analise = analiseDoCorpo(req.body);
    const prompt = montarPromptEdicao(analise);
    const original = await alinharFoto(Buffer.from(imagem_base64, 'base64'));

    // A mascara e o que impede a IA de refazer o rosto. Se a segmentacao falhar
    // ainda entregamos a imagem, mas avisamos na resposta que a garantia caiu.
    let mascara = null;
    try {
      mascara = await mascaraCabeloBarba(original.png, original.largura, original.altura);
    } catch (e) {
      console.error('[visagismo] falha ao segmentar cabelo/barba:', e.message);
    }

    const gerado = await editarCabeloBarba(original.png, prompt);

    // Fora da mascara, o pixel final vem da foto original.
    const final = mascara
      ? await compor(original.png, gerado, mascara, original.largura, original.altura)
      : await sharp(gerado).jpeg({ quality: 92 }).toBuffer();

    console.log('[visagismo] imagem pronta, bytes:', final.length, '| mascara:', Boolean(mascara));
    return res.json({
      base64: final.toString('base64'),
      contentType: 'image/jpeg',
      editada: true,
      mascara_aplicada: Boolean(mascara),
    });
  } catch (err) {
    console.error('[visagismo] erro imagem-referencia:', err.message);
    return res.status(502).json({ error: err.message ?? 'Erro ao gerar imagem.' });
  }
});

module.exports = router;
