// Telefone brasileiro em todo o projeto: a interface mostra "(11) 98765-4321"
// ou "(11) 3333-4444" e o banco recebe so os digitos ("11987654321").
//
// O mesmo codigo existe em barber-mobile/src/lib/telefone.ts, e os dois sao
// cobertos pelos mesmos testes (src/test/telefone.test.ts). Ao mudar um, mude o outro.

export const MAX_DIGITOS_TELEFONE = 11;

export function somenteDigitos(texto: string | null | undefined): string {
  return (texto ?? "").replace(/\D/g, "");
}

// Tira o 0 de operadora/DDD e o 55 do pais, comuns em numeros colados ou antigos
function semPrefixos(digitos: string, comPais: boolean): { digitos: string; removidos: number } {
  let d = digitos.replace(/^0+/, "");
  if (comPais && d.length > MAX_DIGITOS_TELEFONE && d.startsWith("55")) d = d.slice(2).replace(/^0+/, "");
  return { digitos: d, removidos: digitos.length - d.length };
}

// Mascara progressiva: "(1", "(11", "(11) 3333", "(11) 3333-4444", "(11) 98765-4321"
export function formatarTelefone(valor: string | null | undefined): string {
  const d = somenteDigitos(valor).slice(0, MAX_DIGITOS_TELEFONE);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const numero = d.slice(2);
  if (numero.length <= 4) return `(${ddd}) ${numero}`;
  const corte = numero.length === 9 ? 5 : 4;
  return `(${ddd}) ${numero.slice(0, corte)}-${numero.slice(corte)}`;
}

// Valor salvo no banco (digitos, ou numeros antigos com mascara/55) pronto para o campo
export function telefoneParaCampo(valor: string | null | undefined): string {
  return formatarTelefone(semPrefixos(somenteDigitos(valor), true).digitos);
}

// Para exibir em listas: formata o que segue o padrao e mostra o resto como foi salvo
export function exibirTelefone(valor: string | null | undefined): string {
  const { digitos } = semPrefixos(somenteDigitos(valor), true);
  if (digitos.length === 10 || digitos.length === 11) return formatarTelefone(digitos);
  return (valor ?? "").trim();
}

// O que vai para o backend/banco: so digitos ("" quando vazio)
export function telefoneParaSalvar(valor: string | null | undefined): string {
  return semPrefixos(somenteDigitos(valor), true).digitos.slice(0, MAX_DIGITOS_TELEFONE);
}

// Posicao no texto formatado logo depois do n-esimo digito
function posicaoAposDigitos(texto: string, n: number): number {
  if (n <= 0) return texto.startsWith("(") && texto.length > 1 ? 1 : 0;
  let vistos = 0;
  for (let i = 0; i < texto.length; i++) {
    if (/\d/.test(texto[i]) && ++vistos === n) return i + 1;
  }
  return texto.length;
}

export interface EdicaoTelefone {
  texto: string;   // valor formatado para mostrar no campo
  cursor: number;  // onde o cursor deve ficar
  digitos: string; // o mesmo valor so com digitos
}

// Aplica a mascara a uma edicao do campo.
//   anterior     texto formatado antes da edicao
//   novo         texto como o campo ficou (com o que foi digitado, colado ou apagado)
//   cursorNovo   posicao do cursor em `novo`
//   cursorAntes  posicao do cursor antes da edicao, quando conhecida (distingue Delete de Backspace)
// Mantem o cursor junto do mesmo digito, ignora letras e simbolos, nao passa de 11
// digitos e trata a colagem de numeros com mascara, +55 ou 0 na frente.
export function editarTelefone(anterior: string, novo: string, cursorNovo: number, cursorAntes?: number): EdicaoTelefone {
  const digAnterior = somenteDigitos(anterior);
  let digitos = somenteDigitos(novo);
  let antesDoCursor = somenteDigitos(novo.slice(0, cursorNovo)).length;

  // Apagou so um caractere da mascara ("(", ")", espaco, "-"): apaga o digito vizinho
  if (digitos === digAnterior && novo.length < anterior.length) {
    const apagouParaFrente = cursorAntes !== undefined && cursorAntes === cursorNovo;
    if (apagouParaFrente) {
      digitos = digitos.slice(0, antesDoCursor) + digitos.slice(antesDoCursor + 1);
    } else if (antesDoCursor > 0) {
      digitos = digitos.slice(0, antesDoCursor - 1) + digitos.slice(antesDoCursor);
      antesDoCursor -= 1;
    }
  }

  const colou = digitos.length - digAnterior.length > 1;
  const limpo = semPrefixos(digitos, colou);
  digitos = limpo.digitos;
  antesDoCursor = Math.max(0, antesDoCursor - limpo.removidos);

  if (digitos.length > MAX_DIGITOS_TELEFONE) {
    if (colou) {
      digitos = digitos.slice(0, MAX_DIGITOS_TELEFONE);
    } else {
      // Campo cheio: o digito a mais e ignorado e o numero fica como estava
      antesDoCursor = Math.max(0, antesDoCursor - (digitos.length - digAnterior.length));
      digitos = digAnterior;
    }
  }
  antesDoCursor = Math.min(antesDoCursor, digitos.length);

  const texto = formatarTelefone(digitos);
  return { texto, cursor: posicaoAposDigitos(texto, antesDoCursor), digitos };
}

// Validacao (separada da mascara): DDD de 2 digitos, celular com 9 digitos
// comecando com 9 ou fixo com 8 digitos comecando com 2 a 5.
// Devolve a mensagem de erro, ou null se valido. Vazio so e erro se obrigatorio.
export function validarTelefone(valor: string | null | undefined, { obrigatorio = false } = {}): string | null {
  const d = somenteDigitos(valor);
  if (!d) return obrigatorio ? "Telefone é obrigatório" : null;
  if (d.length < 10) return "Telefone incompleto. Informe DDD + número";
  if (d.length > MAX_DIGITOS_TELEFONE) return "Telefone com dígitos demais";
  if (!/^[1-9][1-9]/.test(d)) return "DDD inválido";
  if (d.length === 11 && d[2] !== "9") return "Celular deve ter 9 dígitos e começar com 9";
  if (d.length === 10 && !/[2-5]/.test(d[2])) return "Telefone fixo deve começar com 2, 3, 4 ou 5";
  return null;
}

// Busca por telefone que funciona com ou sem mascara ("11 9876", "(11) 9876", "119876")
export function telefoneCorresponde(telefone: string | null | undefined, busca: string): boolean {
  const termo = somenteDigitos(busca);
  return termo.length > 0 && somenteDigitos(telefone).includes(termo);
}
