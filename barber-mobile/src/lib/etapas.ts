// Servicos com pausa (coloracao, tintura...): aplicacao, pausa e finalizacao.
// Quem decide a disponibilidade e o banco (trigger validar_agendamento e funcao
// horarios_livres). Aqui ficam so a validacao do formulario, com as mesmas
// regras do banco, e o calculo das etapas para exibir na agenda.

export interface ConfigEtapas {
  com_pausa?: boolean | null;
  ativo_inicial_min?: number | null;
  pausa_min?: number | null;
  ativo_final_min?: number | null;
  margem_min?: number | null;
}

export const ETAPA_MAX_MIN = 480;
export const MARGEM_MAX_MIN = 120;

// Marcado com pausa mas sem os tempos: o banco recusa, entao nem e oferecido
export function servicoAgendavel(s: ConfigEtapas): boolean {
  return !(s.com_pausa && s.pausa_min == null);
}

export interface EntradaEtapas {
  ativoInicial: number | null;
  pausa: number | null;
  ativoFinal: number | null;
  margem: number | null;
}

// Mesmas regras de configurar_etapas_servico. Devolve a mensagem do primeiro
// problema, ou null se os tempos estao validos.
export function validarEtapas({ ativoInicial, pausa, ativoFinal, margem }: EntradaEtapas): string | null {
  const tempos = [ativoInicial, pausa, ativoFinal];
  if (tempos.some((t) => t == null)) {
    return 'Informe os três tempos: atendimento inicial, pausa e atendimento final.';
  }
  if (tempos.some((t) => !Number.isInteger(t) || t! < 1 || t! > ETAPA_MAX_MIN)) {
    return `Cada etapa deve ter entre 1 e ${ETAPA_MAX_MIN} minutos.`;
  }
  const m = margem ?? 0;
  if (!Number.isInteger(m) || m < 0 || m > MARGEM_MAX_MIN) {
    return `A margem de segurança deve ter entre 0 e ${MARGEM_MAX_MIN} minutos.`;
  }
  if (pausa! <= 2 * m) {
    return 'A pausa precisa ser maior que o dobro da margem de segurança.';
  }
  return null;
}

export function duracaoTotal(ativoInicial: number, pausa: number, ativoFinal: number): number {
  return ativoInicial + pausa + ativoFinal;
}

// Parte da pausa em que o barbeiro pode atender outro cliente (minutos)
export function pausaAproveitavel(pausa: number, margem: number): number {
  return Math.max(0, pausa - 2 * margem);
}

export type TipoEtapa = 'atendimento' | 'aplicacao' | 'pausa' | 'finalizacao';

export interface Etapa {
  tipo: TipoEtapa;
  inicio: Date;
  fim: Date;
}

export const ROTULO_ETAPA: Record<TipoEtapa, string> = {
  atendimento: 'Atendimento',
  aplicacao: 'Aplicação',
  pausa: 'Pausa (ação do produto)',
  finalizacao: 'Finalização',
};

export interface AgendamentoComEtapas extends ConfigEtapas {
  data_hora: string;
  duracao_min?: number | null;
}

// Etapas de um agendamento, pelos tempos gravados nele (nao pelos do cadastro
// atual do servico). `duracaoServico` cobre agendamentos sem a copia gravada.
export function etapasDoAgendamento(a: AgendamentoComEtapas, duracaoServico?: number | null): Etapa[] {
  const inicio = new Date(a.data_hora).getTime();
  const em = (min: number) => new Date(inicio + min * 60000);
  if (a.pausa_min == null || a.ativo_inicial_min == null || a.ativo_final_min == null) {
    return [{ tipo: 'atendimento', inicio: em(0), fim: em(a.duracao_min ?? duracaoServico ?? 30) }];
  }
  const fimAplicacao = a.ativo_inicial_min;
  const fimPausa = fimAplicacao + a.pausa_min;
  return [
    { tipo: 'aplicacao', inicio: em(0), fim: em(fimAplicacao) },
    { tipo: 'pausa', inicio: em(fimAplicacao), fim: em(fimPausa) },
    { tipo: 'finalizacao', inicio: em(fimPausa), fim: em(fimPausa + a.ativo_final_min) },
  ];
}

// Agendamento (entre `outros`) em cuja pausa `a` acontece, para a agenda
// mostrar 'durante a pausa de ...'. Considera so os nao cancelados.
export function pausaQueContem<T extends AgendamentoComEtapas & { id: string; status?: string }>(
  a: T,
  outros: T[],
  duracaoServico?: (x: T) => number | null | undefined,
): { agendamento: T; pausa: Etapa } | null {
  const etapas = etapasDoAgendamento(a, duracaoServico?.(a));
  const inicio = etapas[0].inicio;
  const fim = etapas[etapas.length - 1].fim;
  for (const o of outros) {
    if (o.id === a.id || o.status === 'cancelado') continue;
    const pausa = etapasDoAgendamento(o, duracaoServico?.(o)).find((e) => e.tipo === 'pausa');
    if (pausa && inicio >= pausa.inicio && fim <= pausa.fim) {
      return { agendamento: o, pausa };
    }
  }
  return null;
}
