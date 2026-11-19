// Confirmacao de presenca pelo WhatsApp nas telas: a autorizacao no Perfil, a
// situacao no cartao do barbeiro e os textos iguais no site e no app.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
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
import * as appWa from "../../../barber-mobile/src/lib/whatsappAgendamentos";
import { presencaDoAgendamento, type AgendamentoPainel } from "@/lib/painelBarbeiro";
import { ROTULO_PRESENCA, idsComSituacao, whatsappParaAdmin, whatsappParaCliente } from "@/lib/whatsappAgendamentos";

const URL = "/api/privacidade/consentimentos/whatsapp_avisos";
const VERSAO = "2026-11-16";
const situacao = (consentido: boolean, versao_anterior = false) => ({
  finalidade: "whatsapp_avisos", versao_atual: VERSAO, consentido,
  concedido_em: consentido ? "2026-11-16T15:30:00Z" : null, origem: consentido ? "web" : null, versao_anterior,
});
const raiz = resolve(__dirname, "../../..");
const ler = (arquivo: string) => readFileSync(resolve(raiz, arquivo), "utf8");

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
    expect(api.apiPost).toHaveBeenCalledWith(URL, { versao: VERSAO, origem: "web" });
    expect(screen.getByText(/Ativadas em \d\d\/\d\d\/2026/)).toHaveTextContent("responda PARAR");
    expect(screen.getByRole("button", { name: "Desativar mensagens" })).toBeInTheDocument();
    expect(screen.queryByTestId("whatsapp-nova-versao")).not.toBeInTheDocument();
  });

  it("autorizou o aviso anterior: explica a mudança e pede para ativar de novo", async () => {
    api.apiGet.mockResolvedValue(situacao(false, true));
    api.apiPost.mockResolvedValue(situacao(true));
    await renderSecao("11987654321");
    expect(screen.getByTestId("whatsapp-nova-versao")).toHaveTextContent(webPriv.AVISO_WHATSAPP_NOVA_VERSAO);
    expect(screen.getByText(/Desativadas\. Nenhuma mensagem é enviada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("checkbox"));
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Ativar mensagens" })); });
    expect(api.apiPost).toHaveBeenCalledWith(URL, { versao: VERSAO, origem: "web" });
    expect(screen.queryByTestId("whatsapp-nova-versao")).not.toBeInTheDocument();
  });

  it("o texto explica a confirmação dupla e não promete mais que Não não cancela", () => {
    const tudo = JSON.stringify([webPriv.AVISO_WHATSAPP_RESUMO, webPriv.AVISO_WHATSAPP_CONCORDANCIA, webPriv.AVISO_WHATSAPP]);
    expect(tudo).not.toMatch(/Responder Não não cancela/);
    for (const trecho of ["SIM, CANCELAR", "NÃO, MANTER", "segunda confirmação", "Nada é cancelado automaticamente", "nunca cancelam"]) {
      expect(tudo).toContain(trecho);
    }
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
    // "recusada" (fluxo da migration 25): o atendimento continua confirmado e cancelavel pelo barbeiro
    expect(screen.getByText("CONFIRMADO")).toBeInTheDocument();
  });

  it("textos de cada situação; cancelado só mostra o cancelamento pelo WhatsApp; concluído não mostra", () => {
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "confirmada" })).toEqual({ texto: "Presença confirmada pelo WhatsApp", tom: "ok" });
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "sem_resposta" })).toEqual({ texto: "Sem resposta no WhatsApp", tom: "neutro" });
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "recusada" })?.tom).toBe("alerta");
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "cancelamento_pendente" })).toEqual(
      { texto: "Cancelamento pedido pelo WhatsApp · aguardando o cliente confirmar", tom: "alerta" });
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "cancelamento_desistido" })?.texto).toMatch(/desistiu do cancelamento · agendamento mantido/);
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "cancelamento_nao_confirmado" })?.texto).toMatch(/não confirmou · agendamento mantido/);
    expect(presencaDoAgendamento({ status: "cancelado", presenca: "cancelada_whatsapp" })).toEqual(
      { texto: "Cancelado pelo cliente pelo WhatsApp", tom: "alerta" });
    for (const presenca of ["pendente", "nao_enviada", null, undefined] as const) {
      expect(presencaDoAgendamento({ status: "confirmado", presenca })).toBeNull();
    }
    // Pedido pendente nunca aparece como cancelado, nem cancelado como pedido
    expect(presencaDoAgendamento({ status: "confirmado", presenca: "cancelada_whatsapp" })).toBeNull();
    for (const presenca of ["confirmada", "recusada", "cancelamento_pendente"] as const) {
      expect(presencaDoAgendamento({ status: "cancelado", presenca })).toBeNull();
    }
    expect(presencaDoAgendamento({ status: "concluido", presenca: "recusada" })).toBeNull();
  });

  it("cartão: pedido pendente continua CONFIRMADO; cancelado pelo WhatsApp aparece como tal", () => {
    cartao({ ...base, presenca: "cancelamento_pendente" });
    expect(screen.getByTestId("presenca")).toHaveTextContent("aguardando o cliente confirmar");
    expect(screen.getByText("CONFIRMADO")).toBeInTheDocument();
    cleanup();
    cartao({ ...base, status: "cancelado", presenca: "cancelada_whatsapp" });
    expect(screen.getByTestId("presenca")).toHaveTextContent("Cancelado pelo cliente pelo WhatsApp");
    expect(screen.getByText("CANCELADO")).toBeInTheDocument();
  });
});

describe("Cliente e admin: cancelamento pelo WhatsApp", () => {
  it("só confirmados e cancelados são consultados", () => {
    expect(idsComSituacao([
      { id: "a", status: "confirmado" }, { id: "b", status: "cancelado" }, { id: "c", status: "concluido" },
    ])).toEqual(["a", "b"]);
  });

  it("textos do histórico do cliente e do painel do admin", () => {
    expect(whatsappParaCliente({ status: "cancelado", presenca: "cancelada_whatsapp" })).toBe("Cancelado por você pelo WhatsApp");
    expect(whatsappParaCliente({ status: "confirmado", presenca: "cancelamento_pendente" })).toMatch(/até lá, o horário continua reservado/);
    expect(whatsappParaAdmin({ status: "cancelado", presenca: "cancelada_whatsapp" })).toBe("Cancelado pelo cliente via WhatsApp");
    expect(whatsappParaAdmin({ status: "confirmado", presenca: "cancelamento_pendente" })).toBe("Cancelamento pendente no WhatsApp");
    for (const [status, presenca] of [["confirmado", "confirmada"], ["cancelado", "recusada"], ["confirmado", "cancelamento_desistido"], ["cancelado", undefined]] as const) {
      expect(whatsappParaCliente({ status, presenca })).toBeNull();
      expect(whatsappParaAdmin({ status, presenca })).toBeNull();
    }
  });

  it("pedido de cancelamento pelo WhatsApp não concluído: o cliente sabe que nada foi cancelado e como cancelar", () => {
    const futuro = new Date(Date.now() + 3600_000).toISOString();
    const passado = new Date(Date.now() - 3600_000).toISOString();
    const texto = whatsappParaCliente({ status: "confirmado", presenca: "cancelamento_nao_confirmado", data_hora: futuro });
    // Recebido, não efetivado, horário reservado, outro meio para cancelar
    expect(texto).toMatch(/^Seu pedido de cancelamento pelo WhatsApp não foi concluído/);
    expect(texto).toMatch(/o cancelamento NÃO foi feito/);
    expect(texto).toMatch(/o horário continua reservado/);
    expect(texto).toMatch(/use o botão Cancelar ou fale com a barbearia/);
    // Depois do horário (prazo vencido) ou em agendamento já cancelado: nada
    expect(whatsappParaCliente({ status: "confirmado", presenca: "cancelamento_nao_confirmado", data_hora: passado })).toBeNull();
    expect(whatsappParaCliente({ status: "cancelado", presenca: "cancelamento_nao_confirmado", data_hora: futuro })).toBeNull();
    // O mesmo texto no app
    expect(appWa.whatsappParaCliente({ status: "confirmado", presenca: "cancelamento_nao_confirmado", data_hora: futuro })).toBe(texto);
  });
});

describe("WhatsApp: site, app e backend iguais", () => {
  it("mesmo aviso, mesma versão (site, app, backend e banco) e mesma regra de celular", () => {
    expect(appPriv.AVISO_WHATSAPP).toEqual(webPriv.AVISO_WHATSAPP);
    expect(appPriv.AVISO_WHATSAPP_RESUMO).toBe(webPriv.AVISO_WHATSAPP_RESUMO);
    expect(appPriv.AVISO_WHATSAPP_CONCORDANCIA).toBe(webPriv.AVISO_WHATSAPP_CONCORDANCIA);
    expect(appPriv.AVISO_WHATSAPP_NOVA_VERSAO).toBe(webPriv.AVISO_WHATSAPP_NOVA_VERSAO);
    expect([webPriv.VERSAO_AVISO_WHATSAPP, appPriv.VERSAO_AVISO_WHATSAPP]).toEqual([VERSAO, VERSAO]);
    expect(ler("backend/src/services/consentimento.js")).toContain(`whatsapp_avisos: { versaoAviso: '${VERSAO}' }`);
    // O banco so envia para quem autorizou esta versao (migration 26)
    expect(ler("supabase/migrations/20261116000026_whatsapp_cancelamento_confirmado.sql")).toContain(`SELECT '${VERSAO}'::text`);
    // Situacao do WhatsApp: o mesmo codigo no site e no app
    const normalizar = (arquivo: string) => ler(arquivo).replace(/\r\n/g, "\n").replace(/"/g, "'")
      .split("\n").filter((l) => !l.startsWith("import ")).join("\n");
    expect(normalizar("barber-mobile/src/lib/whatsappAgendamentos.ts")).toBe(normalizar("cut-advisor-pro/src/lib/whatsappAgendamentos.ts"));
    expect(appWa.ROTULO_PRESENCA).toEqual(ROTULO_PRESENCA);
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
