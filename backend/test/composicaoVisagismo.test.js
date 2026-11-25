// A composicao e a garantia de que o rosto nao muda: fora da mascara, o pixel
// final vem da foto original. Ate 24/11/2026 ela nao funcionava (a imagem
// gerada saia opaca e cobria a foto inteira) e ninguem viu, porque o unico
// teste da rota substituia compor() por uma versao falsa. Aqui o sharp e real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const sharp = require('sharp');
const { compor } = require('../src/services/imagem');

const L = 64;
const A = 96;

const solida = (cor, canais = 3) =>
  sharp({ create: { width: L, height: A, channels: canais, background: cor } }).png().toBuffer();

// Mascara como sai de mascaraCabeloBarba: JPEG em tons de cinza, mas com 3
// canais (foi esse formato que escondeu o bug). Branco so na faixa de cima.
async function mascaraFaixaDeCima() {
  const branco = await sharp({ create: { width: L, height: 32, channels: 3, background: '#fff' } }).png().toBuffer();
  return sharp({ create: { width: L, height: A, channels: 3, background: '#000' } })
    .composite([{ input: branco, left: 0, top: 0 }])
    .greyscale()
    .jpeg()
    .toBuffer();
}

async function pixel(buf, x, y) {
  const { data, info } = await sharp(buf).raw().toBuffer({ resolveWithObject: true });
  const i = (y * info.width + x) * info.channels;
  return [data[i], data[i + 1], data[i + 2]];
}

const perto = (real, esperado) =>
  assert.ok(real.every((v, i) => Math.abs(v - esperado[i]) <= 12), `pixel ${real} longe de ${esperado}`);

test('compor: fora da mascara fica a foto original; dentro, a imagem gerada', async () => {
  const final = await compor(await solida('#ff0000'), await solida('#00ff00'), await mascaraFaixaDeCima(), L, A);
  perto(await pixel(final, 32, 8), [0, 255, 0]);   // cabelo: gerado
  perto(await pixel(final, 32, 80), [255, 0, 0]);  // rosto: original
});

test('compor: imagem gerada com canal alfa e tamanho diferente tambem respeita a mascara', async () => {
  const gerada = await sharp({ create: { width: L * 2, height: A * 2, channels: 4, background: { r: 0, g: 255, b: 0, alpha: 1 } } })
    .png().toBuffer();
  const final = await compor(await solida('#ff0000'), gerada, await mascaraFaixaDeCima(), L, A);
  perto(await pixel(final, 32, 8), [0, 255, 0]);
  perto(await pixel(final, 32, 80), [255, 0, 0]);
});

// ---------------------------------------------------------------
// Montagem da mascara e correcao de luz (imagens sinteticas, sharp real)
// ---------------------------------------------------------------
const { montarMascara } = require('../src/services/imagem');

const LM = 512;
const AM = 768;
const PELE = [200, 160, 140];
const CABELO = [40, 30, 25];

// Imagem RGB a partir de uma funcao (x, y) -> [r, g, b]
function desenhar(cor, l = LM, a = AM) {
  const px = Buffer.alloc(l * a * 3);
  for (let y = 0; y < a; y++) for (let x = 0; x < l; x++) px.set(cor(x, y), (y * l + x) * 3);
  return sharp(px, { raw: { width: l, height: a, channels: 3 } }).png().toBuffer();
}
const faixaBranca = (y0, y1) => desenhar((_x, y) => (y >= y0 && y < y1 ? [255, 255, 255] : [0, 0, 0]));
async function branco(buf, x, y) {
  return (await pixel(buf, x, y))[0] > 127;
}

test('montarMascara: inclui o contorno do corte novo e os fios antigos perto do cabelo, nunca o rosto', async () => {
  // Original: cabelo nas linhas 80-200, uma mecha fina caindo ate 230 (fora da
  // segmentacao) e uma pinta no rosto na linha 600.
  const original = await desenhar((x, y) => {
    if (y >= 80 && y < 200) return CABELO;
    if (x >= 250 && x < 254 && y >= 200 && y < 230) return CABELO;
    if (x >= 250 && x < 262 && y >= 600 && y < 612) return CABELO;
    return PELE;
  });
  // Gerada: corte novo mais alto (40-160), sem a mecha e sem a pinta (a IA mexeu no rosto).
  const gerado = await desenhar((_x, y) => (y >= 40 && y < 160 ? CABELO : PELE));
  const antes = await faixaBranca(80, 200);
  const mascara = await montarMascara({
    original, gerado, antes, cabeloAntes: antes, cabeloDepois: await faixaBranca(40, 160), largura: LM, altura: AM,
  });
  assert.ok(await branco(mascara, 100, 50), 'topo do corte novo');
  assert.ok(await branco(mascara, 252, 220), 'mecha antiga removida pela IA');
  assert.ok(!(await branco(mascara, 100, 260)), 'testa sem mudanca fica de fora');
  assert.ok(!(await branco(mascara, 255, 605)), 'rosto longe do cabelo fica de fora mesmo se a IA mudou');
});

test('montarMascara: sem a mascara de antes nao ha garantia, devolve null', async () => {
  const img = await desenhar(() => PELE);
  assert.equal(await montarMascara({ original: img, gerado: img, antes: null, cabeloAntes: null, cabeloDepois: null, largura: LM, altura: AM }), null);
});

test('compor: corrige a luz da gerada, a testa nova fica com a cor da pele original', async () => {
  const original = await desenhar((_x, y) => (y >= 80 && y < 200 ? CABELO : PELE));
  // A IA clareou tudo em +30 e subiu o cabelo: onde era cabelo agora e pele (clara)
  const clara = PELE.map(v => v + 30);
  const gerado = await desenhar((_x, y) => (y >= 80 && y < 120 ? CABELO : clara));
  const final = await compor(original, gerado, await faixaBranca(80, 200), LM, AM);
  perto(await pixel(final, 256, 170), PELE);   // testa nova, dentro da mascara
  perto(await pixel(final, 256, 400), PELE);   // rosto, fora: original
});

test('mascaraCabeloBarba: mascara binaria e com folga (blur e threshold em pipelines separados)', async () => {
  const { mascaraCabeloBarba } = require('../src/services/imagem');
  // Mascara "do grounded_sam": branco em x < 256, como JPEG RGB
  const doModelo = await sharp(await desenhar(x => (x < 256 ? [255, 255, 255] : [0, 0, 0]))).jpeg().toBuffer();
  const fetchReal = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).endsWith('/mask.jpg')) return new Response(new Uint8Array(doModelo));
    if (String(url).includes('/models/')) return Response.json({ latest_version: { id: 'v1' } });
    return Response.json({ status: 'succeeded', output: ['a.jpg', 'b.jpg', 'https://x/mask.jpg', 'd.jpg'] }, { status: 201 });
  };
  let mascara;
  try {
    mascara = await mascaraCabeloBarba(await desenhar(() => PELE), LM, AM, ['hair']);
  } finally {
    globalThis.fetch = fetchReal;
  }
  const { data, info } = await sharp(mascara).raw().toBuffer({ resolveWithObject: true });
  const linha = x => data[(400 * LM + x) * info.channels];
  for (let x = 0; x < LM; x++) assert.ok(linha(x) === 0 || linha(x) === 255, `x=${x}: ${linha(x)} nao e binario`);
  assert.equal(linha(250), 255);
  assert.equal(linha(262), 255, 'folga alem da borda');
  assert.equal(linha(290), 0, 'folga limitada');
});
