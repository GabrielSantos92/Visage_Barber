import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

// ---- Supabase simulado: cada consulta vira um "ctx" respondido por `responder`
type Ctx = { tabela: string; op: "select" | "update"; valores?: any; filtros: [string, string, any][] };
let responder: (ctx: Ctx) => Promise<{ data: any; error: any }>;
const updates: Ctx[] = [];

function consulta(tabela: string) {
  const ctx: Ctx = { tabela, op: "select", filtros: [] };
  const resolver = () => {
    if (ctx.op === "update") updates.push(ctx);
    return responder(ctx);
  };
  const b: any = {
    select: () => b,
    update: (v: any) => { ctx.op = "update"; ctx.valores = v; return b; },
    eq: (c: string, v: any) => { ctx.filtros.push(["eq", c, v]); return b; },
    neq: (c: string, v: any) => { ctx.filtros.push(["neq", c, v]); return b; },
    in: () => b, order: () => b,
    single: resolver, maybeSingle: resolver,
    then: (ok: any, falha: any) => resolver().then(ok, falha),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: [], error: null }), from: (t: string) => consulta(t) },
}));
// Objeto estavel, como no app: a pagina recarrega a lista quando `user` muda
const auth = vi.hoisted(() => ({ user: { id: "u1" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/ChatDialog", () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import MeusAgendamentos from "@/pages/MeusAgendamentos";

const futuro = new Date(Date.now() + 24 * 3600_000).toISOString();
const ag = (id: string, servico: string, status = "confirmado") => ({
  id, data_hora: futuro, status, barbeiro_id: "b1",
  barbeiros: { nome: "Marcos" }, servicos: { nome: servico, preco: 50 },
});

let respostaUpdate: () => Promise<{ data: any; error: any }>;

beforeEach(() => {
  updates.length = 0;
  toast.success.mockClear();
  toast.error.mockClear();
  respostaUpdate = async () => ({ data: [{ id: "a1" }], error: null });
  responder = async (ctx) => {
    if (ctx.tabela === "agendamentos" && ctx.op === "update") return respostaUpdate();
    if (ctx.tabela === "agendamentos" && ctx.filtros.some(([, c]) => c === "id")) return { data: { status: "cancelado" }, error: null };
    if (ctx.tabela === "agendamentos") return { data: [ag("a1", "Corte"), ag("a2", "Barba", "cancelado")], error: null };
    return { data: [], error: null };
  };
});

async function renderTela() {
  render(<MemoryRouter><MeusAgendamentos /></MemoryRouter>);
  await screen.findByText("Corte");
}

const cartao = (servico: string) =>
  screen.getAllByText(servico).find((el) => !el.closest("[role=alertdialog]"))!.closest("div.border") as HTMLElement;

describe("MeusAgendamentos - confirmacao de cancelamento", () => {
  it("abre o Popup no padrao do barbeiro, sem cancelar nada", async () => {
    await renderTela();
    fireEvent.click(within(cartao("Corte")).getByRole("button", { name: /cancelar/i }));

    const popup = screen.getByRole("alertdialog");
    expect(popup).toHaveTextContent("Cancelar agendamento?");
    expect(popup).toHaveTextContent("Tem certeza de que deseja cancelar este agendamento?");
    expect(popup).toHaveTextContent("Marcos");
    expect(within(popup).getByRole("button", { name: "Voltar" })).toBeInTheDocument();
    expect(within(popup).getByRole("button", { name: "Confirmar cancelamento" })).toBeInTheDocument();
    expect(updates).toHaveLength(0);
  });

  it("Voltar fecha sem alterar", async () => {
    await renderTela();
    fireEvent.click(within(cartao("Corte")).getByRole("button", { name: /cancelar/i }));
    fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Voltar" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(updates).toHaveLength(0);
    expect(within(cartao("Corte")).getByText("CONFIRMADO")).toBeInTheDocument();
  });

  it("confirma: bloqueia durante o processamento e so atualiza apos o sucesso", async () => {
    let concluir!: (r: { data: any; error: any }) => void;
    respostaUpdate = () => new Promise((r) => { concluir = r; });
    await renderTela();
    fireEvent.click(within(cartao("Corte")).getByRole("button", { name: /cancelar/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); });

    const popup = screen.getByRole("alertdialog");
    const confirmar = within(popup).getByRole("button", { name: /cancelando/i });
    expect(confirmar).toBeDisabled();
    expect(within(popup).getByRole("button", { name: "Voltar" })).toBeDisabled();
    fireEvent.click(confirmar);
    fireEvent.keyDown(popup, { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(updates).toHaveLength(1);
    expect(updates[0].filtros).toEqual([["eq", "id", "a1"], ["neq", "status", "cancelado"]]);
    expect(within(cartao("Corte")).getByText("CONFIRMADO")).toBeInTheDocument();

    await act(async () => { concluir({ data: [{ id: "a1" }], error: null }); });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(cartao("Corte")).getByText("CANCELADO")).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Agendamento cancelado com sucesso.");
  });

  it("falha de comunicacao: mostra erro e mantem o agendamento", async () => {
    respostaUpdate = async () => ({ data: null, error: { message: "Failed to fetch" } });
    await renderTela();
    fireEvent.click(within(cartao("Corte")).getByRole("button", { name: /cancelar/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível cancelar"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar cancelamento" })).toBeEnabled();
    expect(within(cartao("Corte")).getByText("CONFIRMADO")).toBeInTheDocument();
  });

  it("ja cancelado pelo barbeiro: mostra o status real", async () => {
    respostaUpdate = async () => ({ data: [], error: null });
    await renderTela();
    fireEvent.click(within(cartao("Corte")).getByRole("button", { name: /cancelar/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("já ter sido cancelado"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(cartao("Corte")).getByText("CANCELADO")).toBeInTheDocument();
  });

  it("agendamento cancelado nao oferece cancelar de novo", async () => {
    await renderTela();
    expect(within(cartao("Barba")).queryByRole("button", { name: /cancelar/i })).not.toBeInTheDocument();
  });
});
