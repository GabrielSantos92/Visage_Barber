import { describe, expect, it } from "vitest";
import {
  duracaoTotal, etapasDoAgendamento, pausaAproveitavel, pausaQueContem, servicoAgendavel, validarEtapas,
} from "./etapas";

const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
const as = (h: number, m = 0) => new Date(2030, 0, 9, h, m).toISOString();

describe("validarEtapas", () => {
  it("aceita tempos coerentes", () => {
    expect(validarEtapas({ ativoInicial: 20, pausa: 40, ativoFinal: 30, margem: 5 })).toBeNull();
    expect(validarEtapas({ ativoInicial: 20, pausa: 40, ativoFinal: 30, margem: null })).toBeNull();
  });

  it("exige os três tempos", () => {
    expect(validarEtapas({ ativoInicial: 20, pausa: null, ativoFinal: 30, margem: 0 })).toMatch(/três tempos/);
  });

  it("recusa tempos negativos, zerados, fracionados ou exagerados", () => {
    expect(validarEtapas({ ativoInicial: -5, pausa: 40, ativoFinal: 30, margem: 0 })).toMatch(/entre 1 e 480/);
    expect(validarEtapas({ ativoInicial: 20, pausa: 0, ativoFinal: 30, margem: 0 })).toMatch(/entre 1 e 480/);
    expect(validarEtapas({ ativoInicial: 20, pausa: 40.5, ativoFinal: 30, margem: 0 })).toMatch(/entre 1 e 480/);
    expect(validarEtapas({ ativoInicial: 20, pausa: 500, ativoFinal: 30, margem: 0 })).toMatch(/entre 1 e 480/);
  });

  it("recusa margem negativa ou que consome a pausa inteira", () => {
    expect(validarEtapas({ ativoInicial: 20, pausa: 40, ativoFinal: 30, margem: -1 })).toMatch(/margem/);
    expect(validarEtapas({ ativoInicial: 20, pausa: 10, ativoFinal: 30, margem: 5 })).toMatch(/dobro da margem/);
  });
});

describe("cálculos", () => {
  it("duração total não inclui a margem", () => {
    expect(duracaoTotal(20, 40, 30)).toBe(90);
    expect(pausaAproveitavel(40, 5)).toBe(30);
  });

  it("serviço com pausa sem tempos não é agendável; convencional é", () => {
    expect(servicoAgendavel({ com_pausa: true, pausa_min: null })).toBe(false);
    expect(servicoAgendavel({ com_pausa: true, ativo_inicial_min: 20, pausa_min: 40, ativo_final_min: 30 })).toBe(true);
    expect(servicoAgendavel({ com_pausa: false })).toBe(true);
  });
});

describe("etapasDoAgendamento", () => {
  it("divide a coloração em aplicação, pausa e finalização", () => {
    const etapas = etapasDoAgendamento({ data_hora: as(14), duracao_min: 90, ativo_inicial_min: 20, pausa_min: 40, ativo_final_min: 30 });
    expect(etapas.map((e) => [e.tipo, hhmm(e.inicio), hhmm(e.fim)])).toEqual([
      ["aplicacao", "14:00", "14:20"],
      ["pausa", "14:20", "15:00"],
      ["finalizacao", "15:00", "15:30"],
    ]);
  });

  it("serviço convencional é um bloco só, com a duração gravada ou a do serviço", () => {
    expect(etapasDoAgendamento({ data_hora: as(14), duracao_min: 45 }).map((e) => hhmm(e.fim))).toEqual(["14:45"]);
    expect(etapasDoAgendamento({ data_hora: as(14) }, 30).map((e) => hhmm(e.fim))).toEqual(["14:30"]);
  });

  it("identifica o atendimento feito durante a pausa de outro", () => {
    const coloracao = { id: "c", data_hora: as(14), duracao_min: 90, ativo_inicial_min: 20, pausa_min: 40, ativo_final_min: 30 };
    const corte = { id: "k", data_hora: as(14, 25), duracao_min: 30 };
    const depois = { id: "d", data_hora: as(15, 30), duracao_min: 30 };
    const todos = [coloracao, corte, depois];
    expect(pausaQueContem(corte, todos)?.agendamento.id).toBe("c");
    expect(pausaQueContem(depois, todos)).toBeNull();
    expect(pausaQueContem(corte, [{ ...coloracao, status: "cancelado" }, corte])).toBeNull();
  });
});
