// Normaliza o telefone cadastrado para o formato do wa.me (so digitos, com DDI 55).
// Retorna null quando o numero esta vazio ou nao parece um telefone brasileiro valido.
export function normalizarTelefoneBR(telefone: string | null | undefined): string | null {
  const digitos = (telefone ?? "").replace(/\D/g, "").replace(/^0+/, "");
  // DDD + numero (fixo com 8 digitos ou celular com 9)
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  // Ja veio com o codigo do pais
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}

interface DadosAgendamento {
  telefone: string | null | undefined;
  barbeiroNome?: string | null;
  servicoNome?: string | null;
  dataHora: string;
}

// Monta o link do WhatsApp do barbeiro com a mensagem inicial do agendamento.
// Retorna null quando nao ha telefone valido (o botao deve ser ocultado).
export function linkWhatsAppAgendamento({ telefone, barbeiroNome, servicoNome, dataHora }: DadosAgendamento): string | null {
  const numero = normalizarTelefoneBR(telefone);
  if (!numero) return null;

  const d = new Date(dataHora);
  const p = (n: number) => String(n).padStart(2, "0");
  const dia = `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
  const hora = `${p(d.getHours())}:${p(d.getMinutes())}`;

  const primeiroNome = barbeiroNome?.trim().split(/\s+/)[0];
  const saudacao = primeiroNome ? `Olá, ${primeiroNome}!` : "Olá!";
  const servico = servicoNome?.trim() ? ` de ${servicoNome.trim()}` : "";
  const mensagem = `${saudacao} Gostaria de conversar sobre meu agendamento${servico} no dia ${dia} às ${hora}.`;

  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}
