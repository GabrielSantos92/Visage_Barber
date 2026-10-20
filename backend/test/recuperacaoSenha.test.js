// Recuperacao de senha por e-mail: o Supabase Auth (envio do e-mail) e simulado.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const {
  criarRecuperacaoSenha, RecuperacaoErro, mascararEmail, MSG_GENERICA,
} = require('../src/services/recuperacaoSenha');

let emails; // chamadas a resetPasswordForEmail
let ipSeq = 0;

const ip = () => `10.0.0.${++ipSeq}`;

beforeEach(() => {
  emails = [];
});

function supabaseFake() {
  return {
    auth: {
      async resetPasswordForEmail(email, opcoes) {
        emails.push({ email, opcoes });
        return { data: {}, error: null };
      },
    },
  };
}

const novoServico = ({ agora } = {}) => criarRecuperacaoSenha({ supabase: supabaseFake(), agora });

async function rejeita(promessaOuFn, status, mensagem) {
  await assert.rejects(
    typeof promessaOuFn === 'function' ? Promise.resolve().then(promessaOuFn) : promessaOuFn,
    (err) => {
      assert.ok(err instanceof RecuperacaoErro, `esperava RecuperacaoErro, veio ${err}`);
      assert.equal(err.status, status);
      if (mensagem) assert.equal(err.message, mensagem);
      return true;
    }
  );
}

test('e-mail mascarado para os logs', () => {
  assert.equal(mascararEmail('lucas@gmail.com'), 'lu***@gmail.com');
});

// -------------------------------------------------------------------- e-mail

test('e-mail: solicitacao chama o Supabase Auth com o redirect e responde de forma generica', async () => {
  const servico = novoServico();
  const r = servico.solicitarEmail({ email: '  Cliente@Visage.TEST ', redirectTo: 'https://app.visage.test/reset-password', ip: ip() });
  assert.equal(r.message, MSG_GENERICA);
  await r.concluido;
  assert.deepEqual(emails, [{ email: 'cliente@visage.test', opcoes: { redirectTo: 'https://app.visage.test/reset-password' } }]);
});

test('e-mail: nao cadastrado recebe exatamente a mesma resposta', async () => {
  const servico = novoServico();
  const cadastrado = servico.solicitarEmail({ email: 'cliente@visage.test', ip: ip() });
  const inexistente = servico.solicitarEmail({ email: 'ninguem@visage.test', ip: ip() });
  assert.deepEqual(Object.keys(cadastrado), Object.keys(inexistente));
  assert.equal(cadastrado.message, inexistente.message);
});

test('e-mail: falha do Supabase nao muda a resposta e nao vaza para o cliente', async () => {
  const servico = criarRecuperacaoSenha({
    supabase: { auth: { resetPasswordForEmail: async () => ({ error: { status: 500, message: 'Error sending recovery email' } }) } },
  });
  const erros = capturarLogs();
  const r = servico.solicitarEmail({ email: 'cliente@visage.test', ip: ip() });
  await r.concluido;
  erros.parar();
  assert.equal(r.message, MSG_GENERICA);
  assert.match(erros.texto(), /cl\*\*\*@visage\.test não enviado/);
  assert.doesNotMatch(erros.texto(), /cliente@visage\.test/);
});

test('e-mail: validacoes e limite de solicitacoes', async () => {
  const servico = novoServico();
  await rejeita(() => servico.solicitarEmail({ email: 'invalido', ip: ip() }), 400);
  await rejeita(() => servico.solicitarEmail({ email: 'a@b.co', redirectTo: 'nao e url', ip: ip() }), 400);

  for (let i = 0; i < 3; i++) servico.solicitarEmail({ email: 'cliente@visage.test', ip: ip() });
  await rejeita(() => servico.solicitarEmail({ email: 'cliente@visage.test', ip: ip() }), 429);

  const mesmoIp = ip();
  for (let i = 0; i < 10; i++) servico.solicitarEmail({ email: `x${i}@visage.test`, ip: mesmoIp });
  await rejeita(() => servico.solicitarEmail({ email: 'y@visage.test', ip: mesmoIp }), 429);
});

test('e-mail: limite expira depois da janela de 15 minutos', async () => {
  let t = 1_000_000;
  const servico = novoServico({ agora: () => t });
  for (let i = 0; i < 3; i++) servico.solicitarEmail({ email: 'barbeiro@visage.test', ip: ip() });
  await rejeita(() => servico.solicitarEmail({ email: 'barbeiro@visage.test', ip: ip() }), 429);
  t += 15 * 60 * 1000 + 1;
  assert.equal(servico.solicitarEmail({ email: 'barbeiro@visage.test', ip: ip() }).message, MSG_GENERICA);
});

function capturarLogs() {
  const linhas = [];
  const originais = { log: console.log, warn: console.warn, error: console.error };
  for (const k of Object.keys(originais)) console[k] = (...a) => linhas.push(a.join(' '));
  return {
    parar: () => Object.assign(console, originais),
    texto: () => linhas.join('\n'),
  };
}
