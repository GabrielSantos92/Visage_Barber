// Banco simulado (com estado) para os testes do Painel e da Agenda do barbeiro.
// Responde as consultas encadeadas do supabase-js por tabela e filtros: cancelar
// muda o status guardado, e o intervalo de datas (gte/lte) e respeitado.
// Uso nos testes:
//   vi.mock("@/integrations/supabase/client", async () => ({ supabase: (await import("./bancoBarbeiro")).supabase }));
import { vi } from "vitest";

export type Ag = { id: string; data_hora: string; status: string; cliente_id: string; preco?: number | null; [k: string]: unknown };
type Filtro = [string, string, unknown];

export const NOMES: Record<string, string> = { c1: "Ana", c2: "Bruno", c3: "Caio", c4: "Davi", c5: "Eva", c6: "Fábio" };

export const banco = {
  rpc: vi.fn(),
  papel: "barbeiro",
  // Estavel entre renderizacoes, como o usuario do contexto de login
  usuario: { id: "u1" },
  barbeiro: { id: "b1" } as { id: string } | null,
  agendamentos: [] as Ag[],
  conversas: [] as { id: string; cliente_id: string }[],
  mensagens: [] as { conversa_id: string }[],
  updates: [] as { valores: unknown; filtros: Filtro[] }[],
  // Simula falha de comunicacao ou "nada alterado" no update
  respostaUpdate: null as null | { data: unknown; error: unknown },
  consultas: [] as { tabela: string; filtros: Filtro[] }[],
};

function consulta(tabela: string) {
  let op: "select" | "update" = "select";
  let valores: Record<string, unknown> = {};
  const filtros: Filtro[] = [];
  const responder = async () => {
    banco.consultas.push({ tabela, filtros: [...filtros] });
    const id = filtros.find(([t, c]) => t === "eq" && c === "id")?.[2];
    if (tabela === "barbeiros") return { data: banco.barbeiro, error: null };
    if (tabela === "profiles") {
      return { data: Object.entries(NOMES).map(([user_id, nome]) => ({ user_id, nome, telefone: user_id === "c1" ? "11987654321" : null })), error: null };
    }
    if (tabela === "conversas") return { data: banco.conversas, error: null };
    if (tabela === "mensagens") return { data: banco.mensagens, error: null };
    if (tabela === "agendamentos" && op === "update") {
      banco.updates.push({ valores, filtros: [...filtros] });
      if (banco.respostaUpdate) return banco.respostaUpdate;
      const ag = banco.agendamentos.find((a) => a.id === id);
      if (!ag || ag.status === valores.status) return { data: [], error: null };
      ag.status = String(valores.status);
      return { data: [{ id }], error: null };
    }
    if (tabela === "agendamentos" && id) return { data: { status: banco.agendamentos.find((a) => a.id === id)?.status }, error: null };
    if (tabela === "agendamentos") {
      const desde = filtros.find(([t]) => t === "gte")?.[2] as string | undefined;
      const ate = filtros.find(([t]) => t === "lte")?.[2] as string | undefined;
      const dentro = (a: Ag) => (!desde || a.data_hora >= desde) && (!ate || a.data_hora <= ate);
      return {
        data: banco.agendamentos.filter(dentro).sort((a, b) => a.data_hora.localeCompare(b.data_hora)).map((a) => ({ ...a })),
        error: null,
      };
    }
    return { data: [], error: null };
  };
  const b: Record<string, unknown> = {
    select: () => b,
    update: (v: Record<string, unknown>) => { op = "update"; valores = v; return b; },
    eq: (c: string, v: unknown) => { filtros.push(["eq", c, v]); return b; },
    neq: (c: string, v: unknown) => { filtros.push(["neq", c, v]); return b; },
    gte: (c: string, v: unknown) => { filtros.push(["gte", c, v]); return b; },
    lte: (c: string, v: unknown) => { filtros.push(["lte", c, v]); return b; },
    in: () => b, order: () => b,
    maybeSingle: responder, single: responder,
    then: (ok: (v: unknown) => unknown, falha?: (e: unknown) => unknown) => responder().then(ok, falha),
  };
  return b;
}

export const supabase = { rpc: (fn: string, a?: unknown) => banco.rpc(fn, a), from: (t: string) => consulta(t) };

// Dia relativo a hoje, numa hora cheia (fuso do aparelho)
export const em = (dias: number, h: number) => {
  const d = new Date();
  d.setDate(d.getDate() + dias);
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
};

export const ag = (id: string, cliente: string, data_hora: string, status: string, preco: number | null = 50): Ag => ({
  id, data_hora, status, cliente_id: cliente, preco,
  duracao_min: 30, ativo_inicial_min: null, pausa_min: null, ativo_final_min: null,
  servicos: { nome: "Corte", preco: 50, duracao_min: 30 },
});

// Ana (hoje 9h, confirmado), Bruno (hoje 10h, concluido), Caio (hoje 11h,
// cancelado), Davi (amanha 10h, confirmado, preco congelado R$ 45), Eva
// (ontem 15h, concluido), Fabio (daqui a 3 dias, cancelado)
export function reiniciarBanco() {
  banco.rpc.mockReset();
  banco.papel = "barbeiro";
  banco.barbeiro = { id: "b1" };
  banco.conversas = [];
  banco.mensagens = [];
  banco.updates = [];
  banco.respostaUpdate = null;
  banco.consultas = [];
  banco.agendamentos = [
    ag("a1", "c1", em(0, 9), "confirmado"),
    ag("a2", "c2", em(0, 10), "concluido"),
    ag("a3", "c3", em(0, 11), "cancelado"),
    ag("a4", "c4", em(1, 10), "confirmado", 45),
    ag("a5", "c5", em(-1, 15), "concluido"),
    ag("a6", "c6", em(3, 10), "cancelado"),
  ];
}

export const chamadas = (fn: string) => banco.rpc.mock.calls.filter(([f]) => f === fn).map(([, a]) => a);
