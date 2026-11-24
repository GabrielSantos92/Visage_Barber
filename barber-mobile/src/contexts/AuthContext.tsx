import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Session, User, isAuthRetryableFetchError } from '@supabase/supabase-js';
import { LIMITE_RENOVACAO_MS, supabase } from '../lib/supabase';
import { removerAparelho } from '../lib/pushNotificacoes';
import { esquecerBarbeiro } from '../lib/barbeiroAtual';
import { definirContaAtiva, limparCacheExceto, limparTodoCache } from '../lib/cacheLocal';
import { Enums } from '../types/supabase';

type AppRole = Enums<'app_role'>;

// Espera maxima pela sessao na abertura do app e no "tentar de novo". A
// renovacao do token ja e interrompida em LIMITE_RENOVACAO_MS (lib/supabase);
// esta folga cobre o resto (leitura da sessao, fila do supabase-js). Passou
// disso: tela de sem conexao com "tentar de novo", nunca carregamento infinito.
const ESPERA_SESSAO_MS = LIMITE_RENOVACAO_MS + 5 * 1000;
const tempoEsgotado = () => new Promise<null>((ok) => setTimeout(() => ok(null), ESPERA_SESSAO_MS));

// Ultimo papel confirmado pelo banco neste aparelho, com a conta a que pertence
const CHAVE_PAPEL = '@visage_papel';
const PAPEIS: AppRole[] = ['admin', 'barbeiro', 'cliente'];

async function lerPapelSalvo(userId: string): Promise<AppRole | null> {
  try {
    const salvo = JSON.parse((await AsyncStorage.getItem(CHAVE_PAPEL)) ?? 'null');
    return salvo?.userId === userId && PAPEIS.includes(salvo.papel) ? salvo.papel : null;
  } catch {
    return null;
  }
}

function salvarPapel(userId: string, papel: AppRole) {
  AsyncStorage.setItem(CHAVE_PAPEL, JSON.stringify({ userId, papel })).catch(() => {});
}

function esquecerPapelSalvo() {
  AsyncStorage.removeItem(CHAVE_PAPEL).catch(() => {});
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: AppRole | null;
  recoveryMode: boolean;
  // Ha sessao salva no aparelho, mas ela precisa ser renovada e o servidor nao
  // respondeu (sem internet). O app espera a conexao em vez de pedir login.
  reconectando: boolean;
  tentarReconectar: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  userRole: null,
  recoveryMode: false,
  reconectando: false,
  tentarReconectar: async () => {},
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]                 = useState<User | null>(null);
  const [session, setSession]           = useState<Session | null>(null);
  const [loading, setLoading]           = useState(true);
  // O papel fica preso a conta de que veio: so vale enquanto a sessao for dessa
  // conta. Se a sessao trocar de conta sem logout (ex.: link de redefinicao de
  // senha de outra conta), o papel antigo deixa de valer na hora e o
  // RootNavigator espera o papel da conta nova.
  const [papel, setPapel]               = useState<{ userId: string; papel: AppRole } | null>(null);
  const userRole                        = papel && papel.userId === user?.id ? papel.papel : null;
  const [recoveryMode, setRecoveryMode] = useState(false);
  const [reconectando, setReconectando] = useState(false);
  const mounted                         = useRef(true);
  // Sessao que o app ja conhece (evento ou getSession): uma resposta atrasada
  // sem sessao nao a apaga
  const sessaoAtual                     = useRef<Session | null>(null);
  // getSession ou algum evento ja respondeu na abertura do app
  const respondeu                       = useRef(false);

  // Consulta do papel em andamento: getSession e o evento INITIAL_SESSION chegam
  // juntos na abertura do app e antes geravam duas consultas iguais
  type PedidoPapel = { userId: string; pedido: Promise<void> };
  const pedidoPapel                     = useRef<PedidoPapel | null>(null);

  // Conta da sessao atual: quando entra outra (ou na abertura do app), os dados
  // salvos de qualquer outra conta sao apagados do aparelho
  const ultimaConta                     = useRef<string | null>(null);
  function trocouDeConta(userId: string) {
    definirContaAtiva(userId);
    if (ultimaConta.current === userId) return;
    ultimaConta.current = userId;
    limparCacheExceto(userId);
  }

  function fetchRole(userId: string): Promise<void> {
    if (pedidoPapel.current?.userId === userId) return pedidoPapel.current.pedido;
    const registro: PedidoPapel = { userId, pedido: Promise.resolve() };
    pedidoPapel.current = registro;
    registro.pedido = carregarPapel(userId, registro);
    registro.pedido.finally(() => { if (pedidoPapel.current === registro) pedidoPapel.current = null; });
    return registro.pedido;
  }

  // 1. O papel salvo neste aparelho para esta conta abre a navegacao certa sem
  //    esperar o banco (antes, ate a resposta, o RootNavigator montava a area do
  //    cliente e disparava as consultas dela, tambem para barbeiro e admin).
  // 2. O banco sempre confere em seguida e corrige se o papel mudou. As
  //    permissoes continuam no banco (RLS); o papel aqui so escolhe as telas.
  // Sem resposta do banco: fica o papel salvo; sem nenhum, cliente (como antes).
  async function carregarPapel(userId: string, registro: PedidoPapel) {
    // Resposta de uma consulta que nao vale mais (logout ou troca de conta no
    // meio, mesmo que depois a mesma conta entre de novo): descarta
    const valendo = () => mounted.current && pedidoPapel.current === registro;

    const salvo = await lerPapelSalvo(userId);
    if (salvo && valendo()) setPapel((atual) => (atual?.userId === userId ? atual : { userId, papel: salvo }));

    let roles: string[] | null = null;
    try {
      const { data, error } = await supabase.from('user_roles').select('role').eq('user_id', userId);
      if (!error) roles = (data ?? []).map((r) => r.role);
    } catch { /* sem rede */ }
    if (!valendo()) return;
    if (!roles && salvo) return;

    const confirmado: AppRole = roles?.includes('admin') ? 'admin' : roles?.includes('barbeiro') ? 'barbeiro' : 'cliente';
    setPapel({ userId, papel: confirmado });
    if (roles && confirmado !== salvo) salvarPapel(userId, confirmado);
  }

  async function processUrl(url: string) {
    if (!url || !mounted.current) return;

    // Query string: PKCE flow → visagebarber://auth/callback?code=xxx
    const queryString = url.split('?')[1]?.split('#')[0] ?? '';
    // Fragment: implicit flow → visagebarber://auth/callback#access_token=xxx&type=recovery
    const fragment = url.split('#')[1] ?? '';

    const qp = Object.fromEntries(new URLSearchParams(queryString));
    const fp = Object.fromEntries(new URLSearchParams(fragment));

    // Link de recuperacao expirado ou ja usado: o Supabase devolve o erro no fragmento
    if (url.includes('auth/callback') && (fp.error_code || qp.error_code)) {
      Alert.alert('Link inválido', 'Este link de redefinição expirou ou já foi usado. Solicite um novo em "Esqueceu a senha?".');
      return;
    }

    if (qp.code) {
      // PKCE: exchangeCodeForSession fires PASSWORD_RECOVERY via onAuthStateChange
      await supabase.auth.exchangeCodeForSession(qp.code);
    } else if (fp.type === 'recovery' && fp.access_token) {
      // Implicit flow: setSession does NOT fire PASSWORD_RECOVERY, so set it manually
      const { error } = await supabase.auth.setSession({
        access_token: fp.access_token,
        refresh_token: fp.refresh_token ?? '',
      });
      if (!error && mounted.current) {
        setRecoveryMode(true);
        setLoading(false);
      }
    }
  }

  useEffect(() => {
    mounted.current = true;

    // 1. Register auth state listener FIRST (synchronous)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mounted.current) return;

      // INITIAL_SESSION sem sessao nao conta como resposta: o limite de espera
      // continua valendo ate o getSession decidir
      if (!(event === 'INITIAL_SESSION' && !session)) respondeu.current = true;
      sessaoAtual.current = session;

      if (event === 'PASSWORD_RECOVERY') {
        setSession(session);
        setUser(session?.user ?? null);
        setRecoveryMode(true);
        setLoading(false);
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);
      // Sessao renovada (o supabase-js tenta sozinho a cada 30 s) ou logout: sai da espera
      if (session || event === 'SIGNED_OUT') setReconectando(false);

      if (event === 'SIGNED_OUT') {
        // Logout ou sessao expirada: nada da conta anterior fica para a proxima
        setRecoveryMode(false);
        setPapel(null);
        pedidoPapel.current = null;
        ultimaConta.current = null;
        definirContaAtiva(null);
        esquecerPapelSalvo();
        // Id de barbeiro guardado (lib/barbeiroAtual) e dados salvos das telas (lib/cacheLocal)
        esquecerBarbeiro();
        limparTodoCache();
      } else if (session?.user) {
        trocouDeConta(session.user.id);
        fetchRole(session.user.id);
      } else {
        // Sem sessao sem logout (ex.: renovacao falhou): nada e lido nem gravado
        // no cache ate a sessao voltar; os dados salvos ficam para quando voltar
        setPapel(null);
        definirContaAtiva(null);
      }
      // Sem sessao na abertura: quem decide entre login e "sem conexao" e o
      // getSession (abaixo), para o login nao aparecer de relance
      if (event === 'INITIAL_SESSION' && !session) return;
      setLoading(false);
    });

    // 2. Get existing session
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (!mounted.current) return;
      respondeu.current = true;
      // Resposta sem sessao depois de um evento que ja trouxe a sessao: fica a sessao
      if (!session && sessaoAtual.current) { setLoading(false); return; }
      aplicarSessao(session, error);
      setLoading(false);
    });

    // 3. Nem getSession nem evento responderam a tempo (internet instavel):
    // tela de sem conexao, sem dados, com "tentar de novo"
    const limite = setTimeout(() => {
      if (!mounted.current || respondeu.current) return;
      setReconectando(true);
      setLoading(false);
    }, ESPERA_SESSAO_MS);

    // 3. Deep link handling (after listener is registered)
    Linking.getInitialURL().then((url) => { if (url) processUrl(url); });
    const linkSub = Linking.addEventListener('url', ({ url }) => processUrl(url));

    return () => {
      mounted.current = false;
      clearTimeout(limite);
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  // Sessao vinda do getSession (abertura ou "tentar de novo"). Sessao salva
  // vencida e sem internet para renovar: o supabase-js mantem a sessao e renova
  // quando a conexao voltar; ate la, nenhum dado aparece.
  function aplicarSessao(session: Session | null, error: unknown) {
    sessaoAtual.current = session;
    setSession(session);
    setUser(session?.user ?? null);
    setReconectando(!session && isAuthRetryableFetchError(error));
    if (session?.user) {
      trocouDeConta(session.user.id);
      fetchRole(session.user.id);
    } else {
      definirContaAtiva(null);
    }
  }

  // Tentar de novo (tela de sem conexao), com a mesma espera maxima. Se
  // renovar, entra; se a sessao nao valer mais, vai para o login; se o tempo
  // acabar, continua na tela de sem conexao.
  const tentarReconectar = useCallback(async () => {
    const r = await Promise.race([supabase.auth.getSession(), tempoEsgotado()]);
    if (!mounted.current || !r) return;
    if (!r.data.session && sessaoAtual.current) { setReconectando(false); return; }
    aplicarSessao(r.data.session, r.error);
  }, []);

  const signOut = useCallback(async () => {
    // Antes de sair (ainda com a sessao): este aparelho para de receber os
    // avisos desta conta
    await removerAparelho();
    await supabase.auth.signOut();
  }, []);

  // Mesmo objeto enquanto nada muda: as telas que usam useAuth nao redesenham a toa
  const valor = useMemo(
    () => ({ user, session, loading, userRole, recoveryMode, reconectando, tentarReconectar, signOut }),
    [user, session, loading, userRole, recoveryMode, reconectando, tentarReconectar, signOut],
  );

  return (
    <AuthContext.Provider value={valor}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
