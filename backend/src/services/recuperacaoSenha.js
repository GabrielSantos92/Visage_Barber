// Recuperacao de senha ("Esqueceu a senha?") por e-mail.
//
// O Supabase Auth envia o link (token proprio, expira e vale uma vez); o
// backend so aplica limites e responde sempre com a mesma mensagem.
//
// Nenhuma resposta indica se o e-mail tem cadastro, e o e-mail completo nao
// vai para os logs.
const crypto = require('node:crypto');
const { criarLimitador } = require('./limiteTaxa');

const MSG_GENERICA = 'Se existir uma conta associada aos dados informados, enviaremos as instruções para recuperar o acesso.';
const MSG_MUITAS_SOLICITACOES = 'Muitas solicitações. Aguarde alguns minutos e tente novamente.';

class RecuperacaoErro extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const emailValido = (email) =>
  typeof email === 'string' && email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

function mascararEmail(email) {
  const [usuario, dominio] = String(email ?? '').split('@');
  if (!usuario || !dominio) return '';
  return `${usuario.slice(0, Math.min(2, usuario.length))}***@${dominio}`;
}

const sha256 = (valor) => crypto.createHash('sha256').update(valor).digest('hex');

function criarRecuperacaoSenha({ supabase, agora = Date.now }) {
  const janela = 15 * 60 * 1000;

  // Limites em memoria, aplicados antes de chamar o Supabase e iguais para
  // e-mail cadastrado ou nao (nao revelam nada)
  const limites = {
    ipSolicitacao: criarLimitador({ max: 10, janelaMs: janela, agora }),
    identificador: criarLimitador({ max: 3, janelaMs: janela, agora }),
  };

  function limitarSolicitacao(ip, chaveIdentificador) {
    const ipOk = limites.ipSolicitacao.consumir(`ip:${ip}`);
    const idOk = limites.identificador.consumir(chaveIdentificador);
    if (!ipOk || !idOk) throw new RecuperacaoErro(429, MSG_MUITAS_SOLICITACOES);
  }

  // Valida e aplica limites agora; o envio fica em `concluido`, que a rota nao
  // espera (o tempo de resposta nao pode depender de a conta existir).
  function solicitarEmail({ email, redirectTo, ip }) {
    const normalizado = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!emailValido(normalizado)) throw new RecuperacaoErro(400, 'Informe um e-mail válido.');

    let destino;
    if (redirectTo !== undefined && redirectTo !== null && redirectTo !== '') {
      try {
        if (typeof redirectTo !== 'string' || redirectTo.length > 500) throw new Error();
        destino = new URL(redirectTo).toString();
      } catch {
        throw new RecuperacaoErro(400, 'Endereço de redirecionamento inválido.');
      }
    }

    limitarSolicitacao(ip, `email:${sha256(normalizado).slice(0, 32)}`);

    const concluido = (async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(normalizado, destino ? { redirectTo: destino } : {});
      if (error) {
        console.error(`[recuperar-senha] e-mail para ${mascararEmail(normalizado)} não enviado: ${error.status ?? ''} ${error.code ?? ''} ${error.message}`);
      }
    })().catch((err) => console.error('[recuperar-senha] erro ao solicitar e-mail:', err.message));

    return { message: MSG_GENERICA, concluido };
  }

  return { solicitarEmail };
}

module.exports = { criarRecuperacaoSenha, RecuperacaoErro, mascararEmail, MSG_GENERICA };
