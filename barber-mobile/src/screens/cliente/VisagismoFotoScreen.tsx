import React, { useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Feather } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import { api } from '../../lib/api';

type Nav = StackNavigationProp<ClienteStackParamList>;

export default function VisagismoFotoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const navigation = useNavigation<Nav>();

  const [foto, setFoto]       = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function escolherGaleria() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permissão necessária', 'Permita o acesso à galeria nas configurações.'); return; }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
      allowsEditing: true,
      aspect: [3, 4],
    });
    if (!result.canceled && result.assets[0].base64) {
      setFoto(result.assets[0].base64);
    }
  }

  async function tirarFoto() {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('Permissão necessária', 'Permita o acesso à câmera nas configurações.'); return; }
    const result = await ImagePicker.launchCameraAsync({
      quality: 0.7,
      base64: true,
      allowsEditing: true,
      aspect: [3, 4],
    });
    if (!result.canceled && result.assets[0].base64) {
      setFoto(result.assets[0].base64);
    }
  }

  async function analisar() {
    if (!foto) return;
    setLoading(true);
    try {
      const resultado = await api.post<any>('/api/visagismo/analisar', { imagem_base64: foto });
      navigation.navigate('VisagismoResultado', { resultado });
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Não foi possível analisar a foto.');
    }
    setLoading(false);
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>VISAGISMO IA</Text>
        <Text style={s.pageTitle}>Análise por Foto</Text>
        <Text style={s.pageSub}>Envie uma foto do seu rosto para receber recomendações personalizadas de corte e estilo.</Text>
      </View>

      {/* Preview da foto */}
      {foto ? (
        <View style={s.previewContainer}>
          <Image source={{ uri: `data:image/jpeg;base64,${foto}` }} style={s.preview} />
          <TouchableOpacity style={s.trocarFoto} onPress={() => setFoto(null)}>
            <Feather name="x" size={14} color={C.mutedFg} />
            <Text style={s.trocarFotoText}>TROCAR FOTO</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={s.uploadArea}>
          <View style={s.uploadIcon}>
            <Feather name="user" size={40} color={C.border} />
          </View>
          <Text style={s.uploadTitle}>Adicione uma foto do seu rosto</Text>
          <Text style={s.uploadSub}>Para melhor resultado, use boa iluminação e olhe diretamente para a câmera</Text>

          <View style={s.botoesUpload}>
            <TouchableOpacity style={s.btnUpload} onPress={tirarFoto}>
              <Feather name="camera" size={16} color={C.primary} />
              <Text style={s.btnUploadText}>TIRAR FOTO</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[s.btnUpload, { borderColor: C.border }]} onPress={escolherGaleria}>
              <Feather name="image" size={16} color={C.mutedFg} />
              <Text style={[s.btnUploadText, { color: C.mutedFg }]}>DA GALERIA</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Dicas */}
      <View style={s.dicas}>
        <Text style={s.dicasLabel}>DICAS PARA MELHOR RESULTADO</Text>
        {[
          { icon: 'sun', text: 'Use boa iluminação, de frente para a luz' },
          { icon: 'user', text: 'Olhe diretamente para a câmera' },
          { icon: 'crop', text: 'Enquadre apenas o rosto e pescoço' },
          { icon: 'minus-circle', text: 'Evite óculos ou bonés' },
        ].map((d, i) => (
          <View key={i} style={s.dicaItem}>
            <Feather name={d.icon as any} size={13} color={C.accent} />
            <Text style={s.dicaText}>{d.text}</Text>
          </View>
        ))}
      </View>

      {/* Botão analisar */}
      {foto && (
        <TouchableOpacity style={s.btnAnalisar} onPress={analisar} disabled={loading}>
          {loading ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <ActivityIndicator color={C.primaryFg} size="small" />
              <Text style={s.btnAnalisarText}>ANALISANDO...</Text>
            </View>
          ) : (
            <>
              <Feather name="cpu" size={14} color={C.primaryFg} />
              <Text style={s.btnAnalisarText}>ANALISAR COM IA</Text>
            </>
          )}
        </TouchableOpacity>
      )}
    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:           { flex: 1, backgroundColor: C.bg },
    pageHeader:       { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:        { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:        { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5, marginBottom: 8 },
    pageSub:          { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, lineHeight: 20 },
    uploadArea:       { margin: 24, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', padding: 32, alignItems: 'center' },
    uploadIcon:       { width: 80, height: 80, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    uploadTitle:      { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 8, textAlign: 'center' },
    uploadSub:        { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, textAlign: 'center', lineHeight: 18, marginBottom: 24 },
    botoesUpload:     { flexDirection: 'row', gap: 12, width: '100%' },
    btnUpload:        { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.primary, paddingVertical: 14 },
    btnUploadText:    { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 },
    previewContainer: { margin: 24, alignItems: 'center' },
    preview:          { width: '100%', height: 320, resizeMode: 'cover' },
    trocarFoto:       { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
    trocarFotoText:   { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    dicas:            { paddingHorizontal: 24, paddingTop: 8 },
    dicasLabel:       { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 14 },
    dicaItem:         { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    dicaText:         { fontFamily: F.sans, fontSize: 13, color: C.fg },
    btnAnalisar:      { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, marginHorizontal: 24, marginTop: 24, paddingVertical: 18 },
    btnAnalisarText:  { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
  });
}
