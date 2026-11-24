// Cache local das telas (stale-while-revalidate): a tela mostra na hora o que
// ja carregou antes e, em seguida, busca no banco e substitui.
//
// Regras:
//   - separado por conta: a chave leva o id do usuario
//     (@visage_cache:v1:<usuario>:<tela>) e uma conta nunca le a de outra;
//   - so leitura: nenhuma operacao (agendar, cancelar, pagar, avaliar, salvar)
//     passa por aqui; elas continuam dependendo da resposta do banco;
//   - so grava depois de uma carga completa e sem erro;
//   - validade: dado mais velho que a validade da tela nao e mostrado (e apagado);
//   - logout ou sessao expirada apagam tudo (limparTodoCache, no AuthContext);
//     entrar com outra conta apaga o das outras (limparCacheExceto);
//   - depois de uma alteracao, a tela chama invalidarCache para as telas
//     afetadas (alem de recarregar do banco, como antes).
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREFIXO = '@visage_cache:v1:';
// Lista muito grande (ex.: historico inteiro) nao vai para o aparelho
const TAMANHO_MAXIMO = 512 * 1024;

const HORA = 60 * 60 * 1000;
export const VALIDADE = {
  // Barbeiros, servicos, notas, horarios de trabalho, perfil: mudam pouco
  catalogo: 7 * 24 * HORA,
  // Agendamentos, painel, financeiro, metricas: mudam mais; mostrados com a data
  agenda: 3 * 24 * HORA,
};

export interface Salvo<T> { dados: T; salvoEm: number }

// Copia em memoria: na mesma sessao, a leitura nao precisa ir ao armazenamento
const memoria = new Map<string, Salvo<unknown>>();

// Conta com sessao ativa (definida pelo AuthContext). Uma carga que termina
// depois do logout ou da troca de conta nao grava nem le nada.
let contaAtiva: string | null = null;
export function definirContaAtiva(userId: string | null) {
  // Outra conta: a suspeita (abaixo) era da sessao anterior
  if (userId !== contaAtiva) suspeitaAte = 0;
  contaAtiva = userId;
}

// Consultas de dados que sairam sem a sessao da conta ativa. Quando o token
// vence e a renovacao falha, o supabase-js manda a consulta com a chave
// anonima e o RLS devolve lista vazia SEM erro; com o token de outra conta, a
// resposta e de outra pessoa. Ate JANELA_SUSPEITA_MS depois da ultima consulta
// assim (no envio e na resposta), nada e gravado: resposta vazia por falha de
// sessao nao vira dado salvo. Lista vazia de consulta autenticada continua
// sendo gravada normalmente.
export const JANELA_SUSPEITA_MS = 2 * 60 * 1000;
let suspeitaAte = 0;

// Conta (sub) de um token de sessao; null se nao for um token de usuario
export function contaDoToken(token: string): string | null {
  try {
    const parte = token.split('.')[1];
    if (!parte) return null;
    const base64 = parte.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(parte.length / 4) * 4, '=');
    const sub = JSON.parse(atob(base64))?.sub;
    return typeof sub === 'string' ? sub : null;
  } catch {
    return null;
  }
}

// Chamada pelo cliente do Supabase (lib/supabase) em cada consulta de dados
export function observarRequisicao(autorizacao: string | null, chaveAnonima: string, agora = Date.now()) {
  if (!contaAtiva) return;
  const token = autorizacao?.startsWith('Bearer ') ? autorizacao.slice(7) : null;
  const conta = !token || token === chaveAnonima ? null : contaDoToken(token);
  if (conta !== contaAtiva) suspeitaAte = Math.max(suspeitaAte, agora + JANELA_SUSPEITA_MS);
}

export const sessaoSobSuspeita = (agora = Date.now()) => agora < suspeitaAte;

const chaveDe = (userId: string, chave: string) => `${PREFIXO}${userId}:${chave}`;

// Remocoes ainda em andamento no armazenamento (a memoria e limpa na hora): uma
// leitura nesse intervalo ignora o que foi salvo antes da remocao
const remocoesPendentes = new Set<{ afeta: (k: string) => boolean; em: number }>();
const removido = (k: string, salvoEm: number) =>
  [...remocoesPendentes].some((r) => salvoEm <= r.em && r.afeta(k));

async function remover(afeta: (k: string) => boolean): Promise<void> {
  const pendente = { afeta, em: Date.now() };
  remocoesPendentes.add(pendente);
  [...memoria.keys()].filter(afeta).forEach((k) => memoria.delete(k));
  try {
    const chaves = (await chavesDoCache()).filter(afeta);
    if (chaves.length) await AsyncStorage.multiRemove(chaves);
  } catch { /* segue: a validade ainda limita o que pode aparecer */ } finally {
    remocoesPendentes.delete(pendente);
  }
}

export async function lerCache<T>(userId: string, chave: string, validadeMs: number, agora = Date.now()): Promise<Salvo<T> | null> {
  if (!userId || userId !== contaAtiva) return null;
  const k = chaveDe(userId, chave);
  let salvo = memoria.get(k) as Salvo<T> | undefined;
  if (!salvo) {
    try {
      const texto = await AsyncStorage.getItem(k);
      if (!texto) return null;
      const lido = JSON.parse(texto);
      if (!lido || typeof lido.salvoEm !== 'number' || !('dados' in lido)) return null;
      if (removido(k, lido.salvoEm) || userId !== contaAtiva) return null;
      // Enquanto lia, a tela gravou um dado mais novo: fica o mais novo
      const naMemoria = memoria.get(k) as Salvo<T> | undefined;
      salvo = naMemoria ?? (lido as Salvo<T>);
      if (!naMemoria) memoria.set(k, salvo);
    } catch {
      return null;
    }
  }
  if (agora - salvo.salvoEm > validadeMs) {
    memoria.delete(k);
    AsyncStorage.removeItem(k).catch(() => {});
    return null;
  }
  return salvo;
}

export async function gravarCache<T>(userId: string, chave: string, dados: T, agora = Date.now()): Promise<void> {
  if (!userId || userId !== contaAtiva || sessaoSobSuspeita()) return;
  const k = chaveDe(userId, chave);
  const salvo: Salvo<T> = { dados, salvoEm: agora };
  memoria.set(k, salvo);
  try {
    const texto = JSON.stringify(salvo);
    if (texto.length > TAMANHO_MAXIMO) {
      memoria.delete(k);
      await AsyncStorage.removeItem(k);
      return;
    }
    await AsyncStorage.setItem(k, texto);
  } catch { /* armazenamento cheio ou indisponivel: segue sem cache */ }
}

async function chavesDoCache(): Promise<string[]> {
  return (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(PREFIXO));
}

// Apaga as telas da conta cujas chaves comecam por algum dos prefixos
// (ex.: 'cliente:' apaga todas as do cliente; 'barbeiro:agenda' so a agenda)
export function invalidarCache(userId: string, prefixos: string[]): Promise<void> {
  const base = `${PREFIXO}${userId}:`;
  return remover((k) => k.startsWith(base) && prefixos.some((p) => k.slice(base.length).startsWith(p)));
}

// Logout ou sessao expirada: nada de nenhuma conta fica no aparelho
export function limparTodoCache(): Promise<void> {
  return remover((k) => k.startsWith(PREFIXO));
}

// Entrou outra conta: apaga o que for de qualquer outra
export function limparCacheExceto(userId: string): Promise<void> {
  const daConta = `${PREFIXO}${userId}:`;
  return remover((k) => k.startsWith(PREFIXO) && !k.startsWith(daConta));
}

// '23/11 às 14:32' (aviso de dados salvos)
export function quandoFoiSalvo(salvoEm: number): string {
  const d = new Date(salvoEm);
  const dois = (n: number) => String(n).padStart(2, '0');
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} às ${dois(d.getHours())}:${dois(d.getMinutes())}`;
}
