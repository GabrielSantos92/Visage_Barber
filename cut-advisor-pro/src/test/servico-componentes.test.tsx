// Cadastro dos componentes de um servico (corte, barba...) no admin web: e o
// que o banco usa para barrar servicos com item repetido no mesmo dia.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const banco = vi.hoisted(() => ({ rpc: vi.fn(), update: vi.fn() }));

function consulta(tabela: string) {
  const dados: Record<string, unknown> = {
    componentes_servico: [
      { codigo: "barba", nome: "Barba" }, { codigo: "corte", nome: "Corte de cabelo" }, { codigo: "sobrancelha", nome: "Sobrancelha" },
    ],
    servico_componentes: [{ componente: "corte" }],
  };
  const b: any = {
    select: () => b, eq: () => b, order: () => b,
    update: (v: unknown) => { banco.update(v); return b; },
    then: (ok: any, falha: any) => Promise.resolve({ data: dados[tabela] ?? [], error: null }).then(ok, falha),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => banco.rpc(...a), from: (t: string) => consulta(t) },
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import ServicoFormDialog from "@/components/admin/ServicoFormDialog";

const servico = {
  id: "s1", nome: "Corte + Barba", descricao: null, preco: 70, duracao_min: 60, ativo: true,
  com_pausa: false, ativo_inicial_min: null, pausa_min: null, ativo_final_min: null, margem_min: 0, created_at: "",
} as any;

beforeEach(() => {
  banco.rpc.mockReset();
  banco.rpc.mockResolvedValue({ data: null, error: null });
  banco.update.mockReset();
});

describe("Admin - componentes do serviço", () => {
  it("mostra os componentes atuais e grava a seleção numa única chamada", async () => {
    const onSaved = vi.fn();
    render(<ServicoFormDialog open servico={servico} onClose={() => {}} onSaved={onSaved} />);

    const corte = await screen.findByRole("checkbox", { name: "Corte de cabelo" });
    expect(corte).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Barba" })).not.toBeChecked();

    fireEvent.click(screen.getByRole("checkbox", { name: "Barba" }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i })); });

    expect(banco.rpc).toHaveBeenCalledWith("definir_componentes_servico", { p_servico_id: "s1", p_componentes: ["corte", "barba"] });
    expect(onSaved).toHaveBeenCalled();
  });

  it("recusa do banco (ex.: sem permissão) aparece como erro e não fecha como sucesso", async () => {
    banco.rpc.mockResolvedValue({ data: null, error: { message: "Apenas o administrador pode alterar os componentes do serviço." } });
    const onSaved = vi.fn();
    render(<ServicoFormDialog open servico={servico} onClose={() => {}} onSaved={onSaved} />);
    await screen.findByRole("checkbox", { name: "Barba" });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /salvar alterações/i })); });
    expect(toast.error).toHaveBeenCalledWith("Apenas o administrador pode alterar os componentes do serviço.");
    expect(onSaved).not.toHaveBeenCalled();
  });
});
