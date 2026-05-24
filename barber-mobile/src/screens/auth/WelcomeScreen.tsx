import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { StackNavigationProp } from '@react-navigation/stack';
import { AuthStackParamList } from '../../navigation/AuthNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

type Props = { navigation: StackNavigationProp<AuthStackParamList, 'Welcome'> };

export default function WelcomeScreen({ navigation }: Props) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  return (
    <View style={s.screen}>
      <View style={s.logoRow}>
        <View style={s.logoSquare}><View style={s.logoInner} /></View>
        <Text style={s.logoText}>VISAGE BARBER</Text>
      </View>

      <View style={s.content}>
        <Text style={s.label}>ÁREA DE ACESSO</Text>
        <Text style={s.heading}>Bem-vindo</Text>
        <Text style={s.sub}>Selecione como deseja entrar</Text>

        <TouchableOpacity style={s.btnPrimary} onPress={() => navigation.navigate('Login')}>
          <Text style={s.btnPrimaryText}>ÁREA DO CLIENTE</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.btnSecondary} onPress={() => navigation.navigate('BarbeiroLogin')}>
          <Text style={s.btnSecondaryText}>ÁREA DO BARBEIRO</Text>
        </TouchableOpacity>
      </View>

      <View style={s.footer}>
        <View style={s.footerDot} />
        <View style={[s.footerDot, { opacity: 0.3 }]} />
        <View style={[s.footerDot, { opacity: 0.3 }]} />
      </View>
    </View>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:        { flex: 1, backgroundColor: C.bg, paddingHorizontal: 24 },
    logoRow:       { flexDirection: 'row', alignItems: 'center', paddingTop: 64, marginBottom: 64 },
    logoSquare:    { width: 28, height: 28, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
    logoInner:     { width: 14, height: 14, backgroundColor: C.bg },
    logoText:      { fontFamily: F.mono, fontSize: 11, color: C.primary, letterSpacing: 1.5 },
    content:       { flex: 1, justifyContent: 'center' },
    label:         { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 2, marginBottom: 12 },
    heading:       { fontFamily: F.sansLight, fontSize: 38, color: C.primary, letterSpacing: -1, marginBottom: 8 },
    sub:           { fontFamily: F.sans, fontSize: 14, color: C.mutedFg, marginBottom: 48 },
    btnPrimary:    { backgroundColor: C.primary, paddingVertical: 18, alignItems: 'center', marginBottom: 14 },
    btnPrimaryText:{ fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    btnSecondary:  { borderWidth: 1, borderColor: C.border, paddingVertical: 18, alignItems: 'center' },
    btnSecondaryText: { fontFamily: F.mono, fontSize: 11, color: C.fg, letterSpacing: 2.5 },
    footer:        { flexDirection: 'row', justifyContent: 'center', gap: 6, paddingBottom: 40 },
    footerDot:     { width: 6, height: 6, backgroundColor: C.primary },
  });
}
