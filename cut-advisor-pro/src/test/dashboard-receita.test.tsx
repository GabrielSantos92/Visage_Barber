// Dashboard (web): o card "Receita do mês" usa o mesmo calculo do Financeiro
// (lancamentos de servicos concluidos e pagos), e nao mais a soma dos precos
// dos servicos concluidos. A lista de recentes mostra o preco congelado.
// (O barbeiro em /dashboard ve o Painel do Barbeiro: painel-barbeiro.test.tsx.)
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { intervaloDoPeriodo } from "@/lib/financeiro";

// O usuario do contexto de login e estavel entre renderizacoes, como no app
const banco = vi.hoisted(() => ({ rpc: vi.fn(), papel: "admin", usuario: { id: "u1" } }));

// Consulta encadeada do supabase-js: responde pela tabela e pelas colunas pedidas
function consulta(tabela: string) {
  let colunas = "";
  let contar = false;
  const c: Record<string, unknown> = {};
  const responder = () => {
    if (contar) return { count: tabela === "profiles" ? 3 : 2, data: null, error: null };
    if (tabela === "barbeiros") return { data: banco.papel === "admin" ? [{ id: "b1", nome: "João" }] : { id: "b1" }, error: null };
    if (tabela === "profiles") return { data: [{ user_id: "c1", nome: "Ana" }], error: null };
    if (colunas.includes("preco, servicos(nome")) {
      // Preco do servico mudou para R$ 80 depois da reserva feita por R$ 50
      return { data: [{ id: "a1", data_hora: "2026-11-04T15:00:00Z", status: "concluido", cliente_id: "c1", preco: 50, servicos: { nome: "Corte", preco: 80 }, barbeiros: { nome: "João" } }], error: null };
    }
    return { data: [{ id: "a1", status: "concluido", created_at: new Date().toISOString(), barbeiro_id: "b1", servicos: { preco: 80 } }], error: null };
  };
  Object.assign(c, {
    select: (col: string, opcoes?: { head?: boolean }) => { colunas = col; contar = !!opcoes?.head; return c; },
    gte: () => c, lte: () => c, eq: () => c, order: () => c, limit: () => c, in: () => c,
    single: async () => responder(),
    then: (ok: (v: unknown) => unknown, erro?: (e: unknown) => unknown) => Promise.resolve(responder()).then(ok, erro),
  });
  return c;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (fn: string, a?: unknown) => banco.rpc(fn, a), from: (t: string) => consulta(t) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: banco.usuario, role: banco.papel, loading: false }) }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/admin/AdminNav", () => ({ AdminNav: () => null, default: () => null }));

import Dashboard from "@/pages/Dashboard";

const texto = (s: unknown) => String(s).replace(/\u00a0/g, " ");
const cartao = async (rotulo: string) => (await screen.findByText(rotulo)).closest("div.border") as HTMLElement;
const mes = intervaloDoPeriodo("mes");

beforeEach(() => {
  banco.rpc.mockReset();
});

describe("Dashboard - Receita do mês", () => {
  it("admin: mostra o faturamento do Financeiro no mês (concluídos e pagos), não a soma dos preços", async () => {
    banco.papel = "admin";
    banco.rpc.mockImplementation(async (fn: string) => ({ data: fn === "financeiro_resumo" ? { faturamento: 1234.5 } : null, error: null }));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const receita = await cartao("RECEITA DO MÊS");
    expect(texto(receita.textContent)).toContain("R$ 1.234,50");
    expect(within(receita).getByText("concluídos e pagos, após descontos e reembolsos")).toBeInTheDocument();
    expect(banco.rpc).toHaveBeenCalledWith("financeiro_resumo", { p_inicio: mes.inicio, p_fim: mes.fim, p_barbeiro_id: null, p_servico_id: null, p_status: null });
    // Recentes: o preco congelado na reserva (R$ 50), nao o preco atual do servico (R$ 80)
    expect(texto((await screen.findByText(/R\$ 50,00/)).textContent)).toBe("R$ 50,00");
    expect(screen.queryByText(/R\$ 80,00/)).toBeNull();
  });

  it("sem resposta do financeiro (ex.: migration não aplicada): não inventa valor", async () => {
    banco.papel = "admin";
    banco.rpc.mockImplementation(async (fn: string) => (fn === "financeiro_resumo"
      ? { data: null, error: { message: "function financeiro_resumo does not exist" } }
      : { data: null, error: null }));
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    const receita = await cartao("RECEITA DO MÊS");
    expect(within(receita).getByText("—")).toBeInTheDocument();
    expect(within(receita).getByText("financeiro indisponível")).toBeInTheDocument();
  });
});
