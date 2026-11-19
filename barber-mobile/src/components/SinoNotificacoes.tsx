// Sino com o numero de notificacoes nao lidas: abre a central. Atualiza ao
// voltar para a tela e quando chega um push ou algo e marcado como lido.
import React, { useCallback, useEffect, useState } from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useTheme } from '../contexts/ThemeContext';
import { F } from '../lib/theme';
import { contarNaoLidas, aoMudar } from '../lib/centralNotificacoes';
import { navegacaoRef } from '../navigation/navegacao';
import { PapelNoApp } from '../hooks/usePushToken';

export default function SinoNotificacoes({ papel }: { papel: PapelNoApp }) {
  const { C } = useTheme();
  const [naoLidas, setNaoLidas] = useState(0);
  const atualizar = useCallback(() => { contarNaoLidas().then(setNaoLidas); }, []);

  useFocusEffect(atualizar);
  useEffect(() => aoMudar(atualizar), [atualizar]);

  return (
    <TouchableOpacity
      style={s.botao}
      onPress={() => navegacaoRef.isReady() && navegacaoRef.navigate('Notificacoes', { papel })}
      accessibilityLabel={naoLidas > 0 ? `Notificações: ${naoLidas} não lidas` : 'Notificações'}
    >
      <Feather name="bell" size={18} color={C.primary} />
      {naoLidas > 0 && (
        <View style={[s.selo, { backgroundColor: C.accent }]}>
          <Text style={[s.seloTexto, { color: C.accentFg }]}>{naoLidas > 9 ? '9+' : naoLidas}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

const s = StyleSheet.create({
  botao: { padding: 6 },
  selo: { position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  seloTexto: { fontFamily: F.mono, fontSize: 9 },
});
