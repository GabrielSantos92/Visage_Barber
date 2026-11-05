import { supabase } from './supabase';
import { calcularHorarios, Intervalo } from './horarios';

interface ServicoAgendado { id: string; duracao_min: number }

// Codigos do PostgREST/Postgres para 'funcao nao existe'
const FUNCAO_AUSENTE = new Set(['PGRST202', '42883']);

const dataLocal = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Horarios livres do barbeiro no dia para o servico escolhido. Quem calcula e o
// banco (horarios_livres), com a mesma regra que valida a reserva: considera so
// os periodos em que o barbeiro precisa estar presente (pausas de coloracao
// ficam livres) e os outros agendamentos do proprio cliente.
export async function buscarHorariosDisponiveis(barbeiroId: string, servico: ServicoAgendado, data: Date): Promise<string[]> {
  const { data: livres, error } = await supabase.rpc('horarios_livres', {
    p_barbeiro_id: barbeiroId,
    p_servico_id: servico.id,
    p_data: dataLocal(data),
  });
  if (!error) return (livres ?? []).map((l) => l.horario);
  if (!FUNCAO_AUSENTE.has(error.code)) throw error;

  // Banco sem a migration 20261014000015: calculo antigo, aqui no app
  return buscarHorariosLegado(barbeiroId, servico.duracao_min, data);
}

async function buscarHorariosLegado(barbeiroId: string, duracaoMin: number, data: Date): Promise<string[]> {
  const { data: periodos } = await supabase
    .from('horarios_disponiveis')
    .select('hora_inicio, hora_fim')
    .eq('barbeiro_id', barbeiroId)
    .eq('dia_semana', data.getDay());
  if (!periodos?.length) return [];

  const ini = new Date(data); ini.setHours(0, 0, 0, 0);
  const fim = new Date(data); fim.setHours(23, 59, 59, 999);

  return calcularHorarios({
    periodos,
    ocupados: await buscarOcupados(barbeiroId, ini, fim),
    duracaoMin,
    data,
  });
}

async function buscarOcupados(barbeiroId: string, ini: Date, fim: Date): Promise<Intervalo[]> {
  const { data, error } = await (supabase as any).rpc('horarios_ocupados', {
    p_barbeiro_id: barbeiroId,
    p_inicio: ini.toISOString(),
    p_fim: fim.toISOString(),
  });
  if (!error) {
    return (data ?? []).map((o: any) => ({ inicio: new Date(o.inicio).getTime(), fim: new Date(o.fim).getTime() }));
  }

  // Banco sem a funcao horarios_ocupados (migration 20261009000014 ainda nao
  // aplicada): consulta antiga, que so enxerga o que o RLS deixa o cliente ler.
  const { data: agendados } = await supabase
    .from('agendamentos')
    .select('data_hora, servicos(duracao_min)')
    .eq('barbeiro_id', barbeiroId)
    .gte('data_hora', ini.toISOString())
    .lte('data_hora', fim.toISOString())
    .neq('status', 'cancelado');
  return (agendados ?? []).map((a: any) => {
    const inicio = new Date(a.data_hora).getTime();
    return { inicio, fim: inicio + (a.servicos?.duracao_min ?? 30) * 60000 };
  });
}

export interface RestricaoDiaria { motivo: string; mensagem: string }

// Funcao da migration 20261105000017, ainda fora dos tipos gerados do Supabase
interface RegraDiariaDb {
  rpc(fn: 'verificar_regra_diaria', args: { p_servico_id: string; p_data: string }):
    PromiseLike<{ data: RestricaoDiaria[] | null; error: { code: string } | null }>;
}

// Limite de 3 agendamentos por dia e servicos com componente repetido no dia,
// verificados pelo banco (verificar_regra_diaria) para o cliente logado, antes
// de escolher o horario. A regra de verdade e a do trigger validar_agendamento;
// null = permitido (ou banco sem a migration 20261105000017).
export async function verificarRegraDiaria(servicoId: string, data: Date): Promise<RestricaoDiaria | null> {
  const { data: linhas, error } = await (supabase as unknown as RegraDiariaDb).rpc('verificar_regra_diaria', {
    p_servico_id: servicoId,
    p_data: dataLocal(data),
  });
  if (error) {
    if (FUNCAO_AUSENTE.has(error.code)) return null;
    throw error;
  }
  return linhas?.[0] ?? null;
}
