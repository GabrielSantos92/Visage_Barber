// As bibliotecas de pagamento e financeiro existem no site e no app. Este teste
// garante que continuam iguais (so mudam o acesso ao Supabase e a API) e que
// dao as mesmas mensagens, periodos e semanas.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../barber-mobile/src/lib/supabase", () => ({ supabase: {} }));
vi.mock("../../../barber-mobile/src/lib/api", () => ({ api: {} }));

import * as webPag from "@/lib/pagamentos";
import * as webFin from "@/lib/financeiro";
import * as appPag from "../../../barber-mobile/src/lib/pagamentos";
import * as appFin from "../../../barber-mobile/src/lib/financeiro";
import * as webPriv from "@/lib/privacidade";
import * as appPriv from "../../../barber-mobile/src/lib/privacidade";

const raiz = resolve(__dirname, "../../..");
// Normaliza aspas e as linhas de import, que mudam de proposito entre as plataformas
const normalizar = (arquivo: string) =>
  readFileSync(resolve(raiz, arquivo), "utf8").replace(/\r\n/g, "\n").replace(/"/g, "'")
    .split("\n").filter((l) => !l.startsWith("import ")).join("\n")
    .replace(/apiPost</g, "api.post<");

describe("financeiro: site e app iguais", () => {
  it("mesmo código nas duas plataformas", () => {
    expect(normalizar("barber-mobile/src/lib/pagamentos.ts")).toBe(normalizar("cut-advisor-pro/src/lib/pagamentos.ts"));
    expect(normalizar("barber-mobile/src/lib/financeiro.ts")).toBe(normalizar("cut-advisor-pro/src/lib/financeiro.ts"));
  });

  it("mesmas mensagens para cada estado do pagamento", () => {
    const agora = Date.parse("2026-11-05T12:00:00Z");
    for (const metodo of ["pix", "cartao", "presencial"] as const) {
      for (const status of ["pending", "approved", "rejected", "expired", "refunded", "partially_refunded", "canceled"] as const) {
        const p = {
          id: "p", agendamento_id: "a", metodo, status, valor_original: 50, desconto: 0, valor: 50, valor_reembolsado: 10,
          pix_copia_cola: null, pix_qr_base64: null, link_pagamento: null, aprovado_em: null,
          expira_em: metodo === "pix" ? "2026-11-05T11:00:00Z" : null,
        };
        expect(appPag.mensagemDoPagamento(p, agora)).toEqual(webPag.mensagemDoPagamento(p, agora));
      }
    }
    const lista = [
      { status: "rejected", criado_em: "2026-11-01" }, { status: "pending", criado_em: "2026-11-02" }, { status: "approved", criado_em: "2026-10-01" },
    ].map((x, i) => ({ ...x, id: String(i) })) as unknown as webPag.Pagamento[];
    expect(webPag.pagamentoAtual(lista)?.status).toBe("approved");
    expect(appPag.pagamentoAtual(lista)?.status).toBe("approved");
  });

  it("mesmos períodos e semanas (segunda a domingo)", () => {
    const quarta = new Date(2026, 10, 4, 15, 0);
    for (const p of ["hoje", "semana", "mes", "30dias", "ano"] as const) {
      expect(appFin.intervaloDoPeriodo(p, quarta)).toEqual(webFin.intervaloDoPeriodo(p, quarta));
    }
    expect(webFin.intervaloDoPeriodo("semana", quarta)).toEqual({ inicio: "2026-11-02", fim: "2026-11-08" });
    expect(webFin.intervaloDoPeriodo("mes", quarta)).toEqual({ inicio: "2026-11-01", fim: "2026-11-30" });
    // Domingo pertence a semana que comecou na segunda anterior
    expect(webFin.dataIso(webFin.inicioDaSemana(new Date(2026, 10, 8)))).toBe("2026-11-02");
    expect(webFin.semanaSeguinte("2026-11-02")).toBe("2026-11-09");
  });

  it("mesmo aviso de pagamentos (privacidade) e mesmas frases do histórico", () => {
    expect(appPriv.AVISO_PAGAMENTOS).toEqual(webPriv.AVISO_PAGAMENTOS);
    expect(appPriv.AVISO_PAGAMENTO_RESUMO).toBe(webPriv.AVISO_PAGAMENTO_RESUMO);
    expect(appPriv.VERSAO_AVISO_PAGAMENTOS).toBe(webPriv.VERSAO_AVISO_PAGAMENTOS);
    // O aviso do visagismo nao mudou (a concordancia ja dada continua valendo)
    expect([webPriv.VERSAO_AVISO_VISAGISMO, appPriv.VERSAO_AVISO_VISAGISMO]).toEqual(["2026-11-04", "2026-11-04"]);

    const eventos = [
      { evento: "criado", metodo: "pix", status_novo: "pending" }, { evento: "criado", metodo: "presencial", status_novo: "approved" },
      { evento: "status", metodo: "cartao", status_anterior: "pending", status_novo: "approved" },
      { evento: "reembolso", metodo: "pix", valor: 12.5 }, { evento: "duplicidade", metodo: "pix" },
      { evento: "reembolso_solicitado", metodo: "cartao", valor: 40 }, { evento: "reembolso_falhou", metodo: "cartao" },
      { evento: "status", metodo: "pix", status_anterior: "pending", status_novo: "canceled", detalhe: "substituido · id 9" },
    ].map((e, i) => ({ id: i, registrado_em: "2026-11-05T12:00:00Z", pagamento_id: "p", status_anterior: null, status_novo: null,
      valor: null, detalhe: null, origem: "sistema", ator: null, ...e })) as unknown as webFin.EventoPagamento[];
    for (const e of eventos) {
      expect(appFin.descreverEvento(e)).toBe(webFin.descreverEvento(e));
      expect(appFin.detalheDoEvento(e)).toBe(webFin.detalheDoEvento(e));
    }
    expect(webFin.detalheDoEvento(eventos[7])).toBe("trocou a forma de pagamento · id 9");

    // Grafico: ate dois meses por dia; mais que isso, por mes
    const serie = [
      { dia: "2026-01-10", faturamento: 40, comissao: 24, barbearia: 16 },
      { dia: "2026-03-05", faturamento: 50, comissao: 30, barbearia: 20 },
      { dia: "2026-03-20", faturamento: 10, comissao: 6, barbearia: 4 },
    ];
    expect(webFin.agrupar(serie, "2026-01-01", "2026-12-31")).toEqual([
      { rotulo: "01/2026", faturamento: 40, comissao: 24, barbearia: 16 },
      { rotulo: "03/2026", faturamento: 60, comissao: 36, barbearia: 24 },
    ]);
    expect(appFin.agrupar(serie, "2026-01-01", "2026-12-31")).toEqual(webFin.agrupar(serie, "2026-01-01", "2026-12-31"));
    expect(webFin.agrupar(serie.slice(1), "2026-03-01", "2026-03-31").map((p) => p.rotulo)).toEqual(["05/03", "20/03"]);
  });
});
