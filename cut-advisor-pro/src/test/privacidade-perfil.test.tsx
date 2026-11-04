import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: api.apiGet,
  apiPost: api.apiPost,
}));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/sonner", () => ({ toast }));

import PrivacidadePerfil from "@/components/PrivacidadePerfil";

const URL = "/api/privacidade/consentimentos/visagismo_foto";
const situacao = (consentido: boolean) => ({
  finalidade: "visagismo_foto", versao_atual: "2026-11-04", consentido,
  concedido_em: consentido ? "2026-11-04T15:30:00Z" : null, origem: consentido ? "mobile" : null,
});

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  toast.success.mockClear();
  toast.error.mockClear();
});

async function renderSecao() {
  render(<MemoryRouter><PrivacidadePerfil /></MemoryRouter>);
  await act(async () => {});
}

describe("Perfil - privacidade", () => {
  it("mostra a autorizacao vigente com data e origem", async () => {
    api.apiGet.mockResolvedValue(situacao(true));
    await renderSecao();
    expect(screen.getByText(/você autorizou o uso da sua foto em \d\d\/\d\d\/2026 às/i)).toHaveTextContent("pelo aplicativo");
    expect(screen.getByRole("button", { name: "Revogar autorização" })).toBeInTheDocument();
  });

  it("sem autorizacao nao oferece revogar", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    await renderSecao();
    expect(screen.getByText(/não autorizado/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Revogar autorização" })).not.toBeInTheDocument();
  });

  it("revogar pede confirmacao e explica as consequencias; Voltar nao revoga", async () => {
    api.apiGet.mockResolvedValue(situacao(true));
    await renderSecao();
    fireEvent.click(screen.getByRole("button", { name: "Revogar autorização" }));
    const popup = screen.getByRole("alertdialog");
    expect(popup).toHaveTextContent("Nenhuma nova foto será enviada");
    expect(popup).toHaveTextContent("Análises já realizadas não são desfeitas");
    fireEvent.click(within(popup).getByRole("button", { name: "Voltar" }));
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("confirmar revoga no backend e atualiza a situacao", async () => {
    api.apiGet.mockResolvedValue(situacao(true));
    api.apiPost.mockResolvedValue({ ...situacao(false), revogados: 1 });
    await renderSecao();
    fireEvent.click(screen.getByRole("button", { name: "Revogar autorização" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revogar autorização" }));
    });
    expect(api.apiPost).toHaveBeenCalledWith(`${URL}/revogar`, { origem: "web" });
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByText(/não autorizado/i)).toBeInTheDocument();
    expect(toast.success).toHaveBeenCalled();
  });

  it("falha ao revogar mantem a autorizacao e avisa", async () => {
    api.apiGet.mockResolvedValue(situacao(true));
    api.apiPost.mockRejectedValue(new Error("offline"));
    await renderSecao();
    fireEvent.click(screen.getByRole("button", { name: "Revogar autorização" }));
    await act(async () => {
      fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Revogar autorização" }));
    });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText(/você autorizou/i)).toBeInTheDocument();
  });
});
