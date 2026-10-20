import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { supabase } from './supabase';

function getBaseUrl(): string {
  if (__DEV__) {
    // No browser, pega o hostname da janela (mesmo servidor, porta diferente)
    if (Platform.OS === 'web') {
      const hostname = typeof window !== 'undefined' ? window.location.hostname : 'localhost';
      return `http://${hostname}:3001`;
    }
    try {
      // hostUri = "192.168.X.X:8081" — mesmo host, porta diferente (3001)
      const hostUri: string =
        (Constants.expoConfig as any)?.hostUri ??
        (Constants as any).manifest?.debuggerHost ??
        '';
      if (hostUri) {
        const host = hostUri.split(':')[0];
        return `http://${host}:3001`;
      }
    } catch {}
  }
  return process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3001';
}

const BASE_URL = getBaseUrl();

// Erro devolvido pelo backend, com o status HTTP e o codigo (ex.: BARBER_HAS_APPOINTMENTS)
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

async function request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  console.log('[API]', method, url);
  // As rotas /api/admin exigem o token da sessao
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new ApiError(errBody.error ?? `HTTP ${res.status}`, res.status, errBody.code);
  }
  return res.json();
}

const get = <T>(path: string) => request<T>('GET', path);
const post = <T>(path: string, body: unknown) => request<T>('POST', path, body);
const del = <T>(path: string) => request<T>('DELETE', path);

export const api = { get, post, del };
