import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';
import { GRUPOS_PERSONALIZACAO, Preferencias, semMudanca } from '../lib/personalizacaoVisagismo';

// Escolhas opcionais do visagismo personalizado (estilo, barba e cor do cabelo).
// Cada grupo funciona como um conjunto de radios para o leitor de tela.
export default function PersonalizacaoVisagismo({
  valor,
  onChange,
}: {
  valor: Preferencias;
  onChange: (p: Preferencias) => void;
}) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  return (
    <View style={s.card}>
      <View style={s.header}>
        <Feather name="sliders" size={14} color={C.accent} />
        <Text style={s.titulo} accessibilityRole="header">PERSONALIZAR (OPCIONAL)</Text>
      </View>
      <Text style={s.texto}>
        Diga o que você quer e a IA escolhe, dentro disso, o que mais combina com o seu rosto. Só cabelo e barba mudam: seu rosto continua o mesmo.
      </Text>

      {GRUPOS_PERSONALIZACAO.map(({ campo, titulo, opcoes }) => (
        <View key={campo} style={s.grupo}>
          <Text style={s.grupoTitulo}>{titulo.toUpperCase()}</Text>
          <View style={s.opcoes} accessibilityRole="radiogroup" accessibilityLabel={titulo}>
            {opcoes.map((o) => {
              const marcada = (valor[campo] ?? '') === o.valor;
              return (
                <TouchableOpacity
                  key={o.valor || 'padrao'}
                  style={[s.opcao, marcada && s.opcaoMarcada]}
                  onPress={() => onChange({ ...valor, [campo]: o.valor })}
                  hitSlop={4}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: marcada }}
                  accessibilityLabel={o.rotulo}
                >
                  <Text style={[s.opcaoTexto, marcada && s.opcaoTextoMarcada]}>{o.rotulo.toUpperCase()}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>
      ))}

      {semMudanca(valor) && (
        <Text style={s.aviso} accessibilityRole="alert">
          Para gerar a simulação, mude ao menos o corte, a barba ou a cor do cabelo.
        </Text>
      )}
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    card:              { marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.border, padding: 20 },
    header:            { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
    titulo:            { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    texto:             { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, lineHeight: 18, marginBottom: 16 },
    grupo:             { marginBottom: 14 },
    grupoTitulo:       { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8 },
    opcoes:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    opcao:             { borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 12 },
    opcaoMarcada:      { backgroundColor: C.primary, borderColor: C.primary },
    opcaoTexto:        { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1 },
    opcaoTextoMarcada: { color: C.primaryFg },
    aviso:             { fontFamily: F.sans, fontSize: 12, color: C.destructive, lineHeight: 18 },
  });
}
