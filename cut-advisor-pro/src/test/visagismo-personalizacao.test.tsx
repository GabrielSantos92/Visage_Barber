// Visagismo personalizado na pagina de foto: as escolhas aparecem depois da
// foto, vao para a analise so quando feitas e bloqueiam o envio sem mudanca.
import { act, fireEvent, render, screen, within } from "@testing-library/react";
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

const URL_CONSENT = "/api/privacidade/consentimentos/visagismo_foto";
const URL_ANALISE = "/api/visagismo/analisar";

function renderTela() {
  return render(
    <MemoryRouter initialEntries={["/visagismo"]}>
      <Routes>
        <Route path="/visagismo" element={<Visagismo />} />
        <Route path="/visagismo/resultado" element={<p>tela de resultado</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Concorda com o aviso e escolhe uma foto
async function prepararFoto() {
  const { container } = renderTela();
  fireEvent.click(await screen.findByRole("checkbox"));
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: /concordar e continuar/i })); });
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "rosto.jpg", { type: "image/jpeg" })] } });
  await screen.findByAltText("Foto selecionada");
}

const grupo = (nome: string) => within(screen.getByRole("group", { name: nome }));
const escolher = (nomeGrupo: string, opcao: string) => fireEvent.click(grupo(nomeGrupo).getByRole("radio", { name: opcao }));
const botaoAnalisar = () => screen.getByRole("button", { name: /analisar com ia/i });
const corpoDaAnalise = () => api.apiPost.mock.calls.find(([url]) => url === URL_ANALISE)?.[1];

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  api.apiPost.mockImplementation((url: string) => Promise.resolve(
    url === URL_CONSENT
      ? { finalidade: "visagismo_foto", consentido: true }
      : { formato_rosto: "oval", aplicavel: true },
  ));
});

describe("Visagismo personalizado", () => {
  it("as opcoes so aparecem depois da foto e comecam no padrao", async () => {
    renderTela();
    fireEvent.click(await screen.findByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /concordar e continuar/i })); });
    expect(screen.queryByRole("heading", { name: /personalizar/i })).not.toBeInTheDocument();
  });

  it("padrao: A IA decide o estilo e a barba, cor natural; a analise vai como antes", async () => {
    await prepararFoto();
    expect(screen.getByRole("heading", { name: /personalizar \(opcional\)/i })).toBeInTheDocument();
    expect(grupo("Estilo do corte").getByRole("radio", { name: "A IA decide" })).toBeChecked();
    expect(grupo("Barba").getByRole("radio", { name: "A IA decide" })).toBeChecked();
    expect(grupo("Cor do cabelo").getByRole("radio", { name: "Natural" })).toBeChecked();

    await act(async () => { fireEvent.click(botaoAnalisar()); });
    expect(corpoDaAnalise()).toEqual({ imagem_base64: expect.any(String) });
  });

  it("envia o estilo, a barba e a cor escolhidos", async () => {
    await prepararFoto();
    escolher("Estilo do corte", "Formal");
    escolher("Barba", "Sem barba");
    escolher("Cor do cabelo", "Loiro");
    expect(grupo("Estilo do corte").getByRole("radio", { name: "Formal" })).toBeChecked();
    expect(grupo("Estilo do corte").getByRole("radio", { name: "A IA decide" })).not.toBeChecked();

    await act(async () => { fireEvent.click(botaoAnalisar()); });
    expect(corpoDaAnalise()).toEqual({
      imagem_base64: expect.any(String),
      preferencias: { estilo: "formal", barba: "sem", cor_cabelo: "loiro" },
    });
    expect(await screen.findByText("tela de resultado")).toBeInTheDocument();
  });

  it("voltar uma opcao para o padrao tira ela do pedido", async () => {
    await prepararFoto();
    escolher("Estilo do corte", "Descolado");
    escolher("Cor do cabelo", "Platinado");
    escolher("Cor do cabelo", "Natural");

    await act(async () => { fireEvent.click(botaoAnalisar()); });
    expect(corpoDaAnalise()).toEqual({ imagem_base64: expect.any(String), preferencias: { estilo: "descolado" } });
  });

  it("manter corte e barba sem mudar a cor bloqueia o envio ate escolher uma mudanca", async () => {
    await prepararFoto();
    escolher("Estilo do corte", "Manter meu corte");
    escolher("Barba", "Manter a atual");
    expect(screen.getByRole("alert")).toHaveTextContent("mude ao menos o corte, a barba ou a cor do cabelo");
    expect(botaoAnalisar()).toBeDisabled();
    fireEvent.click(botaoAnalisar());
    expect(corpoDaAnalise()).toBeUndefined();

    escolher("Cor do cabelo", "Luzes");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(botaoAnalisar()).toBeEnabled();
    await act(async () => { fireEvent.click(botaoAnalisar()); });
    expect(corpoDaAnalise()).toEqual({
      imagem_base64: expect.any(String),
      preferencias: { estilo: "manter", barba: "manter", cor_cabelo: "luzes" },
    });
  });

  it("as opcoes de cada grupo sao radios exclusivos, navegaveis pelo teclado", async () => {
    await prepararFoto();
    const radios = grupo("Cor do cabelo").getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("name"))).toEqual(Array(radios.length).fill("personalizar-cor_cabelo"));
    expect(radios.map((r) => r.closest("label")?.textContent)).toEqual(
      ["Natural", "Loiro", "Platinado", "Castanho", "Preto", "Ruivo", "Luzes"],
    );
  });
});
