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

// Mascara em tons de cinza: BRANCO onde pode editar, preto no resto.
// `partes` encolhe a area editavel na personalizacao (ex.: so 'hair' quando o
// cliente quer manter a barba) — ver partesEditaveis em services/personalizacao.js.
// Atencao: pedir so 'beard,mustache' marcou o CABELO como barba num teste de
// 24/11/2026; a barba sai sempre da chamada combinada (ver montarMascara).
// A imagem e reduzida ao tamanho de trabalho antes de subir: a gerada vem
// maior (1696x2528) e o envio vai como data URL.
async function mascaraCabeloBarba(imagem, largura, altura, partes = ['hair', 'beard', 'mustache']) {
  const png = await sharp(imagem).resize(largura, altura, { fit: 'fill' }).removeAlpha().png().toBuffer();
  const saida = await rodarPredicao(MODELO_MASCARA, {
    image: `data:image/png;base64,${png.toString('base64')}`,
    mask_prompt: partes.join(','),
    // O rosto fica de fora da area editavel ja na segmentacao.
    negative_mask_prompt: 'eyes,nose,mouth,lips,ears,background',
    // A dilatacao do proprio modelo e grosseira demais; damos a folga adiante.
    adjustment_factor: 0,
  }, { comunidade: true });

  // O grounded_sam devolve [anotada, anotada_negativa, mascara, mascara_invertida]
  const urls = Array.isArray(saida) ? saida : [saida];
  if (urls.length < 3) throw new Error('grounded_sam nao devolveu a mascara');

  // blur + threshold = dilatacao: cresce a area branca em ~FOLGA_MASCARA px,
  // dando espaco para um corte com mais volume que o cabelo atual.
  // EM DOIS PIPELINES: num so, o sharp aplica o threshold ANTES do blur e a
  // mascara sai desfocada, sem folga e com uma rampa semitransparente de ~25 px
  // onde cabelo antigo e novo se misturavam ("sombra"). Bug ate 24/11/2026.
  const desfocada = await sharp(await baixar(urls[2]))
    .resize(largura, altura, { fit: 'fill' })
    .extractChannel(0)
    .blur(FOLGA_MASCARA)
    .png()
    .toBuffer();
  return sharp(desfocada).threshold(60).extractChannel(0).png().toBuffer();
}

// ---------------------------------------------------------------
// Montagem da area editavel
// ---------------------------------------------------------------
// Medido em 24/11/2026 numa analise real: a IA devolve a foto no mesmo
// enquadramento (olhos, nariz e orelhas coincidem), mas o corte novo tem outro
// contorno. So com a mascara do cabelo ANTIGO, o topete mais alto saia cortado
// reto e a mecha da franja que a segmentacao nao pegou ficava na testa, por
// cima do corte novo ("sombra" do cabelo antigo). Entao a area editavel e:
//   mascara de antes (cabelo + barba, a chamada combinada de sempre)
//   + cabelo de depois (contorno do corte novo)
//   + fios antigos que a IA removeu (so numa faixa estreita em volta do cabelo).
// A barba nao entra na faixa nem na mascara de depois: perto dela estao a boca
// e as bochechas, e barba nova onde nao cresce barba e justamente o que nao
// queremos simular.

// Largura da faixa em volta do cabelo onde fios antigos podem ter sobrado (px
// numa imagem de 1024 de largura) e diferenca (0-255) que conta como mudanca.
const FAIXA_FIOS = 60;
const LIMIAR_FIOS = 45;

const escalaPx = (px, largura) => px * largura / 1024;

// Canal unico em bytes (0-255), no tamanho pedido.
async function canal(buf, largura, altura) {
  return sharp(buf).resize(largura, altura, { fit: 'fill' }).extractChannel(0).raw().toBuffer();
}

function paraPng(bytes, largura, altura, canais = 1) {
  return sharp(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length), {
    raw: { width: largura, height: altura, channels: canais },
  }).png().toBuffer();
}

// Dilatacao binaria por blur + limiar: o branco cresce ~px pixels. Blur e
// threshold em pipelines separados (ver mascaraCabeloBarba).
async function dilatar(buf, largura, altura, px) {
  const desfocada = await sharp(buf)
    .resize(largura, altura, { fit: 'fill' })
    .extractChannel(0)
    .blur(Math.max(0.3, px / 1.175))
    .png()
    .toBuffer();
  return sharp(desfocada).threshold(31).extractChannel(0).png().toBuffer();
}

async function unirMascaras(mascaras, largura, altura) {
  const validas = mascaras.filter(Boolean);
  if (!validas.length) return null;
  const partes = await Promise.all(validas.map(m => canal(m, largura, altura)));
  const uniao = new Uint8Array(largura * altura);
  for (const p of partes) {
    for (let i = 0; i < uniao.length; i++) if (p[i] > 127) uniao[i] = 255;
  }
  return paraPng(uniao, largura, altura);
}

// Media movel (caixa) separavel, 3 passadas ~ gaussiana. Altera `v`.
function suavizar(v, largura, altura, raio) {
  const tmp = new Float32Array(v.length);
  const janela = 2 * raio + 1;
  for (let passada = 0; passada < 3; passada++) {
    for (let y = 0; y < altura; y++) {
      const base = y * largura;
      let soma = 0;
      for (let x = -raio; x <= raio; x++) soma += v[base + Math.min(largura - 1, Math.max(0, x))];
      for (let x = 0; x < largura; x++) {
        tmp[base + x] = soma / janela;
        soma += v[base + Math.min(largura - 1, x + raio + 1)] - v[base + Math.max(0, x - raio)];
      }
    }
    for (let x = 0; x < largura; x++) {
      let soma = 0;
      for (let y = -raio; y <= raio; y++) soma += tmp[Math.min(altura - 1, Math.max(0, y)) * largura + x];
      for (let y = 0; y < altura; y++) {
        v[y * largura + x] = soma / janela;
        soma += tmp[Math.min(altura - 1, y + raio + 1) * largura + x] - tmp[Math.max(0, y - raio) * largura + x];
      }
    }
  }
}

// A IA muda a luz e a cor (pele mais clara, testa mais brilhante). Medimos a
// diferenca original - gerada em volta da area editavel e a levamos para dentro
// dela, suavizada: a testa que aparece onde havia franja fica com a luz da foto
// original, sem mancha. Diferencas muito grandes (algo que a IA mudou de fato,
// como um fio removido) nao entram na medida.
async function corrigirLuz(original, geradoRgb, mascara, largura, altura) {
  const w = 256;
  const h = Math.round(w * altura / largura);
  const ler = b => sharp(b).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const [o, g] = await Promise.all([ler(original), ler(geradoRgb)]);
  const m = await canal(await dilatar(mascara, w, h, 3), w, h);

  const peso = new Float32Array(w * h);
  for (let i = 0; i < peso.length; i++) {
    if (m[i] > 127) continue;
    const dif = Math.abs(o[i * 3] - g[i * 3]) + Math.abs(o[i * 3 + 1] - g[i * 3 + 1]) + Math.abs(o[i * 3 + 2] - g[i * 3 + 2]);
    if (dif < 120) peso[i] = 1;
  }
  const pesoSuave = Float32Array.from(peso);
  suavizar(pesoSuave, w, h, 16);

  const deslocamento = new Uint8Array(w * h * 3);
  for (let c = 0; c < 3; c++) {
    const d = new Float32Array(w * h);
    let soma = 0;
    let n = 0;
    for (let i = 0; i < d.length; i++) {
      if (!peso[i]) continue;
      d[i] = o[i * 3 + c] - g[i * 3 + c];
      soma += d[i];
      n++;
    }
    const global = n ? soma / n : 0;
    suavizar(d, w, h, 16);
    for (let i = 0; i < d.length; i++) {
      const local = pesoSuave[i] > 0.02 ? d[i] / pesoSuave[i] : global;
      deslocamento[i * 3 + c] = Math.max(0, Math.min(255, Math.round(local + 128)));
    }
  }

  const desloc = await sharp(await paraPng(deslocamento, w, h, 3)).resize(largura, altura, { fit: 'fill' }).raw().toBuffer();
  const ger = await sharp(geradoRgb).resize(largura, altura, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const saida = new Uint8Array(ger.length);
  for (let i = 0; i < ger.length; i++) saida[i] = Math.max(0, Math.min(255, ger[i] + desloc[i] - 128));
  return paraPng(saida, largura, altura, 3);
}

// Fios antigos que a segmentacao nao pegou e a IA removeu: na faixa em volta
// do cabelo, onde a gerada (com a luz corrigida) difere muito da original.
async function fiosRemovidos(original, geradoCorrigido, cabelo, largura, altura) {
  const faixa = await canal(await dilatar(cabelo, largura, altura, escalaPx(FAIXA_FIOS, largura)), largura, altura);
  const dentro = await canal(cabelo, largura, altura);
  const ler = b => sharp(b).resize(largura, altura, { fit: 'fill' }).removeAlpha().raw().toBuffer();
  const [o, g] = await Promise.all([ler(original), ler(geradoCorrigido)]);
  const mudou = new Uint8Array(largura * altura);
  for (let i = 0; i < mudou.length; i++) {
    if (faixa[i] < 128 || dentro[i] > 127) continue;
    const dif = Math.max(
      Math.abs(o[i * 3] - g[i * 3]),
      Math.abs(o[i * 3 + 1] - g[i * 3 + 1]),
      Math.abs(o[i * 3 + 2] - g[i * 3 + 2]),
    );
    if (dif > LIMIAR_FIOS) mudou[i] = 255;
  }
  // Sem erosao: fio de cabelo e fino e sumiria. A dilatacao junta os fios num
  // bloco; ruido solto na pele so troca pele por pele (com a luz corrigida).
  return dilatar(await paraPng(mudou, largura, altura), largura, altura, escalaPx(6, largura));
}

// `antes` e obrigatoria (a garantia do rosto); `cabeloAntes` e `cabeloDepois`
// (so cabelo) sao extras e podem ser null: sem elas, fica a mascara de sempre.
async function montarMascara({ original, gerado, antes, cabeloAntes, cabeloDepois, largura, altura }) {
  if (!antes) return null;
  const cabelo = await unirMascaras([cabeloAntes, cabeloDepois], largura, altura);
  if (!cabelo) return unirMascaras([antes], largura, altura);
  let fios = null;
  try {
    const previa = await unirMascaras([antes, cabelo], largura, altura);
    const geradoRgb = await sharp(gerado).resize(largura, altura, { fit: 'fill' }).removeAlpha().png().toBuffer();
    const corrigido = await corrigirLuz(original, geradoRgb, previa, largura, altura);
    fios = await fiosRemovidos(original, corrigido, cabelo, largura, altura);
  } catch (e) {
    console.error('[imagem] deteccao de fios antigos falhou, seguindo sem ela:', e.message);
  }
  return unirMascaras([antes, cabeloDepois, fios], largura, altura);
}

// A borda e suavizada para a transicao nao virar um recorte duro.
// O alfa PRECISA ter um canal so. A mascara chega com 3 canais (o JPEG do
// grounded_sam continua RGB mesmo depois do greyscale()); com 3 canais o
// joinChannel nao vira transparencia, a imagem gerada sai opaca e cobre a foto
// original inteira, rosto incluido. Esse bug existiu ate 24/11/2026.
async function alfaDaMascara(mascara, largura, altura) {
  return sharp(mascara)
    .resize(largura, altura, { fit: 'fill' })
    .extractChannel(0)
    .blur(3)
    .toColourspace('b-w')
    .png()
    .toBuffer();
}

// A garantia de verdade: fora da mascara o pixel vem da FOTO ORIGINAL.
async function compor(original, gerado, mascara, largura, altura) {
  const alphaSuave = await alfaDaMascara(mascara, largura, altura);

  // Dois pipelines de proposito: num so, o sharp aplica o removeAlpha DEPOIS do
  // joinChannel (a ordem das chamadas nao e a ordem de execucao) e apaga o alfa.
  const geradoBruto = await sharp(gerado)
    .resize(largura, altura, { fit: 'fill' })
    .removeAlpha()
    .png()
    .toBuffer();
  let geradoRgb = geradoBruto;
  try {
    geradoRgb = await corrigirLuz(original, geradoBruto, mascara, largura, altura);
  } catch (e) {
    console.error('[imagem] correcao de luz falhou, seguindo sem ela:', e.message);
  }
  const geradoRecortado = await sharp(geradoRgb)
    .joinChannel(alphaSuave)
    .png()
    .toBuffer();

  return sharp(original)
    .composite([{ input: geradoRecortado, blend: 'over' }])
    .jpeg({ quality: 92 })
    .toBuffer();
}

module.exports = {
  mimeDoBase64, dimensoesDaImagem, alinharFoto, mascaraCabeloBarba, compor, alfaDaMascara,
  montarMascara, unirMascaras, corrigirLuz,
};
