// Id do barbeiro da conta logada (barbeiros.id), usado pelo Painel, Agenda,
// Horarios e Servicos. Antes cada aba perguntava ao banco de novo, em
// sequencia, antes da propria consulta.
//
// De onde vem (o primeiro que houver):
//   1. memoria (esta sessao do app);
//   2. aparelho (lib/cacheLocal, da propria conta): o id nao muda, entao a
//      abertura do app nao precisa esperar o banco, nem com internet ruim;
//   3. banco.
// Atualizacao:
//   - a chave e o usuario: outra conta no aparelho nunca recebe este id;
//   - logout limpa memoria e aparelho (AuthContext);
//   - puxar para atualizar no Painel e na Agenda limpa (pergunta ao banco de novo);
//   - conta ainda sem vinculo ou erro nao ficam guardados: a proxima tela
//     pergunta de novo, como antes.
import { supabase } from './supabase';
import { VALIDADE, gravarCache, invalidarCache, lerCache } from './cacheLocal';

const CHAVE = 'barbeiro:id';
let atual: { userId: string; pedido: Promise<string | null> } | null = null;

async function buscar(userId: string): Promise<string | null> {
  const salvo = await lerCache<string>(userId, CHAVE, VALIDADE.catalogo);
  if (salvo?.dados) return salvo.dados;
  const { data, error } = await supabase.from('barbeiros').select('id').eq('user_id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  const id = data?.id ?? null;
  if (id) gravarCache(userId, CHAVE, id);
  return id;
}

export function idDoBarbeiro(userId: string): Promise<string | null> {
  if (atual?.userId === userId) return atual.pedido;
  const pedido = buscar(userId);
  const registro = { userId, pedido };
  atual = registro;
  const descartar = () => { if (atual === registro) atual = null; };
  pedido.then((id) => { if (!id) descartar(); }, descartar);
  return pedido;
}

// Sem usuario: so a memoria (o logout ja apaga o aparelho inteiro). Com
// usuario (puxar para atualizar): tambem o salvo no aparelho
export function esquecerBarbeiro(userId?: string) {
  atual = null;
  if (userId) invalidarCache(userId, [CHAVE]);
}
