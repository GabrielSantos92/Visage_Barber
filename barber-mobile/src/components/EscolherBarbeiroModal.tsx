import React, { useEffect, useState } from 'react';
import { Modal, View, Text, TouchableOpacity, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';
import { BarbeiroChat, listarBarbeirosDoCliente } from '../lib/visagismoSalvos';

interface Props {
  visible: boolean;
  onClose: () => void;
  onEscolher: (barbeiro: BarbeiroChat) => void;
}

export default function EscolherBarbeiroModal({ visible, onClose, onEscolher }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { user } = useAuth();
  const [barbeiros, setBarbeiros] = useState<BarbeiroChat[] | null>(null);

  useEffect(() => {
    if (!visible || !user) return;
    setBarbeiros(null);
    listarBarbeirosDoCliente(user.id).then(setBarbeiros).catch(() => setBarbeiros([]));
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={s.fundo} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={s.caixa} activeOpacity={1}>
          <View style={s.header}>
            <Text style={s.label}>ENVIAR PARA</Text>
            <TouchableOpacity onPress={onClose} hitSlop={12}>
              <Feather name="x" size={16} color={C.mutedFg} />
            </TouchableOpacity>
          </View>

          {barbeiros === null ? (
            <ActivityIndicator color={C.accent} style={{ marginVertical: 24 }} />
          ) : barbeiros.length === 0 ? (
            <Text style={s.vazio}>
              Você ainda não tem conversa com nenhum barbeiro. Faça um agendamento para poder enviar sua análise.
            </Text>
          ) : (
            barbeiros.map((b, i) => (
              <TouchableOpacity key={b.id} style={[s.item, i > 0 && s.itemBorder]} onPress={() => onEscolher(b)}>
                <Text style={s.itemNome}>{b.nome}</Text>
                <Feather name="send" size={14} color={C.accent} />
              </TouchableOpacity>
            ))
          )}
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    fundo:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    caixa:      { backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 36 },
    header:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
    label:      { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    vazio:      { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, lineHeight: 20, marginVertical: 16 },
    item:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18 },
    itemBorder: { borderTopWidth: 1, borderTopColor: C.border },
    itemNome:   { fontFamily: F.sansMedium, fontSize: 16, color: C.primary },
  });
}
