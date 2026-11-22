// Push do Android pela Expo. O app SO registra o aparelho e trata o toque: quem
// recebe o que e decidido no banco, e o envio e do backend (nunca do app).
//
//   registrarAparelho()   pede a permissao (Android 13+), cria os canais e
//                         grava o token Expo da conta logada
//                         (registrar_dispositivo_push; o token muda de dono se
//                         outra conta entrar no mesmo aparelho)
//   removerAparelho()     no logout, ANTES de sair: o aparelho deixa de
//                         receber os avisos da conta (remover_dispositivo_push)
//                         e o token deste aparelho e invalidado
//                         (unregisterForNotificationsAsync, melhor esforco; o
//                         comportamento sem internet precisa ser conferido no
//                         celular): o proximo envio falha com
//                         DeviceNotRegistered e o backend desativa o aparelho
// Privacidade: os canais escondem o conteudo na tela bloqueada (PRIVATE), e com
// o app aberto so aparece o aviso da conta logada.
//
// Requer o build com o Firebase (google-services.json) para o Android gerar o
// token; sem ele, o registro falha em silencio e o app segue igual (a central
// continua funcionando).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { avisarMudanca, deveExibirNoApp } from './centralNotificacoes';

// Os mesmos ids do backend (CANAIS em backend/src/services/notificacoes.js)
export const CANAIS_ANDROID = [
  { id: 'agendamentos', nome: 'Novos agendamentos' },
  { id: 'cancelamentos', nome: 'Cancelamentos' },
  { id: 'lembretes', nome: 'Lembretes de horário' },
  { id: 'mensagens', nome: 'Mensagens do chat' },
] as const;

type ComRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> };
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as unknown as ComRpc).rpc(fn, args);

// Conta logada agora (o hook usePushToken mantem; null depois do logout)
let usuarioAtual: string | null = null;
export function definirUsuarioAtual(id: string | null) { usuarioAtual = id; }

// App aberto: so mostra o aviso da conta logada; atualiza o sino
Notifications.setNotificationHandler({
  handleNotification: async (n) => {
    const exibir = deveExibirNoApp(n.request.content.data as { destinatario?: string }, usuarioAtual);
    if (exibir) avisarMudanca();
    return { shouldShowBanner: exibir, shouldShowList: exibir, shouldPlaySound: exibir, shouldSetBadge: false };
  },
});

let tokenAtual: string | null = null;
let canaisCriados = false;

async function criarCanais() {
  if (Platform.OS !== 'android' || canaisCriados) return;
  for (const c of CANAIS_ANDROID) {
    await Notifications.setNotificationChannelAsync(c.id, {
      name: c.nome,
      importance: Notifications.AndroidImportance.HIGH,
      // Tela bloqueada (com senha): so "Visage Barber", sem nomes nem horario
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PRIVATE,
      vibrationPattern: [0, 250, 250, 250],
    });
  }
  canaisCriados = true;
}

const projectId = () =>
  (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId
  ?? (Constants as unknown as { easConfig?: { projectId?: string } }).easConfig?.projectId;

// true se o aparelho ficou registrado para a conta logada
export async function registrarAparelho(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    // Os canais vem antes da permissao: no Android 13+ o pedido so aparece
    // depois que existe um canal
    await criarCanais();
    let { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await Notifications.requestPermissionsAsync());
    if (status !== 'granted') return false;
    const id = projectId();
    if (!id) return false;
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId: id });
    const { error } = await rpc('registrar_dispositivo_push', { p_token: token, p_plataforma: 'android' });
    if (error) return false;
    tokenAtual = token;
    return true;
  } catch {
    // Sem Firebase no build, sem rede ou sem permissao: segue sem push
    return false;
  }
}

// Token renovado pelo sistema: grava o novo para a mesma conta
export function aoRenovarToken(): () => void {
  const sub = Notifications.addPushTokenListener(() => { registrarAparelho(); });
  return () => sub.remove();
}

// Logout: desvincula este aparelho da conta (enquanto ainda ha sessao). Falha
// aqui nao impede sair.
export async function removerAparelho(): Promise<void> {
  const token = tokenAtual;
  tokenAtual = null;
  usuarioAtual = null;
  // Some da barra o que era da conta que esta saindo
  await Notifications.dismissAllNotificationsAsync().catch(() => {});
  if (token) {
    try {
      await Promise.race([
        rpc('remover_dispositivo_push', { p_token: token }),
        new Promise((resolve) => setTimeout(resolve, 4000)),
      ]);
    } catch {
      // sem rede: o passo abaixo protege a conta mesmo assim
    }
  }
  // Invalida o token deste aparelho (nao depende da sessao nem do banco;
  // melhor esforco): o proximo login gera outro token
  await Notifications.unregisterForNotificationsAsync().catch(() => {});
}
