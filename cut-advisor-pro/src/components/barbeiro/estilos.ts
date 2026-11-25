import type { StatusAgendamento } from "@/lib/painelBarbeiro";

// Cores de cada status, as mesmas na Agenda e no Painel do Barbeiro
export const COR_STATUS: Record<StatusAgendamento, string> = {
  confirmado: "text-green-700 dark:text-green-500 border-green-600/40 dark:border-green-500/30",
  concluido: "text-primary border-primary/30",
  cancelado: "text-destructive border-destructive/30",
};

// So a cor do texto de cada status (titulos da situacao do dia)
export const COR_TEXTO_STATUS: Record<StatusAgendamento, string> = {
  confirmado: "text-green-700 dark:text-green-500",
  concluido: "text-primary",
  cancelado: "text-destructive",
};

// Preenchimento de cada status nos graficos (mesma cor do texto acima)
export const COR_BARRA: Record<StatusAgendamento, string> = {
  confirmado: "bg-green-600 dark:bg-green-500",
  concluido: "bg-primary",
  cancelado: "bg-destructive",
};

export const chipCls = (ativo: boolean) =>
  `px-3 py-1.5 border font-mono text-[10px] uppercase tracking-widest transition-colors ${
    ativo ? "border-primary bg-primary text-primary-foreground" : "border-border text-foreground hover:border-primary"}`;

export const campoCls = "bg-background border border-border px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary";
