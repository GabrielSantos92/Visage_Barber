// Regras de consentimento no backend: rotas de privacidade e a protecao que
// impede o envio de foto ao visagismo sem login e concordancia vigente.
// Supabase Auth e banco sao simulados (o banco real e testado em consentimentos.sql.test.js).
const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const {
  FINALIDADES, criarConsentimentos, criarProtecaoConsentimento,
} = require('../src/services/consentimento');

// As rotas reais criam o cliente Supabase ao serem carregadas
process.env.SUPABASE_URL ||= 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY ||= 'chave-de-teste';
const { criarRotasPrivacidade } = require('../src/routes/privacidade');

const VERSAO = FINALIDADES.visagismo_foto.versaoAviso;
const TOKENS = { 'token-ana': { id: 'ana' }, 'token-bia': { id: 'bia' } };

// Repositorio em memoria com o mesmo contrato do Supabase
function repositorioMemoria() {
  const linhas = [];
  return {
    linhas,
    async vigentes(userId, finalidade) {
      return linhas.filter((l) => l.user_id === userId && l.finalidade === finalidade && !l.revogado_em);
    },
    async inserir(r) {
      const linha = { ...r, concedido_em: new Date().toISOString(), revogado_em: null };
      linhas.push(linha);
      return linha;
    },
    async revogarVigentes(userId, finalidade, origem) {
      const alvo = linhas.filter((l) => l.user_id === userId && l.finalidade === finalidade && !l.revogado_em);
      alvo.forEach((l) => { l.revogado_em = new Date().toISOString(); l.revogado_origem = origem; });
      return alvo.length;
    },
  };
}

let repo;
let servidor;
let base;
let chamadasAoVisagismo;

beforeEach(async () => {
  repo = repositorioMemoria();
  chamadasAoVisagismo = 0;
  const consentimentos = criarConsentimentos({ repositorio: repo });
  const verificarToken = async (t) => TOKENS[t] ?? null;

  const app = express();
  app.use(express.json());
  app.use('/api/privacidade', criarRotasPrivacidade({ consentimentos, verificarToken }));
  // Stand-in da rota de visagismo, com a mesma protecao usada na real
  const visagismo = express.Router();
  visagismo.use(criarProtecaoConsentimento({ verificarToken, consentimentos, finalidade: 'visagismo_foto' }));
  visagismo.post('/analisar', (_req, res) => { chamadasAoVisagismo++; res.json({ ok: true }); });
  app.use('/api/visagismo', visagismo);

  if (servidor) servidor.close();
  servidor = app.listen(0);
  await new Promise((r) => servidor.once('listening', r));
  base = `http://127.0.0.1:${servidor.address().port}`;
});

after(() => servidor?.close());

async function chamar(metodo, caminho, { token, corpo } = {}) {
  const res = await fetch(`${base}${caminho}`, {
    method: metodo,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: corpo === undefined ? undefined : JSON.stringify(corpo),
  });
  return { status: res.status, json: await res.json() };
}

const URL_CONSENT = '/api/privacidade/consentimentos/visagismo_foto';
const conceder = (token = 'token-ana', corpo = { versao: VERSAO, origem: 'web' }) =>
  chamar('POST', URL_CONSENT, { token, corpo });
const analisar = (token) => chamar('POST', '/api/visagismo/analisar', { token, corpo: { imagem_base64: 'abc' } });

test('visagismo recusa envio sem login', async () => {
  const r = await analisar();
  assert.equal(r.status, 401);
  assert.equal(r.json.code, 'NAO_AUTENTICADO');
  assert.equal((await analisar('token-invalido')).status, 401);
  assert.equal(chamadasAoVisagismo, 0);
});

test('visagismo recusa envio sem consentimento', async () => {
  const r = await analisar('token-ana');
  assert.equal(r.status, 403);
  assert.equal(r.json.code, 'CONSENTIMENTO_NECESSARIO');
  assert.equal(chamadasAoVisagismo, 0);
});

test('situacao inicial: sem consentimento', async () => {
  const r = await chamar('GET', URL_CONSENT, { token: 'token-ana' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { finalidade: 'visagismo_foto', versao_atual: VERSAO, consentido: false, concedido_em: null, origem: null });
});

test('concordancia registrada libera a analise', async () => {
  const r = await conceder('token-ana', { versao: VERSAO, origem: 'mobile' });
  assert.equal(r.status, 200);
  assert.equal(r.json.consentido, true);
  assert.equal(r.json.origem, 'mobile');
  assert.deepEqual(
    repo.linhas.map(({ user_id, finalidade, versao_aviso, origem }) => ({ user_id, finalidade, versao_aviso, origem })),
    [{ user_id: 'ana', finalidade: 'visagismo_foto', versao_aviso: VERSAO, origem: 'mobile' }],
  );
  assert.equal((await analisar('token-ana')).status, 200);
  assert.equal(chamadasAoVisagismo, 1);
});

test('concordar de novo nao duplica o registro', async () => {
  await conceder();
  await conceder();
  assert.equal(repo.linhas.length, 1);
});

test('recusa versao desatualizada do aviso e origem invalida', async () => {
  const velha = await conceder('token-ana', { versao: '2020-01-01', origem: 'web' });
  assert.equal(velha.status, 409);
  assert.equal(velha.json.code, 'VERSAO_AVISO_DESATUALIZADA');
  const semVersao = await conceder('token-ana', { consentido: true, origem: 'web' });
  assert.equal(semVersao.status, 409);
  const origem = await conceder('token-ana', { versao: VERSAO, origem: 'desktop' });
  assert.equal(origem.status, 400);
  assert.equal(repo.linhas.length, 0);
  assert.equal((await analisar('token-ana')).status, 403);
});

test('consentimento em versao antiga nao vale mais', async () => {
  repo.linhas.push({ user_id: 'ana', finalidade: 'visagismo_foto', versao_aviso: '2020-01-01', origem: 'web', concedido_em: 'x', revogado_em: null });
  assert.equal((await analisar('token-ana')).status, 403);
  assert.equal((await chamar('GET', URL_CONSENT, { token: 'token-ana' })).json.consentido, false);
});

test('revogacao impede novos envios e preserva o historico', async () => {
  await conceder('token-ana', { versao: VERSAO, origem: 'web' });
  const r = await chamar('POST', `${URL_CONSENT}/revogar`, { token: 'token-ana', corpo: { origem: 'mobile' } });
  assert.equal(r.status, 200);
  assert.equal(r.json.consentido, false);
  assert.equal(r.json.revogados, 1);
  assert.equal(repo.linhas.length, 1);
  assert.equal(repo.linhas[0].revogado_origem, 'mobile');
  assert.ok(repo.linhas[0].revogado_em);

  assert.equal((await analisar('token-ana')).status, 403);
  assert.equal(chamadasAoVisagismo, 0);

  // Pode concordar de novo depois; o registro anterior continua la
  await conceder();
  assert.equal(repo.linhas.length, 2);
  assert.equal((await analisar('token-ana')).status, 200);
});

test('um usuario nao ve nem altera o consentimento de outro', async () => {
  await conceder('token-ana');
  // Nao ha como apontar outro usuario: a rota usa sempre o dono do token
  const daBia = await chamar('GET', `${URL_CONSENT}?user_id=ana`, { token: 'token-bia' });
  assert.equal(daBia.json.consentido, false);
  await chamar('POST', `${URL_CONSENT}/revogar`, { token: 'token-bia', corpo: { origem: 'web', user_id: 'ana' } });
  assert.equal(repo.linhas[0].revogado_em, null);
  assert.equal((await analisar('token-ana')).status, 200);
  assert.equal((await analisar('token-bia')).status, 403);
});

test('rotas de privacidade exigem login e finalidade conhecida', async () => {
  assert.equal((await chamar('GET', URL_CONSENT)).status, 401);
  assert.equal((await chamar('POST', URL_CONSENT, { corpo: { versao: VERSAO, origem: 'web' } })).status, 401);
  assert.equal(repo.linhas.length, 0);
  const r = await chamar('GET', '/api/privacidade/consentimentos/marketing', { token: 'token-ana' });
  assert.equal(r.status, 404);
});

test('a rota real de visagismo esta protegida antes de chamar a IA', async () => {
  const visagismoReal = require('../src/routes/visagismo');
  const app = express();
  app.use(express.json());
  app.use('/api/visagismo', visagismoReal);
  const s = app.listen(0);
  await new Promise((r) => s.once('listening', r));
  try {
    for (const rota of ['/analisar', '/imagem-referencia']) {
      const res = await fetch(`http://127.0.0.1:${s.address().port}/api/visagismo${rota}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ imagem_base64: 'abc' }),
      });
      assert.equal(res.status, 401, rota);
    }
  } finally {
    s.close();
  }
});
