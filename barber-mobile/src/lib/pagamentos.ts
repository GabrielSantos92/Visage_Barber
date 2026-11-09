// Pagamentos do cliente (PIX, cartao pelo Mercado Pago e presencial).
// Quem cria a cobranca e confirma o pagamento e o backend; o app so mostra o
// estado gravado no banco e pede uma nova consulta ao provedor quando preciso.
import { supabase } from './supabase';
import { api } from './api';

export type MetodoPagamento = 'pix' | 'cartao' | 'presencial';
export type StatusPagamento =
  | 'pending' | 'approved' | 'rejected' | 'expired' | 'refunded' | 'partially_refunded' | 'canceled';

export interface Pagamento {
  id: string;
  agendamento_id: string;
  metodo: MetodoPagamento;
  status: StatusPagamento;
  valor_original: number;
  desconto: number;
  valor: number;
  valor_reembolsado: number;
  pix_copia_cola: string | null;
  pix_qr_base64: string | null;
  link_pagamento: string | null;
  expira_em: string | null;
  aprovado_em: string | null;
  criado_em?: string;
}

export const ROTULO_METODO: Record<MetodoPagamento, string> = {
  pix: 'PIX',
  cartao: 'Cartão de crédito',
  presencial: 'Na barbearia',
};

export const ROTULO_STATUS: Record<StatusPagamento, string> = {
  pending: 'Aguardando pagamento',
  approved: 'Pago',
  rejected: 'Recusado',
  expired: 'Expirado',
  refunded: 'Reembolsado',
  partially_refunded: 'Reembolso parcial',
  canceled: 'Cancelado',
};

export const formatarReais = (v: number | string | null | undefined) =>
  Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export const pago = (p?: Pagamento | null) => !!p && (p.status === 'approved' || p.status === 'partially_refunded');

// PIX ainda em aberto, mas com o prazo vencido (o provedor ainda vai avisar)
export const pixVencido = (p: Pagamento, agora = Date.now()) =>
  p.metodo === 'pix' && p.status === 'pending' && !!p.expira_em && new Date(p.expira_em).getTime() <= agora;

export type TipoMensagem = 'sucesso' | 'aviso' | 'erro' | 'info';

// Mensagem clara para cada situacao do pagamento
export function mensagemDoPagamento(p: Pagamento, agora = Date.now()): { tipo: TipoMensagem; titulo: string; texto: string } {
  if (pixVencido(p, agora)) {
    return { tipo: 'erro', titulo: 'PIX expirado', texto: 'O prazo do QR Code acabou. Gere um novo PIX ou escolha outra forma de pagamento.' };
  }
  switch (p.status) {
    case 'approved':
      return { tipo: 'sucesso', titulo: 'Pagamento aprovado', texto: 'Seu pagamento foi confirmado. É só comparecer no horário marcado.' };
    case 'pending':
      if (p.metodo === 'presencial') {
        return { tipo: 'info', titulo: 'Pagamento na barbearia', texto: 'Você paga no dia do atendimento, direto na barbearia.' };
      }
      return p.metodo === 'pix'
        ? { tipo: 'aviso', titulo: 'Aguardando o PIX', texto: 'Pague com o QR Code ou o código copia e cola. A confirmação aparece aqui automaticamente.' }
        : { tipo: 'aviso', titulo: 'Pagamento pendente', texto: 'Conclua o pagamento na página segura do Mercado Pago. A confirmação aparece aqui automaticamente.' };
    case 'rejected':
      return { tipo: 'erro', titulo: 'Pagamento recusado', texto: 'O pagamento não foi aprovado. Tente outro cartão ou outra forma de pagamento.' };
    case 'expired':
      return { tipo: 'erro', titulo: 'PIX expirado', texto: 'O prazo do QR Code acabou. Gere um novo PIX ou escolha outra forma de pagamento.' };
    case 'refunded':
      return { tipo: 'info', titulo: 'Reembolso realizado', texto: 'O valor deste pagamento foi devolvido.' };
    case 'partially_refunded':
      return { tipo: 'info', titulo: 'Reembolso parcial realizado', texto: `${formatarReais(p.valor_reembolsado)} foram devolvidos.` };
    default:
      return { tipo: 'info', titulo: 'Pagamento cancelado', texto: 'Esta cobrança foi cancelada. Escolha uma forma de pagamento para continuar.' };
  }
}

// O pagamento que vale para o agendamento: o pago; senao o em aberto; senao o mais recente
export function pagamentoAtual(lista: Pagamento[]): Pagamento | null {
  const ordem = (p: Pagamento) =>
    p.status === 'approved' || p.status === 'partially_refunded' || p.status === 'refunded' ? 0 : p.status === 'pending' ? 1 : 2;
  return [...lista].sort((a, b) => ordem(a) - ordem(b) || String(b.criado_em ?? '').localeCompare(String(a.criado_em ?? '')))[0] ?? null;
}

// Tabela da migration 20261105000018, ainda fora dos tipos gerados do Supabase
type Resposta<T> = PromiseLike<{ data: T | null; error: { message: string } | null }>;
interface PagamentosDb {
  from(t: 'pagamentos'): {
    select(c: string): { in(col: string, v: string[]): { order(c: string, o: { ascending: boolean }): Resposta<Pagamento[]> } };
  };
}

const CAMPOS =
  'id, agendamento_id, metodo, status, valor_original, desconto, valor, valor_reembolsado, pix_copia_cola, pix_qr_base64, link_pagamento, expira_em, aprovado_em, criado_em';

// Pagamentos dos agendamentos (o RLS so devolve os do proprio cliente)
export async function buscarPagamentos(agendamentoIds: string[]): Promise<Pagamento[]> {
  if (!agendamentoIds.length) return [];
  const { data, error } = await (supabase as unknown as PagamentosDb)
    .from('pagamentos').select(CAMPOS).in('agendamento_id', agendamentoIds).order('criado_em', { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((p) => ({ ...p, valor: Number(p.valor), valor_original: Number(p.valor_original), desconto: Number(p.desconto), valor_reembolsado: Number(p.valor_reembolsado) }));
}

export const criarPagamento = (agendamentoId: string, metodo: MetodoPagamento) =>
  api.post<Pagamento>('/api/pagamentos', { agendamento_id: agendamentoId, metodo });

export const sincronizarPagamento = (id: string) => api.post<Pagamento>(`/api/pagamentos/${id}/sincronizar`, {});

// Reembolso no Mercado Pago (admin). O motivo fica no historico do pagamento.
export const reembolsarOnline = (id: string, valor?: number, motivo?: string) =>
  api.post<Pagamento>(`/api/pagamentos/${id}/reembolsar`, { ...(valor == null ? {} : { valor }), ...(motivo ? { motivo } : {}) });

// Cobrancas canceladas aqui que ainda podem ser pagas no Mercado Pago (admin):
// de um agendamento ou todas
export const cancelarCobrancasAbertas = (agendamentoId?: string) =>
  api.post<{ canceladas: number; falharam: number }>('/api/pagamentos/cobrancas-abertas/cancelar', agendamentoId ? { agendamento_id: agendamentoId } : {});
