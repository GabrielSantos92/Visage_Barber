const express = require('express');
const router = express.Router();

/**
 * Sistema de recomendação baseado em regras de visagismo.
 * Documentar no TCC: "Sistema especialista baseado em regras de visagismo clássico,
 * com arquitetura preparada para futura integração com AWS Rekognition."
 */
const RECOMENDACOES = {
  oval: {
    cortes: ['Corte desconectado', 'Topete', 'Topete clássico', 'Cabelo penteado para trás', 'Corte curto texturizado', 'Franja texturizada'],
    motivo: 'Formato oval é o mais versátil — aceita praticamente qualquer estilo.',
  },
  redondo: {
    cortes: ['Degradê alto', 'Moicano', 'Topete com volume', 'Moicano disfarçado', 'Coque alto', 'Corte militar alto'],
    motivo: 'Cortes com volume no topo e laterais curtas alongam visualmente o rosto.',
  },
  quadrado: {
    cortes: ['Corte texturizado', 'Topete lateral', 'Coque alto', 'Corte desconectado suave', 'Corte francês', 'Corte com risca lateral'],
    motivo: 'Texturas e volumes suaves suavizam os ângulos marcados da mandíbula.',
  },
  triangular: {
    cortes: ['Topete clássico', 'Volume no topo', 'Corte desconectado lateral', 'Topete', 'Corte César'],
    motivo: 'Volume na parte superior equilibra a testa larga com o queixo estreito.',
  },
  losango: {
    cortes: ['Franja lateral', 'Ondas naturais', 'Topete texturizado', 'Penteado de lado', 'Corte militar'],
    motivo: 'Franjas e laterais estruturadas complementam as maçãs do rosto proeminentes.',
  },
  oblongo: {
    cortes: ['Degradê baixo', 'Laterais mais cheias', 'Corte texturizado', 'Corte clássico', 'Cachos no topo'],
    motivo: 'Evitar altura excessiva; laterais mais largas equilibram o comprimento do rosto.',
  },
};

// POST /api/recommendation
router.post('/', (req, res) => {
  const { formato_rosto } = req.body;

  if (!formato_rosto) {
    return res.status(400).json({ erro: 'Campo formato_rosto é obrigatório.' });
  }

  const recomendacao = RECOMENDACOES[formato_rosto.toLowerCase()];

  if (!recomendacao) {
    return res.status(404).json({
      erro: `Formato '${formato_rosto}' não reconhecido.`,
      formatosValidos: Object.keys(RECOMENDACOES),
    });
  }

  return res.json({
    formato: formato_rosto,
    cortes: recomendacao.cortes,
    motivo: recomendacao.motivo,
  });
});

// GET /api/recommendation/formatos — lista todos os formatos suportados
router.get('/formatos', (_req, res) => {
  res.json({ formatos: Object.keys(RECOMENDACOES) });
});

module.exports = router;
