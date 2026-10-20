import { describe, expect, it } from "vitest";
import { validarNovaSenha } from "./recuperacaoSenha";

describe("validarNovaSenha", () => {
  it("segue as regras de cadastro", () => {
    expect(validarNovaSenha("", "")).toEqual({ senha: "Senha é obrigatória" });
    expect(validarNovaSenha("12345", "12345").senha).toBe("Mínimo 6 caracteres");
    expect(validarNovaSenha("123456", "123457")).toEqual({ confirmacao: "Senhas não coincidem" });
    expect(validarNovaSenha("123456", "123456")).toEqual({});
    expect(validarNovaSenha("a".repeat(73), "a".repeat(73)).senha).toBe("Máximo 72 caracteres");
  });
});
