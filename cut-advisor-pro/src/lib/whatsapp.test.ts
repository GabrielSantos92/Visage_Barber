import { describe, it, expect } from "vitest";
import { linkWhatsAppAgendamento, normalizarTelefoneBR } from "./whatsapp";

describe("normalizarTelefoneBR", () => {
  it("remove a mascara e adiciona o 55", () => {
    expect(normalizarTelefoneBR("(24) 99999-9999")).toBe("5524999999999");
    expect(normalizarTelefoneBR("024 3333-4444")).toBe("552433334444");
  });

  it("mantem o numero que ja tem o codigo do pais", () => {
    expect(normalizarTelefoneBR("+55 24 99999-9999")).toBe("5524999999999");
  });

  it("trata DDD 55 como numero local", () => {
    expect(normalizarTelefoneBR("(55) 99999-9999")).toBe("5555999999999");
  });

  it("rejeita vazio e numero sem DDD", () => {
    expect(normalizarTelefoneBR("")).toBeNull();
    expect(normalizarTelefoneBR(null)).toBeNull();
    expect(normalizarTelefoneBR("9999-9999")).toBeNull();
  });
});

describe("linkWhatsAppAgendamento", () => {
  it("monta o link com a mensagem do agendamento codificada", () => {
    const link = linkWhatsAppAgendamento({
      telefone: "(24) 99999-9999",
      barbeiroNome: "João Silva",
      servicoNome: "Barba Completa",
      dataHora: "2026-10-16T09:00:00",
    });
    expect(link).toBe(
      "https://wa.me/5524999999999?text=" +
        encodeURIComponent("Olá, João! Gostaria de conversar sobre meu agendamento de Barba Completa no dia 16/10/2026 às 09:00."),
    );
  });

  it("nao gera link sem telefone valido", () => {
    expect(linkWhatsAppAgendamento({ telefone: "", dataHora: "2026-10-16T09:00:00" })).toBeNull();
  });
});
