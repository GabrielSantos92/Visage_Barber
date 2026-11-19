// Push do Android pela Expo. O app SO registra o aparelho e trata o toque: quem
// recebe o que e decidido no banco, e o envio e do backend (nunca do app).
//
//   registrarAparelho()   pede a permissao (Android 13+), cria os canais e
//                         grava o token Expo da conta logada
//                         (registrar_dispositivo_push; o token muda de dono se
//                         outra conta entrar no mesmo aparelho)
//   removerAparelho()     no logout, ANTES de sair: o aparelho deixa de
//                         receber os avisos da conta (remover_dispositivo_push)
//
// Requer o build com o Firebase (google-services.json) para o Android gerar o
// token; sem ele, o registro falha em silencio e o app segue igual (a central
// continua funcionando).
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { supabase } from './supabase';
import { avisarMudanca } from './centralNotificacoes';

// Os mesmos ids do backend (CANAIS em backend/src/services/notificacoes.js)
export const CANAIS_ANDROID = [
  { id: 'agendamentos', nome: 'Novos agendamentos' },
  { id: 'cancelamentos', nome: 'Cancelamentos' },
  { id: 'lembretes', nome: 'Lembretes de horário' },
  { id: 'mensagens', nome: 'Mensagens do chat' },
] as const;

type ComRpc = { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string } | null }> };
const rpc = (fn: string, args: Record<string, unknown>) => (supabase as unknown as ComRpc).rpc(fn, args);

// App aberto: mostra o aviso e atualiza o sino
Notifications.setNotificationHandler({
  handleNotification: async () => {
    avisarMudanca();
    return { shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false };
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
  if (!token) return;
  try {
    await Promise.race([
      rpc('remover_dispositivo_push', { p_token: token }),
      new Promise((resolve) => setTimeout(resolve, 4000)),
    ]);
  } catch {
    // sem rede: o aparelho sera reatribuido no proximo login
  }
}
