// Opcoes do visagismo personalizado. As chaves sao as mesmas do backend
// (backend/src/services/personalizacao.js), que transforma cada uma em um texto
// fixo para as IAs; o mesmo arquivo existe no app (barber-mobile/src/lib/
// personalizacaoVisagismo.ts). Um teste confere as tres listas.

export type CampoPreferencia = "estilo" | "barba" | "cor_cabelo";
export type Preferencias = Partial<Record<CampoPreferencia, string>>;

// valor "" = padrao (a IA decide / cor natural): nao e enviado ao backend
type Opcao = { valor: string; rotulo: string; resumo?: string };

export const GRUPOS_PERSONALIZACAO: { campo: CampoPreferencia; titulo: string; opcoes: Opcao[] }[] = [
  {
    campo: "estilo",
    titulo: "Estilo do corte",
    opcoes: [
      { valor: "", rotulo: "A IA decide" },
      { valor: "formal", rotulo: "Formal", resumo: "Estilo formal" },
      { valor: "moderno", rotulo: "Moderno", resumo: "Estilo moderno" },
      { valor: "descolado", rotulo: "Descolado", resumo: "Estilo descolado" },
      { valor: "discreto", rotulo: "Discreto", resumo: "Estilo discreto" },
      { valor: "manter", rotulo: "Manter meu corte", resumo: "Corte atual mantido" },
    ],
  },
  {
    campo: "barba",
    titulo: "Barba",
    opcoes: [
      { valor: "", rotulo: "A IA decide" },
      { valor: "sem", rotulo: "Sem barba", resumo: "Sem barba" },
      { valor: "manter", rotulo: "Manter a atual", resumo: "Barba atual mantida" },
    ],
  },
  {
    campo: "cor_cabelo",
    titulo: "Cor do cabelo",
    opcoes: [
      { valor: "", rotulo: "Natural" },
      { valor: "loiro", rotulo: "Loiro", resumo: "Cabelo loiro" },
      { valor: "platinado", rotulo: "Platinado", resumo: "Cabelo platinado" },
      { valor: "castanho", rotulo: "Castanho", resumo: "Cabelo castanho" },
      { valor: "preto", rotulo: "Preto", resumo: "Cabelo preto" },
      { valor: "ruivo", rotulo: "Ruivo", resumo: "Cabelo ruivo" },
      { valor: "luzes", rotulo: "Luzes", resumo: "Cabelo com luzes" },
    ],
  },
];

// So as escolhas feitas; undefined quando ficou tudo no padrao (a analise
// segue exatamente como era antes da personalizacao)
export function preferenciasParaEnvio(p: Preferencias): Preferencias | undefined {
  const escolhas = Object.fromEntries(Object.entries(p).filter(([, v]) => v)) as Preferencias;
  return Object.keys(escolhas).length ? escolhas : undefined;
}

// Mesma regra do backend: manter corte e barba sem mudar a cor nao deixa nada para simular
export function semMudanca(p: Preferencias): boolean {
  return p.estilo === "manter" && p.barba === "manter" && !p.cor_cabelo;
}

// Pedido em texto curto, para a tela de resultado (ex.: ["Estilo formal", "Sem barba"])
export function resumoPreferencias(p?: Preferencias | null): string[] {
  if (!p) return [];
  return GRUPOS_PERSONALIZACAO.flatMap(({ campo, opcoes }) => {
    const opcao = opcoes.find((o) => o.valor && o.valor === p[campo]);
    return opcao?.resumo ? [opcao.resumo] : [];
  });
}
