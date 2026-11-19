// Central de notificacoes (migration 30): o historico do proprio usuario,
// lido do banco pelo app logado. O banco so devolve as notificacoes de quem
// chama (auth.uid()), so do push e nunca as de teste.
//   minhas_notificacoes(limite, antes)  mais novas primeiro; "antes" pagina
//   contar_notificacoes_nao_lidas()
//   marcar_notificacoes_lidas(ids)      ids de outra pessoa sao ignorados
//   marcar_todas_notificacoes_lidas()
// O texto e montado aqui com os mesmos campos do push (backend
// services/notificacoes.js); nada de texto de mensagem do chat.
import { supabase } from './supabase';

export type TipoNotificacao = 'novo_agendamento' | 'cancelamento' | 'lembrete' | 'mensagem';

export interface DadosNotificacao {
  agendamento_id?: string;
  data_hora?: string;
  servico?: string;
  cliente_nome?: string;
  barbeiro_nome?: string;
  papel?: 'cliente' | 'barbeiro';
  ator?: 'cliente' | 'barbeiro' | 'barbearia';
  minutos?: number;
  conversa_id?: string;
  barbeiro_id?: string;
  cliente_id?: string;
  outro_nome?: string;
}

export interface Notificacao {
  id: string;
  tipo: TipoNotificacao;
  dados: DadosNotificacao;
  agendamento_id: string | null;
  conversa_id: string | null;
  criada_em: string;
  lida_em: string | null;
}

type Resposta<T> = PromiseLike<{ data?: T | null; error: { message: string } | null }>;
type ComRpc = { rpc: <T>(fn: string, args?: Record<string, unknown>) => Resposta<T> };
const rpc = <T>(fn: string, args?: Record<string, unknown>) => (supabase as unknown as ComRpc).rpc<T>(fn, args);

export const POR_PAGINA = 30;

export async function buscarNotificacoes(antes?: string | null): Promise<Notificacao[]> {
  const { data, error } = await rpc<Notificacao[]>('minhas_notificacoes', { p_limite: POR_PAGINA, p_antes: antes ?? null });
  if (error) throw new Error(error.message);
  return Array.isArray(data) ? data : [];
}

// O aviso de um push (que so traz o id), procurado na central da conta logada.
// O banco so devolve avisos de quem chama: aviso de outra conta nao e achado.
export async function notificacaoDoPush(id: string | undefined): Promise<Notificacao | null> {
  if (!id) return null;
  try {
    return (await buscarNotificacoes()).find((n) => n.id === id) ?? null;
  } catch {
    return null;
  }
}

// Sem a central no banco (ou sem rede): zero, sem quebrar a tela
export async function contarNaoLidas(): Promise<number> {
  try {
    const { data, error } = await rpc<number>('contar_notificacoes_nao_lidas');
    return error || typeof data !== 'number' ? 0 : data;
  } catch {
    return 0;
  }
}

export async function marcarLidas(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const { error } = await rpc<number>('marcar_notificacoes_lidas', { p_ids: ids });
  if (error) throw new Error(error.message);
  avisarMudanca();
}

export async function marcarTodasLidas(): Promise<void> {
  const { error } = await rpc<number>('marcar_todas_notificacoes_lidas');
  if (error) throw new Error(error.message);
  avisarMudanca();
}

// O sino e a central se atualizam quando algo muda (lida, push recebido)
const ouvintes = new Set<() => void>();
export function aoMudar(fn: () => void): () => void {
  ouvintes.add(fn);
  return () => { ouvintes.delete(fn); };
}
export function avisarMudanca() {
  ouvintes.forEach((fn) => { try { fn(); } catch { /* ouvinte com erro nao para os outros */ } });
}

// "20/11 às 14h30", no fuso da barbearia
const FORMATO = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
export function quando(iso?: string): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return 'o horário marcado';
  try {
    const p = Object.fromEntries(FORMATO.formatToParts(d).map((x) => [x.type, x.value]));
    return `${p.day}/${p.month} às ${p.hour}h${p.minute === '00' ? '' : p.minute}`;
  } catch {
    return d.toLocaleString('pt-BR');
  }
}
export function hora(iso?: string): string {
  return quando(iso).split(' às ')[1] ?? 'o horário marcado';
}

export function textoDaNotificacao(n: Pick<Notificacao, 'tipo' | 'dados'>): { titulo: string; corpo: string } {
  const d = n.dados ?? {};
  const cliente = d.cliente_nome || 'Cliente';
  const barbeiro = d.barbeiro_nome || 'seu barbeiro';
  const servico = d.servico || 'atendimento';
  switch (n.tipo) {
    case 'novo_agendamento':
      // Para o cliente so quando outra pessoa agendou (migration 30)
      if (d.papel === 'cliente') {
        const quem = d.ator === 'barbeiro' ? (d.barbeiro_nome || 'O barbeiro') : 'A barbearia';
        return { titulo: 'Agendamento marcado para você', corpo: `${quem} agendou ${servico} para você em ${quando(d.data_hora)}.` };
      }
      return { titulo: 'Novo agendamento', corpo: `${cliente} agendou ${servico} para ${quando(d.data_hora)}.` };
    case 'cancelamento': {
      const q = quando(d.data_hora);
      let corpo: string;
      if (d.ator === 'cliente') corpo = `${cliente} cancelou o atendimento de ${q} (${servico}).`;
      else if (d.ator === 'barbeiro') corpo = `${barbeiro} cancelou o seu atendimento de ${q} (${servico}).`;
      else if (d.papel === 'cliente') corpo = `A barbearia cancelou o seu atendimento de ${q} (${servico}).`;
      else corpo = `A barbearia cancelou o atendimento de ${cliente} de ${q} (${servico}).`;
      return { titulo: 'Agendamento cancelado', corpo };
    }
    case 'lembrete':
      return d.papel === 'barbeiro'
        ? { titulo: 'Atendimento em breve', corpo: `${cliente} às ${hora(d.data_hora)} (${servico}).` }
        : { titulo: 'Seu atendimento está próximo', corpo: `${servico} com ${barbeiro} às ${hora(d.data_hora)}.` };
    case 'mensagem':
      return { titulo: 'Nova mensagem', corpo: `Você recebeu uma mensagem de ${d.outro_nome || 'um contato'}.` };
    default:
      return { titulo: 'Visage Barber', corpo: 'Você tem uma nova notificação.' };
  }
}

// Push recebido com o app aberto: so aparece para a conta logada que e a
// destinataria (sem conta logada, ou aviso de outra conta, nao aparece)
export function deveExibirNoApp(dados: { destinatario?: string } | undefined, usuarioAtual: string | null): boolean {
  if (!usuarioAtual) return false;
  return !dados?.destinatario || dados.destinatario === usuarioAtual;
}

// Para onde o toque leva: o chat da conversa ou a agenda (cliente: seus
// agendamentos; barbeiro: a agenda dele). Sem os dados necessarios: nenhuma tela.
export type Destino =
  | { tela: 'agenda' }
  | { tela: 'chat'; params: { outroNome: string; barbeiroId: string; clienteId: string } }
  | null;

export function destinoDaNotificacao(tipo: string | undefined, dados: DadosNotificacao | undefined): Destino {
  const d = dados ?? {};
  if (tipo === 'mensagem') {
    if (!d.barbeiro_id || !d.cliente_id) return null;
    return { tela: 'chat', params: { outroNome: d.outro_nome || 'Conversa', barbeiroId: d.barbeiro_id, clienteId: d.cliente_id } };
  }
  if (tipo === 'novo_agendamento' || tipo === 'cancelamento' || tipo === 'lembrete') return { tela: 'agenda' };
  return null;
}
