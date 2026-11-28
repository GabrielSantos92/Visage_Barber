// Origens aceitas pelo navegador (CORS).
//
// Sem CORS_ORIGENS: qualquer origem, como sempre foi. O login vai por token no
// cabecalho Authorization (sem cookies), entao outra origem nao ganha acesso a
// sessao de ninguem.
// Com CORS_ORIGENS (lista separada por virgula, ex.:
// "https://visagebarber.com.br,https://www.visagebarber.com.br"), so essas
// origens recebem a liberacao no navegador. O app e os webhooks (Mercado Pago,
// banco) nao mandam Origin e nao sao afetados.
function opcoesCors(env = process.env) {
  const origens = String(env.CORS_ORIGENS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  return origens.length ? { origin: origens } : {};
}

module.exports = { opcoesCors };
