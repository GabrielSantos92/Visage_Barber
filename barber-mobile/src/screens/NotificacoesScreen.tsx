// Central de notificacoes (cliente e barbeiro): historico do proprio usuario,
// lidas e nao lidas. Tocar marca como lida e abre a tela do evento.
import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, RefreshControl, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { F } from '../lib/theme';
import {
  Notificacao, POR_PAGINA, buscarNotificacoes, marcarLidas, marcarTodasLidas, textoDaNotificacao, quando, aoMudar,
} from '../lib/centralNotificacoes';
import { abrirDestino, PapelNoApp } from '../hooks/usePushToken';

const ICONES: Record<string, keyof typeof Feather.glyphMap> = {
  novo_agendamento: 'calendar', cancelamento: 'x-circle', lembrete: 'clock', mensagem: 'message-circle',
};

export default function NotificacoesScreen({ route }: { route: { params: { papel: PapelNoApp } } }) {
  const { C } = useTheme();
  const s = estilos(C);
  const papel = route.params.papel;
  const [lista, setLista] = useState<Notificacao[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [atualizando, setAtualizando] = useState(false);
  const [fim, setFim] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    try {
      const itens = await buscarNotificacoes();
      setLista(itens);
      setFim(itens.length < POR_PAGINA);
      setErro(null);
    } catch {
      setErro('Não foi possível carregar as notificações.');
    } finally {
      setCarregando(false);
      setAtualizando(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { carregar(); }, [carregar]));
  useEffect(() => aoMudar(carregar), [carregar]);

  async function maisAntigas() {
    if (fim || lista.length === 0) return;
    try {
      const itens = await buscarNotificacoes(lista[lista.length - 1].criada_em);
      setLista((atual) => [...atual, ...itens.filter((i) => !atual.some((a) => a.id === i.id))]);
      setFim(itens.length < POR_PAGINA);
    } catch {
      setFim(true);
    }
  }

  async function abrir(n: Notificacao) {
    if (!n.lida_em) {
      setLista((atual) => atual.map((a) => (a.id === n.id ? { ...a, lida_em: new Date().toISOString() } : a)));
      marcarLidas([n.id]).catch(() => {});
    }
    abrirDestino(papel, n.tipo, n.dados);
  }

  async function lerTodas() {
    setLista((atual) => atual.map((a) => (a.lida_em ? a : { ...a, lida_em: new Date().toISOString() })));
    marcarTodasLidas().catch(() => carregar());
  }

  if (carregando) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;
  const temNaoLidas = lista.some((n) => !n.lida_em);

  return (
    <View style={s.tela}>
      {temNaoLidas && (
        <TouchableOpacity style={s.lerTodas} onPress={lerTodas} accessibilityRole="button">
          <Feather name="check-square" size={14} color={C.primary} />
          <Text style={s.lerTodasTexto}>MARCAR TODAS COMO LIDAS</Text>
        </TouchableOpacity>
      )}
      <FlatList
        data={lista}
        keyExtractor={(n) => n.id}
        onEndReached={maisAntigas}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={atualizando} onRefresh={() => { setAtualizando(true); carregar(); }} tintColor={C.accent} />}
        contentContainerStyle={{ paddingBottom: 40, flexGrow: 1 }}
        ListEmptyComponent={
          <View style={s.vazio}>
            <Feather name="bell-off" size={28} color={C.mutedFg} />
            <Text style={s.vazioTexto}>{erro ?? 'Nenhuma notificação por enquanto.'}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const { titulo, corpo } = textoDaNotificacao(item);
          const naoLida = !item.lida_em;
          return (
            <TouchableOpacity
              style={[s.item, naoLida && s.itemNaoLido]}
              onPress={() => abrir(item)}
              accessibilityLabel={`${naoLida ? 'Não lida. ' : ''}${titulo}. ${corpo}`}
            >
              <Feather name={ICONES[item.tipo] ?? 'bell'} size={18} color={naoLida ? C.accent : C.mutedFg} style={{ marginTop: 2 }} />
              <View style={{ flex: 1 }}>
                <Text style={[s.titulo, naoLida && { color: C.primary }]}>{titulo}</Text>
                <Text style={s.corpo}>{corpo}</Text>
                <Text style={s.data}>{quando(item.criada_em).toUpperCase()}</Text>
              </View>
              {naoLida && <View style={s.ponto} />}
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const estilos = (C: ReturnType<typeof useTheme>['C']) => StyleSheet.create({
  tela: { flex: 1, backgroundColor: C.bg },
  lerTodas: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 20, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
  lerTodasTexto: { fontFamily: F.mono, fontSize: 10, letterSpacing: 1.5, color: C.primary },
  item: { flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: C.border },
  itemNaoLido: { backgroundColor: C.card },
  titulo: { fontFamily: F.sansMedium, fontSize: 14, color: C.fg, marginBottom: 2 },
  corpo: { fontFamily: F.sans, fontSize: 13, color: C.fg, lineHeight: 18 },
  data: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1, color: C.mutedFg, marginTop: 6 },
  ponto: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.accent, marginTop: 6 },
  vazio: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12, padding: 40 },
  vazioTexto: { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, textAlign: 'center' },
});
