// Tela Financeiro do admin (web): duplicidades a devolver, historico dos
// pagamentos, reembolsos e cobrancas que ainda estao abertas no Mercado Pago.
// As regras estao no banco e no backend (testadas la); aqui se confere o que a
// tela mostra, o que ela pede e que nada e devolvido sem confirmacao do admin.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({ rpc: vi.fn() }));
const api = vi.hoisted(() => ({ apiPost: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, a?: unknown) => banco.rpc(fn, a),
    from: () => ({ select: () => ({ order: async () => ({ data: [], error: null }) }) }),
  },
}));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), apiPost: api.apiPost }));
vi.mock("@/components/ui/sonner", () => ({ toast }));
vi.mock("@/components/admin/AdminNav", () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div>, AdminNav: () => null }));
vi.mock("recharts", () => {
  const Vazio = () => null;
  const Caixa = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Caixa, BarChart: Caixa, Bar: Vazio, CartesianGrid: Vazio, Legend: Vazio, Tooltip: Vazio, XAxis: Vazio, YAxis: Vazio };
});

import AdminFinanceiro from "@/pages/admin/AdminFinanceiro";

const RESUMO = {
  servicos: 1, faturamento_bruto: 40, descontos: 0, faturamento: 40, comissoes: 24, parte_barbearia: 16, taxas_servicos: 2,
  total_recebido: 80, taxas: 2.4, reembolsos: 10, recebido_liquido: 67.6, pendentes_valor: 0, pendentes_quantidade: 0,
  comissoes_pagas: 0, comissoes_pendentes: 24, receita_barbearia: 14, duplicados_quantidade: 1, duplicados_valor: 40, cobrancas_abertas: 1,
};
const linha = {
  agendamento_id: "a1", data_hora: "2026-11-04T12:00:00Z", cliente: "Ana", barbeiro: "João", servico: "Corte", desconto: 0,
  taxa: 0, valor_reembolsado: 0, forma_presencial: null, criado_em: "2026-11-04T10:00:00Z", aprovado_em: "2026-11-04T10:05:00Z",
  cancelamento_provedor: null, valor: 40, status: "approved",
};
const PRINCIPAL = { ...linha, id: "p1", metodo: "cartao", duplicidade_de: null, tem_duplicidade: true };
const DUPLICADO = { ...linha, id: "p2", metodo: "pix", duplicidade_de: "p1", tem_duplicidade: false };
const HISTORICO = [
  { id: 1, registrado_em: "2026-11-04T10:00:00Z", pagamento_id: "p2", metodo: "pix", evento: "criado", status_anterior: null, status_novo: "pending", valor: 40, detalhe: "pix", origem: "cliente", ator: "Ana" },
  { id: 2, registrado_em: "2026-11-04T10:01:00Z", pagamento_id: "p2", metodo: "pix", evento: "status", status_anterior: "pending", status_novo: "canceled", valor: 40, detalhe: "substituido · id 1001", origem: "cliente", ator: "Ana" },
  { id: 3, registrado_em: "2026-11-04T10:06:00Z", pagamento_id: "p2", metodo: "pix", evento: "duplicidade", status_anterior: null, status_novo: "approved", valor: 40, detalhe: "atendimento já quitado pelo pagamento p1", origem: "provedor", ator: null },
];
const REEMBOLSOS = [{
  id: "r1", pagamento_id: "p9", agendamento_id: "a9", reembolsado_em: "2026-11-05T15:00:00Z", cliente: "Bruno", barbeiro: "Pedro",
  servico: "Barba", metodo: "presencial", valor: 10, motivo: "insatisfeito", registrado_por: "Dono", origem: "admin", duplicidade: false,
}];
const A_RECEBER = [{
  agendamento_id: "a5", data_hora: "2026-11-05T14:00:00Z", status: "confirmado", cliente: "Carla", barbeiro: "João",
  servico: "Corte", preco: 40, metodo_pendente: "pix",
}];

function respostas(extra: Record<string, unknown> = {}) {
  const padrao: Record<string, unknown> = {
    financeiro_resumo: RESUMO, financeiro_serie: [], financeiro_barbeiros: [], financeiro_pagamentos: [PRINCIPAL, DUPLICADO],
    financeiro_a_receber: A_RECEBER, financeiro_duplicidades: [DUPLICADO], financeiro_reembolsos: REEMBOLSOS,
    pagamento_historico: HISTORICO, registrar_pagamento_presencial: { pagamento: { id: "p5" }, cancelados: [{ id: "p6" }] },
  };
  banco.rpc.mockImplementation(async (fn: string) => ({ data: fn in extra ? extra[fn] : padrao[fn] ?? null, error: null }));
}

beforeEach(() => {
  banco.rpc.mockReset();
  api.apiPost.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

// toLocaleString usa espaco inseparavel em "R$ 40,00"
const texto = (s: unknown) => String(s).replace(/\u00a0/g, " ");
const secao = (titulo: string) => screen.getByRole("heading", { name: titulo }).closest("section")!;

async function abrir() {
  render(<MemoryRouter><AdminFinanceiro /></MemoryRouter>);
  await screen.findByRole("heading", { name: "Pagamentos em duplicidade" });
}

describe("Admin - Financeiro: duplicidades, histórico e reembolsos", () => {
  it("destaca a duplicidade e o que falta devolver; o pagamento principal não pode ser reembolsado antes", async () => {
    respostas();
    await abrir();
    expect(texto(screen.getAllByRole("alert")[0].textContent)).toMatch(/1 pagamento\(s\) em duplicidade: R\$ 40,00 recebidos a mais/);

    const linhas = within(secao("Pagamentos")).getAllByRole("row").slice(1);
    const [principal, duplicado] = linhas;
    expect(within(principal).getByText("Devolva a duplicidade antes")).toBeInTheDocument();
    expect(within(principal).queryByRole("button", { name: /reembolsar/i })).toBeNull();
    expect(within(duplicado).getByText("Duplicidade")).toBeInTheDocument();
    expect(within(duplicado).getByRole("button", { name: /devolver/i })).toBeInTheDocument();
  });

  it("devolver a duplicidade exige a confirmação do admin e envia valor e motivo ao backend", async () => {
    respostas();
    api.apiPost.mockResolvedValue({ ...DUPLICADO, status: "refunded", valor_reembolsado: 40 });
    await abrir();
    fireEvent.click(within(secao("Pagamentos em duplicidade")).getByRole("button", { name: /devolver/i }));

    const dialogo = screen.getByRole("dialog");
    expect(within(dialogo).getByText("Devolver pagamento em duplicidade")).toBeInTheDocument();
    expect(within(dialogo).getByLabelText(/valor a devolver/i)).toHaveValue("40,00");
    expect(within(dialogo).getByLabelText(/motivo/i)).toHaveValue("Pagamento em duplicidade");
    expect(within(dialogo).getByText(/não altera a comissão/)).toBeInTheDocument();

    const confirmar = within(dialogo).getByRole("button", { name: "Confirmar" });
    expect(confirmar).toBeDisabled();
    await act(async () => { fireEvent.click(confirmar); });
    expect(api.apiPost).not.toHaveBeenCalled();

    fireEvent.click(within(dialogo).getByRole("checkbox"));
    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" })); });
    expect(api.apiPost).toHaveBeenCalledWith("/api/pagamentos/p2/reembolsar", { valor: 40, motivo: "Pagamento em duplicidade" });
    expect(toast.success).toHaveBeenCalledWith("Duplicidade devolvida ao cliente pelo Mercado Pago.");
  });

  it("recusa do backend (ex.: Mercado Pago fora do ar) aparece no diálogo", async () => {
    respostas();
    api.apiPost.mockRejectedValue(new Error("O Mercado Pago não confirmou o reembolso. Confira o pagamento em alguns minutos antes de tentar de novo."));
    await abrir();
    fireEvent.click(within(secao("Pagamentos em duplicidade")).getByRole("button", { name: /devolver/i }));
    const dialogo = screen.getByRole("dialog");
    fireEvent.click(within(dialogo).getByRole("checkbox"));
    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Confirmar" })); });
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("O Mercado Pago não confirmou o reembolso.");
  });

  it("histórico do atendimento: cada operação com origem e autor", async () => {
    respostas();
    await abrir();
    fireEvent.click(within(secao("Pagamentos em duplicidade")).getByRole("button", { name: /histórico/i }));
    const dialogo = screen.getByRole("dialog");
    expect(await within(dialogo).findByText("Cobrança PIX criada")).toBeInTheDocument();
    expect(within(dialogo).getByText("Aguardando pagamento → Cancelado")).toBeInTheDocument();
    expect(within(dialogo).getByText(/trocou a forma de pagamento · id 1001/)).toBeInTheDocument();
    expect(within(dialogo).getByText("Pagamento em duplicidade: o atendimento já estava quitado")).toBeInTheDocument();
    expect(within(dialogo).getAllByText(/Cliente \(Ana\)/)).toHaveLength(2);
    expect(within(dialogo).getByText(/Mercado Pago$/)).toBeInTheDocument();
    expect(banco.rpc).toHaveBeenCalledWith("pagamento_historico", { p_pagamento_id: "p2" });
  });

  it("cobranças ainda abertas no Mercado Pago: o admin pede o cancelamento pelo backend", async () => {
    respostas();
    api.apiPost.mockResolvedValue({ canceladas: 1, falharam: 0 });
    await abrir();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /cancelar no mercado pago/i })); });
    expect(api.apiPost).toHaveBeenCalledWith("/api/pagamentos/cobrancas-abertas/cancelar", {});
    expect(toast.success).toHaveBeenCalledWith("1 cobrança(s) cancelada(s) no Mercado Pago.");
  });

  it("pagamento na barbearia: o PIX que o cliente tinha gerado é cancelado também no Mercado Pago", async () => {
    respostas();
    api.apiPost.mockResolvedValue({ canceladas: 1, falharam: 0 });
    await abrir();
    fireEvent.click(within(secao("Atendimentos sem pagamento confirmado")).getByRole("button", { name: /registrar pagamento/i }));
    await act(async () => { fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Confirmar" })); });
    expect(banco.rpc).toHaveBeenCalledWith("registrar_pagamento_presencial", { p_agendamento_id: "a5", p_forma: "dinheiro", p_desconto: 0, p_taxa: 0 });
    expect(api.apiPost).toHaveBeenCalledWith("/api/pagamentos/cobrancas-abertas/cancelar", { agendamento_id: "a5" });
    expect(toast.success).toHaveBeenCalledWith("Pagamento registrado.");
  });

  it("reembolsos do período: valor, origem, quem fez e o motivo", async () => {
    respostas();
    await abrir();
    const reembolsos = secao("Reembolsos do período");
    expect(within(reembolsos).getByText("insatisfeito")).toBeInTheDocument();
    expect(within(reembolsos).getByText(/Pelo Visage Barber · Dono/)).toBeInTheDocument();
    expect(texto(within(reembolsos).getByText(/- R\$/).textContent)).toBe("- R$ 10,00");
  });

  it("sem duplicidade nem cobrança aberta: nenhum alerta", async () => {
    respostas({ financeiro_resumo: { ...RESUMO, duplicados_quantidade: 0, duplicados_valor: 0, cobrancas_abertas: 0 }, financeiro_duplicidades: [] });
    render(<MemoryRouter><AdminFinanceiro /></MemoryRouter>);
    await screen.findByRole("heading", { name: "Pagamentos" });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Pagamentos em duplicidade" })).toBeNull();
  });
});
