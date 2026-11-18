// Ambiente do backend: QUAL banco esta conectado e se o servidor pode atender.
// Nenhuma operacao do backend toca o banco antes desta conferencia.
//
// BACKEND_AMBIENTE (obrigatorio; nao tem valor padrao):
//   producao         o banco conectado NAO pode estar marcado como de teste.
//                    Nao exige nenhuma marca no banco de producao.
//   teste            SUPABASE_URL de um projeto Supabase (https://<ref>.supabase.co)
//                    que NAO e o de producao, E o proprio banco responde 'teste'
//                    em public.ambiente_do_banco() (supabase/teste/
//                    marcar_banco_de_teste.sql), lido pelo MESMO cliente que
//                    todas as rotas usam (services/supabaseServico.js).
//   desenvolvimento  maquina local: usa o banco que o .env apontar, sem conferir
//                    a marca. Recusado no Render (o Render define RENDER em todo
//                    servico). WhatsApp nao liga (exige producao ou teste).
//   ausente ou outro valor: NADA e atendido. Ausente nunca vale como producao.
//
// Sem fallback: o banco e sempre SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Sem
// os dois, nada e atendido; nenhuma outra chave e usada no lugar.
//
// Enquanto o ambiente nao estiver liberado:
//   * /api/* responde 503 (AMBIENTE_CONFERINDO ou AMBIENTE_BLOQUEADO) e
//     /health responde 503;
//   * o cliente Supabase unico recusa qualquer chamada antes de ela sair (so a
//     leitura da marca passa, enquanto confere);
//   * filas e tarefas automaticas nao comecam (aoLiberar).
// Banco sem responder (ou chave recusada) ao subir: continua bloqueado e
// confere de novo com espera crescente (ate 5 min), sem limite de tentativas.
// Motivo definitivo (banco de teste em producao, banco sem a marca no teste,
// URL de producao no teste, configuracao invalida) nao tenta de novo: corrija
// e reinicie o servico.
// O log leva so o ambiente e o motivo: nunca URL, chave ou token.

// Projeto de producao (o mesmo de barber-mobile/eas.json; nao e segredo: vai
// no app e no site). Mesmo com a marca, o modo teste nunca usa este projeto.
const REFS_PRODUCAO = ['ecngjhpnycirhisghazy'];
const AMBIENTES = ['producao', 'teste', 'desenvolvimento'];
// Erros do PostgREST/PostgreSQL para funcao inexistente: sem a marca
const FUNCAO_INEXISTENTE = new Set(['PGRST202', '42883']);
// Unica chamada permitida enquanto confere
const CAMINHO_MARCA = '/rest/v1/rpc/ambiente_do_banco';
const ESPERAS_MS = [5000, 15000, 60000, 300000];

class AmbienteBloqueadoErro extends Error {
  constructor() {
    super('Ambiente do servidor nao liberado: nenhuma chamada ao banco sai.');
    this.name = 'AmbienteBloqueadoErro';
    this.code = 'AMBIENTE_BLOQUEADO';
  }
}

function refDoProjeto(url) {
  const m = /^https:\/\/([a-z0-9]{10,40})\.supabase\.co\/?$/.exec(String(url ?? '').trim());
  return m ? m[1] : null;
}

// Le e valida o ambiente. Devolve { ambiente, problemas, url } (a chave nunca
// sai daqui: quem cria o cliente le direto do ambiente).
function lerAmbienteServidor(env = process.env, { refsProducao = REFS_PRODUCAO } = {}) {
  const valor = (nome) => (typeof env[nome] === 'string' ? env[nome].trim() : '');
  const bruto = valor('BACKEND_AMBIENTE');
  const ambiente = AMBIENTES.includes(bruto) ? bruto : null;
  const url = valor('SUPABASE_URL');
  const problemas = [];
  if (!ambiente) {
    problemas.push(`BACKEND_AMBIENTE ${bruto ? 'invalido' : 'ausente'} (use producao, teste ou desenvolvimento)`);
  }
  if (!url) problemas.push('SUPABASE_URL ausente');
  if (!valor('SUPABASE_SERVICE_ROLE_KEY')) problemas.push('SUPABASE_SERVICE_ROLE_KEY ausente');
  if (ambiente === 'teste' && url) {
    const ref = refDoProjeto(url);
    if (!ref) problemas.push('SUPABASE_URL nao e de um projeto Supabase (https://<projeto>.supabase.co)');
    else if (refsProducao.includes(ref)) problemas.push('SUPABASE_URL e a do projeto de PRODUCAO');
  }
  if (ambiente === 'desenvolvimento' && valor('RENDER')) {
    problemas.push('desenvolvimento nao pode rodar no Render (use producao ou teste)');
  }
  return { ambiente, problemas, url };
}

// { ok, motivo, temporario } a partir da leitura da marca:
//   leitura = { marca, erro: { code, status } | null }
function avaliarMarca(ambiente, { marca = null, erro = null } = {}) {
  const semFuncao = Boolean(erro) && FUNCAO_INEXISTENTE.has(String(erro.code ?? ''));
  const recusado = Boolean(erro) && !semFuncao && (erro.status === 401 || erro.status === 403);
  if (ambiente === 'desenvolvimento') return { ok: true, motivo: null, temporario: false };
  if (!erro && marca === 'teste' && ambiente === 'producao') {
    return { ok: false, motivo: 'banco_de_teste_com_ambiente_producao', temporario: false };
  }
  // Chave recusada: segue bloqueado, mas confere de novo (recusa passageira
  // nao derruba a producao ate alguem reiniciar; chave errada nunca libera)
  if (recusado) return { ok: false, motivo: 'acesso_recusado_pelo_banco', temporario: true };
  if (erro && !semFuncao) return { ok: false, motivo: 'banco_inacessivel', temporario: true };
  if (ambiente === 'teste' && marca !== 'teste') return { ok: false, motivo: 'banco_sem_marca_de_teste', temporario: false };
  return { ok: true, motivo: null, temporario: false };
}

// Estado do servidor: conferindo -> liberado | bloqueado (definitivo).
//   config:   lerAmbienteServidor()
//   lerMarca: async () => ({ marca, erro }) pelo cliente unico
function criarGuardaAmbiente({
  config,
  lerMarca,
  log = console,
  agendar = (fn, ms) => setTimeout(fn, ms).unref?.(),
  esperas = ESPERAS_MS,
}) {
  let estado = config.problemas.length ? 'bloqueado' : 'conferindo';
  let motivo = config.problemas.length ? 'configuracao_invalida' : null;
  let tentativas = 0;
  let emAndamento = null;
  const ouvintes = [];
  if (config.problemas.length) log.error(`[ambiente] backend BLOQUEADO: ${config.problemas.join('; ')}.`);

  async function umaConferencia() {
    let leitura;
    if (config.ambiente !== 'desenvolvimento') {
      try {
        leitura = await lerMarca();
      } catch (e) {
        leitura = { marca: null, erro: { code: e?.code ?? null, status: e?.status ?? 0 } };
      }
    }
    const r = avaliarMarca(config.ambiente, leitura);
    if (r.ok) {
      estado = 'liberado';
      motivo = null;
      log.info?.(`[ambiente] backend liberado no ambiente ${config.ambiente}.`);
      for (const f of ouvintes.splice(0)) {
        try {
          f();
        } catch (e) {
          log.error(`[ambiente] falha ao iniciar tarefa: ${String(e?.message ?? e).slice(0, 80)}`);
        }
      }
      return true;
    }
    motivo = r.motivo;
    if (r.temporario) {
      const espera = esperas[Math.min(tentativas, esperas.length - 1)];
      tentativas += 1;
      log.warn(`[ambiente] banco sem resposta (${r.motivo}) no ambiente ${config.ambiente}; nova conferencia em ${Math.round(espera / 1000)} s.`);
      agendar(() => { conferir().catch(() => {}); }, espera);
      return false;
    }
    estado = 'bloqueado';
    log.error(`[ambiente] backend BLOQUEADO no ambiente ${config.ambiente}: ${r.motivo}. Corrija e reinicie o servico.`);
    return false;
  }

  // Uma conferencia por vez
  function conferir() {
    if (estado !== 'conferindo') return Promise.resolve(estado === 'liberado');
    if (!emAndamento) emAndamento = umaConferencia().finally(() => { emAndamento = null; });
    return emAndamento;
  }

  const liberado = () => estado === 'liberado';

  // Express: nada passa antes de liberar
  function middleware(_req, res, next) {
    if (estado === 'liberado') return next();
    return res.status(503).json({
      error: 'Serviço indisponível no momento.',
      code: estado === 'conferindo' ? 'AMBIENTE_CONFERINDO' : 'AMBIENTE_BLOQUEADO',
    });
  }

  // fetch do cliente Supabase: recusa antes de sair, a menos que liberado
  // (ou, enquanto confere, a leitura da marca)
  function protegerFetch(base = (...args) => globalThis.fetch(...args)) {
    return (url, init = {}) => {
      if (estado === 'liberado') return base(url, init);
      if (estado === 'conferindo') {
        let caminho = '';
        try {
          caminho = new URL(typeof url === 'string' ? url : (url?.url ?? String(url))).pathname;
        } catch {
          caminho = '';
        }
        if (caminho === CAMINHO_MARCA && String(init.method ?? 'GET').toUpperCase() === 'POST') return base(url, init);
      }
      return Promise.reject(new AmbienteBloqueadoErro());
    };
  }

  // Tarefas que so comecam depois de liberado (filas de avisos)
  function aoLiberar(fn) {
    if (estado === 'liberado') fn();
    else ouvintes.push(fn);
  }

  return {
    conferir, liberado, middleware, protegerFetch, aoLiberar,
    estado: () => ({ estado, ambiente: config.ambiente, motivo }),
  };
}

module.exports = {
  lerAmbienteServidor, avaliarMarca, criarGuardaAmbiente, refDoProjeto, AmbienteBloqueadoErro,
  REFS_PRODUCAO, AMBIENTES, CAMINHO_MARCA,
};
