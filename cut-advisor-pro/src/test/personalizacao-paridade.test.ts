// As opcoes do visagismo personalizado existem no site, no app e no backend
// (que as transforma em texto para as IAs). Este teste garante que as tres
// listas sao as mesmas e que as regras de envio batem com a validacao.
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import * as web from "@/lib/personalizacaoVisagismo";
import * as mobile from "../../../barber-mobile/src/lib/personalizacaoVisagismo";

const require = createRequire(import.meta.url);
const backend = require("../../../backend/src/services/personalizacao.js");

const TABELAS: Record<string, object> = { estilo: backend.ESTILOS, barba: backend.BARBAS, cor_cabelo: backend.CORES };

// Todas as combinacoes possiveis de escolha nas telas
function combinacoes() {
  const [estilos, barbas, cores] = web.GRUPOS_PERSONALIZACAO.map((g) => g.opcoes.map((o) => o.valor));
  return estilos.flatMap((estilo) => barbas.flatMap((barba) => cores.map((cor_cabelo) => ({ estilo, barba, cor_cabelo }))));
}

describe("opcoes do visagismo personalizado", () => {
  it("site e app tem as mesmas opcoes, rotulos e resumos", () => {
    expect(mobile.GRUPOS_PERSONALIZACAO).toEqual(web.GRUPOS_PERSONALIZACAO);
  });

  it("toda opcao das telas existe no backend, e vice-versa", () => {
    for (const { campo, opcoes } of web.GRUPOS_PERSONALIZACAO) {
      const valores = opcoes.map((o) => o.valor).filter(Boolean).sort();
      expect(valores, campo).toEqual(Object.keys(TABELAS[campo]).sort());
      // Toda opcao que nao e o padrao tem resumo para a tela de resultado
      expect(opcoes.filter((o) => o.valor && !o.resumo), campo).toEqual([]);
    }
  });

  it("o backend aceita tudo que as telas enviam e recusa so o que elas bloqueiam", () => {
    const todas = combinacoes();
    expect(todas).toHaveLength(6 * 3 * 7);
    for (const escolha of todas) {
      const envio = web.preferenciasParaEnvio(escolha);
      if (web.semMudanca(escolha)) {
        expect(() => backend.normalizarPreferencias(envio), JSON.stringify(escolha)).toThrow(/ao menos uma mudança/);
      } else {
        expect(backend.normalizarPreferencias(envio), JSON.stringify(escolha)).toEqual(envio ?? null);
      }
    }
  });

  it("site e app aplicam as mesmas regras", () => {
    for (const escolha of combinacoes()) {
      expect(mobile.preferenciasParaEnvio(escolha)).toEqual(web.preferenciasParaEnvio(escolha));
      expect(mobile.semMudanca(escolha)).toBe(web.semMudanca(escolha));
      expect(mobile.resumoPreferencias(escolha)).toEqual(web.resumoPreferencias(escolha));
    }
    expect(web.resumoPreferencias({ estilo: "manter", barba: "sem", cor_cabelo: "luzes" }))
      .toEqual(["Corte atual mantido", "Sem barba", "Cabelo com luzes"]);
    expect(web.resumoPreferencias(undefined)).toEqual([]);
    expect(web.resumoPreferencias({ estilo: "inventado" })).toEqual([]);
  });
});
