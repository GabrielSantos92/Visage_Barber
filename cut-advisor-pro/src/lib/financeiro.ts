// Financeiro (admin e barbeiro). Os valores vem do banco (migrations
// 20261105000018_financeiro.sql e 20261105000019_pagamentos_duplicidade_auditoria.sql),
// calculados a partir dos lancamentos imutaveis; cada funcao confere no banco o
// perfil de quem chama.
import { supabase } from "@/integrations/supabase/client";
import { ROTULO_STATUS, cancelarCobrancasAbertas, formatarReais } from "@/lib/pagamentos";
import type { MetodoPagamento, StatusPagamento } from "@/lib/pagamentos";

export interface Resumo {
  servicos: number;
  faturamento_bruto: number;
  descontos: number;
  faturamento: number;
  comissoes: number;
  parte_barbearia: number;
  taxas_servicos: number;
  total_recebido: number;
  taxas: number;
  reembolsos: number;
  recebido_liquido: number;
  pendentes_valor: number;
  pendentes_quantidade: number;
  comissoes_pagas: number;
  comissoes_pendentes: number;
  receita_barbearia: number;
  // Situacao de hoje (nao depende do periodo): duplicidades a devolver e
  // cobrancas canceladas aqui que ainda podem ser pagas no Mercado Pago
  duplicados_quantidade: number;
  duplicados_valor: number;
  cobrancas_abertas: number;
}
export interface PontoSerie { dia: string; faturamento: number; comissao: number; barbearia: number }
export interface PontoGrafico { rotulo: string; faturamento: number; comissao: number; barbearia: number }
export interface LinhaBarbeiro {
  barbeiro_id: string; nome: string; ativo: boolean; percentual: number | null; servicos: number;
  faturamento: number; comissao: number; saldo_pendente: number;
}
export interface LinhaPagamento {
  id: string; agendamento_id: string; data_hora: string; cliente: string; barbeiro: string; servico: string;
  metodo: MetodoPagamento; status: StatusPagamento; valor: number; desconto: number; taxa: number;
  valor_reembolsado: number; forma_presencial: string | null; criado_em: string; aprovado_em: string | null;
  // Duplicidade: pagamento que quitou o atendimento antes deste
  duplicidade_de: string | null;
  // Quitou um atendimento que tem duplicidade a devolver (devolve-se a duplicada primeiro)
  tem_duplicidade: boolean;
  cancelamento_provedor: "pendente" | "confirmado" | "falhou" | null;
}
export interface LinhaReembolso {
  id: string; pagamento_id: string; agendamento_id: string; reembolsado_em: string; cliente: string; barbeiro: string;
  servico: string; metodo: MetodoPagamento; valor: number; motivo: string | null; registrado_por: string | null;
  origem: "admin" | "provedor" | "estorno"; duplicidade: boolean;
}
export type TipoEvento =
  | "criado" | "cobranca_gerada" | "status" | "reembolso" | "duplicidade"
  | "cancelamento_provedor" | "reembolso_solicitado" | "reembolso_falhou";
export interface EventoPagamento {
  id: number; registrado_em: string; pagamento_id: string; metodo: MetodoPagamento; evento: TipoEvento;
  status_anterior: StatusPagamento | null; status_novo: StatusPagamento | null; valor: number | null;
  detalhe: string | null; origem: "cliente" | "admin" | "provedor" | "sistema"; ator: string | null;
}
export interface AReceber {
  agendamento_id: string; data_hora: string; status: string; cliente: string; barbeiro: string; servico: string;
  preco: number; metodo_pendente: MetodoPagamento | null;
}
export interface LinhaFechamento {
  barbeiro_id: string; nome: string; percentual: number | null; servicos: number; faturamento: number;
  comissao: number; pago: number; pendente: number; saldo_geral: number;
}
export interface ComissoesConfig {
  padrao: number | null;
  barbeiros: { barbeiro_id: string; nome: string; ativo: boolean; proprio: number | null; vigente: number | null }[];
  historico: { id: number; barbeiro: string; percentual: number | null; alterado_em: string; alterado_por: string }[];
}
export interface PagamentoComissao {
  id: string; barbeiro_id: string; barbeiro: string; semana_inicio: string; valor: number; metodo: string;
  comprovante: string | null; observacoes: string | null; registrado_por: string; pago_em: string;
}
export interface MeuFinanceiro {
  percentual: number | null; servicos: number; faturamento: number; comissao: number; recebido: number;
  comissao_total: number; recebido_total: number;
  lancamentos: { id: number; tipo: "servico" | "reembolso" | "cancelamento"; competencia: string; servico: string; valor_pago: number; percentual: number; comissao: number }[];
  pagamentos: { id: string; semana_inicio: string; valor: number; metodo: string; comprovante: string | null; observacoes: string | null; pago_em: string }[];
}

// Funcoes da migration, ainda fora dos tipos gerados do Supabase
type Resposta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
interface RpcDb { rpc<T>(fn: string, args?: Record<string, unknown>): Resposta<T> }

export async function rpc<T>(fn: string, args?: Record<string, unknown>): Promise<T> {
  const { data, error } = await (supabase as unknown as RpcDb).rpc<T>(fn, args);
  if (error) throw new Error(error.message);
  return data as T;
}

// Numeric do Postgres pode chegar como texto: tudo vira numero
const num = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v])) as T;

interface Filtros { inicio: string; fim: string; barbeiroId?: string | null; servicoId?: string | null; status?: StatusPagamento | null }
const args = (f: Filtros) => ({ p_inicio: f.inicio, p_fim: f.fim, p_barbeiro_id: f.barbeiroId || null, p_servico_id: f.servicoId || null });

export const buscarResumo = async (f: Filtros) => num(await rpc<Resumo>("financeiro_resumo", { ...args(f), p_status: f.status || null }));
export const buscarSerie = async (f: Filtros) => (await rpc<PontoSerie[]>("financeiro_serie", args(f))).map(num);
export const buscarPorBarbeiro = async (f: Filtros) =>
  (await rpc<LinhaBarbeiro[]>("financeiro_barbeiros", { p_inicio: f.inicio, p_fim: f.fim, p_servico_id: f.servicoId || null })).map(num);
export const buscarPagamentosAdmin = async (f: Filtros) =>
  (await rpc<LinhaPagamento[]>("financeiro_pagamentos", { ...args(f), p_status: f.status || null })).map(num);
export const buscarAReceber = async (inicio: string, fim: string) =>
  (await rpc<AReceber[]>("financeiro_a_receber", { p_inicio: inicio, p_fim: fim })).map(num);
export const buscarFechamento = async (semanaInicio: string) =>
  (await rpc<LinhaFechamento[]>("fechamento_semanal", { p_semana_inicio: semanaInicio })).map(num);
export const buscarComissoes = () => rpc<ComissoesConfig>("comissoes_configuradas");
export const buscarPagamentosComissao = async (barbeiroId?: string | null) =>
  (await rpc<PagamentoComissao[]>("comissao_pagamentos_lista", { p_barbeiro_id: barbeiroId || null })).map(num);
export const buscarMeuFinanceiro = (inicio: string, fim: string) => rpc<MeuFinanceiro>("meu_financeiro", { p_inicio: inicio, p_fim: fim });
export const buscarReembolsos = async (f: Filtros) => (await rpc<LinhaReembolso[]>("financeiro_reembolsos", args(f))).map(num);
export const buscarDuplicidades = async () => (await rpc<LinhaPagamento[]>("financeiro_duplicidades")).map(num);
export const buscarHistorico = async (pagamentoId: string) =>
  (await rpc<EventoPagamento[]>("pagamento_historico", { p_pagamento_id: pagamentoId })).map(num);

export const configurarComissao = (barbeiroId: string | null, percentual: number | null) =>
  rpc<number | null>("configurar_comissao", { p_barbeiro_id: barbeiroId, p_percentual: percentual });

export const registrarPagamentoComissao = (d: {
  barbeiroId: string; semanaInicio: string; valor: number; metodo: string; comprovante?: string; observacoes?: string;
}) => rpc<{ saldo_semana: number; saldo_geral: number }>("registrar_pagamento_comissao", {
  p_barbeiro_id: d.barbeiroId, p_semana_inicio: d.semanaInicio, p_valor: d.valor, p_metodo: d.metodo,
  p_comprovante: d.comprovante || null, p_observacoes: d.observacoes || null,
});

export async function registrarPagamentoPresencial(agendamentoId: string, forma: string, desconto = 0, taxa = 0) {
  const r = await rpc<{ cancelados?: unknown[] }>("registrar_pagamento_presencial", {
    p_agendamento_id: agendamentoId, p_forma: forma, p_desconto: desconto, p_taxa: taxa,
  });
  // PIX ou link de cartao que o cliente tinha gerado deixam de valer: cancela
  // tambem no Mercado Pago. Se nao der agora, o painel mostra e permite tentar de novo.
  if (r?.cancelados?.length) await cancelarCobrancasAbertas(agendamentoId).catch(() => null);
  return r;
}

export const registrarReembolsoPresencial = (pagamentoId: string, valor: number, motivo?: string) =>
  rpc("registrar_reembolso_presencial", { p_pagamento_id: pagamentoId, p_valor: valor, p_motivo: motivo || null });

export const FORMAS_PRESENCIAIS = [
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "cartao_debito", rotulo: "Cartão de débito" },
  { valor: "cartao_credito", rotulo: "Cartão de crédito" },
  { valor: "pix", rotulo: "PIX na barbearia" },
];
export const METODOS_COMISSAO = [
  { valor: "pix", rotulo: "PIX" },
  { valor: "transferencia", rotulo: "Transferência" },
  { valor: "dinheiro", rotulo: "Dinheiro" },
  { valor: "outro", rotulo: "Outro" },
];

export const ROTULO_ORIGEM: Record<EventoPagamento["origem"], string> = {
  cliente: "Cliente",
  admin: "Administrador",
  provedor: "Mercado Pago",
  sistema: "Sistema",
};
export const ROTULO_ORIGEM_REEMBOLSO: Record<LinhaReembolso["origem"], string> = {
  admin: "Pelo Visage Barber",
  provedor: "Direto no Mercado Pago",
  estorno: "Estorno do cartão",
};

// Frase de cada evento do historico de um pagamento
export function descreverEvento(e: EventoPagamento): string {
  switch (e.evento) {
    case "criado":
      if (e.metodo !== "presencial") return e.metodo === "pix" ? "Cobrança PIX criada" : "Cobrança no cartão de crédito criada";
      return e.status_novo === "approved" ? "Pagamento na barbearia registrado" : "Cliente escolheu pagar na barbearia";
    case "cobranca_gerada": return "Cobrança gerada no Mercado Pago";
    case "status":
      return `${e.status_anterior ? ROTULO_STATUS[e.status_anterior] : "Sem situação"} → ${e.status_novo ? ROTULO_STATUS[e.status_novo] : "Sem situação"}`;
    case "reembolso": return `${formatarReais(e.valor)} devolvido(s) ao cliente`;
    case "duplicidade": return "Pagamento em duplicidade: o atendimento já estava quitado";
    case "cancelamento_provedor": return "Cancelamento no Mercado Pago";
    case "reembolso_solicitado": return `Reembolso de ${formatarReais(e.valor)} solicitado`;
    default: return "O Mercado Pago não confirmou o reembolso";
  }
}

// Detalhe gravado pelo sistema, com o codigo interno de troca de meio traduzido
export const detalheDoEvento = (e: EventoPagamento) =>
  e.detalhe ? e.detalhe.replace(/\bsubstituido\b/, "trocou a forma de pagamento") : null;

// Periodos longos (mais de dois meses) agrupam por mes no grafico
export function agrupar(serie: PontoSerie[], inicio: string, fim: string): PontoGrafico[] {
  const dias = (new Date(fim).getTime() - new Date(inicio).getTime()) / 86400000;
  if (dias <= 62) return serie.map((p) => ({ ...p, rotulo: dataCurta(p.dia) }));
  const meses = new Map<string, PontoGrafico>();
  for (const p of serie) {
    const chave = p.dia.slice(0, 7);
    const m = meses.get(chave) ?? { rotulo: `${chave.slice(5, 7)}/${chave.slice(0, 4)}`, faturamento: 0, comissao: 0, barbearia: 0 };
    m.faturamento += p.faturamento; m.comissao += p.comissao; m.barbearia += p.barbearia;
    meses.set(chave, m);
  }
  return [...meses.values()];
}

// ---------------------------------------------------------------
// Periodos (datas locais, AAAA-MM-DD; o fim e inclusivo)
// ---------------------------------------------------------------
export type Periodo = "hoje" | "semana" | "mes" | "30dias" | "ano" | "personalizado";

export const PERIODOS: { valor: Periodo; rotulo: string }[] = [
  { valor: "hoje", rotulo: "Hoje" },
  { valor: "semana", rotulo: "Esta semana" },
  { valor: "mes", rotulo: "Este mês" },
  { valor: "30dias", rotulo: "Últimos 30 dias" },
  { valor: "ano", rotulo: "Ano" },
  { valor: "personalizado", rotulo: "Personalizado" },
];

export const dataIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const somarDias = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

// Segunda-feira da semana da data (as semanas de comissao vao de segunda a domingo)
export function inicioDaSemana(d: Date): Date {
  const r = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  r.setDate(r.getDate() - ((r.getDay() + 6) % 7));
  return r;
}

export function intervaloDoPeriodo(p: Periodo, agora = new Date(), personalizado?: { inicio: string; fim: string }) {
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  switch (p) {
    case "hoje": return { inicio: dataIso(hoje), fim: dataIso(hoje) };
    case "semana": { const i = inicioDaSemana(hoje); return { inicio: dataIso(i), fim: dataIso(somarDias(i, 6)) }; }
    case "mes": return { inicio: dataIso(new Date(hoje.getFullYear(), hoje.getMonth(), 1)), fim: dataIso(new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0)) };
    case "30dias": return { inicio: dataIso(somarDias(hoje, -29)), fim: dataIso(hoje) };
    case "ano": return { inicio: `${hoje.getFullYear()}-01-01`, fim: `${hoje.getFullYear()}-12-31` };
    default: return personalizado && personalizado.inicio <= personalizado.fim ? personalizado : { inicio: dataIso(hoje), fim: dataIso(hoje) };
  }
}

export const semanaAnterior = (iso: string) => dataIso(somarDias(new Date(`${iso}T12:00:00`), -7));
export const semanaSeguinte = (iso: string) => dataIso(somarDias(new Date(`${iso}T12:00:00`), 7));
export const fimDaSemana = (iso: string) => dataIso(somarDias(new Date(`${iso}T12:00:00`), 6));

// "05/11" ou "05/11/2026"
export const dataCurta = (iso: string, ano = false) => {
  const [a, m, d] = iso.slice(0, 10).split("-");
  return ano ? `${d}/${m}/${a}` : `${d}/${m}`;
};

export const percentual = (v: number | null | undefined) =>
  v == null ? "—" : `${Number(v).toLocaleString("pt-BR", { maximumFractionDigits: 2 })}%`;
