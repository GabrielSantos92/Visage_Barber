const express = require('express');
const router = express.Router();

/**
 * Sistema de recomendação baseado em regras de visagismo.
 * Documentar no TCC: "Sistema especialista baseado em regras de visagismo clássico,
 * com arquitetura preparada para futura integração com AWS Rekognition."
 */
const RECOMENDACOES = {
  oval: {
    cortes: ['Undercut', 'Quiff', 'Pompadour', 'Slick Back', 'Crop Top', 'Textured Fringe'],
    motivo: 'Formato oval é o mais versátil — aceita praticamente qualquer estilo.',
  },
  redondo: {
    cortes: ['Fade Alto', 'Mohawk', 'Quiff com volume', 'Faux Hawk', 'Topknot', 'High and Tight'],
    motivo: 'Cortes com volume no topo e laterais curtas alongam visualmente o rosto.',
  },
  quadrado: {
    cortes: ['Corte Texturizado', 'Quiff Lateral', 'Topknot', 'Undercut Suave', 'French Crop', 'Side Part'],
    motivo: 'Texturas e volumes suaves suavizam os ângulos marcados da mandíbula.',
  },
  triangular: {
    cortes: ['Pompadour', 'Volume no Topo', 'Undercut Lateral', 'Quiff', 'Caesar Cut'],
    motivo: 'Volume na parte superior equilibra a testa larga com o queixo estreito.',
  },
  losango: {
    cortes: ['Franja Lateral', 'Ondas Naturais', 'Quiff Texturizado', 'Side Swept', 'Buzz Cut'],
    motivo: 'Franjas e laterais estruturadas complementam as maçãs do rosto proeminentes.',
  },
  oblongo: {
    cortes: ['Fade Baixo', 'Lateral Sides', 'Textured Crop', 'Corte Clássico', 'Curly Top'],
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
