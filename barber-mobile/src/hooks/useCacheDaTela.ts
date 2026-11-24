// Cache de uma tela (lib/cacheLocal), da conta logada:
//   restaurar(aplicar): mostra o que ficou salvo, se o banco ainda nao respondeu
//   salvar(dados):      depois de uma carga completa do banco
//   falhou(erro):       a atualizacao falhou; se a tela mostra dados salvos, o
//                       aviso (AvisoDadosSalvos) diz isso em vez de travar
// `chave` nula: a tela nao usa cache (ex.: conta ainda nao conhecida).
import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { gravarCache, lerCache } from '../lib/cacheLocal';
import { ehFalhaDeConexao } from '../lib/conexao';

export type FalhaAtualizacao = 'conexao' | 'outra' | null;

export function useCacheDaTela<T>(chave: string | null, validadeMs: number) {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // Data do dado salvo que a tela esta mostrando (null: dado do banco ou nada)
  const [salvoEm, setSalvoEmEstado] = useState<number | null>(null);
  const [falha, setFalha] = useState<FalhaAtualizacao>(null);
  // Copia para as funcoes de carga, que podem ter sido criadas em um render antigo
  const salvoEmRef = useRef<number | null>(null);
  const setSalvoEm = (v: number | null) => { salvoEmRef.current = v; setSalvoEmEstado(v); };
  // Chave que ja recebeu dado do banco: o salvo (mais velho) nao a substitui
  const fresca = useRef<string | null>(null);
  const chaveAtual = useRef(chave);
  chaveAtual.current = chave;

  // Outra chave (outro dia, outro modo): comeca sem aviso
  useEffect(() => { setSalvoEm(null); setFalha(null); }, [chave, userId]);

  const restaurar = useCallback(async (aplicar: (dados: T) => void): Promise<boolean> => {
    if (!userId || !chave || fresca.current === `${userId}:${chave}`) return false;
    const salvo = await lerCache<T>(userId, chave, validadeMs);
    // Enquanto lia, o banco respondeu ou a tela mudou de chave: nao aplica
    if (!salvo || fresca.current === `${userId}:${chave}` || chaveAtual.current !== chave) return false;
    aplicar(salvo.dados);
    setSalvoEm(salvo.salvoEm);
    return true;
  }, [userId, chave, validadeMs]);

  const salvar = useCallback((dados: T) => {
    if (!userId || !chave) return;
    fresca.current = `${userId}:${chave}`;
    setSalvoEm(null);
    setFalha(null);
    gravarCache(userId, chave, dados);
  }, [userId, chave]);

  // true: a tela mostra dados salvos e o aviso cuida da falha (a tela nao
  // precisa mostrar o erro). false: nao ha dados salvos na tela; ela mostra o
  // proprio erro, como antes.
  const falhou = useCallback((erro: unknown): boolean => {
    if (salvoEmRef.current == null) return false;
    setFalha(ehFalhaDeConexao(erro) ? 'conexao' : 'outra');
    return true;
  }, []);

  return { restaurar, salvar, falhou, salvoEm, falha, userId };
}
