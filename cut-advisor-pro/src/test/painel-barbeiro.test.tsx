// Painel do Barbeiro (/dashboard do barbeiro): resumo do dia com as acoes nos
// atendimentos de hoje e o financeiro (meu_financeiro e meu_desempenho). As
// regras financeiras estao no banco (testadas no backend); aqui se confere o
// que o painel pede, como mostra as respostas e que as acoes o atualizam.
// A agenda completa (por dia, proximos, historico) esta em barbeiro-agenda-modos.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { intervaloDoPeriodo } from "@/lib/financeiro";
import { PERIODOS_PAINEL } from "@/lib/painelBarbeiro";
import { banco, chamadas, reiniciarBanco } from "./bancoBarbeiro";

vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./bancoBarbeiro")).supabase }));
vi.mock("@/contexts/AuthContext", async () => {
  const { banco: b } = await import("./bancoBarbeiro");
  return { useAuth: () => ({ user: b.usuario, role: b.papel, loading: false }) };
});
vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/components/ChatDialog", () => ({
  default: ({ outroNome, onOpenChange }: { outroNome: string; onOpenChange: (a: boolean) => void }) => (
    <div role="dialog" aria-label={`Chat com ${outroNome}`}>
      <button onClick={() => onOpenChange(false)}>Fechar chat</button>
    </div>
  ),
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import Dashboard from "@/pages/Dashboard";

const MEU = {
  percentual: 60, servicos: 2, faturamento: 90, comissao: 54, recebido: 24, comissao_total: 54, recebido_total: 24,
  lancamentos: [
    { id: 2, tipo: "reembolso", competencia: "2026-11-05", servico: "Corte", valor_pago: -10, percentual: 60, comissao: -6 },
    { id: 1, tipo: "servico", competencia: "2026-11-04", servico: "Corte", valor_pago: 40, percentual: 60, comissao: 24 },
  ],
  pagamentos: [{ id: "x", semana_inicio: "2026-11-02", valor: 24, metodo: "pix", comprovante: "E1", observacoes: null, pago_em: "2026-11-05T15:00:00Z" }],
};
const DES = { percentual: 60, percentual_origem: "individual", percentual_padrao: 40, dias_semana: [2, 0, 5, 0, 1, 3, 0] };

function respostas(extra: Record<string, unknown> = {}) {
  banco.rpc.mockImplementation(async (fn: string) => {
    const r = fn in extra ? extra[fn] : ({ meu_financeiro: MEU, meu_desempenho: DES } as Record<string, unknown>)[fn] ?? null;
    return r instanceof Error ? { data: null, error: { message: r.message } } : { data: r, error: null };
  });
}

beforeEach(() => {
  reiniciarBanco();
  toast.success.mockClear();
  toast.error.mockClear();
  respostas();
});

const texto = (s: unknown) => String(s).replace(/\s/g, " ");
const ultima = (fn: string) => { const c = chamadas(fn); return c[c.length - 1]; };
const cartao = (nome: string) =>
  screen.getAllByText(nome).find((el) => !el.closest("[role=alertdialog]"))!.closest("div.border") as HTMLElement;
const nomesHoje = () =>
  within(screen.getByLabelText("Atendimentos de hoje")).queryAllByText(/^(Ana|Bruno|Caio|Davi|Eva|Fábio)$/).map((e) => e.textContent);
// Cartao financeiro: o rotulo e o primeiro paragrafo do cartao
const indicador = (rotulo: string) => screen.getByText(rotulo).parentElement as HTMLElement;

async function abrirPainel() {
  render(<MemoryRouter><Dashboard /></MemoryRouter>);
  await screen.findByText("Visão do dia");
  await screen.findByText("Faturamento gerado");
}

describe("Painel do Barbeiro - A. Resumo do dia", () => {
  it("o barbeiro em /dashboard vê o Painel do Barbeiro, não o painel antigo", async () => {
    await abrirPainel();
    expect(screen.getByText("Painel do barbeiro")).toBeInTheDocument();
    expect(screen.queryByText("RECEITA DO MÊS")).toBeNull();
    expect(screen.queryByText(/Agendamentos Recentes/i)).toBeNull();
  });

  it("situação e atendimentos de hoje; próximos e histórico ficam só na Agenda", async () => {
    await abrirPainel();
    expect(screen.getByLabelText("A atender: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Concluídos: 1")).toBeInTheDocument();
    expect(screen.getByLabelText("Cancelados: 1")).toBeInTheDocument();
    expect(nomesHoje()).toEqual(["Ana", "Bruno", "Caio"]);
    expect(within(cartao("Ana")).getByText("Hoje · 09:00")).toBeInTheDocument();

    // Sem abas de proximos/historico no Painel; so o dia de hoje e pedido ao banco
    expect(screen.queryByRole("tab")).toBeNull();
    expect(screen.queryByText("Davi")).toBeNull();
    expect(screen.queryByText("Eva")).toBeNull();
    const daLista = banco.consultas.find((c) => c.tabela === "agendamentos" && c.filtros.some(([t]) => t === "gte"));
    expect(daLista).toBeDefined();
  });

  it("botão Abrir agenda leva à Agenda completa", async () => {
    await abrirPainel();
    expect(screen.getByRole("link", { name: /Abrir agenda/i })).toHaveAttribute("href", "/barbeiro/agenda");
  });

  it("sem atendimentos hoje: aviso, e o financeiro continua", async () => {
    banco.agendamentos = banco.agendamentos.filter((a) => !["a1", "a2", "a3"].includes(a.id));
    await abrirPainel();
    expect(screen.getByText("Nenhum atendimento marcado para hoje.")).toBeInTheDocument();
    expect(screen.getByLabelText("A atender: 0")).toBeInTheDocument();
    expect(texto(indicador("Faturamento gerado").textContent)).toContain("R$ 90,00");
  });
});

describe("Painel do Barbeiro - ações nos atendimentos de hoje", () => {
  it("cancelar ou registrar falta: confirma, grava no banco e recarrega o resumo e o financeiro", async () => {
    await abrirPainel();
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: /^(CANCELAR|CLIENTE FALTOU)$/ }));
    const popup = screen.getByRole("alertdialog");
    expect(popup).toHaveTextContent(/Cancelar agendamento\?|Registrar falta do cliente\?/);
    expect(banco.updates).toHaveLength(0);
    const antes = chamadas("meu_financeiro").length;
    await act(async () => { fireEvent.click(within(popup).getByRole("button", { name: /^Confirmar/ })); });

    // Mesma operacao da Agenda, com protecao contra cancelar de novo
    expect(banco.updates).toEqual([{ valores: { status: "cancelado" }, filtros: [["eq", "id", "a1"], ["neq", "status", "cancelado"]] }]);
    expect(toast.success).toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    // Resumo recarregado do banco e financeiro pedido de novo
    expect(await screen.findByLabelText("Cancelados: 2")).toBeInTheDocument();
    expect(screen.getByLabelText("A atender: 0")).toBeInTheDocument();
    expect(within(cartao("Ana")).getByText("CANCELADO")).toBeInTheDocument();
    expect(chamadas("meu_financeiro").length).toBe(antes + 1);
    expect(chamadas("meu_desempenho").length).toBe(antes + 1);
  });

  it("cliente faltou (atendimento já concluído): texto próprio e o financeiro é recarregado (estorno)", async () => {
    await abrirPainel();
    fireEvent.click(within(cartao("Bruno")).getByRole("button", { name: "CLIENTE FALTOU" }));
    const popup = screen.getByRole("alertdialog");
    expect(popup).toHaveTextContent("Registrar falta do cliente?");
    const antes = chamadas("meu_desempenho").length;
    await act(async () => { fireEvent.click(within(popup).getByRole("button", { name: "Confirmar falta" })); });

    expect(toast.success).toHaveBeenCalledWith("Falta do cliente registrada.");
    expect(await within(cartao("Bruno")).findByText("CANCELADO")).toBeInTheDocument();
    expect(within(cartao("Bruno")).queryByRole("button", { name: /cancelar|cliente faltou/i })).toBeNull();
    expect(chamadas("meu_desempenho").length).toBe(antes + 1);
  });

  it("falha de comunicação mantém o aviso aberto; já cancelado em outro aparelho mostra o status real", async () => {
    await abrirPainel();
    banco.respostaUpdate = { data: null, error: { message: "Failed to fetch" } };
    fireEvent.click(within(cartao("Ana")).getByRole("button", { name: /^(CANCELAR|CLIENTE FALTOU)$/ }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Confirmar/ })); });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("Não foi possível cancelar"));
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(within(cartao("Ana")).getByText("CONFIRMADO")).toBeInTheDocument();

    banco.respostaUpdate = { data: [], error: null };
    banco.agendamentos.find((a) => a.id === "a1")!.status = "cancelado";
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /^Confirmar/ })); });
    expect(toast.error).toHaveBeenCalledWith(expect.stringContaining("já ter sido cancelado"));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(await within(cartao("Ana")).findByText("CANCELADO")).toBeInTheDocument();
  });

  it("chat: selo de mensagens não lidas e conversa aberta pelo próprio Painel", async () => {
    banco.conversas = [{ id: "cv1", cliente_id: "c1" }];
    banco.mensagens = [{ conversa_id: "cv1" }, { conversa_id: "cv1" }];
    await abrirPainel();
    const chat = await within(cartao("Ana")).findByRole("button", { name: /^CHAT/ });
    expect(await within(chat).findByText("2")).toBeInTheDocument();
    fireEvent.click(chat);
    expect(screen.getByRole("dialog", { name: "Chat com Ana" })).toBeInTheDocument();

    // Ao fechar, as nao lidas sao recarregadas
    banco.mensagens = [];
    const antes = banco.consultas.filter((c) => c.tabela === "conversas").length;
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Fechar chat" })); });
    expect(banco.consultas.filter((c) => c.tabela === "conversas").length).toBe(antes + 1);
    await act(async () => {});
    expect(within(cartao("Ana")).getByRole("button", { name: /^CHAT/ })).toHaveTextContent(/^CHAT$/);
  });
});

describe("Painel do Barbeiro - B, C e D (financeiro)", () => {
  it("cartões, gráfico e comissões vêm só de meu_financeiro e meu_desempenho", async () => {
    await abrirPainel();
    expect(texto(indicador("Faturamento gerado").textContent)).toContain("R$ 90,00");
    expect(indicador("Faturamento gerado")).toHaveTextContent("Não é o valor que você recebe.");
    expect(texto(indicador("Minha comissão").textContent)).toContain("R$ 54,00");
    expect(indicador("Meu percentual")).toHaveTextContent("60%");
    expect(indicador("Meu percentual")).toHaveTextContent("Percentual individual");

    // Grafico: atendimentos por dia da semana, segunda a domingo
    expect(screen.getByLabelText("segunda-feira: 2 atendimentos")).toBeInTheDocument();
    expect(screen.getByLabelText("quarta-feira: 5 atendimentos")).toBeInTheDocument();
    expect(screen.getByLabelText("domingo: 0 atendimentos")).toBeInTheDocument();
    expect(screen.getByText("11 atendimentos · mais movimento: quarta-feira")).toBeInTheDocument();

    // D: comissoes e recebimentos
    expect(indicador("Serviços com comissão")).toHaveTextContent("2");
    expect(texto(indicador("Recebido no período").textContent)).toContain("R$ 24,00");
    expect(texto(indicador("Saldo a receber").textContent)).toContain("R$ 30,00"); // 54 - 24
    expect(screen.getByText("Reembolso")).toBeInTheDocument();
    expect(screen.getByText(/Semana de 02\/11\/2026/)).toBeInTheDocument();

    // Nenhuma funcao do admin; financeiro so pelas funcoes do proprio barbeiro
    expect(new Set(banco.rpc.mock.calls.map(([f]) => f))).toEqual(new Set(["concluir_agendamentos_passados", "meu_financeiro", "meu_desempenho"]));
  });

  it("concluído e ainda não pago: conta no gráfico, mas não no faturamento", async () => {
    respostas({
      meu_financeiro: { ...MEU, servicos: 0, faturamento: 0, comissao: 0, lancamentos: [] },
      meu_desempenho: { percentual: 50, percentual_origem: "padrao", percentual_padrao: 50, dias_semana: [0, 0, 1, 0, 0, 0, 0] },
    });
    await abrirPainel();
    expect(screen.getByLabelText("quarta-feira: 1 atendimento")).toBeInTheDocument();
    expect(texto(indicador("Faturamento gerado").textContent)).toContain("R$ 0,00");
    expect(indicador("Meu percentual")).toHaveTextContent("50%");
    expect(indicador("Meu percentual")).toHaveTextContent("Padrão da barbearia");
    expect(screen.getByText("Nenhum serviço concluído e pago no período.")).toBeInTheDocument();
  });

  it("sem percentual configurado: comissão pendente, sem valor inventado", async () => {
    respostas({ meu_desempenho: { ...DES, percentual: null, percentual_origem: null, percentual_padrao: null } });
    await abrirPainel();
    expect(indicador("Meu percentual")).toHaveTextContent("Pendente");
    expect(indicador("Meu percentual")).toHaveTextContent("Aguardando configuração do admin");
  });

  it("filtros: os cinco períodos pedem o mesmo intervalo às duas funções", async () => {
    await abrirPainel();
    expect(PERIODOS_PAINEL.map((p) => p.rotulo)).toEqual(["Hoje", "Esta semana", "Este mês", "Últimos 30 dias", "Personalizado"]);
    for (const p of PERIODOS_PAINEL.filter((x) => x.valor !== "personalizado")) {
      await act(async () => { fireEvent.click(screen.getByRole("button", { name: p.rotulo })); });
      const { inicio, fim } = intervaloDoPeriodo(p.valor);
      expect(ultima("meu_financeiro")).toEqual({ p_inicio: inicio, p_fim: fim });
      expect(ultima("meu_desempenho")).toEqual({ p_inicio: inicio, p_fim: fim });
    }
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Personalizado" })); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Data inicial"), { target: { value: "2026-10-01" } }); });
    await act(async () => { fireEvent.change(screen.getByLabelText("Data final"), { target: { value: "2026-10-31" } }); });
    expect(ultima("meu_financeiro")).toEqual({ p_inicio: "2026-10-01", p_fim: "2026-10-31" });
    expect(ultima("meu_desempenho")).toEqual({ p_inicio: "2026-10-01", p_fim: "2026-10-31" });
  });

  it("erro só no desempenho: o resto do painel continua", async () => {
    respostas({ meu_desempenho: new Error("function meu_desempenho does not exist") });
    await abrirPainel();
    expect(await screen.findByText("function meu_desempenho does not exist")).toBeInTheDocument();
    expect(texto(indicador("Faturamento gerado").textContent)).toContain("R$ 90,00");
    expect(indicador("Meu percentual")).toHaveTextContent("Indisponível");
    expect(screen.getByText("Ana")).toBeInTheDocument();
  });

  it("conta não vinculada a um barbeiro: aviso e nenhuma consulta financeira", async () => {
    banco.barbeiro = null;
    render(<MemoryRouter><Dashboard /></MemoryRouter>);
    expect(await screen.findByText(/Sua conta ainda não está vinculada a um barbeiro/)).toBeInTheDocument();
    expect(chamadas("meu_financeiro")).toHaveLength(0);
    expect(chamadas("meu_desempenho")).toHaveLength(0);
  });
});
