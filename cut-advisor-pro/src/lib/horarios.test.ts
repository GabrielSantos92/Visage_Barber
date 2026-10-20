import { describe, it, expect } from "vitest";
import {
  MSG_CONFLITO_BARBEIRO, MSG_CONFLITO_CLIENTE, calcularHorarios, interpretarErroAgendamento, sobrepoe,
} from "./horarios";

const DIA = new Date(2026, 9, 16); // 16/10/2026, hora local
const ANTES = new Date(2026, 9, 15, 12, 0);
const em = (h: number, m = 0) => new Date(2026, 9, 16, h, m).getTime();
const ocupado = (h1: number, m1: number, h2: number, m2: number) => ({ inicio: em(h1, m1), fim: em(h2, m2) });
const EXPEDIENTE = [{ hora_inicio: "13:00:00", hora_fim: "16:00:00" }];

describe("sobrepoe (existente 14:00-14:30)", () => {
  const existente = ocupado(14, 0, 14, 30);
  it.each([
    ["13:30-14:00", ocupado(13, 30, 14, 0), false],
    ["14:00-14:30", ocupado(14, 0, 14, 30), true],
    ["14:15-14:45", ocupado(14, 15, 14, 45), true],
    ["14:25-14:55", ocupado(14, 25, 14, 55), true],
    ["14:30-15:00", ocupado(14, 30, 15, 0), false],
    ["14:45-15:15", ocupado(14, 45, 15, 15), false],
  ])("%s", (_nome, novo, esperado) => {
    expect(sobrepoe(novo, existente)).toBe(esperado);
  });
});

describe("calcularHorarios", () => {
  it("oferece o expediente inteiro quando nao ha reservas", () => {
    expect(calcularHorarios({ periodos: EXPEDIENTE, ocupados: [], duracaoMin: 30, data: DIA, agora: ANTES }))
      .toEqual(["13:00", "13:30", "14:00", "14:30", "15:00", "15:30"]);
  });

  it("remove o horario reservado e mantem os consecutivos", () => {
    const slots = calcularHorarios({ periodos: EXPEDIENTE, ocupados: [ocupado(14, 0, 14, 30)], duracaoMin: 30, data: DIA, agora: ANTES });
    expect(slots).toEqual(["13:00", "13:30", "14:30", "15:00", "15:30"]);
  });

  it("uma reserva longa bloqueia todo o intervalo dela", () => {
    const slots = calcularHorarios({ periodos: EXPEDIENTE, ocupados: [ocupado(14, 0, 15, 0)], duracaoMin: 30, data: DIA, agora: ANTES });
    expect(slots).toEqual(["13:00", "13:30", "15:00", "15:30"]);
  });

  it("um servico longo nao e oferecido se invadir uma reserva ou o fim do expediente", () => {
    const slots = calcularHorarios({ periodos: EXPEDIENTE, ocupados: [ocupado(14, 0, 14, 30)], duracaoMin: 60, data: DIA, agora: ANTES });
    // 13:30 invadiria 14:00; 15:30 passaria das 16:00
    expect(slots).toEqual(["13:00", "14:30", "15:00"]);
  });

  it("reserva que comeca fora da grade de 30 min tambem bloqueia", () => {
    const slots = calcularHorarios({ periodos: EXPEDIENTE, ocupados: [ocupado(14, 15, 14, 45)], duracaoMin: 30, data: DIA, agora: ANTES });
    expect(slots).toEqual(["13:00", "13:30", "15:00", "15:30"]);
  });

  it("respeita a pausa de almoco e ordena os periodos", () => {
    const periodos = [
      { hora_inicio: "13:00:00", hora_fim: "14:00:00" },
      { hora_inicio: "09:00:00", hora_fim: "10:00:00" },
    ];
    expect(calcularHorarios({ periodos, ocupados: [], duracaoMin: 30, data: DIA, agora: ANTES }))
      .toEqual(["09:00", "09:30", "13:00", "13:30"]);
  });

  it("nao oferece horarios que ja passaram", () => {
    const agora = new Date(2026, 9, 16, 14, 10);
    expect(calcularHorarios({ periodos: EXPEDIENTE, ocupados: [], duracaoMin: 30, data: DIA, agora }))
      .toEqual(["14:30", "15:00", "15:30"]);
  });
});

describe("interpretarErroAgendamento", () => {
  it("serviço com pausa sem tempos configurados mostra a mensagem do banco", () => {
    const msg = "Este serviço ainda não tem os tempos de atendimento configurados.";
    expect(interpretarErroAgendamento({ code: "PT400", details: "SERVICO_SEM_ETAPAS", message: msg }))
      .toEqual({ mensagem: msg, horarioIndisponivel: false });
  });

  it("conflito com o barbeiro", () => {
    expect(interpretarErroAgendamento({ code: "PT409", details: "CONFLITO_BARBEIRO", message: "x" }))
      .toEqual({ mensagem: MSG_CONFLITO_BARBEIRO, horarioIndisponivel: true });
  });

  it("conflito com outro agendamento do cliente", () => {
    expect(interpretarErroAgendamento({ code: "PT409", details: "CONFLITO_CLIENTE", message: "x" }))
      .toEqual({ mensagem: MSG_CONFLITO_CLIENTE, horarioIndisponivel: true });
  });

  it("indice unico antigo conta como conflito com o barbeiro", () => {
    expect(interpretarErroAgendamento({ code: "23505", message: "duplicate key value" }).mensagem).toBe(MSG_CONFLITO_BARBEIRO);
  });

  it("nao mostra erro tecnico ao cliente", () => {
    const r = interpretarErroAgendamento({ code: "42501", message: "new row violates row-level security policy" });
    expect(r).toEqual({ mensagem: "Não foi possível concluir o agendamento. Tente novamente.", horarioIndisponivel: false });
  });
});
