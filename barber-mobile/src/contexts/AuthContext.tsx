import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Linking } from 'react-native';
import { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Enums } from '../types/supabase';

type AppRole = Enums<'app_role'>;

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  userRole: AppRole | null;
  recoveryMode: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  userRole: null,
  recoveryMode: false,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser]                 = useState<User | null>(null);
  const [session, setSession]           = useState<Session | null>(null);
  const [loading, setLoading]           = useState(true);
  const [userRole, setUserRole]         = useState<AppRole | null>(null);
  const [recoveryMode, setRecoveryMode] = useState(false);
  const mounted                         = useRef(true);

  async function fetchRole(userId: string) {
    const { data } = await supabase.from('user_roles').select('role').eq('user_id', userId);
    if (!mounted.current) return;
    const roles = (data ?? []).map((r) => r.role);
    if (roles.includes('admin')) setUserRole('admin');
    else if (roles.includes('barbeiro')) setUserRole('barbeiro');
    else setUserRole('cliente');
  }

  async function processUrl(url: string) {
    if (!url || !mounted.current) return;

    // Query string: PKCE flow → visagebarber://auth/callback?code=xxx
    const queryString = url.split('?')[1]?.split('#')[0] ?? '';
    // Fragment: implicit flow → visagebarber://auth/callback#access_token=xxx&type=recovery
    const fragment = url.split('#')[1] ?? '';

    const qp = Object.fromEntries(new URLSearchParams(queryString));
    const fp = Object.fromEntries(new URLSearchParams(fragment));

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

      if (event === 'PASSWORD_RECOVERY') {
        setSession(session);
        setUser(session?.user ?? null);
        setRecoveryMode(true);
        setLoading(false);
        return;
      }

      setSession(session);
      setUser(session?.user ?? null);

      if (event === 'SIGNED_OUT') {
        setRecoveryMode(false);
        setUserRole(null);
      } else if (session?.user) {
        fetchRole(session.user.id);
      } else {
        setUserRole(null);
      }
      setLoading(false);
    });

    // 2. Get existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted.current) return;
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) fetchRole(session.user.id);
      setLoading(false);
    });

    // 3. Deep link handling (after listener is registered)
    Linking.getInitialURL().then((url) => { if (url) processUrl(url); });
    const linkSub = Linking.addEventListener('url', ({ url }) => processUrl(url));

    return () => {
      mounted.current = false;
      subscription.unsubscribe();
      linkSub.remove();
    };
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, userRole, recoveryMode, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
