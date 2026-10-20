import React, { useEffect, useState } from 'react';
import { View, Text, Image, ActivityIndicator, StyleSheet } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useTheme } from '../contexts/ThemeContext';
import { F, Theme } from '../lib/theme';
import { urlAssinada } from '../lib/visagismoSalvos';

// Mostra uma imagem do bucket privado "visagismo" ocupando a largura do pai,
// na proporcao original (descoberta quando a imagem carrega).
export default function ImagemVisagismo({ path }: { path: string }) {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const [url, setUrl]     = useState<string | null>(null);
  const [ratio, setRatio] = useState(1);
  const [erro, setErro]   = useState(false);

  useEffect(() => {
    let ativo = true;
    setErro(false);
    urlAssinada(path)
      .then((u) => { if (ativo) setUrl(u); })
      .catch(() => { if (ativo) setErro(true); });
    return () => { ativo = false; };
  }, [path]);

  if (erro) {
    return (
      <View style={s.placeholder}>
        <Feather name="image" size={18} color={C.mutedFg} />
        <Text style={s.placeholderText}>IMAGEM INDISPONÍVEL</Text>
      </View>
    );
  }

  if (!url) {
    return <View style={s.placeholder}><ActivityIndicator color={C.accent} /></View>;
  }

  return (
    <Image
      source={{ uri: url }}
      style={{ width: '100%', aspectRatio: ratio, backgroundColor: C.card }}
      resizeMode="contain"
      onLoad={(e) => {
        const { width, height } = e.nativeEvent.source;
        if (width && height) setRatio(width / height);
      }}
      onError={() => setErro(true)}
    />
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    placeholder:     { width: '100%', aspectRatio: 1, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', gap: 8 },
    placeholderText: { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5 },
  });
}
