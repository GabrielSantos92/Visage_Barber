// Agenda semanal do barbeiro (tabela horarios_disponiveis).
// Mesmas regras da tela de barbeiros do admin mobile (BarbeariasScreen): cada dia
// ativo vira um periodo, ou dois quando ha pausa de almoco.

export const DIAS_NOMES = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export interface DiaConfig {
  ativo: boolean;
  inicio: string;
  fim: string;
  almoco: boolean;
  almocoInicio: string;
  almocoFim: string;
}

export interface Horario {
  dia_semana: number;
  hora_inicio: string;
  hora_fim: string;
}

export function defaultAgenda(): DiaConfig[] {
  return DIAS_NOMES.map((_, i) => ({
    ativo: i >= 1 && i <= 6,
    inicio: "09:00",
    fim: "18:00",
    almoco: false,
    almocoInicio: "12:00",
    almocoFim: "13:00",
  }));
}

// Monta a configuracao da semana a partir das linhas salvas.
// Sem nenhuma linha, devolve a agenda padrao (seg a sab, 09:00 as 18:00).
export function horariosParaAgenda(horarios: Horario[]): DiaConfig[] {
  const config = defaultAgenda();
  // O Supabase devolve colunas time como "HH:MM:SS"; fica so "HH:MM"
  const t5 = (v: string) => (v ?? "").substring(0, 5);

  const porDia: Record<number, { inicio: string; fim: string }[]> = {};
  for (const h of horarios) {
    (porDia[h.dia_semana] ??= []).push({ inicio: t5(h.hora_inicio), fim: t5(h.hora_fim) });
  }

  for (const [diaStr, periodos] of Object.entries(porDia)) {
    const dia = Number(diaStr);
    if (!config[dia]) continue;
    periodos.sort((a, b) => a.inicio.localeCompare(b.inicio));
    config[dia].ativo = true;
    if (periodos.length === 1) {
      config[dia].inicio = periodos[0].inicio;
      config[dia].fim = periodos[0].fim;
      config[dia].almoco = false;
    } else {
      config[dia].inicio = periodos[0].inicio;
      config[dia].almocoInicio = periodos[0].fim;
      config[dia].almocoFim = periodos[1].inicio;
      config[dia].fim = periodos[1].fim;
      config[dia].almoco = true;
    }
  }
  return config;
}

// Retorna a mensagem do primeiro problema encontrado, ou null se a agenda e valida.
export function validarAgenda(agenda: DiaConfig[]): string | null {
  const timeRx = /^\d{2}:\d{2}$/;
  for (let i = 0; i < agenda.length; i++) {
    const d = agenda[i];
    if (!d.ativo) continue;
    if (!timeRx.test(d.inicio) || !timeRx.test(d.fim)) {
      return `Horário inválido em ${DIAS_NOMES[i]}. Use HH:MM.`;
    }
    if (d.inicio >= d.fim) {
      return `Em ${DIAS_NOMES[i]}, o início deve ser anterior ao fim.`;
    }
    if (d.almoco) {
      if (!timeRx.test(d.almocoInicio) || !timeRx.test(d.almocoFim)) {
        return `Horário de almoço inválido em ${DIAS_NOMES[i]}.`;
      }
      if (d.almocoInicio <= d.inicio || d.almocoFim >= d.fim || d.almocoInicio >= d.almocoFim) {
        return `Pausa de almoço inválida em ${DIAS_NOMES[i]}.`;
      }
    }
  }
  return null;
}

export function agendaParaHorarios(barbeiroId: string, agenda: DiaConfig[]) {
  const linhas: (Horario & { barbeiro_id: string })[] = [];
  agenda.forEach((d, i) => {
    if (!d.ativo) return;
    if (!d.almoco) {
      linhas.push({ barbeiro_id: barbeiroId, dia_semana: i, hora_inicio: d.inicio, hora_fim: d.fim });
    } else {
      linhas.push({ barbeiro_id: barbeiroId, dia_semana: i, hora_inicio: d.inicio, hora_fim: d.almocoInicio });
      linhas.push({ barbeiro_id: barbeiroId, dia_semana: i, hora_inicio: d.almocoFim, hora_fim: d.fim });
    }
  });
  return linhas;
}
