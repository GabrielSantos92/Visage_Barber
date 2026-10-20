import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { erroDoRetornoOAuth } from "./loginGoogle";

describe("erroDoRetornoOAuth", () => {
  it("retorno com sessao nao tem erro", () => {
    expect(erroDoRetornoOAuth("", "#access_token=abc&refresh_token=def&token_type=bearer")).toBeNull();
    expect(erroDoRetornoOAuth("", "")).toBeNull();
  });

  it("cancelamento na tela do Google", () => {
    expect(erroDoRetornoOAuth("?error=access_denied&error_description=User+denied", "")).toBe("Login com Google cancelado.");
    expect(erroDoRetornoOAuth("", "#error=access_denied&error_code=access_denied")).toBe("Login com Google cancelado.");
  });

  it("erro do provedor vira mensagem generica, sem o texto tecnico", () => {
    const msg = erroDoRetornoOAuth("?error=server_error&error_description=Unable+to+exchange+external+code", "");
    expect(msg).toBe("Não foi possível entrar com Google. Tente novamente.");
  });
});
