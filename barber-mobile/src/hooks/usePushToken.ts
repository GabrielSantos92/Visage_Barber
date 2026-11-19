// Push do Android para a conta logada (cliente ou barbeiro): registra o
// aparelho, acompanha a renovacao do token e abre a tela certa ao tocar numa
// notificacao, com o app aberto, em segundo plano ou fechado.
import { useEffect, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { useAuth } from '../contexts/AuthContext';
import { registrarAparelho, aoRenovarToken, definirUsuarioAtual } from '../lib/pushNotificacoes';
import { avisarMudanca, destinoDaNotificacao, DadosNotificacao, notificacaoDoPush, marcarLidas } from '../lib/centralNotificacoes';
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
    definirUsuarioAtual(user?.id ?? null);
    if (!user) return undefined;
    registrarAparelho();
    return aoRenovarToken();
  }, [user?.id]);

  // Toque na notificacao (inclusive a que abriu o app fechado). O push so traz
  // o tipo e o id do aviso: o detalhe vem da central, que so devolve avisos da
  // conta logada. Aviso de outra conta (aparelho que ficou vinculado) nao e
  // encontrado e o toque so abre a central.
  useEffect(() => {
    if (!resposta || !user) return;
    const id = resposta.notification.request.identifier;
    if (tratadas.current.has(id)) return;
    tratadas.current.add(id);
    const push = (resposta.notification.request.content.data ?? {}) as { tipo?: string; notificacao_id?: string };
    avisarMudanca();
    (async () => {
      const aviso = await notificacaoDoPush(push.notificacao_id);
      const abrir = () => (aviso
        ? abrirDestino(papel, aviso.tipo, aviso.dados as DadosNotificacao)
        : navegacaoRef.isReady() && (navegacaoRef.navigate('Notificacoes', { papel }), true));
      if (aviso && !aviso.lida_em) marcarLidas([aviso.id]).catch(() => {});
      // A navegacao pode ainda nao estar pronta logo ao abrir o app
      if (!abrir()) setTimeout(abrir, 600);
    })();
  }, [resposta, user?.id, papel]);
}
