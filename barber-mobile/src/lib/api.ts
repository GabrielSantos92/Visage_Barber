import Constants from 'expo-constants';

// Em desenvolvimento, usa o host atual do Metro bundler (sempre correto, sem cache).
function getBaseUrl(): string {
  if (__DEV__) {
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

async function post<T>(path: string, body: unknown): Promise<T> {
  const url = `${BASE_URL}${path}`;
  console.log('[API] POST', url);
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export const api = { post };
