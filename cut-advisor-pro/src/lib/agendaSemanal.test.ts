import { describe, it, expect } from "vitest";
import { agendaParaHorarios, defaultAgenda, horariosParaAgenda, validarAgenda } from "./agendaSemanal";

describe("agendaSemanal", () => {
  it("usa a agenda padrao (seg a sab) quando nao ha horarios salvos", () => {
    const agenda = horariosParaAgenda([]);
    expect(agenda.map((d) => d.ativo)).toEqual([false, true, true, true, true, true, true]);
    expect(agenda[1].inicio).toBe("09:00");
    expect(agenda[1].fim).toBe("18:00");
  });

  it("le um periodo unico e corta os segundos", () => {
    const agenda = horariosParaAgenda([{ dia_semana: 0, hora_inicio: "10:00:00", hora_fim: "14:30:00" }]);
    expect(agenda[0]).toMatchObject({ ativo: true, inicio: "10:00", fim: "14:30", almoco: false });
  });

  it("le dois periodos como pausa de almoco, em qualquer ordem", () => {
    const agenda = horariosParaAgenda([
      { dia_semana: 2, hora_inicio: "13:00:00", hora_fim: "18:00:00" },
      { dia_semana: 2, hora_inicio: "08:00:00", hora_fim: "12:00:00" },
    ]);
    expect(agenda[2]).toMatchObject({
      ativo: true, inicio: "08:00", almocoInicio: "12:00", almocoFim: "13:00", fim: "18:00", almoco: true,
    });
  });

  it("gera uma linha por dia ativo e duas quando ha almoco", () => {
    const agenda = defaultAgenda().map((d) => ({ ...d, ativo: false }));
    agenda[1] = { ...agenda[1], ativo: true };
    agenda[3] = { ...agenda[3], ativo: true, almoco: true };
    expect(agendaParaHorarios("b1", agenda)).toEqual([
      { barbeiro_id: "b1", dia_semana: 1, hora_inicio: "09:00", hora_fim: "18:00" },
      { barbeiro_id: "b1", dia_semana: 3, hora_inicio: "09:00", hora_fim: "12:00" },
      { barbeiro_id: "b1", dia_semana: 3, hora_inicio: "13:00", hora_fim: "18:00" },
    ]);
  });

  it("salvar e reabrir devolve a mesma agenda", () => {
    const agenda = defaultAgenda();
    agenda[5] = { ...agenda[5], almoco: true, almocoInicio: "11:30", almocoFim: "12:30" };
    expect(horariosParaAgenda(agendaParaHorarios("b1", agenda))).toEqual(agenda);
  });

  it("valida inicio, fim e pausa de almoco", () => {
    const base = defaultAgenda();
    expect(validarAgenda(base)).toBeNull();

    const invertido = defaultAgenda();
    invertido[1].inicio = "19:00";
    expect(validarAgenda(invertido)).toBe("Em Seg, o início deve ser anterior ao fim.");

    const formato = defaultAgenda();
    formato[2].fim = "";
    expect(validarAgenda(formato)).toBe("Horário inválido em Ter. Use HH:MM.");

    const almocoFora = defaultAgenda();
    almocoFora[3] = { ...almocoFora[3], almoco: true, almocoInicio: "08:00" };
    expect(validarAgenda(almocoFora)).toBe("Pausa de almoço inválida em Qua.");
  });

  it("ignora dias de folga na validacao", () => {
    const agenda = defaultAgenda();
    agenda[0] = { ...agenda[0], ativo: false, inicio: "", fim: "" };
    expect(validarAgenda(agenda)).toBeNull();
  });
});
