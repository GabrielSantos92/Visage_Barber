import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VisagismoResultado from "@/pages/VisagismoResultado";
import {
  INTERVALO_MENSAGEM_MS, MENSAGENS_ESPERA, MENSAGENS_ESPERA_LONGA, mensagemDoPasso,
} from "@/hooks/use-mensagens-espera";

vi.mock("@/components/Navbar", () => ({ default: () => null }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok-cliente" } } }) } },
}));

const resultado = {
  formato_rosto: "oval",
  tracos: "Traços equilibrados",
  corte_principal: { nome: "Taper Fade", descricao: "desc", caracteristicas: ["a", "b"] },
};

type Pendente = { resolve: (r: Response) => void; reject: (e: unknown) => void; signal: AbortSignal };
let pendentes: Pendente[];
let fetchMock: ReturnType<typeof vi.fn>;

async function renderTela() {
  const r = render(
    <MemoryRouter initialEntries={[{ pathname: "/visagismo/resultado", state: { resultado, fotoUrl: "blob:original", fotoBase64: "abc" } }]}>
      <Routes>
        <Route path="/visagismo/resultado" element={<VisagismoResultado />} />
        <Route path="/visagismo" element={<p>tela visagismo</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {});
  return r;
}

const respostaOk = () => new Response(JSON.stringify({ contentType: "image/png", base64: "Z2VyYWRh" }), { status: 200 });

beforeEach(() => {
  vi.useFakeTimers();
  pendentes = [];
  fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init.signal as AbortSignal;
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
    pendentes.push({ resolve, reject, signal });
  }));
  vi.stubGlobal("fetch", fetchMock);
  Element.prototype.setPointerCapture = () => {};
  // O jsdom nao implementa PointerEvent; sem ele pointerId/pointerType se perdem.
  if (!("PointerEvent" in window) || !new window.PointerEvent("pointerdown", { pointerId: 1 }).pointerId) {
    class PointerEventFake extends MouseEvent {
      pointerId: number; pointerType: string;
      constructor(type: string, init: PointerEventInit = {}) {
        super(type, init);
        this.pointerId = init.pointerId ?? 0;
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    vi.stubGlobal("PointerEvent", PointerEventFake);
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("mensagens de espera", () => {
  it("segue a sequencia e depois alterna as frases neutras", async () => {
    expect(mensagemDoPasso(0)).toBe(MENSAGENS_ESPERA[0]);
    expect(mensagemDoPasso(MENSAGENS_ESPERA.length - 1)).toBe("Quase pronto...");
    expect(mensagemDoPasso(MENSAGENS_ESPERA.length)).toBe(MENSAGENS_ESPERA_LONGA[0]);
    expect(mensagemDoPasso(MENSAGENS_ESPERA.length + MENSAGENS_ESPERA_LONGA.length)).toBe(MENSAGENS_ESPERA_LONGA[0]);
  });
});

describe("VisagismoResultado", () => {
  it("troca as mensagens durante a geracao e mostra a imagem ao concluir", async () => {
    await renderTela();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent(MENSAGENS_ESPERA[0]);

    act(() => { vi.advanceTimersByTime(INTERVALO_MENSAGEM_MS); });
    expect(screen.getByRole("status")).toHaveTextContent(MENSAGENS_ESPERA[1]);
    act(() => { vi.advanceTimersByTime(INTERVALO_MENSAGEM_MS * 20); });
    expect(screen.getByRole("status")).toBeInTheDocument();
    // Esperas longas nao reabrem a requisicao
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => { pendentes[0].resolve(respostaOk()); });
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByAltText("Corte ideal")).toHaveAttribute("src", "data:image/png;base64,Z2VyYWRh");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("mostra erro compreensivel e a nova tentativa faz uma unica chamada", async () => {
    await renderTela();
    await act(async () => { pendentes[0].resolve(new Response("{}", { status: 502 })); });
    expect(screen.getByRole("alert")).toHaveTextContent("Não foi possível gerar a imagem agora.");
    expect(vi.getTimerCount()).toBe(0);

    const tentar = screen.getByRole("button", { name: /tentar novamente/i });
    fireEvent.click(tentar);
    await act(async () => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("status")).toHaveTextContent(MENSAGENS_ESPERA[0]);

    await act(async () => { pendentes[1].resolve(respostaOk()); });
    expect(screen.getByAltText("Corte ideal")).toBeInTheDocument();
  });

  it("cancela a requisicao e mostra erro de tempo esgotado", async () => {
    await renderTela();
    await act(async () => { vi.advanceTimersByTime(360000); });
    expect(pendentes[0].signal.aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("demorou mais que o esperado");
  });

  it("cancela a requisicao e limpa os temporizadores ao sair da tela", async () => {
    const { unmount } = await renderTela();
    unmount();
    expect(pendentes[0].signal.aborted).toBe(true);
    await act(async () => {});
    expect(vi.getTimerCount()).toBe(0);
  });

  it("amplia a foto original enquanto a IA ainda gera, e fecha com Escape", async () => {
    await renderTela();
    // Imagem gerada ainda indisponivel: nao ha como abrir o visualizador dela
    expect(screen.queryByRole("button", { name: /ampliar foto com o corte ideal/i })).not.toBeInTheDocument();

    const abrir = screen.getByRole("button", { name: "Ampliar sua foto" });
    fireEvent.click(abrir);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("SUA FOTO");
    expect(screen.getByRole("button", { name: /fechar/i })).toHaveFocus();
    expect(screen.getAllByAltText("Sua foto").at(-1)).toHaveAttribute("src", "blob:original");

    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // A geracao continua em andamento
    expect(screen.getByRole("status")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("amplia a imagem gerada com botoes, teclado, roda e pinca", async () => {
    await renderTela();
    await act(async () => { pendentes[0].resolve(respostaOk()); });
    fireEvent.click(screen.getByRole("button", { name: /ampliar foto com o corte ideal/i }));
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent("COM O CORTE IDEAL");
    expect(dialog).toHaveTextContent("100%");

    fireEvent.click(screen.getByRole("button", { name: "Ampliar zoom" }));
    expect(dialog).toHaveTextContent("150%");
    fireEvent.keyDown(dialog, { key: "+" });
    expect(dialog).toHaveTextContent("225%");
    fireEvent.keyDown(dialog, { key: "-" });
    expect(dialog).toHaveTextContent("150%");
    fireEvent.click(screen.getByRole("button", { name: "Restaurar tamanho" }));
    expect(dialog).toHaveTextContent("100%");

    const area = screen.getByTestId("area-zoom");
    fireEvent.wheel(area, { deltaY: -500, clientX: 0, clientY: 0 });
    expect(dialog).toHaveTextContent("212%");
    fireEvent.keyDown(dialog, { key: "0" });
    expect(dialog).toHaveTextContent("100%");

    // Pinca: dois dedos se afastando de 100px para 200px dobram a escala
    fireEvent.pointerDown(area, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 });
    fireEvent.pointerDown(area, { pointerId: 2, pointerType: "touch", clientX: 200, clientY: 100 });
    fireEvent.pointerMove(area, { pointerId: 2, pointerType: "touch", clientX: 300, clientY: 100 });
    expect(dialog).toHaveTextContent("200%");
    fireEvent.pointerUp(area, { pointerId: 2, pointerType: "touch", clientX: 300, clientY: 100 });
    fireEvent.pointerUp(area, { pointerId: 1, pointerType: "touch", clientX: 100, clientY: 100 });
    // Soltar a pinca nao fecha o visualizador
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /fechar/i }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("envia o token da sessao e mostra o motivo quando o uso da foto nao esta autorizado", async () => {
    await renderTela();
    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer tok-cliente" });

    await act(async () => {
      pendentes[0].resolve(new Response(JSON.stringify({ error: "É preciso concordar com o Aviso de Privacidade antes de enviar sua foto.", code: "CONSENTIMENTO_NECESSARIO" }), { status: 403 }));
    });
    expect(screen.getByRole("alert")).toHaveTextContent("É preciso concordar com o Aviso de Privacidade");
    expect(vi.getTimerCount()).toBe(0);
  });
});
