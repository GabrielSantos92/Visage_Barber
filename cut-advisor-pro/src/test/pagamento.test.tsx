// Pagina de pagamento do cliente (web). A cobranca e criada e confirmada pelo
// backend; aqui se confere o que a tela envia (nunca o valor), o que mostra em
// cada estado e que so considera pago o que o backend devolveu como pago.
import { act, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const AG = "a0000000-0000-4000-8000-000000000001";
const agora = Date.now();
const base = {
  id: "p1", agendamento_id: AG, valor_original: 50, desconto: 0, valor: 50, valor_reembolsado: 0,
  pix_copia_cola: null, pix_qr_base64: null, link_pagamento: null, expira_em: null, aprovado_em: null,
  criado_em: new Date(agora).toISOString(),
};

const estado = vi.hoisted(() => ({ pagamentos: [] as unknown[] }));
const api = vi.hoisted(() => ({ apiPost: vi.fn() }));

function consulta(tabela: string) {
  const b: Record<string, unknown> = {};
  Object.assign(b, {
    select: () => b, eq: () => b, in: () => b, order: () => b,
    maybeSingle: async () => ({
      data: { id: AG, data_hora: "2026-11-20T17:00:00.000Z", status: "confirmado", preco: 50, servicos: { nome: "Corte premium", preco: 50 }, barbeiros: { nome: "João" } },
      error: null,
    }),
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ data: tabela === "pagamentos" ? estado.pagamentos : [], error: null }).then(ok),
  });
  return b;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: (t: string) => consulta(t) } }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), apiPost: api.apiPost }));
vi.mock("@/components/Navbar", () => ({ default: () => null }));

import Pagamento from "@/pages/Pagamento";

async function abrir(url = `/pagamento/${AG}`) {
  render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/pagamento/:agendamentoId" element={<Pagamento />} />
        <Route path="/meus-agendamentos" element={<p>lista</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await screen.findByText("Corte premium");
}

beforeEach(() => {
  estado.pagamentos = [];
  api.apiPost.mockReset();
});
afterEach(() => vi.unstubAllGlobals());

describe("Pagamento do cliente (web)", () => {
  it("sem pagamento: mostra o resumo e as três formas; o PIX é pedido sem enviar valor", async () => {
    api.apiPost.mockResolvedValue({ ...base, metodo: "pix", status: "pending", pix_copia_cola: "00020126PIX", pix_qr_base64: "iVBOR", expira_em: new Date(agora + 1800e3).toISOString() });
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) };
    vi.stubGlobal("navigator", { ...navigator, clipboard });
    await abrir();

    expect(screen.getByText("R$ 50,00")).toBeInTheDocument();
    for (const t of ["PIX", "Cartão de crédito", "Na barbearia"]) expect(screen.getByRole("radio", { name: new RegExp(t) })).toBeInTheDocument();

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /gerar pix/i })); });
    expect(api.apiPost).toHaveBeenCalledWith("/api/pagamentos", { agendamento_id: AG, metodo: "pix" });
    expect(screen.getByAltText("QR Code do PIX")).toHaveAttribute("src", "data:image/png;base64,iVBOR");
    expect(screen.getByLabelText("PIX copia e cola")).toHaveValue("00020126PIX");
    expect(screen.getByRole("status")).toHaveTextContent("Aguardando o PIX");

    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /copiar código/i })); });
    expect(clipboard.writeText).toHaveBeenCalledWith("00020126PIX");
    expect(screen.getByRole("button", { name: /código copiado/i })).toBeInTheDocument();
  });

  it("antes de escolher, informa o que vai para o Mercado Pago e leva ao Aviso de Privacidade", async () => {
    await abrir();
    expect(screen.getByText(/enviamos ao Mercado Pago o seu e-mail, o serviço e o valor/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Aviso de Privacidade" })).toHaveAttribute("href", "/privacidade#pagamentos");
  });

  it("cartão: vai para a página segura do Mercado Pago", async () => {
    const assign = vi.fn();
    vi.stubGlobal("location", { ...window.location, assign });
    api.apiPost.mockResolvedValue({ ...base, metodo: "cartao", status: "pending", link_pagamento: "https://mp.test/checkout?pref=1", expira_em: new Date(agora + 3600e3).toISOString() });
    await abrir();
    fireEvent.click(screen.getByRole("radio", { name: /cartão de crédito/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /pagar com cartão/i })); });
    expect(api.apiPost).toHaveBeenCalledWith("/api/pagamentos", { agendamento_id: AG, metodo: "cartao" });
    expect(assign).toHaveBeenCalledWith("https://mp.test/checkout?pref=1");
  });

  it("presencial: registra a escolha e explica que paga na barbearia", async () => {
    api.apiPost.mockResolvedValue({ ...base, metodo: "presencial", status: "pending" });
    await abrir();
    fireEvent.click(screen.getByRole("radio", { name: /na barbearia/i }));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /confirmar pagamento na barbearia/i })); });
    expect(screen.getByRole("status")).toHaveTextContent("Pagamento na barbearia");
    expect(screen.getByRole("button", { name: /prefiro pagar agora/i })).toBeInTheDocument();
  });

  it("só mostra aprovado depois que o backend confirma ('Já paguei' consulta o provedor)", async () => {
    estado.pagamentos = [{ ...base, metodo: "pix", status: "pending", pix_copia_cola: "000201", expira_em: new Date(agora + 1800e3).toISOString() }];
    api.apiPost.mockResolvedValueOnce({ ...base, metodo: "pix", status: "pending", expira_em: new Date(agora + 1800e3).toISOString() });
    await abrir();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /já paguei/i })); });
    expect(api.apiPost).toHaveBeenCalledWith("/api/pagamentos/p1/sincronizar", {});
    expect(screen.getByRole("status")).toHaveTextContent("Aguardando o PIX");

    api.apiPost.mockResolvedValueOnce({ ...base, metodo: "pix", status: "approved", aprovado_em: new Date().toISOString() });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /já paguei/i })); });
    expect(screen.getByRole("status")).toHaveTextContent("Pagamento aprovado");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("recusado ou PIX vencido: explica e oferece pagar de novo", async () => {
    estado.pagamentos = [{ ...base, metodo: "cartao", status: "rejected" }];
    await abrir();
    expect(screen.getByRole("status")).toHaveTextContent("Pagamento recusado");
    expect(screen.getAllByRole("radio")).toHaveLength(3);
  });

  it("PIX com prazo vencido aparece como expirado mesmo antes do aviso do provedor", async () => {
    estado.pagamentos = [{ ...base, metodo: "pix", status: "pending", pix_copia_cola: "000201", expira_em: new Date(agora - 60e3).toISOString() }];
    await abrir();
    expect(screen.getByRole("status")).toHaveTextContent("PIX expirado");
    expect(screen.queryByAltText("QR Code do PIX")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /gerar pix/i })).toBeInTheDocument();
  });

  it("erro do backend aparece para o cliente", async () => {
    api.apiPost.mockRejectedValue(new Error("O pagamento online ainda não está disponível. Escolha pagar na barbearia."));
    await abrir();
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /gerar pix/i })); });
    expect(screen.getByRole("alert")).toHaveTextContent("O pagamento online ainda não está disponível");
  });
});
