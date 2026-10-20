import { supabase as _supabase } from './supabase';
import { sendPushNotification } from './notifications';

// visagismo_analises / conversas / mensagens nao estao nos types gerados do Supabase
const db = _supabase as any;
const BUCKET = 'visagismo';

export interface AnaliseSalva {
  id: string;
  resultado: any;
  imagem_path: string;
  created_at: string;
}

export interface BarbeiroChat {
  id: string;
  nome: string;
}

function base64ParaBytes(base64: string): ArrayBuffer {
  const bin = atob(base64.replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// Envia a imagem da comparacao para o Storage e registra a analise no historico.
export async function salvarAnalise(userId: string, resultado: any, imagemBase64: string): Promise<AnaliseSalva> {
  const path = `${userId}/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.jpg`;
  const { error: erroUpload } = await _supabase.storage
    .from(BUCKET)
    .upload(path, base64ParaBytes(imagemBase64), { contentType: 'image/jpeg' });
  if (erroUpload) throw erroUpload;

  const { data, error } = await db
    .from('visagismo_analises')
    .insert({ user_id: userId, resultado, imagem_path: path })
    .select('*')
    .single();
  if (error) {
    await _supabase.storage.from(BUCKET).remove([path]);
    throw error;
  }
  return data;
}

export async function listarAnalises(userId: string): Promise<AnaliseSalva[]> {
  const { data, error } = await db
    .from('visagismo_analises')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function excluirAnalise(analise: AnaliseSalva) {
  const { error } = await db.from('visagismo_analises').delete().eq('id', analise.id);
  if (error) throw error;
  await _supabase.storage.from(BUCKET).remove([analise.imagem_path]);
}

// O bucket e privado: a imagem so abre por URL assinada. Guardamos as URLs em
// memoria para o chat (que recarrega a cada 3s) nao pedir uma nova toda vez.
const VALIDADE_S = 3600;
const urls = new Map<string, { url: string; expira: number }>();

export async function urlAssinada(path: string): Promise<string> {
  const emCache = urls.get(path);
  if (emCache && emCache.expira > Date.now()) return emCache.url;

  const { data, error } = await _supabase.storage.from(BUCKET).createSignedUrl(path, VALIDADE_S);
  if (error || !data?.signedUrl) throw error ?? new Error('Imagem indisponível.');
  urls.set(path, { url: data.signedUrl, expira: Date.now() + (VALIDADE_S - 600) * 1000 });
  return data.signedUrl;
}

// O chat so existe entre cliente e barbeiro com quem ele tem agendamento.
export async function listarBarbeirosDoCliente(userId: string): Promise<BarbeiroChat[]> {
  const { data, error } = await db
    .from('agendamentos')
    .select('barbeiro_id, barbeiros(nome)')
    .eq('cliente_id', userId)
    .neq('status', 'cancelado')
    .order('data_hora', { ascending: false });
  if (error) throw error;

  const vistos = new Map<string, BarbeiroChat>();
  for (const a of data ?? []) {
    if (!vistos.has(a.barbeiro_id)) vistos.set(a.barbeiro_id, { id: a.barbeiro_id, nome: a.barbeiros?.nome ?? 'Barbeiro' });
  }
  return [...vistos.values()];
}

export async function enviarAnaliseNoChat(clienteId: string, barbeiroId: string, analise: AnaliseSalva) {
  let { data: conversa } = await db
    .from('conversas')
    .select('id')
    .eq('cliente_id', clienteId)
    .eq('barbeiro_id', barbeiroId)
    .maybeSingle();

  if (!conversa) {
    const { data: nova, error } = await db
      .from('conversas')
      .insert({ cliente_id: clienteId, barbeiro_id: barbeiroId })
      .select('id')
      .single();
    if (error) throw error;
    conversa = nova;
  }

  const r = analise.resultado ?? {};
  const conteudo = [
    `Minha análise de visagismo: ${r.corte_principal?.nome ?? 'corte recomendado'}`,
    r.barba?.estilo ? `barba ${r.barba.estilo}` : null,
  ].filter(Boolean).join(' · ');

  const { error } = await db.from('mensagens').insert({
    conversa_id: conversa.id,
    remetente_id: clienteId,
    conteudo,
    imagem_path: analise.imagem_path,
  });
  if (error) throw error;

  const { data: barb } = await db.from('barbeiros').select('push_token').eq('id', barbeiroId).single();
  sendPushNotification(barb?.push_token, 'Visagismo', conteudo);
}
