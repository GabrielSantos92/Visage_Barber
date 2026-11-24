// Aviso discreto quando a tela mostra dados salvos no aparelho:
//   - a atualizacao falhou: diz de quando sao os dados e permite tentar de novo;
//   - ainda atualizando: nada aparece, a nao ser que o dado salvo seja antigo
//     (mais de 30 minutos), quando a data aparece sem botao.
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { F } from '../lib/theme';
import { quandoFoiSalvo } from '../lib/cacheLocal';
import type { FalhaAtualizacao } from '../hooks/useCacheDaTela';

interface Props {
  salvoEm: number | null;
  falha: FalhaAtualizacao;
  onTentar: () => void;
}

// Dado salvo mais velho que isto: a data aparece mesmo enquanto atualiza
// (internet lenta), para ninguem tomar dado antigo por atual
const ANTIGO_MS = 30 * 60 * 1000;

export default function AvisoDadosSalvos({ salvoEm, falha, onTentar }: Props) {
  const { C } = useTheme();
  if (salvoEm == null) return null;
  if (!falha) {
    if (Date.now() - salvoEm <= ANTIGO_MS) return null;
    return (
      <View style={[s.caixa, { borderColor: C.border, backgroundColor: C.card }]} accessibilityLiveRegion="polite">
        <Feather name="clock" size={13} color={C.mutedFg} />
        <Text style={[s.texto, { color: C.mutedFg }]}>{`Mostrando os dados salvos em ${quandoFoiSalvo(salvoEm)}. Atualizando…`}</Text>
      </View>
    );
  }
  const texto = falha === 'conexao'
    ? `Sem conexão. Mostrando os dados salvos em ${quandoFoiSalvo(salvoEm)}.`
    : `Não foi possível atualizar. Mostrando os dados salvos em ${quandoFoiSalvo(salvoEm)}.`;
  return (
    <View style={[s.caixa, { borderColor: C.warning, backgroundColor: C.card }]} accessibilityLiveRegion="polite">
      <Feather name={falha === 'conexao' ? 'wifi-off' : 'alert-circle'} size={13} color={C.warning} />
      <Text style={[s.texto, { color: C.fg }]}>{texto}</Text>
      <TouchableOpacity onPress={onTentar} style={[s.botao, { borderColor: C.warning }]} accessibilityRole="button">
        <Text style={[s.botaoTexto, { color: C.warning }]}>ATUALIZAR</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  caixa:      { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, marginHorizontal: 24, marginTop: 12, paddingHorizontal: 12, paddingVertical: 10 },
  texto:      { flex: 1, fontFamily: F.sans, fontSize: 12, lineHeight: 17 },
  botao:      { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  botaoTexto: { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5 },
});
