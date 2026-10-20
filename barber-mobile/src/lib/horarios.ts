// Regras de disponibilidade da tela de agendamento.
// A regra de verdade e aplicada pelo banco (trigger validar_agendamento); aqui
// so se decide quais horarios oferecer e como explicar uma recusa ao cliente.

export interface Periodo { hora_inicio: string; hora_fim: string }
// Intervalo ocupado, em milissegundos (Date.getTime())
export interface Intervalo { inicio: number; fim: number }

const PASSO_MIN = 30;

export const MSG_CONFLITO_BARBEIRO =
  'Esse horário não está mais disponível para este barbeiro. Por favor, escolha outro horário.';
export const MSG_CONFLITO_CLIENTE =
  'Você já possui um agendamento nesse horário. Escolha outro horário para evitar conflitos.';

// Dois intervalos se sobrepoem quando um comeca antes de o outro terminar.
// Intervalos consecutivos (um termina quando o outro comeca) nao conflitam.
export function sobrepoe(a: Intervalo, b: Intervalo): boolean {
  return a.inicio < b.fim && a.fim > b.inicio;
}

interface CalculoHorarios {
  periodos: Periodo[];
  ocupados: Intervalo[];
  duracaoMin: number;
  data: Date;
  agora?: Date;
}

// Horarios (HH:MM) do dia em que o servico inteiro cabe no expediente, ainda
// nao comecou e nao se sobrepoe a nenhum intervalo ocupado.
export function calcularHorarios({ periodos, ocupados, duracaoMin, data, agora = new Date() }: CalculoHorarios): string[] {
  const slots = new Set<string>();
  for (const p of periodos) {
    const [hI, mI] = p.hora_inicio.split(':').map(Number);
    const [hF, mF] = p.hora_fim.split(':').map(Number);
    let atual = new Date(data); atual.setHours(hI, mI, 0, 0);
    const fimPeriodo = new Date(data); fimPeriodo.setHours(hF, mF, 0, 0);

    while (atual < fimPeriodo) {
      const novo = { inicio: atual.getTime(), fim: atual.getTime() + duracaoMin * 60000 };
      const livre = !ocupados.some((o) => sobrepoe(novo, o));
      if (atual > agora && novo.fim <= fimPeriodo.getTime() && livre) {
        slots.add(`${String(atual.getHours()).padStart(2, '0')}:${String(atual.getMinutes()).padStart(2, '0')}`);
      }
      atual = new Date(atual.getTime() + PASSO_MIN * 60000);
    }
  }
  return [...slots].sort();
}

interface ErroBanco { code?: string; message?: string; details?: string | null }

// Traduz a recusa do banco em uma mensagem para o cliente.
// `horarioIndisponivel` indica que a lista de horarios deve ser recarregada.
export function interpretarErroAgendamento(error: ErroBanco): { mensagem: string; horarioIndisponivel: boolean } {
  if (error.details === 'CONFLITO_CLIENTE') {
    return { mensagem: MSG_CONFLITO_CLIENTE, horarioIndisponivel: true };
  }
  // 23505: indice unico antigo (mesmo barbeiro, mesmo horario de inicio)
  if (error.details === 'CONFLITO_BARBEIRO' || error.code === '23505') {
    return { mensagem: MSG_CONFLITO_BARBEIRO, horarioIndisponivel: true };
  }
  if (error.details === 'FORA_DO_EXPEDIENTE' || error.details === 'HORARIO_PASSADO') {
    return { mensagem: error.message ?? MSG_CONFLITO_BARBEIRO, horarioIndisponivel: true };
  }
  if (
    error.details === 'BARBEIRO_INDISPONIVEL' ||
    error.details === 'SERVICO_INDISPONIVEL' ||
    error.details === 'SERVICO_SEM_ETAPAS'
  ) {
    return { mensagem: error.message ?? 'Agendamento indisponível.', horarioIndisponivel: false };
  }
  return { mensagem: 'Não foi possível concluir o agendamento. Tente novamente.', horarioIndisponivel: false };
}
