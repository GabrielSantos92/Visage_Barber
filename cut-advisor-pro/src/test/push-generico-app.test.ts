// Push generico no app: o toque so traz o id do aviso, e o detalhe vem da
// central da conta logada (o banco so devolve os avisos de quem chama).
import { describe, it, expect, vi, beforeEach } from "vitest";

// Funcao simples (nao vi.fn): o vi.fn observa o resultado e geraria uma
// rejeicao propria para a falha de rede, que o app ja trata
type Rpc = (fn: string, args?: unknown) => unknown;
let resposta: Rpc = () => ({ data: [], error: null });
const chamadas: unknown[][] = [];
vi.mock("../../../barber-mobile/src/lib/supabase", () => ({
  supabase: { rpc: (fn: string, args?: unknown) => { chamadas.push([fn, args]); return resposta(fn, args); } },
}));
import { notificacaoDoPush, deveExibirNoApp } from "../../../barber-mobile/src/lib/centralNotificacoes";

const DA_CONTA = {
  id: "n1", tipo: "cancelamento", dados: { servico: "Corte", ator: "barbeiro" }, agendamento_id: "a1",
  conversa_id: null, criada_em: "2026-11-19T12:00:00Z", lida_em: null,
};

describe("toque num push genérico", () => {
  beforeEach(() => { chamadas.length = 0; resposta = () => ({ data: [], error: null }); });

  it("acha o aviso na central da conta logada e só então tem os detalhes", async () => {
    resposta = async () => ({ data: [DA_CONTA], error: null });
    expect(await notificacaoDoPush("n1")).toEqual(DA_CONTA);
    expect(chamadas).toEqual([["minhas_notificacoes", { p_limite: 30, p_antes: null }]]);
  });

  it("aviso de outra conta (aparelho que ficou vinculado) não é achado: nenhum detalhe", async () => {
    resposta = async () => ({ data: [DA_CONTA], error: null });
    expect(await notificacaoDoPush("de-outra-conta")).toBeNull();
  });

  it("sem id: nenhum detalhe e a central nem é consultada", async () => {
    expect(await notificacaoDoPush(undefined)).toBeNull();
    expect(chamadas).toEqual([]);
  });

  it("sessão expirada: nenhum detalhe e nada quebra", async () => {
    resposta = async () => ({ data: null, error: { message: "JWT expired" } });
    expect(await notificacaoDoPush("n1")).toBeNull();
  });

  it("sem rede: nenhum detalhe e nada quebra", async () => {
    resposta = async () => { throw new Error("rede"); };
    expect(await notificacaoDoPush("n1")).toBeNull();
  });

  it("app aberto sem conta logada: o push não aparece", () => {
    expect(deveExibirNoApp({}, null)).toBe(false);
    expect(deveExibirNoApp({}, "u1")).toBe(true);
  });
});
