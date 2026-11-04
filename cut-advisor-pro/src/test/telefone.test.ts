// Mascara e validacao de telefone. A mesma bateria roda contra a copia da web e
// a do mobile, para garantir que as duas plataformas formatam exatamente igual.
import { describe, expect, it } from "vitest";
import * as web from "@/lib/telefone";
import * as mobile from "../../../barber-mobile/src/lib/telefone";

type Lib = typeof web;
type Campo = { texto: string; cursor: number };

// Simula o campo: o navegador/teclado altera o texto e a mascara e reaplicada
function criarCampo(lib: Lib, inicial = "") {
  let campo: Campo = { texto: lib.telefoneParaCampo(inicial), cursor: lib.telefoneParaCampo(inicial).length };
  const aplicar = (novo: string, cursorNovo: number, cursorAntes?: number) => {
    const r = lib.editarTelefone(campo.texto, novo, cursorNovo, cursorAntes);
    campo = { texto: r.texto, cursor: r.cursor };
  };
  return {
    get texto() { return campo.texto; },
    get cursor() { return campo.cursor; },
    posicionar(cursor: number) { campo = { ...campo, cursor }; },
    digitar(textoDigitado: string) {
      for (const c of textoDigitado) {
        const { texto, cursor } = campo;
        aplicar(texto.slice(0, cursor) + c + texto.slice(cursor), cursor + 1, cursor);
      }
    },
    colar(conteudo: string, inicio = campo.cursor, fim = campo.cursor) {
      const { texto } = campo;
      aplicar(texto.slice(0, inicio) + conteudo + texto.slice(fim), inicio + conteudo.length, inicio);
    },
    backspace(vezes = 1) {
      for (let i = 0; i < vezes; i++) {
        const { texto, cursor } = campo;
        if (cursor === 0) return;
        aplicar(texto.slice(0, cursor - 1) + texto.slice(cursor), cursor - 1, cursor);
      }
    },
    deleteParaFrente() {
      const { texto, cursor } = campo;
      aplicar(texto.slice(0, cursor) + texto.slice(cursor + 1), cursor, cursor);
    },
  };
}

describe.each([["web", web], ["mobile", mobile]] as const)("telefone (%s)", (_nome, lib) => {
  it("digitar um celular", () => {
    const c = criarCampo(lib);
    const vistos: string[] = [];
    for (const d of "11987654321") { c.digitar(d); vistos.push(c.texto); }
    expect(vistos).toEqual([
      "(1", "(11", "(11) 9", "(11) 98", "(11) 987", "(11) 9876",
      "(11) 9876-5", "(11) 9876-54", "(11) 9876-543", "(11) 9876-5432", "(11) 98765-4321",
    ]);
    expect(c.cursor).toBe(c.texto.length);
  });

  it("digitar um telefone fixo", () => {
    const c = criarCampo(lib);
    c.digitar("1133334444");
    expect(c.texto).toBe("(11) 3333-4444");
  });

  it("nao passa de 11 digitos nem acrescenta numeros", () => {
    const c = criarCampo(lib);
    c.digitar("119876543219999");
    expect(c.texto).toBe("(11) 98765-4321");
  });

  it("apagar todos os numeros com backspace", () => {
    const c = criarCampo(lib, "11987654321");
    c.backspace(30);
    expect(c.texto).toBe("");
  });

  it("apagar um numero do meio mantem o cursor no lugar", () => {
    const c = criarCampo(lib, "11987654321"); // (11) 98765-4321
    c.posicionar("(11) 987".length);
    c.backspace();
    expect(c.texto).toBe("(11) 9865-4321");
    expect(c.texto.slice(0, c.cursor)).toBe("(11) 98");
    c.digitar("7");
    expect(c.texto).toBe("(11) 98765-4321");
    expect(c.texto.slice(0, c.cursor)).toBe("(11) 987");
  });

  it("backspace logo depois do hifen apaga o digito anterior", () => {
    const c = criarCampo(lib, "1133334444"); // (11) 3333-4444
    c.posicionar("(11) 3333-".length);
    c.backspace();
    expect(c.texto).toBe("(11) 3334-444");
    expect(c.texto.slice(0, c.cursor)).toBe("(11) 333");
  });

  it("Delete antes do hifen apaga o digito seguinte", () => {
    const c = criarCampo(lib, "1133334444");
    c.posicionar("(11) 3333".length);
    c.deleteParaFrente();
    expect(c.texto).toBe("(11) 3333-444");
  });

  it("digitar no meio de um campo cheio nao altera o numero", () => {
    const c = criarCampo(lib, "11987654321");
    c.posicionar("(11) 9".length);
    c.digitar("5");
    expect(c.texto).toBe("(11) 98765-4321");
  });

  it("colar telefone ja formatado", () => {
    const c = criarCampo(lib);
    c.colar("(21) 99876-5432");
    expect(c.texto).toBe("(21) 99876-5432");
    expect(c.cursor).toBe(c.texto.length);
  });

  it("colar telefone so com numeros, com +55 ou com 0", () => {
    for (const colado of ["21998765432", "+55 21 99876-5432", "5521998765432", "021998765432", "0 21 99876 5432"]) {
      const c = criarCampo(lib);
      c.colar(colado);
      expect(c.texto, colado).toBe("(21) 99876-5432");
    }
  });

  it("colar substituindo o numero selecionado", () => {
    const c = criarCampo(lib, "1133334444");
    c.colar("11987654321", 0, c.texto.length);
    expect(c.texto).toBe("(11) 98765-4321");
  });

  it("letras e simbolos sao ignorados", () => {
    const c = criarCampo(lib);
    c.digitar("a1b1#9.8-7x6");
    expect(c.texto).toBe("(11) 9876");
    c.colar("abc");
    expect(c.texto).toBe("(11) 9876");
  });

  it("DDD nao comeca com zero", () => {
    const c = criarCampo(lib);
    c.digitar("011");
    expect(c.texto).toBe("(11");
  });

  it("valida celular, fixo, incompletos e obrigatoriedade", () => {
    expect(lib.validarTelefone("(11) 98765-4321")).toBeNull();
    expect(lib.validarTelefone("1133334444")).toBeNull();
    expect(lib.validarTelefone("(11) 9876-543")).toMatch(/incompleto/);
    expect(lib.validarTelefone("(1")).toMatch(/incompleto/);
    expect(lib.validarTelefone("11887654321")).toMatch(/Celular/);
    expect(lib.validarTelefone("1193334444")).toMatch(/fixo/);
    expect(lib.validarTelefone("1033334444")).toMatch(/DDD/);
    expect(lib.validarTelefone("", { obrigatorio: true })).toMatch(/obrigatório/);
    expect(lib.validarTelefone("")).toBeNull();
  });

  it("mascara nao e validacao: um numero formatado ainda pode ser invalido", () => {
    expect(lib.formatarTelefone("1188765432")).toBe("(11) 8876-5432");
    expect(lib.validarTelefone("(11) 8876-5432")).not.toBeNull();
  });

  it("salva so digitos e recupera formatado, inclusive numeros antigos", () => {
    expect(lib.telefoneParaSalvar("(11) 98765-4321")).toBe("11987654321");
    expect(lib.telefoneParaSalvar("")).toBe("");
    for (const salvo of ["11987654321", "(11) 98765-4321", "+55 11 98765-4321", "11 98765 4321"]) {
      expect(lib.telefoneParaCampo(salvo), salvo).toBe("(11) 98765-4321");
      expect(lib.exibirTelefone(salvo), salvo).toBe("(11) 98765-4321");
    }
    expect(lib.exibirTelefone(null)).toBe("");
    // Fora do padrao: mostra como foi salvo, sem inventar
    expect(lib.exibirTelefone("ramal 123")).toBe("ramal 123");
  });

  it("formato salvo continua compativel com o link do WhatsApp", async () => {
    const { normalizarTelefoneBR } = await import("@/lib/whatsapp");
    expect(normalizarTelefoneBR(lib.telefoneParaSalvar("(11) 98765-4321"))).toBe("5511987654321");
    expect(normalizarTelefoneBR(lib.telefoneParaSalvar("(11) 3333-4444"))).toBe("551133334444");
  });
});
