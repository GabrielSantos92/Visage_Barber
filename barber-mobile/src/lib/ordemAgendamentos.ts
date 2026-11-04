// Ordem das listas de agendamentos do barbeiro: os dias mais proximos de hoje
// primeiro e, dentro de cada dia, do primeiro horario para o ultimo.
//   - futuro:   hoje, amanha, depois de amanha...
//   - passado:  ontem antes de anteontem (no historico)
// Sempre pelo horario marcado (data_hora), nunca pela data de criacao.
//
// O mesmo codigo existe em cut-advisor-pro/src/lib/ordemAgendamentos.ts e os dois
// sao cobertos pelos mesmos testes (cut-advisor-pro/src/test/ordem-agendamentos.test.ts).

const DIA_MS = 86400000;

// Dias entre a data do agendamento e hoje, no fuso do aparelho (o mesmo usado para exibir)
function diasAte(dataHora: Date, agora: Date): number {
  const dia = new Date(dataHora.getFullYear(), dataHora.getMonth(), dataHora.getDate()).getTime();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()).getTime();
  return Math.round((dia - hoje) / DIA_MS);
}

export function compararAgendamentos(
  a: { data_hora: string; id?: string },
  b: { data_hora: string; id?: string },
  agora: Date = new Date(),
): number {
  const da = new Date(a.data_hora);
  const db = new Date(b.data_hora);
  const diasA = diasAte(da, agora);
  const diasB = diasAte(db, agora);
  // 1. Dia mais proximo de hoje primeiro
  if (Math.abs(diasA) !== Math.abs(diasB)) return Math.abs(diasA) - Math.abs(diasB);
  // 2. Mesma distancia (amanha x ontem): o futuro primeiro
  if (diasA !== diasB) return diasB - diasA;
  // 3. Dentro do dia, horario crescente; 4. desempate estavel
  return da.getTime() - db.getTime() || (a.id ?? '').localeCompare(b.id ?? '');
}

// Devolve uma copia ordenada (nao altera a lista recebida)
export function ordenarAgendamentos<T extends { data_hora: string; id?: string }>(lista: T[], agora: Date = new Date()): T[] {
  return [...lista].sort((a, b) => compararAgendamentos(a, b, agora));
}
