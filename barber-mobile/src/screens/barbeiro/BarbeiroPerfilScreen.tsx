import React, { useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, TextInput, TouchableOpacity,
  Alert, ActivityIndicator, ScrollView, Image,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import { supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

export default function BarbeiroPerfilScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);

  const { user, signOut } = useAuth();
  const [nome, setNome]                   = useState('');
  const [especialidade, setEspecialidade] = useState('');
  const [fotoUrl, setFotoUrl]             = useState<string | null>(null);
  const [loading, setLoading]             = useState(true);
  const [saving, setSaving]               = useState(false);
  const [uploadingFoto, setUploadingFoto] = useState(false);

  useEffect(() => { fetchPerfil(); }, []);

  async function fetchPerfil() {
    if (!user) return;
    const { data } = await supabase.from('barbeiros').select('*').eq('user_id', user.id).single();
    setNome(data?.nome ?? '');
    setEspecialidade(data?.especialidade ?? '');
    setFotoUrl((data as any)?.foto_url ?? null);
    setLoading(false);
  }

  async function escolherFoto() {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão necessária', 'Permita o acesso à galeria nas configurações.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.6,
      base64: true,
    });
    if (!result.canceled && result.assets[0].base64) {
      await uploadFoto(result.assets[0].base64);
    }
  }

  async function uploadFoto(base64: string) {
    if (!user) return;
    setUploadingFoto(true);
    try {
      const byteChars = atob(base64);
      const bytes = new Uint8Array(byteChars.length);
      for (let i = 0; i < byteChars.length; i++) {
        bytes[i] = byteChars.charCodeAt(i);
      }

      const path = `${user.id}/foto.jpg`;

      const { error: uploadError } = await (supabase.storage as any)
        .from('barbeiro-fotos')
        .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });

      if (uploadError) throw uploadError;

      const { data: urlData } = (supabase.storage as any)
        .from('barbeiro-fotos')
        .getPublicUrl(path);

      const publicUrl = urlData.publicUrl;
      await supabase.from('barbeiros').update({ foto_url: publicUrl } as any).eq('user_id', user.id);
      setFotoUrl(`${publicUrl}?t=${Date.now()}`);
      Alert.alert('Foto atualizada!', 'Sua foto de perfil foi salva.');
    } catch (e: any) {
      Alert.alert('Erro', e.message ?? 'Não foi possível fazer o upload.');
    }
    setUploadingFoto(false);
  }

  async function salvar() {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase.from('barbeiros').update({ nome, especialidade }).eq('user_id', user.id);
    setSaving(false);
    if (error) Alert.alert('Erro', error.message);
    else Alert.alert('Salvo!', 'Perfil atualizado com sucesso.');
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <ScrollView style={s.screen} contentContainerStyle={{ paddingBottom: 40 }}>
      <View style={s.pageHeader}>
        <Text style={s.pageLabel}>CONTA</Text>
        <Text style={s.pageTitle}>Meu Perfil</Text>
      </View>

      {/* Foto de perfil */}
      <View style={s.fotoSection}>
        <TouchableOpacity style={s.fotoContainer} onPress={escolherFoto} disabled={uploadingFoto}>
          {fotoUrl ? (
            <Image source={{ uri: fotoUrl }} style={s.foto} />
          ) : (
            <View style={s.fotoPlaceholder}>
              <Text style={s.fotoLetra}>{nome ? nome[0].toUpperCase() : '?'}</Text>
            </View>
          )}
          <View style={s.fotoCameraBtn}>
            {uploadingFoto
              ? <ActivityIndicator size="small" color={C.primaryFg} />
              : <Feather name="camera" size={14} color={C.primaryFg} />
            }
          </View>
        </TouchableOpacity>
        <Text style={s.fotoLabel}>TOQUE PARA ALTERAR</Text>
      </View>

      <View style={s.section}>
        <Text style={s.sectionLabel}>INFORMAÇÕES</Text>
        <View style={s.sectionLine} />
      </View>

      <View style={s.form}>
        <Text style={s.label}>NOME</Text>
        <View style={s.inputRow}>
          <Feather name="user" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <TextInput style={s.input} value={nome} onChangeText={setNome}
            placeholder="Seu nome" placeholderTextColor={C.mutedFg} />
        </View>

        <Text style={s.label}>ESPECIALIDADE</Text>
        <View style={s.inputRow}>
          <Feather name="scissors" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <TextInput style={s.input} value={especialidade} onChangeText={setEspecialidade}
            placeholder="Ex: Degradê, Navalhado" placeholderTextColor={C.mutedFg} />
        </View>

        <Text style={s.label}>EMAIL</Text>
        <View style={[s.inputRow, { opacity: 0.5 }]}>
          <Feather name="mail" size={14} color={C.mutedFg} style={{ paddingLeft: 14 }} />
          <Text style={[s.input, { color: C.mutedFg }]}>{user?.email}</Text>
        </View>

        <TouchableOpacity style={s.btnPrimary} onPress={salvar} disabled={saving}>
          {saving
            ? <ActivityIndicator color={C.primaryFg} size="small" />
            : <Text style={s.btnPrimaryText}>SALVAR ALTERAÇÕES</Text>}
        </TouchableOpacity>

        <TouchableOpacity style={s.btnSecondary} onPress={signOut}>
          <Feather name="log-out" size={14} color={C.mutedFg} />
          <Text style={s.btnSecondaryText}>SAIR DA CONTA</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:           { flex: 1, backgroundColor: C.bg },
    pageHeader:       { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    pageLabel:        { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    pageTitle:        { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    fotoSection:      { alignItems: 'center', paddingVertical: 28 },
    fotoContainer:    { position: 'relative' },
    foto:             { width: 96, height: 96, borderRadius: 0 },
    fotoPlaceholder:  { width: 96, height: 96, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, justifyContent: 'center', alignItems: 'center' },
    fotoLetra:        { fontFamily: F.mono, fontSize: 36, color: C.primary },
    fotoCameraBtn:    { position: 'absolute', bottom: 0, right: 0, width: 28, height: 28, backgroundColor: C.primary, justifyContent: 'center', alignItems: 'center' },
    fotoLabel:        { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1.5, marginTop: 10 },
    section:          { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 24, paddingVertical: 20 },
    sectionLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginRight: 12 },
    sectionLine:      { flex: 1, height: 1, backgroundColor: C.border },
    form:             { paddingHorizontal: 24 },
    label:            { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 8, marginTop: 4 },
    inputRow:         { flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card, marginBottom: 16 },
    input:            { flex: 1, color: C.primary, fontFamily: F.sans, fontSize: 14, paddingHorizontal: 12, paddingVertical: 14 },
    btnPrimary:       { backgroundColor: C.primary, paddingVertical: 16, alignItems: 'center', marginBottom: 12, marginTop: 8 },
    btnPrimaryText:   { fontFamily: F.mono, fontSize: 11, color: C.primaryFg, letterSpacing: 2.5 },
    btnSecondary:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderWidth: 1, borderColor: C.border, paddingVertical: 16, marginBottom: 8 },
    btnSecondaryText: { fontFamily: F.mono, fontSize: 11, color: C.mutedFg, letterSpacing: 2.5 },
  });
}
