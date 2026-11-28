// Limite de uso do visagismo: cada analise e cada simulacao chamam provedores de
// IA pagos. Tres limites por tipo ('analise' e 'imagem'):
//   - do usuario na ultima hora e nas ultimas 24 horas;
//   - do sistema inteiro nas ultimas 24 horas (teto de custo, mesmo com muitas
//     contas novas).
//
// A contagem fica no banco (migration 31, funcao consumir_cota_visagismo), que
// vale para todas as instancias do backend. Enquanto a migration nao estiver
// aplicada, a contagem cai para a memoria deste processo (services/limiteTaxa.js)
// e o log avisa: com uma instancia so, o limite continua valendo. Qualquer outro
// erro do banco recusa o uso (503): sem saber quanto ja foi gasto, nao se chama a IA.
//
// O uso e contado antes de chamar a IA, mesmo que ela falhe depois: o provedor
// pode cobrar a tentativa.

const { criarLimitador } = require('./limiteTaxa');

const HORA_MS = 60 * 60 * 1000;
const DIA_MS = 24 * HORA_MS;

// Padroes pensados para uma barbearia: um fluxo completo e 1 analise + 1 simulacao
const PADROES = {
  analise: { porHora: 4, porDia: 10, totalDia: 200 },
  imagem: { porHora: 3, porDia: 6, totalDia: 60 },
};

const VARIAVEIS = {
  analise: { porHora: 'VISAGISMO_ANALISES_POR_HORA', porDia: 'VISAGISMO_ANALISES_POR_DIA', totalDia: 'VISAGISMO_ANALISES_TOTAL_DIA' },
  imagem: { porHora: 'VISAGISMO_IMAGENS_POR_HORA', porDia: 'VISAGISMO_IMAGENS_POR_DIA', totalDia: 'VISAGISMO_IMAGENS_TOTAL_DIA' },
};

const ROTULOS = { analise: 'análises por foto', imagem: 'simulações de corte' };

// Inteiro de 0 a 100000; 0 desliga o tipo. Valor invalido usa o padrao (com aviso).
function lerLimitesVisagismo(env = process.env) {
  const avisos = [];
  const limites = {};
  for (const [tipo, campos] of Object.entries(VARIAVEIS)) {
    limites[tipo] = {};
    for (const [campo, nome] of Object.entries(campos)) {
      const bruto = env[nome];
      const padrao = PADROES[tipo][campo];
      if (bruto === undefined || String(bruto).trim() === '') {
        limites[tipo][campo] = padrao;
        continue;
      }
      const n = Number(String(bruto).trim());
      if (Number.isInteger(n) && n >= 0 && n <= 100000) {
        limites[tipo][campo] = n;
      } else {
        avisos.push(`${nome} inválida; usando ${padrao}.`);
        limites[tipo][campo] = padrao;
      }
    }
  }
  return { limites, avisos };
}

// Hora de Brasilia, para a mensagem ao cliente
function quando(liberarEm, agora) {
  const data = liberarEm ? new Date(liberarEm) : null;
  if (!data || Number.isNaN(data.getTime())) return 'mais tarde';
  const fuso = { timeZone: 'America/Sao_Paulo' };
  const hora = data.toLocaleTimeString('pt-BR', { ...fuso, hour: '2-digit', minute: '2-digit' });
  const dia = (d) => d.toLocaleDateString('pt-BR', fuso);
  if (dia(data) === dia(agora)) return `a partir das ${hora}`;
  const amanha = new Date(agora.getTime() + DIA_MS);
  if (dia(data) === dia(amanha)) return `amanhã, a partir das ${hora}`;
  return `em ${data.toLocaleDateString('pt-BR', { ...fuso, day: '2-digit', month: '2-digit' })}, a partir das ${hora}`;
}

function recusa(tipo, motivo, limite, liberarEm, agora) {
  const rotulo = ROTULOS[tipo];
  if (motivo === 'TOTAL') {
    return {
      ok: false, status: 429, code: 'COTA_VISAGISMO_TOTAL',
      error: `O limite diário de ${rotulo} do sistema foi atingido. Tente novamente ${quando(liberarEm, agora)}.`,
    };
  }
  const periodo = motivo === 'HORA' ? 'por hora' : 'por dia';
  return {
    ok: false, status: 429, code: 'COTA_VISAGISMO_USUARIO',
    error: `Você atingiu o limite de ${limite} ${rotulo} ${periodo}. Tente novamente ${quando(liberarEm, agora)}.`,
  };
}

// Funcao do banco ausente (migration 31 nao aplicada)
const funcaoAusente = (err) => err?.code === 'PGRST202' || err?.code === '42883';

// Contagem em memoria, por processo (reserva enquanto a migration nao existe)
function criarContagemMemoria(limites, agora) {
  const relogio = () => agora().getTime();
  const contadores = {};
  for (const [tipo, l] of Object.entries(limites)) {
    contadores[tipo] = {
      hora: criarLimitador({ max: l.porHora, janelaMs: HORA_MS, agora: relogio }),
      dia: criarLimitador({ max: l.porDia, janelaMs: DIA_MS, agora: relogio }),
      total: criarLimitador({ max: l.totalDia, janelaMs: DIA_MS, agora: relogio }),
    };
  }
  return ({ userId, tipo }) => {
    const c = contadores[tipo];
    const l = limites[tipo];
    if (c.total.excedido('total')) return { permitido: false, motivo: 'TOTAL', limite: l.totalDia, liberar_em: null };
    if (c.dia.excedido(userId)) return { permitido: false, motivo: 'DIA', limite: l.porDia, liberar_em: null };
    if (c.hora.excedido(userId)) return { permitido: false, motivo: 'HORA', limite: l.porHora, liberar_em: null };
    c.total.registrar('total');
    c.dia.registrar(userId);
    c.hora.registrar(userId);
    return { permitido: true };
  };
}

// registrar({ userId, tipo, limite }) -> { permitido, motivo, limite, liberar_em }, ou lanca o erro do banco
// Sem a funcao no banco, volta a tentar depois deste intervalo (a migration pode
// ter sido aplicada sem reiniciar o servidor)
const RECONFERIR_BANCO_MS = 10 * 60 * 1000;

function criarCotaVisagismo({ registrar, limites, agora = () => new Date(), log = console }) {
  const memoria = criarContagemMemoria(limites, agora);
  let semBancoDesde = null;

  async function consumir(userId, tipo) {
    if (!ROTULOS[tipo]) throw new Error(`tipo de cota desconhecido: ${tipo}`);
    if (!userId) return { ok: false, status: 401, code: 'NAO_AUTENTICADO', error: 'Faça login para usar a análise por foto.' };

    let r;
    if (semBancoDesde !== null && agora().getTime() - semBancoDesde < RECONFERIR_BANCO_MS) {
      r = memoria({ userId, tipo });
    } else {
      try {
        r = await registrar({ userId, tipo, limite: limites[tipo] });
        if (semBancoDesde !== null) log.warn('[cota-visagismo] função consumir_cota_visagismo encontrada: contando no banco.');
        semBancoDesde = null;
      } catch (err) {
        if (!funcaoAusente(err)) {
          log.error('[cota-visagismo] erro ao conferir o limite:', err?.message ?? err);
          return {
            ok: false, status: 503, code: 'COTA_INDISPONIVEL',
            error: 'A análise por foto está indisponível no momento. Tente novamente em alguns minutos.',
          };
        }
        if (semBancoDesde === null) {
          log.warn('[cota-visagismo] função consumir_cota_visagismo ausente (migration 31 não aplicada): '
            + 'contando só na memória deste processo.');
        }
        semBancoDesde = agora().getTime();
        r = memoria({ userId, tipo });
      }
    }
    if (r?.permitido) return { ok: true };
    return recusa(tipo, r?.motivo, r?.limite, r?.liberar_em, agora());
  }

  return { consumir };
}

// Chamada ao banco pelo cliente unico do backend (service role)
const registrarNoBanco = (chamar) => ({ userId, tipo, limite }) => chamar('consumir_cota_visagismo', {
  p_user_id: userId, p_tipo: tipo, p_por_hora: limite.porHora, p_por_dia: limite.porDia, p_total_dia: limite.totalDia,
});

// Instancia real, criada no primeiro uso (os testes das rotas trocam este modulo)
let real = null;
const cotaVisagismo = {
  consumir(userId, tipo) {
    if (!real) {
      const { chamar } = require('./supabaseServico');
      const { limites, avisos } = lerLimitesVisagismo(process.env);
      for (const a of avisos) console.warn('[cota-visagismo]', a);
      real = criarCotaVisagismo({ registrar: registrarNoBanco(chamar), limites });
    }
    return real.consumir(userId, tipo);
  },
};

module.exports = { cotaVisagismo, criarCotaVisagismo, lerLimitesVisagismo, registrarNoBanco, PADROES };
