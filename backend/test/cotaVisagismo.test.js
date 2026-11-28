// Limite de uso do visagismo (services/cotaVisagismo.js), sem banco: leitura
// das variaveis, mensagens, reserva em memoria quando a migration 31 falta e
// recusa quando o banco falha por outro motivo.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarCotaVisagismo, lerLimitesVisagismo, registrarNoBanco, PADROES } = require('../src/services/cotaVisagismo');

const LIMITES = {
  analise: { porHora: 2, porDia: 3, totalDia: 5 },
  imagem: { porHora: 1, porDia: 2, totalDia: 3 },
};
const logMudo = () => {
  const linhas = [];
  return { linhas, warn: (...a) => linhas.push(['warn', a.join(' ')]), error: (...a) => linhas.push(['error', a.join(' ')]) };
};
// 26/11/2026 12:00 em Brasilia (15:00 UTC)
const AGORA = new Date('2026-11-26T15:00:00Z');

test('limites: padroes sem variaveis; valores validos (inclusive 0); invalido usa o padrao com aviso', () => {
  assert.deepEqual(lerLimitesVisagismo({}).limites, PADROES);
  const { limites, avisos } = lerLimitesVisagismo({
    VISAGISMO_ANALISES_POR_HORA: '7', VISAGISMO_IMAGENS_TOTAL_DIA: '0',
    VISAGISMO_ANALISES_POR_DIA: 'dez', VISAGISMO_IMAGENS_POR_HORA: '-1', VISAGISMO_IMAGENS_POR_DIA: '2.5',
    VISAGISMO_ANALISES_TOTAL_DIA: ' ',
  });
  assert.equal(limites.analise.porHora, 7);
  assert.equal(limites.imagem.totalDia, 0);
  assert.equal(limites.analise.porDia, PADROES.analise.porDia);
  assert.equal(limites.imagem.porHora, PADROES.imagem.porHora);
  assert.equal(limites.imagem.porDia, PADROES.imagem.porDia);
  assert.equal(limites.analise.totalDia, PADROES.analise.totalDia);
  assert.equal(avisos.length, 3);
  assert.ok(avisos.every((a) => /^VISAGISMO_[A-Z_]+ inválida; usando \d+\.$/.test(a)));
});

test('banco: repassa usuario, tipo e limites; permitido libera', async () => {
  const chamadas = [];
  const chamar = async (nome, args) => { chamadas.push([nome, args]); return { permitido: true }; };
  const cota = criarCotaVisagismo({ registrar: registrarNoBanco(chamar), limites: LIMITES, agora: () => AGORA });
  assert.deepEqual(await cota.consumir('u1', 'imagem'), { ok: true });
  assert.deepEqual(chamadas, [['consumir_cota_visagismo', { p_user_id: 'u1', p_tipo: 'imagem', p_por_hora: 1, p_por_dia: 2, p_total_dia: 3 }]]);
});

test('banco: recusas viram 429 com mensagem no horario de Brasilia', async () => {
  const respostas = [
    { permitido: false, motivo: 'HORA', limite: 2, liberar_em: '2026-11-26T15:40:00Z' },
    { permitido: false, motivo: 'DIA', limite: 3, liberar_em: '2026-11-27T12:05:00Z' },
    { permitido: false, motivo: 'TOTAL', limite: 5, liberar_em: null },
    { permitido: false, motivo: 'DIA', limite: 3, liberar_em: '2026-11-29T12:05:00Z' },
  ];
  const cota = criarCotaVisagismo({ registrar: async () => respostas.shift(), limites: LIMITES, agora: () => AGORA });
  assert.deepEqual(await cota.consumir('u1', 'analise'), {
    ok: false, status: 429, code: 'COTA_VISAGISMO_USUARIO',
    error: 'Você atingiu o limite de 2 análises por foto por hora. Tente novamente a partir das 12:40.',
  });
  assert.equal((await cota.consumir('u1', 'analise')).error,
    'Você atingiu o limite de 3 análises por foto por dia. Tente novamente amanhã, a partir das 09:05.');
  assert.deepEqual(await cota.consumir('u1', 'imagem'), {
    ok: false, status: 429, code: 'COTA_VISAGISMO_TOTAL',
    error: 'O limite diário de simulações de corte do sistema foi atingido. Tente novamente mais tarde.',
  });
  assert.equal((await cota.consumir('u1', 'analise')).error,
    'Você atingiu o limite de 3 análises por foto por dia. Tente novamente em 29/11, a partir das 09:05.');
});

test('sem usuario: 401 sem consultar o banco; tipo desconhecido e erro de programacao', async () => {
  let chamou = false;
  const cota = criarCotaVisagismo({ registrar: async () => { chamou = true; return { permitido: true }; }, limites: LIMITES });
  assert.equal((await cota.consumir(undefined, 'analise')).status, 401);
  await assert.rejects(cota.consumir('u1', 'video'), /tipo de cota desconhecido/);
  assert.equal(chamou, false);
});

test('banco com erro (nao a funcao ausente): recusa com 503, sem chamar a IA', async () => {
  const log = logMudo();
  const cota = criarCotaVisagismo({
    registrar: async () => { throw Object.assign(new Error('fetch failed'), { code: undefined }); }, limites: LIMITES, log,
  });
  assert.deepEqual(await cota.consumir('u1', 'analise'), {
    ok: false, status: 503, code: 'COTA_INDISPONIVEL',
    error: 'A análise por foto está indisponível no momento. Tente novamente em alguns minutos.',
  });
  assert.equal(log.linhas[0][0], 'error');
});

test('migration 31 ausente: conta na memoria (usuario por hora e dia, total do sistema) e volta ao banco depois de 10 min', async () => {
  let agora = AGORA.getTime();
  let funcaoExiste = false;
  let noBanco = 0;
  const registrar = async () => {
    if (!funcaoExiste) throw Object.assign(new Error('Could not find the function'), { code: 'PGRST202' });
    noBanco++;
    return { permitido: true };
  };
  const log = logMudo();
  const cota = criarCotaVisagismo({ registrar, limites: LIMITES, agora: () => new Date(agora), log });

  // Imagem: 1 por hora por usuario
  assert.equal((await cota.consumir('u1', 'imagem')).ok, true);
  const hora = await cota.consumir('u1', 'imagem');
  assert.equal(hora.code, 'COTA_VISAGISMO_USUARIO');
  assert.match(hora.error, /1 simulações de corte por hora\. Tente novamente mais tarde\./);
  assert.equal(log.linhas.filter(([n]) => n === 'warn').length, 1, 'avisa uma vez');

  // Outro usuario ainda pode; o terceiro esgota o total do sistema (3)
  assert.equal((await cota.consumir('u2', 'imagem')).ok, true);
  agora += 61 * 60 * 1000;
  funcaoExiste = false;
  assert.equal((await cota.consumir('u1', 'imagem')).ok, true, 'passou 1 hora: u1 de novo (2 no dia)');
  assert.equal((await cota.consumir('u3', 'imagem')).code, 'COTA_VISAGISMO_TOTAL');
  assert.equal((await cota.consumir('u1', 'imagem')).code, 'COTA_VISAGISMO_TOTAL');

  // A migration foi aplicada: antes de 10 minutos ainda conta na memoria...
  funcaoExiste = true;
  assert.equal((await cota.consumir('u4', 'analise')).ok, true, 'analise conta separado da imagem');
  assert.equal(noBanco, 0);
  // ...e depois volta a contar no banco
  agora += 11 * 60 * 1000;
  assert.equal((await cota.consumir('u4', 'analise')).ok, true);
  assert.equal(noBanco, 1);
  assert.match(log.linhas.at(-1)[1], /encontrada: contando no banco/);
});

test('limite 0 desliga o tipo, mesmo na memoria', async () => {
  const cota = criarCotaVisagismo({
    registrar: async () => { throw Object.assign(new Error('x'), { code: '42883' }); },
    limites: { ...LIMITES, imagem: { porHora: 5, porDia: 5, totalDia: 0 } }, log: logMudo(),
  });
  assert.equal((await cota.consumir('u1', 'imagem')).code, 'COTA_VISAGISMO_TOTAL');
  assert.equal((await cota.consumir('u1', 'analise')).ok, true);
});
