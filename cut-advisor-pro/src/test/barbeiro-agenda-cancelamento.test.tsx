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
    gte: () => b, lte: () => b, in: () => b, order: () => b,
    single: resolver, maybeSingle: resolver,
    then: (ok: any, falha: any) => resolver().then(ok, falha),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: async () => ({ data: null, error: null }), from: (t: string) => consulta(t) },
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: { id: "u1" } }) }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/ChatDialog", () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import BarbeiroAgenda from "@/pages/BarbeiroAgenda";

const futuro = new Date(Date.now() + 2 * 3600_000).toISOString();
const passado = new Date(Date.now() - 2 * 3600_000).toISOString();
const ag = (id: string, cliente: string, data_hora: string, status = "confirmado") => ({
  id, data_hora, status, observacoes: null, cliente_id: cliente,
  duracao_min: 30, ativo_inicial_min: null, pausa_min: null, ativo_final_min: null,
  servicos: { nome: "Corte", duracao_min: 30, preco: 50 },
});

let lista: any[];
let respostaUpdate: () => Promise<{ data: any; error: any }>;
let statusNoBanco: string;

beforeEach(() => {
  updates.length = 0;
  toast.success.mockClear();
  toast.error.mockClear();
  lista = [ag("a1", "c1", futuro), ag("a2", "c2", passado), ag("a3", "c3", futuro, "cancelado")];
  statusNoBanco = "cancelado";
  respostaUpdate = async () => ({ data: [{ id: "a1" }], error: null });
  responder = async (ctx) => {
    if (ctx.tabela === "barbeiros") return { data: { id: "b1" }, error: null };
    if (ctx.tabela === "profiles") return {
      data: [{ user_id: "c1", nome: "Ana", telefone: null }, { user_id: "c2", nome: "Bruno", telefone: null }, { user_id: "c3", nome: "Caio", telefone: null }],
      error: null,
    };
    if (ctx.tabela === "agendamentos" && ctx.op === "update") return respostaUpdate();
    if (ctx.tabela === "agendamentos" && ctx.filtros.some(([, c]) => c === "id")) return { data: { status: statusNoBanco }, error: null };
    if (ctx.tabela === "agendamentos") return { data: lista, error: null };
    return { data: [], error: null };
  };
});

async function renderAgenda() {
  render(<MemoryRouter><BarbeiroAgenda /></MemoryRouter>);
  await screen.findByText("Ana");
}

// Cartao de um cliente (o motion.div que contem o nome)
const cartao = (nome: string) =>
  screen.getAllByText(nome).find((el) => !el.closest("[role=alertdialog]"))!.closest("div.border") as HTMLElement;

describe("BarbeiroAgenda - confirmacao de cancelamento", () => {
  it("abre o Popup ao clicar em cancelar, sem cancelar nada", async () => {
    await renderAgenda();
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: "CANCELAR" }));

    const popup = screen.getByRole("alertdialog");
    expect(popup).toHaveTextContent("Cancelar agendamento?");
    expect(popup).toHaveTextContent("Tem certeza de que deseja cancelar este agendamento? Essa ação poderá afetar o horário reservado pelo cliente.");
    expect(within(popup).getByRole("button", { name: "Voltar" })).toBeInTheDocument();
    expect(within(popup).getByRole("button", { name: "Confirmar cancelamento" })).toBeInTheDocument();
    expect(updates).toHaveLength(0);
  });

  it("Voltar fecha o Popup e mantem o agendamento", async () => {
    await renderAgenda();
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: "CANCELAR" }));
    fireEvent.click(screen.getByRole("button", { name: "Voltar" }));

    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(updates).toHaveLength(0);
    expect(within(cartao("Ana")).getByText("CONFIRMADO")).toBeInTheDocument();
  });

  it("Escape tambem fecha sem alterar", async () => {
    await renderAgenda();
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: "CANCELAR" }));
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(updates).toHaveLength(0);
  });

  it("confirma: bloqueia durante o processamento e so atualiza apos o sucesso", async () => {
    let concluir!: (r: { data: any; error: any }) => void;
    respostaUpdate = () => new Promise((r) => { concluir = r; });
    await renderAgenda();
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: "CANCELAR" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); });

    // Processando: botoes desabilitados, sem fechar e sem segunda chamada
    const confirmar = screen.getByRole("button", { name: /cancelando/i });
    expect(confirmar).toBeDisabled();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeDisabled();
    fireEvent.click(confirmar);
    fireEvent.keyDown(screen.getByRole("alertdialog"), { key: "Escape" });
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(updates).toHaveLength(1);
    expect(within(cartao("Ana")).getByText("CONFIRMADO")).toBeInTheDocument();

    // Mesma operacao de antes, com protecao contra cancelar de novo
    expect(updates[0].valores).toEqual({ status: "cancelado" });
    expect(updates[0].filtros).toEqual([["eq", "id", "a1"], ["neq", "status", "cancelado"]]);

    await act(async () => { concluir({ data: [{ id: "a1" }], error: null }); });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(cartao("Ana")).getByText("CANCELADO")).toBeInTheDocument();
    expect(within(cartao("Ana")).queryByRole("button", { name: "CANCELAR" })).not.toBeInTheDocument();
    expect(toast.success).toHaveBeenCalledWith("Agendamento cancelado com sucesso.");
  });

  it("falha de comunicacao: mostra erro, mantem o Popup e o agendamento como estava", async () => {
    respostaUpdate = async () => ({ data: null, error: { message: "Failed to fetch" } });
    await renderAgenda();
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: "CANCELAR" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível cancelar"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirmar cancelamento" })).toBeEnabled();
    expect(within(cartao("Ana")).getByText("CONFIRMADO")).toBeInTheDocument();
  });

  it("nada alterado no banco (ja cancelado em outro aparelho): mostra o status real", async () => {
    respostaUpdate = async () => ({ data: [], error: null });
    await renderAgenda();
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: "CANCELAR" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); });

    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("já ter sido cancelado"));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(within(cartao("Ana")).getByText("CANCELADO")).toBeInTheDocument();
  });

  it("agendamento ja cancelado nao oferece cancelar de novo", async () => {
    await renderAgenda();
    expect(within(cartao("Caio")).queryByRole("button", { name: /cancelar|cliente faltou/i })).not.toBeInTheDocument();
  });

  it("'Cliente faltou' tambem pede confirmacao, com texto proprio", async () => {
    await renderAgenda();
    fireEvent.click(within(cartao("Bruno")).getByRole("button", { name: "CLIENTE FALTOU" }));
    const popup = screen.getByRole("alertdialog");
    expect(popup).toHaveTextContent("Registrar falta do cliente?");
    expect(updates).toHaveLength(0);
    await act(async () => { fireEvent.click(within(popup).getByRole("button", { name: "Confirmar falta" })); });
    expect(toast.success).toHaveBeenCalledWith("Falta do cliente registrada.");
  });

  it("o chat continua disponivel nos cartoes", async () => {
    await renderAgenda();
    expect(within(cartao("Ana")).getByRole("button", { name: /chat/i })).toBeInTheDocument();
  });
});
