// Situacao do WhatsApp de cada agendamento: confirmacao de presenca
// (migration 25) e cancelamento com confirmacao dupla (migration 26), lida de
// presenca_dos_agendamentos. O banco so devolve os agendamentos que quem chama
// pode ver (o cliente, o barbeiro do atendimento ou o admin).
// O mesmo codigo existe no site (cut-advisor-pro/src/lib/whatsappAgendamentos.ts)
// e no app (barber-mobile/src/lib/whatsappAgendamentos.ts); o teste de paridade confere.
import { supabase } from './supabase';

export type SituacaoPresenca =
  | 'confirmada' | 'recusada' | 'sem_resposta' | 'pendente' | 'nao_enviada'
  // Cancelamento pelo WhatsApp (migration 26): pedido pendente nao e cancelamento
  | 'cancelamento_pendente' | 'cancelamento_desistido' | 'cancelamento_nao_confirmado' | 'cancelada_whatsapp';

type Linha = { agendamento_id: string; situacao: SituacaoPresenca };
type ComRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data?: Linha[] | null; error: { message: string } | null }> };

// Opcional: se a funcao nao existir no banco ou falhar, as telas seguem iguais
export async function buscarSituacoesWhatsapp(ids: string[]): Promise<Record<string, SituacaoPresenca>> {
  if (ids.length === 0) return {};
  try {
    const { data, error } = await (supabase as unknown as ComRpc).rpc('presenca_dos_agendamentos', { p_ids: ids });
    if (error || !Array.isArray(data)) return {};
    return Object.fromEntries(data.map((p) => [p.agendamento_id, p.situacao]));
  } catch {
    return {};
  }
}

// So os agendamentos que podem ter situacao: confirmados e cancelados
export const idsComSituacao = (lista: { id: string; status: string }[]) =>
  lista.filter((a) => a.status === 'confirmado' || a.status === 'cancelado').map((a) => a.id);

export type TomPresenca = 'ok' | 'alerta' | 'neutro';
export interface AvisoWhatsapp { texto: string; tom: TomPresenca }
type ComSituacao = { status: string; presenca?: SituacaoPresenca | null; data_hora?: string | null };

// O atendimento ainda nao comecou (sem data, considera que nao)
const aindaVaiAcontecer = (a: ComSituacao, agora = Date.now()) =>
  !a.data_hora || new Date(a.data_hora).getTime() > agora;

// Barbeiro: cartao da agenda e do painel
export const ROTULO_PRESENCA = {
  confirmada: 'Presença confirmada pelo WhatsApp',
  recusada: 'Cliente avisou que não virá',
  sem_resposta: 'Sem resposta no WhatsApp',
  cancelamento_pendente: 'Cancelamento pedido pelo WhatsApp · aguardando o cliente confirmar',
  cancelamento_desistido: 'Cliente desistiu do cancelamento · agendamento mantido',
  cancelamento_nao_confirmado: 'Cliente pediu para cancelar e não confirmou · agendamento mantido',
  cancelada_whatsapp: 'Cancelado pelo cliente pelo WhatsApp',
} as const;

export function presencaParaBarbeiro(a: ComSituacao): AvisoWhatsapp | null {
  if (a.status === 'cancelado') {
    return a.presenca === 'cancelada_whatsapp' ? { texto: ROTULO_PRESENCA.cancelada_whatsapp, tom: 'alerta' } : null;
  }
  if (a.status !== 'confirmado') return null;
  switch (a.presenca) {
    case 'confirmada': return { texto: ROTULO_PRESENCA.confirmada, tom: 'ok' };
    case 'sem_resposta': return { texto: ROTULO_PRESENCA.sem_resposta, tom: 'neutro' };
    case 'recusada': return { texto: ROTULO_PRESENCA.recusada, tom: 'alerta' };
    case 'cancelamento_pendente': return { texto: ROTULO_PRESENCA.cancelamento_pendente, tom: 'alerta' };
    case 'cancelamento_desistido': return { texto: ROTULO_PRESENCA.cancelamento_desistido, tom: 'ok' };
    case 'cancelamento_nao_confirmado': return { texto: ROTULO_PRESENCA.cancelamento_nao_confirmado, tom: 'alerta' };
    default: return null;
  }
}

// Cliente: historico em Meus agendamentos
export function whatsappParaCliente(a: ComSituacao): string | null {
  if (a.status === 'cancelado' && a.presenca === 'cancelada_whatsapp') return 'Cancelado por você pelo WhatsApp';
  if (a.status === 'confirmado' && a.presenca === 'cancelamento_pendente') {
    return 'Você pediu o cancelamento pelo WhatsApp. Ele só vale depois que você tocar em SIM, CANCELAR na mensagem; até lá, o horário continua reservado.';
  }
  // Pedido pelo WhatsApp que nao foi concluido (a confirmacao nao chegou ou
  // nao foi respondida) e o atendimento ainda vai acontecer
  if (a.status === 'confirmado' && a.presenca === 'cancelamento_nao_confirmado' && aindaVaiAcontecer(a)) {
    return 'Seu pedido de cancelamento pelo WhatsApp não foi concluído: o cancelamento NÃO foi feito e o horário continua reservado. Para cancelar, use o botão Cancelar ou fale com a barbearia.';
  }
  return null;
}

// Admin: agendamentos recentes do painel
export function whatsappParaAdmin(a: ComSituacao): string | null {
  if (a.status === 'cancelado' && a.presenca === 'cancelada_whatsapp') return 'Cancelado pelo cliente via WhatsApp';
  if (a.status === 'confirmado' && a.presenca === 'cancelamento_pendente') return 'Cancelamento pendente no WhatsApp';
  return null;
}
