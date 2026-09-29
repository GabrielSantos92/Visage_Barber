// Cliente minimo da API do Replicate.
//
// Dois detalhes que ja causaram bug aqui:
//   - modelos oficiais aceitam /models/{m}/predictions; os da comunidade exigem
//     /predictions com o id da versao;
//   - contas com pouco credito ficam limitadas a 1 requisicao simultanea, e o
//     pipeline do visagismo faz varias chamadas em sequencia.

const BASE = 'https://api.replicate.com/v1';

function cabecalhos() {
  return {
    'Authorization': `Bearer ${process.env.REPLICATE_API_KEY}`,
    'Content-Type': 'application/json',
  };
}

async function idDaVersao(modelo) {
  const r = await fetch(`${BASE}/models/${modelo}`, { headers: cabecalhos() });
  if (!r.ok) throw new Error(`Replicate: modelo ${modelo} nao encontrado (${r.status})`);
  return (await r.json()).latest_version.id;
}

async function criarPredicao(modelo, input, { comunidade = false } = {}) {
  const url = comunidade ? `${BASE}/predictions` : `${BASE}/models/${modelo}/predictions`;
  const corpo = comunidade ? { version: await idDaVersao(modelo), input } : { input };

  let resposta;
  for (let tentativa = 0; ; tentativa++) {
    resposta = await fetch(url, {
      method: 'POST',
      headers: { ...cabecalhos(), 'Prefer': 'wait=60' },
      body: JSON.stringify(corpo),
    });

    if (resposta.status !== 429 || tentativa >= 5) break;
    const espera = 3000 * (tentativa + 1);
    console.log(`[replicate] 429, aguardando ${espera / 1000}s...`);
    await new Promise(r => setTimeout(r, espera));
  }

  if (!resposta.ok) {
    const err = await resposta.json().catch(() => ({}));
    throw new Error(`Replicate erro ${resposta.status}: ${err.detail ?? JSON.stringify(err)}`);
  }

  let predicao = await resposta.json();
  let voltas = 0;
  while (!['succeeded', 'failed', 'canceled'].includes(predicao.status) && voltas++ < 100) {
    await new Promise(r => setTimeout(r, 3000));
    predicao = await (await fetch(`${BASE}/predictions/${predicao.id}`, { headers: cabecalhos() })).json();
  }

  if (predicao.status === 'failed') throw new Error(`Replicate falhou: ${predicao.error ?? 'erro desconhecido'}`);
  if (predicao.status !== 'succeeded') throw new Error('Replicate: timeout na geracao');
  if (!predicao.output) throw new Error('Replicate: sem saida');

  return predicao.output;
}

// Os provedores de imagem falham de forma transitoria ("Server side error").
// Uma nova tentativa resolve, e predicao com falha nao e cobrada.
async function rodarPredicao(modelo, input, opcoes = {}) {
  try {
    return await criarPredicao(modelo, input, opcoes);
  } catch (e) {
    if (!/falhou/.test(e.message)) throw e;
    console.error('[replicate] predicao falhou, tentando novamente:', e.message.slice(0, 120));
    return criarPredicao(modelo, input, opcoes);
  }
}

async function baixar(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Erro ao baixar imagem: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}

function primeiraUrl(saida) {
  return Array.isArray(saida) ? saida[0] : saida;
}

// O Gemini no Replicate devolve o texto em pedacos.
function juntarTexto(saida) {
  return Array.isArray(saida) ? saida.join('') : String(saida);
}

module.exports = { rodarPredicao, baixar, primeiraUrl, juntarTexto };
