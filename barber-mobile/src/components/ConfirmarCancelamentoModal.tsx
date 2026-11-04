import React from 'react';
import { Modal, View, Text, TouchableOpacity, Pressable, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';

interface Props {
  visible: boolean;
  titulo: string;
  mensagem: string;
  // Quem/quando, para o barbeiro conferir antes de confirmar
  detalhe?: string;
  textoConfirmar: string;
  processando: boolean;
  erro: string | null;
  onVoltar: () => void;
  onConfirmar: () => void;
}

// Confirmacao de acao destrutiva. Enquanto processa, nada fecha o modal
// (toque fora, botao voltar do Android) e o confirmar fica desabilitado.
export default function ConfirmarCancelamentoModal({
  visible, titulo, mensagem, detalhe, textoConfirmar, processando, erro, onVoltar, onConfirmar,
}: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const voltar = () => { if (!processando) onVoltar(); };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={voltar}>
      <Pressable style={s.fundo} onPress={voltar} accessibilityLabel="Fechar">
        <Pressable style={s.caixa} onPress={() => {}} accessibilityRole="alert">
          <View style={s.icone}>
            <Feather name="alert-triangle" size={18} color={C.destructive} />
          </View>
          <Text style={s.titulo}>{titulo}</Text>
          <Text style={s.mensagem}>{mensagem}</Text>
          {detalhe ? <Text style={s.detalhe}>{detalhe}</Text> : null}
          {erro ? (
            <View style={s.erro}>
              <Feather name="wifi-off" size={12} color={C.destructive} />
              <Text style={s.erroTexto}>{erro}</Text>
            </View>
          ) : null}

          <TouchableOpacity
            style={[s.btnConfirmar, processando && { opacity: 0.6 }]}
            onPress={onConfirmar}
            disabled={processando}
            accessibilityRole="button"
            accessibilityState={{ disabled: processando, busy: processando }}
          >
            {processando
              ? <ActivityIndicator color="#ffffff" size="small" />
              : <Text style={s.btnConfirmarTexto}>{textoConfirmar.toUpperCase()}</Text>}
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btnVoltar, processando && { opacity: 0.4 }]}
            onPress={voltar}
            disabled={processando}
            accessibilityRole="button"
          >
            <Text style={s.btnVoltarTexto}>VOLTAR</Text>
          </TouchableOpacity>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    fundo:             { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'center', alignItems: 'center', padding: 24 },
    caixa:             { width: '100%', maxWidth: 420, backgroundColor: C.bg, borderWidth: 1, borderColor: C.border, padding: 24 },
    icone:             { width: 36, height: 36, borderWidth: 1, borderColor: C.destructive, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
    titulo:            { fontFamily: F.sansMedium, fontSize: 18, color: C.primary, marginBottom: 8 },
    mensagem:          { fontFamily: F.sans, fontSize: 14, color: C.mutedFg, lineHeight: 21 },
    detalhe:           { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1, borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10, marginTop: 16, lineHeight: 16 },
    erro:              { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14 },
    erroTexto:         { flex: 1, fontFamily: F.sans, fontSize: 12, color: C.destructive, lineHeight: 18 },
    btnConfirmar:      { backgroundColor: C.destructive, paddingVertical: 15, alignItems: 'center', justifyContent: 'center', marginTop: 22, minHeight: 48 },
    btnConfirmarTexto: { fontFamily: F.mono, fontSize: 10, color: '#ffffff', letterSpacing: 1.5 },
    btnVoltar:         { borderWidth: 1, borderColor: C.border, paddingVertical: 14, alignItems: 'center', marginTop: 10, minHeight: 48, justifyContent: 'center' },
    btnVoltarTexto:    { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 },
  });
}
