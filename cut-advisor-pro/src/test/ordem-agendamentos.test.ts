// Ordem das listas de agendamentos do barbeiro. A mesma bateria roda contra a
// copia da web e a do mobile, para as duas plataformas ordenarem igual.
import { describe, expect, it } from "vitest";
import * as web from "@/lib/ordemAgendamentos";
import * as mobile from "../../../barber-mobile/src/lib/ordemAgendamentos";

// "Agora" fixo: quarta, 05/11/2026 as 12:00 (horario local)
const AGORA = new Date(2026, 10, 5, 12, 0);
const em = (dia: number, hora: string) => {
  const [h, m] = hora.split(":").map(Number);
  return new Date(2026, 10, dia, h, m).toISOString();
};
const ag = (id: string, dia: number, hora: string, extra: Record<string, unknown> = {}) =>
  ({ id, data_hora: em(dia, hora), ...extra });
const ids = (lista: { id: string }[]) => lista.map((a) => a.id);

describe.each([["web", web], ["mobile", mobile]] as const)("ordem dos agendamentos (%s)", (_n, lib) => {
  const ordenar = <T extends { id: string; data_hora: string }>(l: T[]) => lib.ordenarAgendamentos(l, AGORA);

  it("mesmo dia fora de ordem: do primeiro ao ultimo horario", () => {
    const lista = [ag("C", 5, "10:00"), ag("E", 5, "15:30"), ag("A", 5, "08:00"), ag("D", 5, "13:00"), ag("B", 5, "09:30")];
    expect(ids(ordenar(lista))).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("dias diferentes no futuro: dias mais proximos primeiro, horario crescente em cada dia", () => {
    const lista = [ag("sex-09", 7, "09:00"), ag("qui-14", 6, "14:00"), ag("hoje-16", 5, "16:00"), ag("qui-08", 6, "08:00"), ag("hoje-13", 5, "13:00")];
    expect(ids(ordenar(lista))).toEqual(["hoje-13", "hoje-16", "qui-08", "qui-14", "sex-09"]);
  });

  it("historico: ontem antes de anteontem, e horario crescente dentro do dia", () => {
    const lista = [ag("seg-10", 3, "10:00"), ag("ter-17", 4, "17:00"), ag("seg-08", 3, "08:00"), ag("ter-09", 4, "09:00")];
    expect(ids(ordenar(lista))).toEqual(["ter-09", "ter-17", "seg-08", "seg-10"]);
  });

  it("usa o horario marcado, nao a data de criacao", () => {
    const lista = [
      ag("tarde", 5, "17:00", { created_at: "2026-10-01T10:00:00Z" }),
      ag("manha", 5, "09:00", { created_at: "2026-11-04T10:00:00Z" }),
    ];
    expect(ids(ordenar(lista))).toEqual(["manha", "tarde"]);
  });

  it("novo agendamento entra na posicao correta", () => {
    const lista = ordenar([ag("A", 5, "08:00"), ag("C", 5, "10:00")]);
    expect(ids(ordenar([...lista, ag("novo", 5, "09:00")]))).toEqual(["A", "novo", "C"]);
  });

  it("alterar o horario reorganiza a lista", () => {
    const lista = ordenar([ag("A", 5, "08:00"), ag("B", 5, "09:30"), ag("C", 5, "10:00")]);
    const alterada = lista.map((a) => (a.id === "A" ? { ...a, data_hora: em(5, "11:00") } : a));
    expect(ids(ordenar(alterada))).toEqual(["B", "C", "A"]);
  });

  it("amanha vem antes de ontem quando estao a mesma distancia", () => {
    expect(ids(ordenar([ag("ontem", 4, "10:00"), ag("amanha", 6, "10:00")]))).toEqual(["amanha", "ontem"]);
  });

  it("mesmo horario (ex.: um cancelado e um novo): ordem estavel", () => {
    const lista = [ag("b", 5, "10:00", { status: "confirmado" }), ag("a", 5, "10:00", { status: "cancelado" })];
    expect(ids(ordenar(lista))).toEqual(["a", "b"]);
    expect(ids(ordenar([...lista].reverse()))).toEqual(["a", "b"]);
  });

  it("nao altera a lista original", () => {
    const lista = [ag("B", 5, "10:00"), ag("A", 5, "08:00")];
    ordenar(lista);
    expect(ids(lista)).toEqual(["B", "A"]);
  });
});
