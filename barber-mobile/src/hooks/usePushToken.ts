// Push do Android para a conta logada (cliente ou barbeiro): registra o
// aparelho, acompanha a renovacao do token e abre a tela certa ao tocar numa
// notificacao, com o app aberto, em segundo plano ou fechado.
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../contexts/AuthContext';
import { registrarAparelho, aoRenovarToken } from '../lib/pushNotificacoes';
import { avisarMudanca, destinoDaNotificacao, DadosNotificacao } from '../lib/centralNotificacoes';
import { navegacaoRef } from '../navigation/navegacao';

export type PapelNoApp = 'barbeiro' | 'cliente';

// Rotas de cada perfil (ClienteNavigator e BarbeiroNavigator)
const AGENDA: Record<PapelNoApp, [string, object]> = {
  cliente: ['ClienteTabs', { screen: 'MeusAgendamentos' }],
  barbeiro: ['BarbeiroTabs', { screen: 'Agendamentos' }],
};

export function abrirDestino(papel: PapelNoApp, tipo: string | undefined, dados: DadosNotificacao | undefined) {
  const destino = destinoDaNotificacao(tipo, dados);
  if (!destino || !navegacaoRef.isReady()) return false;
  if (destino.tela === 'chat') navegacaoRef.navigate('Chat', destino.params);
  else navegacaoRef.navigate(...AGENDA[papel]);
  return true;
}

export function usePushToken(papel: PapelNoApp) {
  const { user } = useAuth();
  const resposta = Notifications.useLastNotificationResponse();
  const tratadas = useRef(new Set<string>());

  // Registro do aparelho para esta conta (e de novo se o token mudar)
  useEffect(() => {
    if (!user) return undefined;
    registrarAparelho();
    return aoRenovarToken();
  }, [user?.id]);

  // Toque na notificacao (inclusive a que abriu o app fechado). So abre se o
  // aviso for da conta logada: aviso antigo de outra conta no mesmo aparelho
  // e ignorado.
  useEffect(() => {
    if (!resposta || !user) return;
    const id = resposta.notification.request.identifier;
    if (tratadas.current.has(id)) return;
    tratadas.current.add(id);
    const dados = (resposta.notification.request.content.data ?? {}) as DadosNotificacao & { tipo?: string; destinatario?: string };
    avisarMudanca();
    if (dados.destinatario && dados.destinatario !== user.id) return;
    // A navegacao pode ainda nao estar pronta logo ao abrir o app
    if (!abrirDestino(papel, dados.tipo, dados)) {
      setTimeout(() => abrirDestino(papel, dados.tipo, dados), 600);
    }
  }, [resposta, user?.id, papel]);
}
