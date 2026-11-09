// Tela de comissoes (admin). As regras estao no
// banco (testadas no backend); aqui se confere o que cada tela pede ao banco e
// como mostra as respostas e as recusas.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dataIso, inicioDaSemana } from "@/lib/financeiro";

const banco = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (fn: string, a?: unknown) => banco.rpc(fn, a) } }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import AdminComissoes from "@/pages/admin/AdminComissoes";

const SEMANA = dataIso(inicioDaSemana(new Date()));
const CONFIG = {
  padrao: 50,
  barbeiros: [
    { barbeiro_id: "b1", nome: "João", ativo: true, proprio: 60, vigente: 60 },
    { barbeiro_id: "b2", nome: "Pedro", ativo: true, proprio: null, vigente: 50 },
  ],
  historico: [{ id: 1, barbeiro: "João", percentual: 60, alterado_em: "2026-11-01T12:00:00Z", alterado_por: "Dono" }],
};
const FECHAMENTO = [
  { barbeiro_id: "b1", nome: "João", percentual: 60, servicos: 2, faturamento: 90, comissao: 54, pago: 24, pendente: "30.00", saldo_geral: 30 },
];

function respostas(extra: Record<string, unknown> = {}) {
  banco.rpc.mockImplementation(async (fn: string) => {
    if (fn in extra) {
      const r = extra[fn];
      return r instanceof Error ? { data: null, error: { message: r.message } } : { data: r, error: null };
    }
    const padrao: Record<string, unknown> = {
      comissoes_configuradas: CONFIG, fechamento_semanal: FECHAMENTO, comissao_pagamentos_lista: [],
      configurar_comissao: 55.5, registrar_pagamento_comissao: { saldo_semana: 20, saldo_geral: 20 },
    };
    return { data: padrao[fn] ?? null, error: null };
  });
}

beforeEach(() => {
  banco.rpc.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
});

const chamadas = (fn: string) => banco.rpc.mock.calls.filter(([f]) => f === fn).map(([, a]) => a);
// toLocaleString usa espaco inseparavel em "R$ 20,00"
const texto = (s: unknown) => String(s).replace(/ /g, " ");

describe("Admin - Comissões", () => {
  it("mostra padrão, percentual de cada barbeiro (próprio ou padrão) e o histórico", async () => {
    respostas();
    render(<MemoryRouter><AdminComissoes /></MemoryRouter>);
    expect(await screen.findByLabelText("Percentual padrão")).toHaveValue("50");
    expect(screen.getByLabelText("Percentual de João")).toHaveValue("60");
    expect(screen.getByLabelText("Percentual de Pedro")).toHaveValue("");
    expect(screen.getByText("(padrão)")).toBeInTheDocument();
    expect(screen.getByText(/João: 60%/)).toBeInTheDocument();
    expect(chamadas("fechamento_semanal")[0]).toEqual({ p_semana_inicio: SEMANA });
  });

  it("percentual fora de 0 a 100 nem chega ao banco; válido vai como número", async () => {
    respostas();
    render(<MemoryRouter><AdminComissoes /></MemoryRouter>);
    const campo = await screen.findByLabelText("Percentual de Pedro");
    const linha = campo.closest("tr")!;

    fireEvent.change(campo, { target: { value: "150" } });
    await act(async () => { fireEvent.click(within(linha).getByRole("button", { name: "Salvar" })); });
    expect(toast.error).toHaveBeenCalledWith("O percentual deve estar entre 0 e 100.");
    expect(chamadas("configurar_comissao")).toEqual([]);

    fireEvent.change(campo, { target: { value: "55,5" } });
    await act(async () => { fireEvent.click(within(linha).getByRole("button", { name: "Salvar" })); });
    expect(chamadas("configurar_comissao")).toEqual([{ p_barbeiro_id: "b2", p_percentual: 55.5 }]);
    expect(toast.success).toHaveBeenCalledWith("Comissão do barbeiro atualizada.");
  });

  it("registra pagamento semanal parcial e mostra o que ainda falta", async () => {
    respostas();
    render(<MemoryRouter><AdminComissoes /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /registrar pagamento/i }));
    const dialogo = screen.getByRole("dialog");
    const valor = within(dialogo).getByLabelText(/valor pago/i);
    expect(valor).toHaveValue("30,00");

    fireEvent.change(valor, { target: { value: "10" } });
    fireEvent.change(within(dialogo).getByLabelText(/comprovante/i), { target: { value: "E2E123" } });
    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar" })); });
    expect(chamadas("registrar_pagamento_comissao")).toEqual([{
      p_barbeiro_id: "b1", p_semana_inicio: SEMANA, p_valor: 10, p_metodo: "pix", p_comprovante: "E2E123", p_observacoes: null,
    }]);
    expect(texto(toast.success.mock.calls[0][0])).toBe("Comissão paga. Ainda faltam R$ 20,00 desta semana.");
  });

  it("recusa do banco (valor acima do saldo) aparece no diálogo", async () => {
    respostas({ registrar_pagamento_comissao: new Error("O valor é maior que o saldo pendente (R$ 30,00).") });
    render(<MemoryRouter><AdminComissoes /></MemoryRouter>);
    fireEvent.click(await screen.findByRole("button", { name: /registrar pagamento/i }));
    const dialogo = screen.getByRole("dialog");
    await act(async () => { fireEvent.click(within(dialogo).getByRole("button", { name: "Registrar" })); });
    expect(within(dialogo).getByRole("alert")).toHaveTextContent("O valor é maior que o saldo pendente (R$ 30,00).");
  });
});

// "Meu Financeiro" do barbeiro agora faz parte do Painel do Barbeiro:
// ver painel-barbeiro.test.tsx
