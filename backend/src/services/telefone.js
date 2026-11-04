// Telefone brasileiro no backend: as mesmas regras de cut-advisor-pro/src/lib/telefone.ts
// e barber-mobile/src/lib/telefone.ts. O banco guarda so os digitos ("11987654321").

const somenteDigitos = (texto) => String(texto ?? '').replace(/\D/g, '');

// Digitos prontos para salvar: sem mascara, sem 0 na frente e sem o 55 do pais
function telefoneParaSalvar(valor) {
  let d = somenteDigitos(valor).replace(/^0+/, '');
  if (d.length > 11 && d.startsWith('55')) d = d.slice(2).replace(/^0+/, '');
  return d;
}

// DDD de 2 digitos + celular (9 digitos comecando com 9) ou fixo (8 digitos
// comecando com 2 a 5). Devolve a mensagem de erro, ou null se valido.
function validarTelefone(valor, { obrigatorio = false } = {}) {
  const d = telefoneParaSalvar(valor);
  if (!d) return obrigatorio ? 'Telefone é obrigatório.' : null;
  if (d.length < 10) return 'Telefone incompleto. Informe DDD + número.';
  if (d.length > 11) return 'Telefone com dígitos demais.';
  if (!/^[1-9][1-9]/.test(d)) return 'DDD inválido.';
  if (d.length === 11 && d[2] !== '9') return 'Celular deve ter 9 dígitos e começar com 9.';
  if (d.length === 10 && !/[2-5]/.test(d[2])) return 'Telefone fixo deve começar com 2, 3, 4 ou 5.';
  return null;
}

module.exports = { somenteDigitos, telefoneParaSalvar, validarTelefone };
