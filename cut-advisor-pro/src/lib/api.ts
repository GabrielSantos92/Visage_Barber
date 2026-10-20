import { supabase } from "@/integrations/supabase/client";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// Erro devolvido pelo backend, com o status HTTP e o codigo (ex.: BARBER_HAS_APPOINTMENTS)
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
}

// Chamada ao backend enviando o token da sessao, exigido pelas rotas /api/admin.
async function request<T>(method: "GET" | "POST" | "DELETE", path: string, body?: unknown): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new Error("Não foi possível conectar ao servidor. Verifique se o backend está em execução.");
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(json.error ?? `Erro ${res.status}`, res.status, json.code);
  return json as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body: unknown) => request<T>("POST", path, body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);
