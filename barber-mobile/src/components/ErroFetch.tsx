import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { F } from '../lib/theme';

interface Props {
  message: string;
  onRetry: () => void;
}

export default function ErroFetch({ message, onRetry }: Props) {
  const { C } = useTheme();
  return (
    <View style={[s.container, { borderColor: C.destructive, backgroundColor: C.card }]}>
      <Feather name="alert-circle" size={14} color={C.destructive} />
      <Text style={[s.message, { color: C.destructive }]} numberOfLines={2}>{message}</Text>
      <TouchableOpacity onPress={onRetry} style={[s.btn, { borderColor: C.destructive }]}>
        <Text style={[s.btnText, { color: C.destructive }]}>TENTAR NOVAMENTE</Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center', borderWidth: 1, paddingHorizontal: 16, paddingVertical: 12, gap: 10, marginHorizontal: 24, marginTop: 16 },
  message:   { flex: 1, fontFamily: F.sans, fontSize: 13 },
  btn:       { borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  btnText:   { fontFamily: F.mono, fontSize: 9, letterSpacing: 1.5 },
});
