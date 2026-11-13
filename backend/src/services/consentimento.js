// Consentimento do titular (LGPD) por finalidade.
//
// A regra fica toda aqui, no backend: web e mobile so mostram o aviso e pedem
// a concordancia. O que vale e o registro na tabela public.consentimentos,
// gravado so por este servico, e a checagem feita antes de cada envio de foto.
//
// O repositorio e injetado (Supabase em producao, memoria nos testes) e expoe:
//   vigentes(userId, finalidade)            -> [{ versao_aviso, origem, concedido_em }]
//   inserir({ user_id, finalidade, versao_aviso, origem }) -> registro
//   revogarVigentes(userId, finalidade, origem)            -> quantidade revogada

const FINALIDADES = {
  // Versao do Aviso de Privacidade apresentado. Ao mudar o texto do aviso (web e
  // mobile), atualize aqui: quem concordou com a versao antiga precisa concordar de novo.
  visagismo_foto: { versaoAviso: '2026-11-04' },
  // Avisos e confirmacao de presenca pelo WhatsApp (migration 20261113000025).
  // A versao e a do texto mostrado no perfil (web e mobile: lib/privacidade.ts).
  whatsapp_avisos: { versaoAviso: '2026-11-13' },
};

const ORIGENS = ['web', 'mobile'];

class ConsentimentoErro extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function configDa(finalidade) {
  const config = FINALIDADES[finalidade];
  if (!config) throw new ConsentimentoErro(404, 'FINALIDADE_DESCONHECIDA', 'Finalidade de consentimento desconhecida.');
  return config;
}

function validarOrigem(origem) {
  if (!ORIGENS.includes(origem)) {
    throw new ConsentimentoErro(400, 'ORIGEM_INVALIDA', 'Origem da manifestação inválida.');
  }
}

function criarConsentimentos({ repositorio }) {
  async function vigenteNaVersaoAtual(userId, finalidade) {
    const { versaoAviso } = configDa(finalidade);
    const vigentes = await repositorio.vigentes(userId, finalidade);
    return vigentes.find((c) => c.versao_aviso === versaoAviso) ?? null;
  }

  return {
    async status(userId, finalidade) {
      const { versaoAviso } = configDa(finalidade);
      const atual = await vigenteNaVersaoAtual(userId, finalidade);
      return {
        finalidade,
        versao_atual: versaoAviso,
        consentido: Boolean(atual),
        concedido_em: atual?.concedido_em ?? null,
        origem: atual?.origem ?? null,
      };
    },

    // So aceita a versao do aviso em vigor: o app tem de ter mostrado o texto atual.
    async conceder(userId, finalidade, { versao, origem }) {
      const { versaoAviso } = configDa(finalidade);
      validarOrigem(origem);
      if (versao !== versaoAviso) {
        throw new ConsentimentoErro(409, 'VERSAO_AVISO_DESATUALIZADA',
          'O Aviso de Privacidade foi atualizado. Atualize o app e leia a nova versão.');
      }
      const existente = await vigenteNaVersaoAtual(userId, finalidade);
      if (!existente) {
        await repositorio.inserir({ user_id: userId, finalidade, versao_aviso: versaoAviso, origem });
      }
      return this.status(userId, finalidade);
    },

    async revogar(userId, finalidade, { origem }) {
      configDa(finalidade);
      validarOrigem(origem);
      const revogados = await repositorio.revogarVigentes(userId, finalidade, origem);
      return { ...(await this.status(userId, finalidade)), revogados };
    },

    async valido(userId, finalidade) {
      return Boolean(await vigenteNaVersaoAtual(userId, finalidade));
    },
  };
}

// Middleware: so deixa passar o usuario autenticado com consentimento vigente na
// versao atual. `verificarToken(token)` devolve o usuario ou null.
function criarProtecaoConsentimento({ verificarToken, consentimentos, finalidade }) {
  configDa(finalidade);
  return async (req, res, next) => {
    try {
      const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      const usuario = token ? await verificarToken(token) : null;
      if (!usuario) {
        return res.status(401).json({ error: 'Faça login para usar a análise por foto.', code: 'NAO_AUTENTICADO' });
      }
      if (!(await consentimentos.valido(usuario.id, finalidade))) {
        return res.status(403).json({
          error: 'É preciso concordar com o Aviso de Privacidade antes de enviar sua foto.',
          code: 'CONSENTIMENTO_NECESSARIO',
        });
      }
      req.usuario = usuario;
      next();
    } catch (err) {
      console.error('[consentimento] erro ao verificar:', err.message);
      res.status(500).json({ error: 'Não foi possível verificar sua autorização. Tente novamente.' });
    }
  };
}

// Repositorio sobre o cliente Supabase com service role
function repositorioSupabase(db) {
  return {
    async vigentes(userId, finalidade) {
      const { data, error } = await db.from('consentimentos')
        .select('versao_aviso, origem, concedido_em')
        .eq('user_id', userId).eq('finalidade', finalidade).is('revogado_em', null)
        .order('concedido_em', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    async inserir(registro) {
      const { data, error } = await db.from('consentimentos').insert(registro).select().single();
      // Corrida entre dois pedidos iguais: o indice unico ja garante um so vigente
      if (error && error.code !== '23505') throw error;
      return data;
    },
    async revogarVigentes(userId, finalidade, origem) {
      const { data, error } = await db.from('consentimentos')
        .update({ revogado_em: new Date().toISOString(), revogado_origem: origem })
        .eq('user_id', userId).eq('finalidade', finalidade).is('revogado_em', null)
        .select('id');
      if (error) throw error;
      return data?.length ?? 0;
    },
  };
}

module.exports = {
  FINALIDADES, ORIGENS, ConsentimentoErro,
  criarConsentimentos, criarProtecaoConsentimento, repositorioSupabase,
};
