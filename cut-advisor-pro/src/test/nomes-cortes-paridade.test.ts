// A tabela de nomes de cortes em pt-BR existe no backend (respostas novas da IA)
// e no mobile (historico salvo). Este teste garante que as duas sao iguais e
// traduzem igual, para o mesmo corte ter o mesmo nome em todo lugar.
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as mobile from "../../../barber-mobile/src/lib/nomesCortes";

const require = createRequire(import.meta.url);
const backend = require("../../../backend/src/services/nomesCortes.js") as typeof mobile;

const raiz = resolve(__dirname, "../../..");
const pares = (arquivo: string) =>
  [...readFileSync(resolve(raiz, arquivo), "utf8").matchAll(/\['([^']+)', '([^']+)'\]/g)].map((m) => `${m[1]} => ${m[2]}`);

describe("nomes de cortes em pt-BR", () => {
  it("backend e mobile usam a mesma tabela", () => {
    const doBackend = pares("backend/src/services/nomesCortes.js");
    expect(doBackend.length).toBeGreaterThan(50);
    expect(pares("barber-mobile/src/lib/nomesCortes.ts")).toEqual(doBackend);
  });

  it("traduzem igual, inclusive combinacoes e nomes ja em portugues", () => {
    for (const nome of [
      "Low Fade", "Textured Crop", "Pompadour with Low Fade", "Side Part", "Buzz Cut", "Stubble",
      "Degradê baixo", "Corte social", "Taper Fade com risca", "Low-Fade", "Van Dyke",
    ]) {
      expect(mobile.nomeCortePtBR(nome), nome).toBe(backend.nomeCortePtBR(nome));
    }
  });

  it("analise antiga salva no app aparece em pt-BR sem perder os campos da imagem", () => {
    const salva = {
      corte_principal: { nome: "Low Fade", nome_en: "low fade", caracteristicas: [] },
      cortes_alternativos: ["Undercut"],
      barba: { estilo: "Goatee", estilo_en: "goatee" },
    };
    const r = mobile.analiseEmPtBR(salva);
    expect(r.corte_principal.nome).toBe("Degradê baixo");
    expect(r.cortes_alternativos).toEqual(["Corte desconectado"]);
    expect(r.barba.estilo).toBe("Cavanhaque");
    expect(r.corte_principal.nome_en).toBe("low fade");
    expect(r.barba.estilo_en).toBe("goatee");
    expect(mobile.analiseEmPtBR(r)).toEqual(r);
    expect(r).toEqual(backend.analiseEmPtBR(salva));
  });
});
