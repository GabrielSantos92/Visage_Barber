// Confirmacao de presenca pelo WhatsApp nas telas: a autorizacao no Perfil, a
// situacao no cartao do barbeiro e os textos iguais no site e no app.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
vi.mock("../../../barber-mobile/src/lib/supabase", () => ({ supabase: {} }));
vi.mock("../../../barber-mobile/src/lib/api", () => ({ api: {} }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import WhatsappPerfil from "@/components/WhatsappPerfil";
import CartaoAgendamento from "@/components/barbeiro/CartaoAgendamento";
import * as webPriv from "@/lib/privacidade";
import * as appPriv from "../../../barber-mobile/src/lib/privacidade";
import { presencaDoAgendamento, type AgendamentoPainel } from "@/lib/painelBarbeiro";

const URL = "/api/privacidade/consentimentos/whatsapp_avisos";
const situacao = (consentido: boolean) => ({
  finalidade: "whatsapp_avisos", versao_atual: "2026-11-13", consentido,
  concedido_em: consentido ? "2026-11-13T15:30:00Z" : null, origem: consentido ? "web" : null,
});

beforeEach(() => {
  api.apiGet.mockReset();
  api.apiPost.mockReset();
  toast.success.mockClear();
  toast.error.mockClear();
});

async function renderSecao(telefone: string | null) {
  render(<MemoryRouter><WhatsappPerfil telefone={telefone} /></MemoryRouter>);
  await act(async () => {});
}

describe("Perfil - mensagens pelo WhatsApp", () => {
  it("desativado e com celular: só ativa depois de marcar a concordância", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    api.apiPost.mockResolvedValue(situacao(true));
    await renderSecao("11987654321");
    expect(api.apiGet).toHaveBeenCalledWith(URL);
    expect(screen.getByText(/Desativadas\. Nenhuma mensagem é enviada/)).toBeInTheDocument();
    const ativar = screen.getByRole("button", { name: "Ativar mensagens" });
    expect(ativar).toBeDisabled();
    fireEvent.click(ativar);
    expect(api.apiPost).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(ativar); });
    expect(api.apiPost).toHaveBeenCalledWith(URL, { versao: "2026-11-13", origem: "web" });
    expect(screen.getByText(/Ativadas em \d\d\/\d\d\/2026/)).toHaveTextContent("responda PARAR");
    expect(screen.getByRole("button", { name: "Desativar mensagens" })).toBeInTheDocument();
  });

  it("sem celular válido no cadastro não oferece ativar", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    for (const telefone of [null, "", "1133334444", "119876"]) {
      await renderSecao(telefone);
    }
    expect(screen.queryByRole("button", { name: "Ativar mensagens" })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(screen.getAllByText(/salve antes um celular com DDD/)).toHaveLength(4);
  });

  it("ativado: desativar revoga a autorização", async () => {
    api.apiGet.mockResolvedValue(situacao(true));
    api.apiPost.mockResolvedValue(situacao(false));
    await renderSecao("(11) 98765-4321");
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Desativar mensagens" })); });
    expect(api.apiPost).toHaveBeenCalledWith(`${URL}/revogar`, { origem: "web" });
    expect(screen.getByText(/Desativadas/)).toBeInTheDocument();
  });

  it("falha ao ativar: avisa e continua desativado", async () => {
    api.apiGet.mockResolvedValue(situacao(false));
    api.apiPost.mockRejectedValue(new Error("rede"));
    await renderSecao("11987654321");
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ativar mensagens" })); });
    expect(toast.error).toHaveBeenCalled();
    expect(screen.getByText(/Desativadas/)).toBeInTheDocument();
  });
});

describe("Agenda do barbeiro - situação da presença", () => {
  const base: AgendamentoPainel = {
    id: "a1", data_hora: new Date(Date.now() + 3600000).toISOString(), status: "confirmado", cliente_id: "c1", preco: 50,
    duracao_min: 30, ativo_inicial_min: null, pausa_min: null, ativo_final_min: null,
    profiles: { nome: "Ana", telefone: "11987654321" }, servicos: { nome: "Corte", preco: 50, duracao_min: 30 },
  };
  const cartao = (a: AgendamentoPainel) => render(<CartaoAgendamento agendamento={a} todos={[a]} onAcao={() => {}} onChat={() => {}} />);

  it("mostra a resposta do cliente; sem pedido, não mostra nada", () => {
    cartao({ ...base, presenca: "recusada" });
    expect(screen.getByTestId("presenca")).toHaveTextContent("Cliente avisou que não virá");
    // Responder nao nao cancela: o atendimento continua confirmado e cancelavel pelo barbeiro
    expect(screen.getByText("CONFIRMADO")).toBeInTheDocument();
  });

  it("textos de cada situação; cancelado e concluído não mostram", () => {
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "confirmada" })).toEqual({ texto: "Presença confirmada pelo WhatsApp", tom: "ok" });
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "sem_resposta" })).toEqual({ texto: "Sem resposta no WhatsApp", tom: "neutro" });
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "recusada" })?.tom).toBe("alerta");
    for (const presenca of ["pendente", "nao_enviada", null, undefined] as const) {
      expect(presencaDoAgendamento({ status: "confirmado", presenca })).toBeNull();
    }
    expect(presencaDoAgendamento({ status: "cancelado", presenca: "confirmada" })).toBeNull();
    expect(presencaDoAgendamento({ status: "concluido", presenca: "recusada" })).toBeNull();
  });
});

describe("WhatsApp: site, app e backend iguais", () => {
  it("mesmo aviso, mesma versão e mesma regra de celular", () => {
    expect(appPriv.AVISO_WHATSAPP).toEqual(webPriv.AVISO_WHATSAPP);
    expect(appPriv.AVISO_WHATSAPP_RESUMO).toBe(webPriv.AVISO_WHATSAPP_RESUMO);
    expect(appPriv.AVISO_WHATSAPP_CONCORDANCIA).toBe(webPriv.AVISO_WHATSAPP_CONCORDANCIA);
    expect([webPriv.VERSAO_AVISO_WHATSAPP, appPriv.VERSAO_AVISO_WHATSAPP]).toEqual(["2026-11-13", "2026-11-13"]);
    const backend = readFileSync(resolve(__dirname, "../../../backend/src/services/consentimento.js"), "utf8");
    expect(backend).toContain(`whatsapp_avisos: { versaoAviso: '${webPriv.VERSAO_AVISO_WHATSAPP}' }`);
    for (const [telefone, ok] of [
      ["11987654321", true], ["(11) 98765-4321", true], ["5511987654321", true], ["011987654321", true],
      ["1133334444", false], ["11887654321", false], ["", false], [null, false],
    ] as const) {
      expect(webPriv.celularParaWhatsapp(telefone)).toBe(ok);
      expect(appPriv.celularParaWhatsapp(telefone)).toBe(ok);
    }
    // O aviso do visagismo nao mudou (a concordancia ja dada continua valendo)
    expect(webPriv.VERSAO_AVISO_VISAGISMO).toBe("2026-11-04");
  });
});
