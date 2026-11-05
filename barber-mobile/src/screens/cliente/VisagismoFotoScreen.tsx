import React, { useState, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image,
  ActivityIndicator, Alert, ScrollView,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Feather } from '@expo/vector-icons';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { ClienteStackParamList } from '../../navigation/ClienteNavigator';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';
import { api, ApiError } from '../../lib/api';
import AvisoPrivacidadeVisagismo from '../../components/AvisoPrivacidadeVisagismo';
import PersonalizacaoVisagismo from '../../components/PersonalizacaoVisagismo';
import { Preferencias, preferenciasParaEnvio, semMudanca } from '../../lib/personalizacaoVisagismo';

type Nav = StackNavigationProp<ClienteStackParamList>;

type EstadoConsentimento = 'pendente' | 'concedido';

export default function VisagismoFotoScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const navigation = useNavigation<Nav>();

  const [foto, setFoto]           = useState<string | null>(null);
  const [fotoUri, setFotoUri]     = useState<string | null>(null);
  const [loading, setLoading]     = useState(false);
  const [cameraAtiva, setCameraAtiva] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  // O aviso aparece a cada visita, mesmo para quem ja concordou antes: a foto so
  // pode ser escolhida depois de concordar de novo. O backend continua sendo
  // quem decide se o envio e aceito.
  const [consentimento, setConsentimento] = useState<EstadoConsentimento>('pendente');
  // Visagismo personalizado (opcional): estilo, barba e cor do cabelo
  const [preferencias, setPreferencias] = useState<Preferencias>({});

  // Ao voltar para a tela (ex.: do resultado), recomeca pelo aviso. Se o aviso
  // ja esta aberto (ex.: voltou de "Consultar Aviso de Privacidade"), nada muda.
  // A ref evita rodar de novo logo apos concordar (so roda ao ganhar o foco).
  const consentimentoRef = useRef(consentimento);
  consentimentoRef.current = consentimento;
  useFocusEffect(useCallback(() => {
    if (consentimentoRef.current === 'pendente') return;
    setConsentimento('pendente');
    setFoto(null);
    setFotoUri(null);
  }, []));

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
      setFotoUri(result.assets[0].uri);
    }
  }

  async function abrirCamera() {
    if (!cameraPermission?.granted) {
      const { granted } = await requestCameraPermission();
      if (!granted) {
        Alert.alert('Permissão necessária', 'Permita o acesso à câmera nas configurações.');
        return;
      }
    }
    setCameraAtiva(true);
  }

  async function capturarFoto() {
    if (!cameraRef.current) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ base64: true, quality: 0.7 });
      if (photo?.base64) {
        setFoto(photo.base64);
        setFotoUri(photo.uri);
        setCameraAtiva(false);
      }
    } catch {
      Alert.alert('Erro', 'Não foi possível capturar a foto.');
    }
  }

  async function analisar() {
    if (!foto || semMudanca(preferencias)) return;
    setLoading(true);
    try {
      // Sem personalizacao o pedido e o mesmo de sempre
      const pref = preferenciasParaEnvio(preferencias);
      const resultado = await api.post<any>('/api/visagismo/analisar', pref ? { imagem_base64: foto, preferencias: pref } : { imagem_base64: foto });
      navigation.navigate('VisagismoResultado', { resultado, fotoUri: fotoUri ?? undefined, fotoBase64: foto ?? undefined });
    } catch (e: any) {
      // Autorizacao revogada em outro aparelho: descarta a foto e mostra o aviso de novo
      if (e instanceof ApiError && e.code === 'CONSENTIMENTO_NECESSARIO') {
        setFoto(null);
        setFotoUri(null);
        setConsentimento('pendente');
      }
      Alert.alert('Erro', e.message ?? 'Não foi possível analisar a foto.');
    }
    setLoading(false);
  }

  // Câmera inline
  if (cameraAtiva) {
    return (
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="front" />

        {/* Botão fechar */}
        <TouchableOpacity
          style={s.cameraBtnFechar}
          onPress={() => setCameraAtiva(false)}
        >
          <Feather name="x" size={24} color="#fff" />
        </TouchableOpacity>

        {/* Botão capturar */}
        <View style={s.cameraControls}>
          <TouchableOpacity style={s.cameraBtnCapturar} onPress={capturarFoto}>
            <View style={s.cameraBtnInner} />
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>VISAGISMO IA</Text>
        <Text style={s.pageTitle}>Análise por Foto</Text>
        <Text style={s.pageSub}>Envie uma foto do seu rosto para receber recomendações personalizadas de corte e estilo.</Text>
      </View>

      {/* Aviso de privacidade: aparece antes de qualquer escolha de foto */}
      {consentimento === 'pendente' ? (
        <AvisoPrivacidadeVisagismo
          onConcordou={(sit) => setConsentimento(sit.consentido ? 'concedido' : 'pendente')}
          onConsultarAviso={() => navigation.navigate('AvisoPrivacidade')}
          onVoltar={() => navigation.goBack()}
        />
      ) : foto ? (
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
            <TouchableOpacity style={s.btnUpload} onPress={escolherGaleria}>
              <Feather name="image" size={16} color={C.primary} />
              <Text style={s.btnUploadText}>DA GALERIA</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.btnUpload} onPress={abrirCamera}>
              <Feather name="camera" size={16} color={C.primary} />
              <Text style={s.btnUploadText}>CÂMERA</Text>
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

      {consentimento === 'concedido' && (
        <TouchableOpacity style={s.autorizado} onPress={() => navigation.navigate('AvisoPrivacidade')}>
          <Feather name="shield" size={11} color={C.accent} />
          <Text style={s.autorizadoTexto}>USO DA FOTO AUTORIZADO · VER AVISO DE PRIVACIDADE</Text>
        </TouchableOpacity>
      )}

      {foto && consentimento === 'concedido' && (
        <PersonalizacaoVisagismo valor={preferencias} onChange={setPreferencias} />
      )}

      {/* Botão analisar */}
      {foto && consentimento === 'concedido' && (
        <TouchableOpacity
          style={[s.btnAnalisar, semMudanca(preferencias) && { opacity: 0.5 }]}
          onPress={analisar}
          disabled={loading || semMudanca(preferencias)}
          accessibilityState={{ disabled: loading || semMudanca(preferencias) }}
        >
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
    screen:             { flex: 1, backgroundColor: C.bg },
    pageHeader:         { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 24, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:          { fontFamily: F.mono, fontSize: 10, color: C.accent, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:          { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5, marginBottom: 8 },
    pageSub:            { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, lineHeight: 20 },
    uploadArea:         { margin: 24, borderWidth: 1, borderColor: C.border, borderStyle: 'dashed', padding: 32, alignItems: 'center' },
    uploadIcon:         { width: 80, height: 80, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center', marginBottom: 16 },
    uploadTitle:        { fontFamily: F.sansMedium, fontSize: 15, color: C.primary, marginBottom: 8, textAlign: 'center' },
    uploadSub:          { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, textAlign: 'center', lineHeight: 18, marginBottom: 24 },
    botoesUpload:       { flexDirection: 'row', gap: 12, width: '100%' },
    btnUpload:          { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.primary, paddingVertical: 14 },
    btnUploadText:      { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.5 },
    previewContainer:   { margin: 24, alignItems: 'center' },
    preview:            { width: '100%', height: 320, resizeMode: 'cover' },
    trocarFoto:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 12 },
    trocarFotoText:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5 },
    dicas:              { paddingHorizontal: 24, paddingTop: 8 },
    dicasLabel:         { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 14 },
    dicaItem:           { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 },
    dicaText:           { fontFamily: F.sans, fontSize: 13, color: C.fg },
    autorizado:         { flexDirection: 'row', alignItems: 'center', gap: 6, marginHorizontal: 24, marginTop: -8, paddingVertical: 6 },
    autorizadoTexto:    { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.2, flex: 1 },
    btnAnalisar:        { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, backgroundColor: C.primary, marginHorizontal: 24, marginTop: 24, paddingVertical: 18 },
    btnAnalisarText:    { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    // Camera
    cameraBtnFechar:    { position: 'absolute', top: 56, left: 24, width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
    cameraControls:     { position: 'absolute', bottom: 48, left: 0, right: 0, alignItems: 'center' },
    cameraBtnCapturar:  { width: 80, height: 80, borderRadius: 40, borderWidth: 4, borderColor: '#fff', justifyContent: 'center', alignItems: 'center' },
    cameraBtnInner:     { width: 64, height: 64, borderRadius: 32, backgroundColor: '#fff' },
  });
}
