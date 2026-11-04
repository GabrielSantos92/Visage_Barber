import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, LayoutChangeEvent } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useSharedValue, useAnimatedStyle, withTiming } from 'react-native-reanimated';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';

const ESCALA_MIN = 1;
const ESCALA_MAX = 5;
const ESCALA_TOQUE_DUPLO = 2.5;

// Translacao maxima para a imagem ampliada nao sair da area visivel.
function limitar(v: number, escala: number, conteudo: number, area: number) {
  'worklet';
  const max = Math.max(0, (conteudo * escala - area) / 2);
  return Math.min(max, Math.max(-max, v));
}

function limitarEscala(s: number) {
  'worklet';
  return Math.min(ESCALA_MAX, Math.max(ESCALA_MIN, s));
}

interface Props {
  uri: string | null;
  titulo: string;
  visible: boolean;
  onClose: () => void;
}

// Imagem em tela cheia: pinca amplia/reduz (no ponto entre os dedos), arrastar
// move a imagem ampliada e o toque duplo alterna o zoom. A imagem fica em
// "contain", entao a proporcao da foto nunca e alterada.
export default function VisualizadorImagem({ uri, titulo, visible, onClose }: Props) {
  return (
    <Modal
      visible={visible && !!uri}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      {/* O Modal abre fora da arvore nativa da tela: precisa das proprias raizes
          de area segura e de gestos. */}
      <SafeAreaProvider>
        <GestureHandlerRootView style={{ flex: 1 }}>
          {/* Montado a cada abertura: o zoom sempre comeca em 100% */}
          {uri ? <Conteudo key={uri} uri={uri} titulo={titulo} onClose={onClose} /> : null}
        </GestureHandlerRootView>
      </SafeAreaProvider>
    </Modal>
  );
}

function Conteudo({ uri, titulo, onClose }: { uri: string; titulo: string; onClose: () => void }) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const insets = useSafeAreaInsets();

  const escala = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  // Area visivel e tamanho real da foto dentro dela (em "contain")
  const areaW = useSharedValue(0);
  const areaH = useSharedValue(0);
  const proporcao = useSharedValue(0);
  // Estado dos gestos
  const inicioEscala = useSharedValue(1);
  const inicioX = useSharedValue(0);
  const inicioY = useSharedValue(0);
  const focoX = useSharedValue(0);
  const focoY = useSharedValue(0);
  const baseX = useSharedValue(0);
  const baseY = useSharedValue(0);
  const pincando = useSharedValue(false);
  const rebasear = useSharedValue(false);

  function onLayout(e: LayoutChangeEvent) {
    areaW.value = e.nativeEvent.layout.width;
    areaH.value = e.nativeEvent.layout.height;
  }

  function conteudoW() {
    'worklet';
    return proporcao.value ? Math.min(areaW.value, areaH.value * proporcao.value) : areaW.value;
  }
  function conteudoH() {
    'worklet';
    return proporcao.value ? conteudoW() / proporcao.value : areaH.value;
  }

  function restaurar() {
    'worklet';
    escala.value = withTiming(1);
    x.value = withTiming(0);
    y.value = withTiming(0);
  }

  const pinca = Gesture.Pinch()
    .onStart((e) => {
      pincando.value = true;
      inicioEscala.value = escala.value;
      inicioX.value = x.value;
      inicioY.value = y.value;
      focoX.value = e.focalX - areaW.value / 2;
      focoY.value = e.focalY - areaH.value / 2;
    })
    .onUpdate((e) => {
      const nova = limitarEscala(inicioEscala.value * e.scale);
      const k = nova / inicioEscala.value;
      // O ponto que estava sob os dedos acompanha o meio da pinca.
      const fx = e.focalX - areaW.value / 2;
      const fy = e.focalY - areaH.value / 2;
      escala.value = nova;
      x.value = limitar(fx - (focoX.value - inicioX.value) * k, nova, conteudoW(), areaW.value);
      y.value = limitar(fy - (focoY.value - inicioY.value) * k, nova, conteudoH(), areaH.value);
    })
    .onFinalize(() => {
      pincando.value = false;
      rebasear.value = true;
      if (escala.value < 1.05) restaurar();
    });

  const arraste = Gesture.Pan()
    .averageTouches(true)
    .onStart((e) => {
      baseX.value = x.value - e.translationX;
      baseY.value = y.value - e.translationY;
      rebasear.value = false;
    })
    .onUpdate((e) => {
      if (pincando.value) return;
      // Depois de uma pinca, continua de onde a imagem esta, sem salto.
      if (rebasear.value) {
        baseX.value = x.value - e.translationX;
        baseY.value = y.value - e.translationY;
        rebasear.value = false;
      }
      x.value = limitar(baseX.value + e.translationX, escala.value, conteudoW(), areaW.value);
      y.value = limitar(baseY.value + e.translationY, escala.value, conteudoH(), areaH.value);
    });

  const toqueDuplo = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e, sucesso) => {
      if (!sucesso) return;
      if (escala.value > 1) { restaurar(); return; }
      const fx = e.x - areaW.value / 2;
      const fy = e.y - areaH.value / 2;
      escala.value = withTiming(ESCALA_TOQUE_DUPLO);
      x.value = withTiming(limitar(fx * (1 - ESCALA_TOQUE_DUPLO), ESCALA_TOQUE_DUPLO, conteudoW(), areaW.value));
      y.value = withTiming(limitar(fy * (1 - ESCALA_TOQUE_DUPLO), ESCALA_TOQUE_DUPLO, conteudoH(), areaH.value));
    });

  const gestos = Gesture.Race(toqueDuplo, Gesture.Simultaneous(pinca, arraste));

  const estiloImagem = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: escala.value }],
  }));

  return (
    <View style={s.raiz}>
      <View style={[s.topo, { paddingTop: insets.top + 12 }]}>
        <Text style={s.titulo} numberOfLines={1}>{titulo}</Text>
        <TouchableOpacity
          style={s.fechar}
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Fechar visualização"
        >
          <Feather name="x" size={18} color={C.primary} />
        </TouchableOpacity>
      </View>

      <GestureDetector gesture={gestos}>
        <View style={s.area} onLayout={onLayout} collapsable={false}>
          <Animated.Image
            source={{ uri }}
            style={[StyleSheet.absoluteFill, estiloImagem]}
            resizeMode="contain"
            accessibilityLabel={titulo}
            onLoad={(e) => {
              const { width, height } = e.nativeEvent.source;
              if (width && height) proporcao.value = width / height;
            }}
          />
        </View>
      </GestureDetector>

      <Text style={[s.dica, { paddingBottom: insets.bottom + 16 }]}>
        PINCE PARA AMPLIAR · TOQUE DUPLO ALTERNA O ZOOM
      </Text>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    raiz:   { flex: 1, backgroundColor: C.bg },
    topo:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingHorizontal: 20, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border },
    titulo: { flex: 1, fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5 },
    fechar: { width: 36, height: 36, borderWidth: 1, borderColor: C.border, alignItems: 'center', justifyContent: 'center' },
    area:   { flex: 1, overflow: 'hidden' },
    dica:   { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, textAlign: 'center', paddingTop: 12 },
  });
}
