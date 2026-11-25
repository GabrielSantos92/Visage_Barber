import { supabase } from "@/integrations/supabase/client";
import { recusaDaArea, type AreaDeLogin } from "@/lib/areaDeLogin";

// Chamada logo depois do login (senha ou Google), com a sessao ja criada:
// confere se a conta pertence a area da tela (regra em lib/areaDeLogin). Se nao
// pertencer, ou se o papel nao puder ser confirmado, encerra a sessao recem-
// criada e devolve o motivo. O encerramento e so desta sessao (scope "local"):
// o signOut padrao ("global") derrubaria a conta em todos os aparelhos.
export async function recusarForaDaArea(userId: string, area: AreaDeLogin): Promise<string | null> {
  let roles: string[] | null = null;
  try {
    const { data, error } = await supabase.from("user_roles").select("role").eq("user_id", userId);
    if (!error) roles = (data ?? []).map((r) => r.role);
  } catch {
    /* sem rede: roles fica null e o login e recusado */
  }

  const recusa = recusaDaArea(roles, area);
  if (recusa) await supabase.auth.signOut({ scope: "local" });
  return recusa;
}
