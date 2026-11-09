// Navegacao do barbeiro no site: o Painel (/dashboard) e a unica tela
// principal; "Meu Financeiro" saiu do menu e o endereco antigo leva ao Painel.
// Usa o App de verdade (rotas reais), com login e banco simulados.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const sessao = vi.hoisted(() => ({
  usuario: { id: "u1", user_metadata: { nome: "João Barbeiro" } },
}));

function consulta() {
  const b: Record<string, unknown> = {
    select: () => b, update: () => b, eq: () => b, neq: () => b, in: () => b, gte: () => b, lte: () => b, order: () => b, limit: () => b,
    maybeSingle: async () => ({ data: { id: "b1" }, error: null }),
    single: async () => ({ data: { id: "b1" }, error: null }),
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(ok, falha),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: async () => ({ data: null, error: null }),
    from: () => consulta(),
    auth: {
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}));
vi.mock("@/contexts/AuthContext", () => ({
  AuthProvider: ({ children }: { children: React.ReactNode }) => children,
  useAuth: () => ({ user: sessao.usuario, role: "barbeiro", loading: false, signOut: async () => {} }),
}));

import App from "@/App";

describe("Navegação do barbeiro (site)", () => {
  it("o endereço antigo de Meu Financeiro leva ao Painel do Barbeiro", async () => {
    window.history.pushState({}, "", "/barbeiro/financeiro");
    render(<App />);
    expect(await screen.findByText("Painel do barbeiro")).toBeInTheDocument();
    expect(window.location.pathname).toBe("/dashboard");
  });

  it("o menu tem Painel e Agenda, sem item separado de Financeiro", async () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    await screen.findByText("Painel do barbeiro");
    const menu = screen.getByRole("navigation");
    expect(within(menu).getByRole("link", { name: /PAINEL/ })).toHaveAttribute("href", "/dashboard");
    expect(within(menu).getByRole("link", { name: /AGENDA/ })).toHaveAttribute("href", "/barbeiro/agenda");
    expect(within(menu).queryByRole("link", { name: /FINANCEIRO/i })).toBeNull();
    expect(menu.querySelector('a[href="/barbeiro/financeiro"]')).toBeNull();
  });

  it("a Agenda é uma tela separada, sem o financeiro", async () => {
    window.history.pushState({}, "", "/barbeiro/agenda");
    render(<App />);
    expect(await screen.findByRole("heading", { name: "AGENDA DO DIA" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Por dia" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Próximos" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Histórico" })).toBeInTheDocument();
    expect(screen.queryByText("Faturamento gerado")).toBeNull();
    expect(screen.queryByText("Painel do barbeiro")).toBeNull();
  });

  it("o botão Abrir agenda do Painel leva à Agenda", async () => {
    window.history.pushState({}, "", "/dashboard");
    render(<App />);
    const abrir = await screen.findByRole("link", { name: /Abrir agenda/i });
    await act(async () => { fireEvent.click(abrir); });
    expect(window.location.pathname).toBe("/barbeiro/agenda");
    expect(await screen.findByRole("heading", { name: "AGENDA DO DIA" })).toBeInTheDocument();
  });
});
