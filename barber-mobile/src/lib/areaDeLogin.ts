// Separacao das areas de login, igual no site e no app (o teste
// area-login confere). Cada tela de login so abre a propria area: conta de
// barbeiro nao entra pela Area do Cliente e conta de cliente nao entra pela
// Area do Barbeiro. O admin nao tem tela de login propria e entra pelas duas.
// A separacao e so de telas; as permissoes continuam no banco (RLS).

export type AreaDeLogin = 'cliente' | 'barbeiro';
export type PapelDaConta = 'admin' | 'barbeiro' | 'cliente';

export const MENSAGENS_AREA = {
  contaDeBarbeiro: 'Esta conta é de barbeiro. Entre pela Área do Barbeiro.',
  contaDeCliente: 'Esta conta não é de barbeiro. Entre pela Área do Cliente.',
  semConfirmacao: 'Não foi possível confirmar o tipo da sua conta. Verifique a conexão e tente novamente.',
} as const;

// Papel que vale para a conta: admin > barbeiro > cliente. O barbeiro tambem
// tem a linha 'cliente' em user_roles (criada pelo gatilho do cadastro).
export function papelEfetivo(roles: readonly string[]): PapelDaConta {
  if (roles.includes('admin')) return 'admin';
  if (roles.includes('barbeiro')) return 'barbeiro';
  return 'cliente';
}

// null: a conta pode entrar por esta area. Senao, o motivo para mostrar na tela.
// roles null = a consulta de user_roles falhou: sem confirmar o papel, recusa.
export function recusaDaArea(roles: readonly string[] | null, area: AreaDeLogin): string | null {
  if (!roles) return MENSAGENS_AREA.semConfirmacao;
  const papel = papelEfetivo(roles);
  if (papel === 'admin') return null;
  if (area === 'cliente' && papel === 'barbeiro') return MENSAGENS_AREA.contaDeBarbeiro;
  if (area === 'barbeiro' && papel !== 'barbeiro') return MENSAGENS_AREA.contaDeCliente;
  return null;
}
