import { supabase } from "@/integrations/supabase/client";

export interface NotaBarbeiro { media: number; total: number }

// Nota media e quantidade de avaliacoes por barbeiro (chave: id do barbeiro).
// Quem calcula e o banco (notas_barbeiros), porque o RLS nao deixa o cliente
// ler avaliacoes de outros clientes. Barbeiro sem avaliacao fica fora do mapa.
// Se a funcao nao existir ou falhar, os cards so ficam sem a nota.
export async function buscarNotasBarbeiros(): Promise<Record<string, NotaBarbeiro>> {
  const { data, error } = await supabase.rpc("notas_barbeiros");
  if (error) return {};
  return Object.fromEntries((data ?? []).map((n) => [n.barbeiro_id, { media: Number(n.media), total: n.total }]));
}

export const formatarNota = (media: number) => media.toFixed(1).replace(".", ",");
