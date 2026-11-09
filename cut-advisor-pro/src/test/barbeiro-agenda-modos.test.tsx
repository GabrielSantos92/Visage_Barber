// Agenda do barbeiro (site): o gerenciamento completo dos agendamentos, separado
// do Painel. Por dia (navegacao por datas), Proximos (lista completa) e
// Historico, com cancelar, registrar falta e chat; nada do financeiro.
// (As confirmacoes de cancelamento em detalhe: barbeiro-agenda-cancelamento.)
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { inicioDoDia, fimDoDia, somarDias } from "@/lib/painelBarbeiro";
import { banco, chamadas, reiniciarBanco } from "./bancoBarbeiro";

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./bancoBarbeiro")).supabase }));
vi.mock("@/contexts/AuthContext", async () => {
  const { banco: b } = await import("./bancoBarbeiro");
  return { useAuth: () => ({ user: b.usuario, role: b.papel, loading: false }) };
});
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/ChatDialog", () => ({
  default: ({ outroNome }: { outroNome: string }) => <div role="dialog" aria-label={`Chat com ${outroNome}`} />,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import BarbeiroAgenda from "@/pages/BarbeiroAgenda";

beforeEach(() => {
  reiniciarBanco();
  banco.rpc.mockImplementation(async () => ({ data: null, error: null }));
  toast.success.mockClear();
  toast.error.mockClear();
});

const NOMES = /^(Ana|Bruno|Caio|Davi|Eva|Fábio)$/;
const nomes = () => screen.queryAllByText(NOMES).filter((el) => !el.closest("[role=alertdialog]")).map((e) => e.textContent);
const cartao = (nome: string) =>
  screen.getAllByText(nome).find((el) => !el.closest("[role=alertdialog]"))!.closest("div.border") as HTMLElement;
// Ultima consulta da lista de agendamentos (com ou sem intervalo de datas)
const ultimaLista = () => [...banco.consultas].reverse().find((c) => c.tabela === "agendamentos" && c.filtros.some(([, col]) => col === "barbeiro_id"))!;
const intervalo = (c: { filtros: [string, string, unknown][] }) => ({
  desde: c.filtros.find(([t]) => t === "gte")?.[2], ate: c.filtros.find(([t]) => t === "lte")?.[2],
});

async function abrirAgenda() {
  render(<MemoryRouter><BarbeiroAgenda /></MemoryRouter>);
  await screen.findByText("Ana");
}

describe("Agenda do barbeiro (site) - modos", () => {
  it("Por dia: começa hoje, com a situação do dia, e navega pelas datas pedindo o intervalo de cada dia", async () => {
    await abrirAgenda();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AGENDA DO DIA");
    expect(screen.getByRole("tab", { name: "Por dia" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("HOJE")).toBeInTheDocument();
    expect(nomes()).toEqual(["Ana", "Bruno", "Caio"]);
    expect(screen.getByLabelText("A atender: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Concluídos: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancelados: 1")).toBeInTheDocument();
    const hoje = new Date();
    expect(intervalo(ultimaLista())).toEqual({ desde: inicioDoDia(hoje).toISOString(), ate: fimDoDia(hoje).toISOString() });

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Próximo dia" })); });
    expect(await screen.findByText("Davi")).toBeInTheDocument();
    expect(screen.getByText("AMANHÃ")).toBeInTheDocument();
    expect(nomes()).toEqual(["Davi"]);
    expect(intervalo(ultimaLista()).desde).toBe(inicioDoDia(somarDias(hoje, 1)).toISOString());

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dia anterior" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Dia anterior" })); });
    expect(await screen.findByText("Eva")).toBeInTheDocument();
    expect(screen.getByText("ONTEM")).toBeInTheDocument();
    expect(nomes()).toEqual(["Eva"]);

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Voltar para hoje" })); });
    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(nomes()).toEqual(["Ana", "Bruno", "Caio"]);
    expect(screen.queryByRole("button", { name: "Voltar para hoje" })).toBeNull();
  });

  it("Próximos: lista completa dos agendamentos futuros confirmados, com data; cancelar tira da lista", async () => {
    await abrirAgenda();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Próximos" })); });
    expect(await screen.findByText("Davi")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("AGENDA PRÓXIMOS");
    // Todos os agendamentos (sem intervalo de datas); o cancelado do futuro nao entra
    expect(intervalo(ultimaLista())).toEqual({ desde: undefined, ate: undefined });
    expect(nomes()).toEqual(["Davi"]);
    expect(within(cartao("Davi")).getByText("Amanhã · 10:00")).toBeInTheDocument();
    // Sem navegacao por datas fora do modo Por dia
    expect(screen.queryByRole("button", { name: "Próximo dia" })).toBeNull();

    fireEvent.click(within(cartao("Davi")).getByRole("button", { name: "CANCELAR" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Cancelar agendamento?");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar cancelamento" })); });
    expect(banco.updates).toEqual([{ valores: { status: "cancelado" }, filtros: [["eq", "id", "a4"], ["neq", "status", "cancelado"]] }]);
    expect(toast.success).toHaveBeenCalledWith("Agendamento cancelado com sucesso.");
    expect(screen.getByText("Nenhum agendamento marcado para os próximos dias.")).toBeInTheDocument();
  });

  it("Histórico: dias anteriores, com registro de falta num atendimento concluído", async () => {
    await abrirAgenda();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Histórico" })); });
    expect(await screen.findByText("Eva")).toBeInTheDocument();
    expect(nomes()).toEqual(["Eva"]);
    expect(within(cartao("Eva")).getByText("Ontem · 15:00")).toBeInTheDocument();
    expect(within(cartao("Eva")).getByText("CONCLUÍDO")).toBeInTheDocument();

    fireEvent.click(within(cartao("Eva")).getByRole("button", { name: "CLIENTE FALTOU" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Registrar falta do cliente?");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Confirmar falta" })); });
    expect(toast.success).toHaveBeenCalledWith("Falta do cliente registrada.");
    expect(within(cartao("Eva")).getByText("CANCELADO")).toBeInTheDocument();
    expect(within(cartao("Eva")).queryByRole("button", { name: /cancelar|cliente faltou/i })).toBeNull();
  });

  it("chat e mensagens não lidas continuam na Agenda; telefone do cliente no cartão", async () => {
    banco.conversas = [{ id: "cv1", cliente_id: "c1" }];
    banco.mensagens = [{ conversa_id: "cv1" }];
    await abrirAgenda();
    const chat = within(cartao("Ana")).getByRole("button", { name: /^CHAT/ });
    expect(await within(chat).findByText("1")).toBeInTheDocument();
    expect(within(cartao("Ana")).getByText("(11) 98765-4321")).toBeInTheDocument();
    fireEvent.click(chat);
    expect(screen.getByRole("dialog", { name: "Chat com Ana" })).toBeInTheDocument();
  });

  it("a Agenda não tem nada do financeiro", async () => {
    await abrirAgenda();
    await act(async () => { fireEvent.click(screen.getByRole("tab", { name: "Histórico" })); });
    await screen.findByText("Eva");
    expect(chamadas("meu_financeiro")).toHaveLength(0);
    expect(chamadas("meu_desempenho")).toHaveLength(0);
    expect(screen.queryByText(/Faturamento|Minha comissão|Meu percentual/)).toBeNull();
  });

  it("conta não vinculada a um barbeiro: aviso", async () => {
    banco.barbeiro = null;
    render(<MemoryRouter><BarbeiroAgenda /></MemoryRouter>);
    expect(await screen.findByText(/Sua conta ainda não está vinculada a um barbeiro/)).toBeInTheDocument();
  });
});
