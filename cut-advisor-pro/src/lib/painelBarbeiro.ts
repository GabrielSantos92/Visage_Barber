// Painel e Agenda do Barbeiro: agendamentos do proprio barbeiro (visao do dia
// no Painel; Por dia, Proximos e Historico na Agenda), acoes nos atendimentos
// (cancelar, registrar falta) e textos/periodos.
// O mesmo codigo existe no site (cut-advisor-pro/src/lib/painelBarbeiro.ts) e
// no app (barber-mobile/src/lib/painelBarbeiro.ts); o teste de paridade confere.
// Os valores financeiros vem so do banco (meu_financeiro e meu_desempenho).
import { supabase } from "@/integrations/supabase/client";
import { ordenarAgendamentos } from "@/lib/ordemAgendamentos";
import { formatarReais } from "@/lib/pagamentos";
import { PERIODOS, buscarMeuDesempenho, buscarMeuFinanceiro, percentual } from "@/lib/financeiro";
import type { MeuDesempenho, MeuFinanceiro } from "@/lib/financeiro";
import { ROTULO_PRESENCA, buscarSituacoesWhatsapp, idsComSituacao, presencaParaBarbeiro } from "@/lib/whatsappAgendamentos";
import type { SituacaoPresenca, TomPresenca } from "@/lib/whatsappAgendamentos";

export type StatusAgendamento = "confirmado" | "concluido" | "cancelado";

// Situacao do WhatsApp (confirmacao de presenca e cancelamento pelo WhatsApp)
export type { SituacaoPresenca, TomPresenca };

export interface AgendamentoPainel {
  id: string;
  data_hora: string;
  status: StatusAgendamento;
  cliente_id: string;
  // Preco congelado na reserva (ausente antes da migration do financeiro)
  preco?: number | null;
  // Tempos gravados no agendamento (pausa_min nulo = atendimento continuo)
  duracao_min: number | null;
  ativo_inicial_min: number | null;
  pausa_min: number | null;
  ativo_final_min: number | null;
  profiles: { nome: string; telefone?: string | null } | null;
  servicos: { nome: string; preco: number; duracao_min: number } | null;
  // Ausente: nenhum pedido de confirmacao (ou banco sem a migration do WhatsApp)
  presenca?: SituacaoPresenca | null;
}

// ---------------------------------------------------------------
// Acesso ao banco. So os dados do proprio barbeiro: os agendamentos e as
// conversas tem RLS por barbeiro. Tabelas fora dos tipos gerados (conversas,
// mensagens) e colunas novas passam por esta interface minima do supabase-js.
// ---------------------------------------------------------------
type Erro = { message: string };
interface Consulta<L> extends PromiseLike<{ data: L[] | null; error: Erro | null }> {
  select(colunas: string): Consulta<L>;
  update(valores: Record<string, unknown>): Consulta<L>;
  eq(coluna: string, valor: unknown): Consulta<L>;
  neq(coluna: string, valor: unknown): Consulta<L>;
  gte(coluna: string, valor: unknown): Consulta<L>;
  lte(coluna: string, valor: unknown): Consulta<L>;
  in(coluna: string, valores: unknown[]): Consulta<L>;
  order(coluna: string, opcoes?: { ascending?: boolean }): Consulta<L>;
  limit(quantidade: number): Consulta<L>;
  range(de: number, ate: number): Consulta<L>;
  maybeSingle(): PromiseLike<{ data: L | null; error: Erro | null }>;
}
interface Banco {
  from<L>(tabela: string): Consulta<L>;
  rpc<L = unknown>(fn: string, args?: Record<string, unknown>): PromiseLike<{ data?: L[] | null; error: Erro | null }>;
}
const banco = () => supabase as unknown as Banco;

export interface AgendaDoBarbeiro { barbeiroId: string | null; agendamentos: AgendamentoPainel[] }

// concluirPassados: conclui antes os horarios que ja terminaram (o pg_cron ja
// faz isso a cada 5 minutos; o app deixa so com ele e economiza uma ida ao
// banco). situacoesWhatsapp: busca a situacao do WhatsApp de cada atendimento
// (o app pula enquanto o WhatsApp esta oculto). Sem opcoes, as duas acontecem.
// barbeiroId: id do barbeiro ja conhecido (o app guarda durante a sessao e
// economiza a consulta a barbeiros); sem ele, busca pelo usuario.
export interface OpcoesAgenda { concluirPassados?: boolean; situacoesWhatsapp?: boolean; barbeiroId?: string }

// Traz os agendamentos do barbeiro logado, com nome e telefone de cada
// cliente: todos, ou so os de `dia` (Painel: hoje; Agenda: o dia escolhido na
// navegacao por datas)
export async function buscarAgendaDoBarbeiro(userId: string, dia?: Date, opcoes: OpcoesAgenda = {}): Promise<AgendaDoBarbeiro> {
  const { concluirPassados = true, situacoesWhatsapp = true } = opcoes;
  if (concluirPassados) await banco().rpc("concluir_agendamentos_passados");
  let barbeiroId = opcoes.barbeiroId;
  if (!barbeiroId) {
    const { data: barbeiro, error: erroBarbeiro } = await banco().from<{ id: string }>("barbeiros")
      .select("id").eq("user_id", userId).maybeSingle();
    if (erroBarbeiro) throw new Error(erroBarbeiro.message);
    // Conta ainda nao vinculada a um barbeiro
    if (!barbeiro) return { barbeiroId: null, agendamentos: [] };
    barbeiroId = barbeiro.id;
  }

  let consulta = banco().from<AgendamentoPainel>("agendamentos")
    // "*" traz o preco congelado quando a coluna existe, sem falhar antes da migration
    .select("*, servicos(nome, preco, duracao_min)")
    .eq("barbeiro_id", barbeiroId);
  if (dia) consulta = consulta.gte("data_hora", inicioDoDia(dia).toISOString()).lte("data_hora", fimDoDia(dia).toISOString());
  const { data, error } = await consulta.order("data_hora", { ascending: true });
  if (error) throw new Error(error.message);
  // Nomes dos clientes e situacao do WhatsApp dependem so da lista: em paralelo
  const lista = data ?? [];
  const [comNomes, situacoes] = await Promise.all([
    comClientes(lista),
    situacoesWhatsapp ? buscarSituacoesWhatsapp(idsComSituacao(lista)) : Promise.resolve({} as Record<string, SituacaoPresenca>),
  ]);
  return { barbeiroId, agendamentos: comPresenca(comNomes, situacoes) };
}

// cliente_id aponta para auth.users; em profiles a coluna equivalente e user_id
async function comClientes(lista: AgendamentoPainel[]): Promise<AgendamentoPainel[]> {
  const ids = [...new Set(lista.map((a) => a.cliente_id).filter(Boolean))];
  const clientes: Record<string, { nome: string; telefone: string | null }> = {};
  if (ids.length > 0) {
    const { data } = await banco().from<{ user_id: string; nome: string; telefone: string | null }>("profiles")
      .select("user_id, nome, telefone").in("user_id", ids);
    (data ?? []).forEach((p) => { clientes[p.user_id] = { nome: p.nome, telefone: p.telefone ?? null }; });
  }
  return lista.map((a) => ({ ...a, profiles: clientes[a.cliente_id] ?? null }));
}

// Situacao do WhatsApp dos atendimentos confirmados e cancelados (o cancelado
// pode ter sido pelo WhatsApp). Opcional: se a funcao nao existir no banco ou
// falhar, a agenda segue igual.
function comPresenca(lista: AgendamentoPainel[], mapa: Record<string, SituacaoPresenca>): AgendamentoPainel[] {
  return lista.map((a) => (mapa[a.id] ? { ...a, presenca: mapa[a.id] } : a));
}

// Mensagens nao lidas de cada cliente (selo no botao de chat)
export async function buscarNaoLidas(barbeiroId: string, userId: string): Promise<Record<string, number>> {
  const { data: conversas } = await banco().from<{ id: string; cliente_id: string }>("conversas")
    .select("id, cliente_id").eq("barbeiro_id", barbeiroId);
  if (!conversas?.length) return {};
  const { data: mensagens } = await banco().from<{ conversa_id: string }>("mensagens")
    .select("conversa_id")
    .in("conversa_id", conversas.map((c) => c.id))
    .eq("lida", false)
    .neq("remetente_id", userId);
  const mapa: Record<string, number> = {};
  (mensagens ?? []).forEach((m) => {
    const c = conversas.find((x) => x.id === m.conversa_id);
    if (c) mapa[c.cliente_id] = (mapa[c.cliente_id] ?? 0) + 1;
  });
  return mapa;
}

// ---------------------------------------------------------------
// Acoes nos atendimentos: o mesmo cancelamento no Painel e na Agenda
// ---------------------------------------------------------------
export type ResultadoCancelamento =
  | { resultado: "ok"; status: "cancelado" }
  | { resultado: "inalterado"; status: StatusAgendamento | null }
  | { resultado: "erro" };

// "ok" so quando o banco confirma a alteracao. O .select() revela o caso em
// que nada mudou (RLS ou status ja alterado em outro aparelho), que nao gera
// erro: entao busca o status real para a tela mostrar.
export async function cancelarAgendamento(id: string): Promise<ResultadoCancelamento> {
  const { data, error } = await banco().from<{ id: string }>("agendamentos")
    .update({ status: "cancelado" }).eq("id", id).neq("status", "cancelado").select("id");
  if (error) return { resultado: "erro" };
  if (data?.length) return { resultado: "ok", status: "cancelado" };
  const { data: atual } = await banco().from<{ status: StatusAgendamento }>("agendamentos")
    .select("status").eq("id", id).maybeSingle();
  return { resultado: "inalterado", status: atual?.status ?? null };
}

// Falta: o horario ja passou (ou o sistema ja concluiu o atendimento sozinho)
export const ehFalta = (a: { status: string; data_hora: string }, agora: Date = new Date()) =>
  a.status === "concluido" || new Date(a.data_hora) <= agora;

// Concluido acontece sozinho; o barbeiro so cancela ou registra a falta.
// Cancelado nao oferece acao.
export type AcaoAgendamento = "cancelar" | "falta";
export const acaoDoAgendamento = (a: { status: string; data_hora: string }, agora: Date = new Date()): AcaoAgendamento | null =>
  a.status === "cancelado" ? null : ehFalta(a, agora) ? "falta" : "cancelar";

export const TEXTOS_ACAO: Record<AcaoAgendamento, { botao: string; titulo: string; mensagem: string; confirmar: string; sucesso: string }> = {
  cancelar: {
    botao: "Cancelar",
    titulo: "Cancelar agendamento?",
    mensagem: "Tem certeza de que deseja cancelar este agendamento? Essa ação poderá afetar o horário reservado pelo cliente.",
    confirmar: "Confirmar cancelamento",
    sucesso: "Agendamento cancelado com sucesso.",
  },
  falta: {
    botao: "Cliente faltou",
    titulo: "Registrar falta do cliente?",
    mensagem: "O agendamento será marcado como cancelado porque o cliente não compareceu.",
    confirmar: "Confirmar falta",
    sucesso: "Falta do cliente registrada.",
  },
};

export const TEXTOS_CANCELAMENTO = {
  voltar: "Voltar",
  processando: "Cancelando...",
  erro: "Não foi possível cancelar o agendamento. Verifique sua conexão e tente novamente.",
  inalterado: "Este agendamento não pôde ser cancelado. Ele pode já ter sido cancelado.",
  chat: "Chat",
};

// ---------------------------------------------------------------
// Dias, situacao e a Agenda (Por dia, Proximos, Historico)
// ---------------------------------------------------------------
// Datas no fuso do aparelho, o mesmo usado para exibir
export const inicioDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
export const fimDoDia = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);
export const somarDias = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const ROTULO_STATUS_AGENDAMENTO: Record<StatusAgendamento, string> = {
  confirmado: "Confirmado",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

// WhatsApp no cartao do atendimento: resposta da confirmacao de presenca e,
// separados, o cancelamento pedido (ainda nao vale) e o cancelamento
// confirmado pelo cliente (lib/whatsappAgendamentos.ts)
export { ROTULO_PRESENCA };
export const presencaDoAgendamento = presencaParaBarbeiro;

export interface SituacaoDoDia { aAtender: number; concluidos: number; cancelados: number }

export const ITENS_SITUACAO: { chave: keyof SituacaoDoDia; rotulo: string; status: StatusAgendamento }[] = [
  { chave: "aAtender", rotulo: "A atender", status: "confirmado" },
  { chave: "concluidos", rotulo: "Concluídos", status: "concluido" },
  { chave: "cancelados", rotulo: "Cancelados", status: "cancelado" },
];

// Quantos atendimentos da lista (um dia) estao em cada situacao
export const situacaoDe = (lista: { status: string }[]): SituacaoDoDia => ({
  aAtender: lista.filter((a) => a.status === "confirmado").length,
  concluidos: lista.filter((a) => a.status === "concluido").length,
  cancelados: lista.filter((a) => a.status === "cancelado").length,
});

// Atendimentos de um dia (todos os status), em ordem de horario
export function agendamentosDoDia<T extends { id: string; data_hora: string }>(lista: T[], dia: Date): T[] {
  const inicio = inicioDoDia(dia).getTime();
  const fim = somarDias(dia, 1).getTime();
  const quando = (a: T) => new Date(a.data_hora).getTime();
  return lista.filter((a) => quando(a) >= inicio && quando(a) < fim)
    .sort((a, b) => quando(a) - quando(b) || a.id.localeCompare(b.id));
}

export interface VisaoDoDia<T> { hoje: T[]; proximos: T[]; historico: T[]; situacao: SituacaoDoDia }

// Hoje: todos os atendimentos do dia, em ordem de horario. Proximos: os
// confirmados a partir de amanha. Historico: os dias anteriores, do mais
// recente para o mais antigo.
export function visaoDoDia<T extends { id: string; data_hora: string; status: string }>(lista: T[], agora: Date = new Date()): VisaoDoDia<T> {
  const inicio = inicioDoDia(agora).getTime();
  const fim = somarDias(agora, 1).getTime();
  const quando = (a: T) => new Date(a.data_hora).getTime();
  const hoje = agendamentosDoDia(lista, agora);
  return {
    hoje,
    proximos: ordenarAgendamentos(lista.filter((a) => quando(a) >= fim && a.status === "confirmado"), agora),
    historico: ordenarAgendamentos(lista.filter((a) => quando(a) < inicio), agora),
    situacao: situacaoDe(hoje),
  };
}

// Modos da Agenda: o dia escolhido (navegacao por datas), a lista completa
// dos proximos e o historico
export type ModoAgenda = "dia" | "proximos" | "historico";

export const MODOS_AGENDA: { valor: ModoAgenda; rotulo: string }[] = [
  { valor: "dia", rotulo: "Por dia" },
  { valor: "proximos", rotulo: "Próximos" },
  { valor: "historico", rotulo: "Histórico" },
];

export const VAZIO_MODO: Record<ModoAgenda, string> = {
  dia: "Nenhum agendamento neste dia.",
  proximos: "Nenhum agendamento marcado para os próximos dias.",
  historico: "Nenhum atendimento anterior a hoje.",
};

// Lista de cada modo. "dia": os agendamentos ja vem so do dia escolhido (o
// banco filtra pelo intervalo); "proximos" e "historico": a partir de todos.
export function listaDoModo<T extends { id: string; data_hora: string; status: string }>(modo: ModoAgenda, lista: T[], agora: Date = new Date()): T[] {
  if (modo === "dia") return lista;
  return visaoDoDia(lista, agora)[modo];
}

export const TEXTOS_AGENDA = {
  rotulo: "Agenda do barbeiro",
  titulo: "Agenda",
  situacao: "Situação do dia",
  diaAnterior: "Dia anterior",
  diaSeguinte: "Próximo dia",
  irParaHoje: "Voltar para hoje",
  erro: "Erro ao carregar a agenda",
};

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

// Navegacao por datas: { titulo: "Hoje" | "Amanhã" | "Ontem" | "sexta-feira", data: "06 de novembro de 2026" }
export function rotuloDoDia(dia: Date, agora: Date = new Date()): { titulo: string; data: string } {
  const titulo = mesmoDia(dia, agora) ? "Hoje" : mesmoDia(dia, somarDias(agora, 1)) ? "Amanhã"
    : mesmoDia(dia, somarDias(agora, -1)) ? "Ontem" : DIAS_SEMANA.extenso[(dia.getDay() + 6) % 7];
  return { titulo, data: `${dois(dia.getDate())} de ${MESES[dia.getMonth()]} de ${dia.getFullYear()}` };
}

// ---------------------------------------------------------------
// Exibicao dos atendimentos
// ---------------------------------------------------------------
const dois = (n: number) => String(n).padStart(2, "0");
const mesmoDia = (a: Date, b: Date) =>
  a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const DIAS_CURTOS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const horaDoAgendamento = (iso: string) => {
  const d = new Date(iso);
  return `${dois(d.getHours())}:${dois(d.getMinutes())}`;
};

// "Hoje · 14:30", "Amanhã · 09:00", "Ontem · 18:00" ou "qua 05/11 · 14:30"
export function quandoDoAgendamento(iso: string, agora: Date = new Date()): string {
  const d = new Date(iso);
  const amanha = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1);
  const ontem = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 1);
  const ano = d.getFullYear() !== agora.getFullYear() ? `/${d.getFullYear()}` : "";
  const dia = mesmoDia(d, agora) ? "Hoje" : mesmoDia(d, amanha) ? "Amanhã" : mesmoDia(d, ontem) ? "Ontem"
    : `${DIAS_CURTOS[d.getDay()]} ${dois(d.getDate())}/${dois(d.getMonth() + 1)}${ano}`;
  return `${dia} · ${horaDoAgendamento(iso)}`;
}

// "05/11 · 14:30" (confirmacao de cancelamento)
export const dataHoraCurta = (iso: string) => {
  const d = new Date(iso);
  return `${dois(d.getDate())}/${dois(d.getMonth() + 1)} · ${horaDoAgendamento(iso)}`;
};

// Preco congelado na reserva; antes da migration do financeiro, o do servico
export const precoDoAgendamento = (a: { preco?: number | null; servicos: { preco: number } | null }) =>
  a.preco ?? a.servicos?.preco ?? null;

export const duracaoDoAgendamento = (a: { duracao_min: number | null; servicos: { duracao_min: number } | null }) =>
  a.duracao_min ?? a.servicos?.duracao_min ?? null;

// ---------------------------------------------------------------
// Meu desempenho, atendimentos realizados e comissoes
// ---------------------------------------------------------------
// Os mesmos periodos do financeiro, sem o ano
export const PERIODOS_PAINEL = PERIODOS.filter((p) => p.valor !== "ano");

export const TEXTOS_PAINEL = {
  rotulo: "Painel do barbeiro",
  titulo: "Painel",
  semVinculo: "Sua conta ainda não está vinculada a um barbeiro. Peça ao administrador para configurar seu perfil.",
  visaoDoDia: "Visão do dia",
  situacao: "Situação da agenda",
  hoje: "Atendimentos de hoje",
  hojeVazio: "Nenhum atendimento marcado para hoje.",
  abrirAgenda: "Abrir agenda",
  desempenho: "Meu desempenho",
  periodoNota: "O período vale para Meu desempenho, Atendimentos realizados e Comissões e recebimentos.",
  resultado: "Resultado financeiro",
  resultadoNota: "Atendimentos concluídos e pagos, já com descontos, reembolsos e estornos.",
  faturamento: "Faturamento gerado",
  faturamentoNota: "Valor pago pelos clientes nos seus serviços. Não é o valor que você recebe.",
  comissao: "Minha comissão",
  comissaoNota: "Gerada no período",
  percentual: "Meu percentual",
  atendimentos: "Atendimentos realizados · dias com mais cortes",
  atendimentosNota: "Quantidade de atendimentos concluídos, pagos ou não. Não é um valor financeiro.",
  atendimentosVazio: "Nenhum atendimento concluído no período.",
  comissoes: "Comissões e recebimentos",
  servicosComissao: "Serviços com comissão",
  recebido: "Recebido no período",
  saldo: "Saldo a receber",
  lancamentos: "Serviços que geraram comissão",
  lancamentosVazio: "Nenhum serviço concluído e pago no período.",
  pagamentos: "Pagamentos recebidos",
  pagamentosVazio: "Nenhum pagamento de comissão registrado ainda.",
  erroAgenda: "Não foi possível carregar seus agendamentos.",
  erroFinanceiro: "Não foi possível carregar seu financeiro.",
  erroDesempenho: "Não foi possível carregar seu desempenho.",
};

export const ORIGEM_PERCENTUAL: Record<"individual" | "padrao", string> = {
  individual: "Percentual individual",
  padrao: "Padrão da barbearia",
};

export const ROTULO_LANCAMENTO: Record<MeuFinanceiro["lancamentos"][number]["tipo"], string> = {
  servico: "Serviço",
  reembolso: "Reembolso",
  cancelamento: "Cancelado",
};

// Percentual em vigor: individual > padrao > pendente (nunca inventado)
export function cartaoPercentual(d: MeuDesempenho | null): { valor: string; nota: string; pendente: boolean } {
  if (!d) return { valor: "—", nota: "Indisponível", pendente: false };
  if (d.percentual == null) return { valor: "Pendente", nota: "Aguardando configuração do admin", pendente: true };
  return { valor: percentual(d.percentual), nota: d.percentual_origem ? ORIGEM_PERCENTUAL[d.percentual_origem] : "", pendente: false };
}

// Todas as comissoes geradas menos o que ja foi pago ao barbeiro
export const saldoAReceber = (f: MeuFinanceiro) => Number(f.comissao_total) - Number(f.recebido_total);
export const notaSaldo = (f: MeuFinanceiro) => `Comissões acumuladas ${formatarReais(f.comissao_total)}, menos o que já foi pago`;

// Segunda (indice 0) a domingo (indice 6), como meu_desempenho devolve
export const DIAS_SEMANA = {
  curto: ["SEG", "TER", "QUA", "QUI", "SEX", "SÁB", "DOM"],
  extenso: ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"],
};

const atendimentos = (n: number) => `${n} ${n === 1 ? "atendimento" : "atendimentos"}`;
export const rotuloDia = (indice: number, quantidade: number) => `${DIAS_SEMANA.extenso[indice]}: ${atendimentos(quantidade)}`;

export function resumoDiasSemana(dias: number[]) {
  const total = dias.reduce((s, v) => s + v, 0);
  const maximo = Math.max(0, ...dias);
  const destaques = total ? DIAS_SEMANA.extenso.filter((_, i) => dias[i] === maximo) : [];
  return { total, maximo, destaques, texto: total ? `${atendimentos(total)} · mais movimento: ${destaques.join(", ")}` : "" };
}

// Data de hoje por extenso: "quarta-feira, 05/11"
export const dataDeHoje = (agora: Date = new Date()) =>
  `${DIAS_SEMANA.extenso[(agora.getDay() + 6) % 7]}, ${dois(agora.getDate())}/${dois(agora.getMonth() + 1)}`;

export interface PainelFinanceiro {
  financeiro: MeuFinanceiro | null;
  desempenho: MeuDesempenho | null;
  erroFinanceiro: string | null;
  erroDesempenho: string | null;
}

const mensagemDe = (e: unknown, padrao: string) => (e instanceof Error && e.message ? e.message : padrao);

// Independentes: se o desempenho falhar, o resto do financeiro continua na tela
export async function buscarPainelFinanceiro(inicio: string, fim: string): Promise<PainelFinanceiro> {
  const [fin, des] = await Promise.allSettled([buscarMeuFinanceiro(inicio, fim), buscarMeuDesempenho(inicio, fim)]);
  return {
    financeiro: fin.status === "fulfilled" ? fin.value : null,
    erroFinanceiro: fin.status === "rejected" ? mensagemDe(fin.reason, TEXTOS_PAINEL.erroFinanceiro) : null,
    desempenho: des.status === "fulfilled" ? des.value : null,
    erroDesempenho: des.status === "rejected" ? mensagemDe(des.reason, TEXTOS_PAINEL.erroDesempenho) : null,
  };
}

// ---------------------------------------------------------------
// Painel: indicadores do periodo, comparacao com o periodo anterior,
// graficos, proximos atendimentos e avaliacoes.
// Nenhum valor financeiro e calculado aqui: faturamento, comissao e servicos
// pagos vem de meu_financeiro (regras no banco). As contagens vem dos
// agendamentos e das avaliacoes do proprio barbeiro (RLS), so somadas e
// agrupadas para exibir.
// ---------------------------------------------------------------
export interface Intervalo { inicio: string; fim: string }

const deIso = (iso: string) => { const [a, m, d] = iso.slice(0, 10).split("-").map(Number); return new Date(a, m - 1, d); };
const isoDe = (d: Date) => `${d.getFullYear()}-${dois(d.getMonth() + 1)}-${dois(d.getDate())}`;
const diasNoIntervalo = (i: Intervalo) => Math.round((deIso(i.fim).getTime() - deIso(i.inicio).getTime()) / 86400000) + 1;
// Dia (AAAA-MM-DD, fuso do aparelho) de um horario do banco
export const diaDoHorario = (iso: string) => isoDe(new Date(iso));
const noIntervalo = (dia: string, i: Intervalo) => dia >= i.inicio && dia <= i.fim;

// Trecho comparavel do periodo anterior. Periodo que ainda nao terminou (a
// semana, o mes) compara so os dias ja passados: 01 a 25/11 contra 01 a 25/10,
// nao contra outubro inteiro. Mes inteiro compara com o mes anterior; os
// demais, com o mesmo numero de dias logo antes.
export function periodoAnterior(atual: Intervalo, agora: Date = new Date()): Intervalo {
  const hoje = isoDe(agora);
  const fimUtil = atual.inicio <= hoje && atual.fim > hoje ? hoje : atual.fim;
  const decorridos = diasNoIntervalo({ inicio: atual.inicio, fim: fimUtil });
  const ini = deIso(atual.inicio);
  const mesInteiro = ini.getDate() === 1 && atual.fim === isoDe(new Date(ini.getFullYear(), ini.getMonth() + 1, 0));
  const inicio = mesInteiro ? new Date(ini.getFullYear(), ini.getMonth() - 1, 1) : somarDias(ini, -diasNoIntervalo(atual));
  let fim = somarDias(inicio, decorridos - 1);
  if (mesInteiro) {
    const ultimo = new Date(inicio.getFullYear(), inicio.getMonth() + 1, 0);
    if (fim > ultimo) fim = ultimo;
  }
  return { inicio: isoDe(inicio), fim: isoDe(fim) };
}

// "01/11 a 25/11"
export const textoIntervalo = (i: Intervalo) => {
  const curta = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return i.inicio === i.fim ? curta(i.inicio) : `${curta(i.inicio)} a ${curta(i.fim)}`;
};

// Variacao contra o periodo anterior. "pontos": diferenca absoluta (nota media);
// "percentual": diferenca relativa. Sem valor anterior (0), so mostra o anterior.
export type Tendencia = "alta" | "queda" | "estavel";
export interface Variacao { tendencia: Tendencia; texto: string }

export function variacao(atual: number | null, anterior: number | null, modo: "percentual" | "pontos" = "percentual"): Variacao | null {
  if (atual == null || anterior == null) return null;
  const diferenca = Math.round((atual - anterior) * 100) / 100;
  const tendencia: Tendencia = diferenca > 0 ? "alta" : diferenca < 0 ? "queda" : "estavel";
  if (tendencia === "estavel") return { tendencia, texto: "igual ao anterior" };
  const sinal = diferenca > 0 ? "+" : "";
  if (modo === "pontos") return { tendencia, texto: `${sinal}${diferenca.toFixed(1).replace(".", ",")} vs. anterior` };
  if (anterior === 0) return { tendencia, texto: "anterior: 0" };
  const pct = Math.round((diferenca / Math.abs(anterior)) * 100);
  return { tendencia, texto: `${sinal}${pct}% vs. anterior` };
}

// Valor medio pago por servico pago, com os mesmos numeros do Resultado
// financeiro (os dois ja liquidos de descontos, reembolsos e estornos)
export const ticketMedio = (f: { faturamento: number; servicos: number } | null) =>
  f && Number(f.servicos) > 0 ? Number(f.faturamento) / Number(f.servicos) : null;

// ---------------------------------------------------------------
// Atendimentos do periodo (contagens e servicos mais realizados)
// ---------------------------------------------------------------
export interface AtendimentoDoPeriodo { id: string; data_hora: string; status: StatusAgendamento; servicos: { nome: string } | null }

export interface ResumoAtendimentos {
  concluidos: number;
  // Inclui as faltas: "Cliente faltou" tambem grava o status cancelado
  cancelados: number;
  aAtender: number;
  servicos: { nome: string; quantidade: number }[];
}

export const SERVICO_SEM_NOME = "Serviço removido";

export function resumoAtendimentos(lista: AtendimentoDoPeriodo[], intervalo: Intervalo): ResumoAtendimentos {
  const doPeriodo = lista.filter((a) => noIntervalo(diaDoHorario(a.data_hora), intervalo));
  const situacao = situacaoDe(doPeriodo);
  const porServico = new Map<string, number>();
  doPeriodo.filter((a) => a.status === "concluido").forEach((a) => {
    const nome = a.servicos?.nome ?? SERVICO_SEM_NOME;
    porServico.set(nome, (porServico.get(nome) ?? 0) + 1);
  });
  const servicos = [...porServico.entries()].map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome));
  return { concluidos: situacao.concluidos, cancelados: situacao.cancelados, aAtender: situacao.aAtender, servicos };
}

// ---------------------------------------------------------------
// Faixas dos graficos: por dia ate 31 dias, por semana ate 26 semanas,
// por mes acima disso
// ---------------------------------------------------------------
export type Agrupamento = "dia" | "semana" | "mes";
export interface Faixa { inicio: string; fim: string; rotulo: string }

export function faixasDoPeriodo(i: Intervalo): { faixas: Faixa[]; agrupamento: Agrupamento } {
  const total = diasNoIntervalo(i);
  const agrupamento: Agrupamento = total <= 31 ? "dia" : total <= 182 ? "semana" : "mes";
  const faixas: Faixa[] = [];
  let atual = deIso(i.inicio);
  const ultimo = deIso(i.fim);
  while (atual <= ultimo && faixas.length < 400) {
    const fimFaixa = agrupamento === "dia" ? atual
      : agrupamento === "semana" ? somarDias(atual, 6)
        : new Date(atual.getFullYear(), atual.getMonth() + 1, 0);
    const fim = fimFaixa > ultimo ? ultimo : fimFaixa;
    const rotulo = agrupamento === "mes" ? `${dois(atual.getMonth() + 1)}/${atual.getFullYear()}` : `${dois(atual.getDate())}/${dois(atual.getMonth() + 1)}`;
    faixas.push({ inicio: isoDe(atual), fim: isoDe(fim), rotulo });
    atual = somarDias(fim, 1);
  }
  return { faixas, agrupamento };
}

const faixaDoDia = (faixas: Faixa[], dia: string) => faixas.find((f) => dia >= f.inicio && dia <= f.fim);

export interface PontoFinanceiro extends Faixa { faturamento: number; comissao: number }

// Faturamento e comissao por faixa, somando os lancamentos de meu_financeiro
// (data do atendimento, como os cartoes). Reembolsos e estornos descontam.
export function evolucaoFinanceira(lancamentos: MeuFinanceiro["lancamentos"], i: Intervalo): { pontos: PontoFinanceiro[]; agrupamento: Agrupamento } {
  const { faixas, agrupamento } = faixasDoPeriodo(i);
  const pontos = faixas.map((f) => ({ ...f, faturamento: 0, comissao: 0 }));
  lancamentos.forEach((l) => {
    const p = faixaDoDia(pontos, l.competencia.slice(0, 10)) as PontoFinanceiro | undefined;
    if (!p) return;
    p.faturamento += Number(l.valor_pago);
    p.comissao += Number(l.comissao);
  });
  pontos.forEach((p) => {
    p.faturamento = Math.round(p.faturamento * 100) / 100;
    p.comissao = Math.round(p.comissao * 100) / 100;
  });
  return { pontos, agrupamento };
}

export interface PontoAtendimentos extends Faixa { concluidos: number }

// Atendimentos concluidos por faixa (pagos ou nao)
export function atendimentosPorFaixa(lista: AtendimentoDoPeriodo[], i: Intervalo): { pontos: PontoAtendimentos[]; agrupamento: Agrupamento } {
  const { faixas, agrupamento } = faixasDoPeriodo(i);
  const pontos = faixas.map((f) => ({ ...f, concluidos: 0 }));
  lista.forEach((a) => {
    if (a.status !== "concluido") return;
    const p = faixaDoDia(pontos, diaDoHorario(a.data_hora)) as PontoAtendimentos | undefined;
    if (p) p.concluidos += 1;
  });
  return { pontos, agrupamento };
}

export const NOME_AGRUPAMENTO: Record<Agrupamento, string> = { dia: "por dia", semana: "por semana", mes: "por mês" };

// ---------------------------------------------------------------
// Avaliacoes dos clientes (so as do proprio barbeiro, pelo RLS)
// ---------------------------------------------------------------
export interface AvaliacaoPainel {
  id: string; nota: number; comentario: string | null; created_at: string; cliente_id: string | null;
  // Nome do cliente: so nas mais recentes, as que aparecem na lista
  cliente?: string | null;
}
export interface ResumoAvaliacoes { media: number | null; total: number }

export function resumoAvaliacoes(lista: AvaliacaoPainel[], i?: Intervalo): ResumoAvaliacoes {
  const doPeriodo = i ? lista.filter((a) => noIntervalo(diaDoHorario(a.created_at), i)) : lista;
  if (!doPeriodo.length) return { media: null, total: 0 };
  const media = doPeriodo.reduce((s, a) => s + Number(a.nota), 0) / doPeriodo.length;
  return { media: Math.round(media * 10) / 10, total: doPeriodo.length };
}

export const notaComVirgula = (n: number) => n.toFixed(1).replace(".", ",");
const avaliacoesTexto = (n: number) => `${n} ${n === 1 ? "avaliação" : "avaliações"}`;
export const notaAvaliacoes = (periodo: ResumoAvaliacoes, geral: ResumoAvaliacoes) =>
  periodo.total ? `${avaliacoesTexto(periodo.total)} no período`
    : geral.total ? `Nenhuma no período · geral ${notaComVirgula(geral.media ?? 0)} (${avaliacoesTexto(geral.total)})`
      : "Nenhuma avaliação recebida ainda";

// Lancamentos e pagamentos: os cinco mais recentes, com "ver todos"
export const LIMITE_LISTA = 5;
export const AVALIACOES_RECENTES = 5;

// ---------------------------------------------------------------
// Consultas do Painel (todas so do proprio barbeiro)
// ---------------------------------------------------------------
const POR_PAGINA = 1000;

// O Supabase devolve no maximo 1000 linhas por consulta: periodos longos vem em paginas
async function todasAsPaginas<L>(montar: () => Consulta<L>): Promise<L[]> {
  const linhas: L[] = [];
  for (let de = 0; ; de += POR_PAGINA) {
    const { data, error } = await montar().range(de, de + POR_PAGINA - 1);
    if (error) throw new Error(error.message);
    linhas.push(...(data ?? []));
    if (!data || data.length < POR_PAGINA) return linhas;
  }
}

// Status e servico dos agendamentos do intervalo (o Painel pede o periodo
// atual e o anterior numa consulta so). Sem cliente, sem valores.
export const buscarAtendimentosDoPeriodo = (barbeiroId: string, i: Intervalo) =>
  todasAsPaginas(() => banco().from<AtendimentoDoPeriodo>("agendamentos")
    .select("id, data_hora, status, servicos(nome)")
    .eq("barbeiro_id", barbeiroId)
    .gte("data_hora", inicioDoDia(deIso(i.inicio)).toISOString())
    .lte("data_hora", fimDoDia(deIso(i.fim)).toISOString())
    .order("data_hora", { ascending: true }));

// Proximos atendimentos (a partir de amanha; os de hoje ja estao na Visao do
// dia). So os primeiros: a lista completa fica na Agenda.
export async function buscarProximos(barbeiroId: string, agora: Date = new Date(), limite = 5): Promise<AgendamentoPainel[]> {
  const { data, error } = await banco().from<AgendamentoPainel>("agendamentos")
    .select("*, servicos(nome, preco, duracao_min)")
    .eq("barbeiro_id", barbeiroId)
    .eq("status", "confirmado")
    .gte("data_hora", inicioDoDia(somarDias(agora, 1)).toISOString())
    .order("data_hora", { ascending: true })
    .limit(limite);
  if (error) throw new Error(error.message);
  return comClientes(data ?? []);
}

// Todas as avaliacoes do barbeiro (a nota de cada periodo sai daqui, sem nova
// consulta ao trocar o filtro). Nome do cliente so nas mais recentes.
export async function buscarAvaliacoes(barbeiroId: string): Promise<AvaliacaoPainel[]> {
  const lista = await todasAsPaginas(() => banco().from<AvaliacaoPainel>("avaliacoes")
    .select("id, nota, comentario, created_at, cliente_id")
    .eq("barbeiro_id", barbeiroId)
    .order("created_at", { ascending: false }));
  const recentes = lista.slice(0, AVALIACOES_RECENTES);
  const ids = [...new Set(recentes.map((a) => a.cliente_id).filter((id): id is string => !!id))];
  if (!ids.length) return lista;
  const { data } = await banco().from<{ user_id: string; nome: string }>("profiles").select("user_id, nome").in("user_id", ids);
  const nomes: Record<string, string> = {};
  (data ?? []).forEach((p) => { nomes[p.user_id] = p.nome; });
  return lista.map((a, i) => (i < AVALIACOES_RECENTES ? { ...a, cliente: a.cliente_id ? nomes[a.cliente_id] ?? null : null } : a));
}

export const TEXTOS_INDICADORES = {
  titulo: "Indicadores do período",
  atendimentos: "Atendimentos concluídos",
  atendimentosNota: "Concluídos no período, pagos ou não",
  ticket: "Ticket médio",
  ticketNota: "Faturamento ÷ serviços pagos",
  avaliacao: "Avaliação média",
  cancelamentos: "Cancelamentos e faltas",
  cancelamentosNota: "Inclui as faltas registradas: o sistema não as separa",
  indisponivel: "Indisponível",
  semComparacao: "Sem comparação",
  comparado: "Comparado a",
  evolucao: "Evolução do faturamento",
  evolucaoNota: "Lançamentos oficiais pela data do atendimento, já com reembolsos e estornos.",
  verFaturamento: "Faturamento",
  verComissao: "Comissão",
  atendimentosPeriodo: "Atendimentos por período",
  atendimentosPeriodoNota: "Atendimentos concluídos, pagos ou não. Não é um valor financeiro.",
  servicos: "Serviços mais realizados",
  servicosNota: "Atendimentos concluídos de cada serviço no período.",
  servicosVazio: "Nenhum serviço concluído no período.",
  diasSemana: "Desempenho por dia da semana",
  umDia: "Escolha um período de mais de um dia para ver a evolução.",
  semFaturamento: "Nenhum faturamento no período.",
  proximos: "Próximos atendimentos",
  proximosVazio: "Nenhum atendimento marcado para os próximos dias.",
  verAgenda: "Ver todos na Agenda",
  avaliacoes: "Avaliações recentes",
  avaliacoesVazio: "Você ainda não recebeu avaliações.",
  verTodos: "Ver todos",
  verMenos: "Ver menos",
  erroAtividade: "Não foi possível carregar os atendimentos do período.",
  erroProximos: "Não foi possível carregar os próximos atendimentos.",
  erroAvaliacoes: "Não foi possível carregar as avaliações.",
  divisao: "Para onde vai o faturamento",
  comissoesPagas: "Comissões já pagas",
  tentar: "Tentar novamente",
};
