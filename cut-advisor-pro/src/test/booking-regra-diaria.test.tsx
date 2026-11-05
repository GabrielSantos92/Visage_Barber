// Agendamento na web com a regra diaria (limite de 3 por dia e servicos com
// componente repetido). Quem decide e o banco; aqui se confere que a tela
// pergunta antes de mostrar os horarios, nao deixa avancar e explica o motivo.
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MSG_LIMITE_DIARIO } from "@/lib/horarios";

const MSG_REPETIDO = "Você já tem um agendamento neste dia que inclui barba. Escolha um serviço diferente ou outra data.";

const SERVICOS = [
  { id: "combo", nome: "Corte + Barba", preco: 70, duracao_min: 60, com_pausa: false, pausa_min: null },
  { id: "corte", nome: "Corte", preco: 40, duracao_min: 30, com_pausa: false, pausa_min: null },
];

const banco = vi.hoisted(() => ({
  rpc: vi.fn(),
  insert: vi.fn(),
  // Resposta de verificar_regra_diaria por servico
  regra: {} as Record<string, { motivo: string; mensagem: string }[]>,
}));

function consulta(tabela: string) {
  const dados: Record<string, unknown> = {
    barbeiros: [{ id: "b1", nome: "João", especialidade: null }],
    barbeiro_servicos: SERVICOS.map((s) => ({ servico_id: s.id, servicos: s })),
  };
  const b: any = {
    select: () => b, eq: () => b,
    insert: (linha: unknown) => banco.insert(linha),
    then: (ok: any, falha: any) => Promise.resolve({ data: dados[tabela] ?? [], error: null }).then(ok, falha),
  };
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...a: unknown[]) => banco.rpc(...a), from: (t: string) => consulta(t) },
}));
const auth = vi.hoisted(() => ({ user: { id: "u1" } }));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import Booking from "@/pages/Booking";

beforeEach(() => {
  banco.regra = {};
  banco.insert.mockReset();
  banco.rpc.mockReset();
  banco.rpc.mockImplementation(async (nome: string, args: any) => {
    if (nome === "verificar_regra_diaria") return { data: banco.regra[args.p_servico_id] ?? [], error: null };
    if (nome === "horarios_livres") return { data: [{ horario: "14:00" }], error: null };
    return { data: [], error: null };
  });
  toast.error.mockReset();
});

const proximo = () => screen.getByRole("button", { name: /próximo/i });
const datas = (container: HTMLElement) => [...container.querySelectorAll<HTMLButtonElement>(".grid button")];

async function ateAData(servico: string) {
  const r = render(<MemoryRouter><Booking /></MemoryRouter>);
  fireEvent.click(await screen.findByText("João"));
  fireEvent.click(proximo());
  fireEvent.click(await screen.findByText(servico));
  fireEvent.click(proximo());
  await screen.findByText(/selecione a data/i);
  return r;
}

describe("Agendamento web - limite diário e serviços repetidos", { timeout: 20000 }, () => {
  it("serviço com componente já agendado no dia: explica o motivo e não deixa avançar", async () => {
    banco.regra.combo = [{ motivo: "SERVICO_REPETIDO", mensagem: MSG_REPETIDO }];
    const { container } = await ateAData("Corte + Barba");
    await act(async () => { fireEvent.click(datas(container)[0]); });

    expect(await screen.findByRole("alert")).toHaveTextContent(MSG_REPETIDO);
    expect(proximo()).toBeDisabled();
    expect(banco.rpc).toHaveBeenCalledWith("verificar_regra_diaria", expect.objectContaining({ p_servico_id: "combo", p_data: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    // Os horarios nem chegam a ser pedidos com o avanco bloqueado
    expect(screen.queryByText("14:00")).not.toBeInTheDocument();
  });

  it("limite de 3 no dia: mostra a mensagem do limite", async () => {
    banco.regra.corte = [{ motivo: "LIMITE_DIARIO", mensagem: MSG_LIMITE_DIARIO }];
    const { container } = await ateAData("Corte");
    await act(async () => { fireEvent.click(datas(container)[0]); });
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Você atingiu o limite máximo de 3 agendamentos por dia. Escolha outra data para realizar um novo agendamento.");
    expect(proximo()).toBeDisabled();
  });

  it("serviço permitido: segue para os horários normalmente", async () => {
    const { container } = await ateAData("Corte");
    await act(async () => { fireEvent.click(datas(container)[0]); });
    await waitFor(() => expect(proximo()).toBeEnabled());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fireEvent.click(proximo());
    expect(await screen.findByText("14:00")).toBeInTheDocument();
  });

  it("recusa do banco ao confirmar (ex.: reserva feita em outra aba): mostra o motivo e volta para a data", async () => {
    const { container } = await ateAData("Corte");
    await act(async () => { fireEvent.click(datas(container)[0]); });
    await waitFor(() => expect(proximo()).toBeEnabled());
    fireEvent.click(proximo());
    fireEvent.click(await screen.findByText("14:00"));
    fireEvent.click(proximo());

    banco.insert.mockResolvedValue({ error: { code: "PT400", details: "LIMITE_DIARIO", message: MSG_LIMITE_DIARIO } });
    // Ao voltar para a data, a verificacao agora encontra o limite
    banco.regra.corte = [{ motivo: "LIMITE_DIARIO", mensagem: MSG_LIMITE_DIARIO }];
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /confirmar agendamento/i })); });

    expect(toast.error).toHaveBeenCalledWith(MSG_LIMITE_DIARIO);
    expect(await screen.findByText(/selecione a data/i)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent(MSG_LIMITE_DIARIO);
    expect(proximo()).toBeDisabled();
  });
});
