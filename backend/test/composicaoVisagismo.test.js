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
