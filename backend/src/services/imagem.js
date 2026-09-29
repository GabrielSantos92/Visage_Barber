// Edicao localizada de cabelo e barba.
//
// Nenhum modelo de edicao por prompt (Nano Banana Pro, gpt-image-1, FLUX Kontext)
// aceita mascara: todos re-renderizam a imagem inteira a partir do texto, e o
// rosto e redesenhado junto. Confirmado na documentacao do gemini-3-pro-image e
// medido na pratica com os tres.
//
// Entao a restricao vem daqui, em duas camadas:
//   1. SEGMENTACAO — Grounding DINO + SAM acham os pixels de cabelo e barba.
//   2. COMPOSICAO  — o pixel final vem da FOTO ORIGINAL em tudo que nao for
//      cabelo/barba. O rosto nao fica "parecido" com o original: ele E o original.

const sharp = require('sharp');
const { rodarPredicao, baixar } = require('./replicate');

// Segmentacao por texto. E modelo da comunidade, entao exige id de versao.
const MODELO_MASCARA = 'schananas/grounded_sam';

// Quanto a mascara cresce alem do cabelo atual, em pixels. Precisa de folga para
// caber um corte com mais volume que o original, mas dilatar demais libera o
// rosto inteiro (testado: o adjustment_factor=5 do proprio modelo faz isso).
const FOLGA_MASCARA = 10;

// O frontend manda base64 puro (sem prefixo data:). Detectamos o mime pelos
// bytes magicos porque o upload por galeria pode ser PNG e o da camera, JPEG.
function mimeDoBase64(base64) {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

function dimensoesDaImagem(buf) {
  // PNG: largura/altura no chunk IHDR
  if (buf.length > 24 && buf[0] === 0x89 && buf[1] === 0x50) {
    return { largura: buf.readUInt32BE(16), altura: buf.readUInt32BE(20) };
  }
  // JPEG: percorre os marcadores ate um SOF
  if (buf.length > 4 && buf[0] === 0xFF && buf[1] === 0xD8) {
    let i = 2;
    while (i + 9 < buf.length) {
      if (buf[i] !== 0xFF) { i++; continue; }
      const marcador = buf[i + 1];
      const ehSOF = marcador >= 0xC0 && marcador <= 0xCF &&
        marcador !== 0xC4 && marcador !== 0xC8 && marcador !== 0xCC;
      if (ehSOF) return { altura: buf.readUInt16BE(i + 5), largura: buf.readUInt16BE(i + 7) };
      i += 2 + buf.readUInt16BE(i + 2);
    }
  }
  return null;
}

// Os geradores devolvem em alguns poucos tamanhos fixos. Alinhamos a foto a um
// deles ANTES de tudo, para que original, mascara e resultado fiquem pixel a
// pixel no mesmo espaco — sem isso a composicao final sairia desalinhada.
// Escolhemos o de proporcao mais proxima, para recortar o minimo possivel.
async function alinharFoto(buf) {
  const dim = dimensoesDaImagem(buf);
  const opcoes = [
    ['1024x1024', 1],
    ['1024x1536', 1024 / 1536],
    ['1536x1024', 1536 / 1024],
  ];

  let escolhido = '1024x1536';
  if (dim && dim.largura && dim.altura) {
    const proporcao = dim.largura / dim.altura;
    escolhido = opcoes.reduce((a, b) =>
      Math.abs(proporcao - a[1]) <= Math.abs(proporcao - b[1]) ? a : b)[0];
    console.log(`[imagem] foto ${dim.largura}x${dim.altura} -> ${escolhido}`);
  }

  const [largura, altura] = escolhido.split('x').map(Number);
  const png = await sharp(buf).resize(largura, altura, { fit: 'cover' }).png().toBuffer();
  return { png, largura, altura, size: escolhido };
}

// Mascara em tons de cinza: BRANCO onde pode editar (cabelo + barba), preto no resto.
async function mascaraCabeloBarba(pngAlinhado, largura, altura) {
  const saida = await rodarPredicao(MODELO_MASCARA, {
    image: `data:image/png;base64,${pngAlinhado.toString('base64')}`,
    mask_prompt: 'hair,beard,mustache',
    // O rosto fica de fora da area editavel ja na segmentacao.
    negative_mask_prompt: 'eyes,nose,mouth,lips,ears,background',
    // A dilatacao do proprio modelo e grosseira demais; damos a folga adiante.
    adjustment_factor: 0,
  }, { comunidade: true });

  // O grounded_sam devolve [anotada, anotada_negativa, mascara, mascara_invertida]
  const urls = Array.isArray(saida) ? saida : [saida];
  if (urls.length < 3) throw new Error('grounded_sam nao devolveu a mascara');

  return sharp(await baixar(urls[2]))
    .resize(largura, altura, { fit: 'fill' })
    .greyscale()
    // blur + threshold = dilatacao: cresce a area branca em ~FOLGA_MASCARA px,
    // dando espaco para um corte com mais volume que o cabelo atual.
    .blur(FOLGA_MASCARA)
    .threshold(60)
    .toBuffer();
}

// A garantia de verdade: fora da mascara o pixel vem da FOTO ORIGINAL.
// A borda e suavizada para a transicao nao virar um recorte duro.
async function compor(original, gerado, mascara, largura, altura) {
  const alphaSuave = await sharp(mascara).blur(3).toBuffer();

  const geradoRecortado = await sharp(gerado)
    .resize(largura, altura, { fit: 'fill' })
    .removeAlpha()
    .joinChannel(alphaSuave)
    .png()
    .toBuffer();

  return sharp(original)
    .composite([{ input: geradoRecortado, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = { mimeDoBase64, dimensoesDaImagem, alinharFoto, mascaraCabeloBarba, compor };
