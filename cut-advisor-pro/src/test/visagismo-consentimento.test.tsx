import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/Navbar", () => ({ default: () => null }));

const api = vi.hoisted(() => ({ apiGet: vi.fn(), apiPost: vi.fn() }));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiGet: api.apiGet,
  apiPost: api.apiPost,
}));

import Visagismo from "@/pages/Visagismo";
import AvisoPrivacidade from "@/pages/AvisoPrivacidade";
import { ApiError } from "@/lib/api";
import { AVISO_VISAGISMO, VERSAO_AVISO_VISAGISMO } from "@/lib/privacidade";

const URL_CONSENT = "/api/privacidade/consentimentos/visagismo_foto";
const situacao = (consentido: boolean) => ({
  finalidade: "visagismo_foto", versao_atual: VERSAO_AVISO_VISAGISMO, consentido,
  concedido_em: consentido ? "2026-11-04T12:00:00Z" : null, origem: consentido ? "web" : null,
});

function renderTela() {
  return render(
    <MemoryRouter initialEntries={["/inicio", "/visagismo"]} initialIndex={1}>
      <Routes>
        <Route path="/inicio" element={<p>tela anterior</p>} />
        <Route path="/visagismo" element={<Visagismo />} />
        <Route path="/visagismo/resultado" element={<p>tela de resultado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const botaoConcordar = () => screen.getByRole("button", { name: /concordar e continuar/i });
const chamadasPost = (url: string) => api.apiPost.mock.calls.filter(([u]) => u === url);

async function escolherFoto(container: HTMLElement) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "rosto.jpg", { type: "image/jpeg" })] } });
  await screen.findByAltText("Foto selecionada");
}

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
});

describe("Visagismo - aviso de privacidade", () => {
  it("mostra o aviso antes de qualquer escolha de foto, com a caixa desmarcada", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    renderTela();

    expect(await screen.findByRole("heading", { name: AVISO_VISAGISMO.titulo })).toBeInTheDocument();
    expect(api.apiGet).toHaveBeenCalledWith(URL_CONSENT);
    expect(screen.getByText("Como utilizaremos sua foto?")).toBeInTheDocument();
    expect(screen.getByText("Processamento por inteligência artificial")).toBeInTheDocument();
    expect(screen.getByText("Seus direitos")).toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(botaoConcordar()).toBeDisabled();
    expect(screen.queryByRole("button", { name: /da galeria/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /câmera/i })).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: /consultar aviso de privacidade/i });
    expect(link).toHaveAttribute("href", "/privacidade");
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("sem marcar a caixa nada e registrado", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    renderTela();
    await screen.findByRole("checkbox");
    fireEvent.click(botaoConcordar());
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("Voltar sai da tela sem registrar concordancia", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    renderTela();
    await screen.findByRole("checkbox");
    fireEvent.click(screen.getByRole("button", { name: /^voltar$/i }));
    expect(await screen.findByText("tela anterior")).toBeInTheDocument();
    expect(api.apiPost).not.toHaveBeenCalled();
  });

  it("concordar registra no backend com a versao do aviso e libera o envio", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    api.apiPost.mockResolvedValue(situacao(true));
    renderTela();
    fireEvent.click(await screen.findByRole("checkbox"));
    expect(botaoConcordar()).toBeEnabled();
    await act(async () => { fireEvent.click(botaoConcordar()); });

    expect(api.apiPost).toHaveBeenCalledWith(URL_CONSENT, { versao: VERSAO_AVISO_VISAGISMO, origem: "web" });
    expect(screen.queryByRole("heading", { name: AVISO_VISAGISMO.titulo })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /da galeria/i })).toBeInTheDocument();
    expect(screen.getByText(/uso da foto autorizado/i)).toBeInTheDocument();
  });

  it("falha ao registrar: mostra o erro e continua bloqueado", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    api.apiPost.mockRejectedValue(new Error("Não foi possível registrar sua escolha. Tente novamente."));
    renderTela();
    fireEvent.click(await screen.findByRole("checkbox"));
    await act(async () => { fireEvent.click(botaoConcordar()); });

    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível registrar sua escolha");
    expect(screen.queryByRole("button", { name: /da galeria/i })).not.toBeInTheDocument();
  });

  it("quem ja concordou vai direto ao envio e a analise segue normalmente", async () => {
    api.apiGet.mockResolvedValue(situacao(true));
    api.apiPost.mockResolvedValue({ formato_rosto: "oval" });
    const { container } = renderTela();
    expect(await screen.findByRole("button", { name: /da galeria/i })).toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();

    await escolherFoto(container);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /analisar com ia/i })); });
    expect(api.apiPost).toHaveBeenCalledWith("/api/visagismo/analisar", { imagem_base64: expect.any(String) });
    expect(await screen.findByText("tela de resultado")).toBeInTheDocument();
  });

  it("se o backend recusar por falta de consentimento, descarta a foto e mostra o aviso", async () => {
    api.apiGet.mockResolvedValue(situacao(true));
    api.apiPost.mockRejectedValue(new ApiError("É preciso concordar com o Aviso de Privacidade antes de enviar sua foto.", 403, "CONSENTIMENTO_NECESSARIO"));
    const { container } = renderTela();
    await screen.findByRole("button", { name: /da galeria/i });
    await escolherFoto(container);
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /analisar com ia/i })); });

    expect(screen.getByRole("heading", { name: AVISO_VISAGISMO.titulo })).toBeInTheDocument();
    expect(screen.queryByAltText("Foto selecionada")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox")).not.toBeChecked();
    expect(chamadasPost("/api/visagismo/analisar")).toHaveLength(1);
  });

  it("erro ao verificar a autorizacao permite tentar de novo", async () => {
    api.apiGet.mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(situacao(false));
    renderTela();
    fireEvent.click(await screen.findByRole("button", { name: /tentar novamente/i }));
    await waitFor(() => expect(screen.getByRole("checkbox")).toBeInTheDocument());
  });
});

describe("Aviso de Privacidade completo", () => {
  it("lista finalidades, fornecedores, revogacao e direitos", () => {
    render(<MemoryRouter><AvisoPrivacidade /></MemoryRouter>);
    expect(screen.getByRole("heading", { name: "Aviso de Privacidade" })).toBeInTheDocument();
    for (const t of ["3. Para que usamos", "5. Processamento por inteligência artificial e compartilhamento", "7. Revogação", "8. Seus direitos"]) {
      expect(screen.getByRole("heading", { name: t })).toBeInTheDocument();
    }
    expect(screen.getByText(/Google \(modelos Gemini\)/)).toBeInTheDocument();
    expect(screen.getByText(/Replicate/)).toBeInTheDocument();
  });
});
