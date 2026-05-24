import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, FlatList,
  StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { supabase as _supabase } from '../../lib/supabase';
import { useTheme } from '../../contexts/ThemeContext';
import { F, Theme } from '../../lib/theme';

const db = _supabase as any;

export type ChatParams = {
  outroNome: string;
  barbeiroId: string;
  clienteId: string;
};

interface Mensagem {
  id: string;
  conversa_id: string;
  remetente_id: string;
  conteudo: string;
  created_at: string;
}

export default function ChatScreen() {
  const { C } = useTheme();
  const s = React.useMemo(() => makeStyles(C), [C]);
  const { user } = useAuth();
  const route = useRoute<RouteProp<{ Chat: ChatParams }, 'Chat'>>();
  const { outroNome, barbeiroId, clienteId } = route.params;

  const [conversaId, setConversaId] = useState<string | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[]>([]);
  const [texto, setTexto] = useState('');
  const [loading, setLoading] = useState(true);
  const [enviando, setEnviando] = useState(false);
  const conversaIdRef = useRef<string | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    initConversa();
  }, []);

  // Polling a cada 3 segundos para receber mensagens em tempo real
  useEffect(() => {
    if (!conversaIdRef.current) return;
    const interval = setInterval(() => buscarMensagens(conversaIdRef.current!), 3000);
    return () => clearInterval(interval);
  }, [conversaId]);

  // Scroll automático quando chegam novas mensagens
  useEffect(() => {
    if (mensagens.length > 0) {
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [mensagens]);

  async function initConversa() {
    let { data: conversa } = await db
      .from('conversas')
      .select('id')
      .eq('cliente_id', clienteId)
      .eq('barbeiro_id', barbeiroId)
      .maybeSingle();

    if (!conversa) {
      const { data: nova } = await db
        .from('conversas')
        .insert({ cliente_id: clienteId, barbeiro_id: barbeiroId })
        .select('id')
        .single();
      conversa = nova;
    }

    if (!conversa) { setLoading(false); return; }

    conversaIdRef.current = conversa.id;
    setConversaId(conversa.id);
    await buscarMensagens(conversa.id);
    setLoading(false);
  }

  async function buscarMensagens(cid: string) {
    const { data } = await db
      .from('mensagens')
      .select('*')
      .eq('conversa_id', cid)
      .order('created_at', { ascending: true });
    if (data) setMensagens(data);
  }

  async function enviar() {
    const cid = conversaIdRef.current;
    if (!texto.trim() || !cid || !user || enviando) return;
    const conteudo = texto.trim();
    setTexto('');
    setEnviando(true);
    await db.from('mensagens').insert({ conversa_id: cid, remetente_id: user.id, conteudo });
    await buscarMensagens(cid);
    setEnviando(false);
  }

  if (loading) return <ActivityIndicator style={{ flex: 1, backgroundColor: C.bg }} color={C.accent} />;

  return (
    <KeyboardAvoidingView
      style={s.screen}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={88}
    >
      <FlatList
        ref={listRef}
        data={mensagens}
        keyExtractor={(m) => m.id}
        contentContainerStyle={s.listContent}
        renderItem={({ item }) => {
          const minha = item.remetente_id === user?.id;
          return (
            <View style={[s.bubbleWrap, minha && { alignItems: 'flex-end' }]}>
              <View style={[s.bubble, minha ? s.bubbleMinha : s.bubbleOutra]}>
                <Text style={[s.bubbleText, minha ? s.bubbleTextMinha : s.bubbleTextOutra]}>
                  {item.conteudo}
                </Text>
                <Text style={[s.bubbleTime, minha && { textAlign: 'right' }]}>
                  {new Date(item.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          );
        }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Feather name="message-circle" size={32} color={C.border} />
            <Text style={s.emptyText}>Nenhuma mensagem ainda</Text>
            <Text style={s.emptySubText}>Inicie a conversa com {outroNome}.</Text>
          </View>
        }
      />

      <View style={s.inputRow}>
        <TextInput
          style={s.input}
          value={texto}
          onChangeText={setTexto}
          placeholder="Digite uma mensagem..."
          placeholderTextColor={C.mutedFg}
          multiline
          maxLength={500}
        />
        <TouchableOpacity
          style={[s.sendBtn, { backgroundColor: texto.trim() ? C.primary : C.card }]}
          onPress={enviar}
          disabled={!texto.trim() || enviando}
        >
          {enviando
            ? <ActivityIndicator size="small" color={C.primaryFg} />
            : <Feather name="send" size={14} color={texto.trim() ? C.primaryFg : C.mutedFg} />
          }
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:          { flex: 1, backgroundColor: C.bg },
    listContent:     { padding: 16, paddingBottom: 8 },
    bubbleWrap:      { marginBottom: 10, alignItems: 'flex-start' },
    bubble:          { maxWidth: '78%', padding: 12, borderWidth: 1 },
    bubbleMinha:     { backgroundColor: C.primary, borderColor: C.primary },
    bubbleOutra:     { backgroundColor: C.card, borderColor: C.border },
    bubbleText:      { fontFamily: F.sans, fontSize: 14, lineHeight: 20 },
    bubbleTextMinha: { color: C.primaryFg },
    bubbleTextOutra: { color: C.fg },
    bubbleTime:      { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, marginTop: 4, letterSpacing: 0.5 },
    empty:           { alignItems: 'center', marginTop: 80, gap: 10 },
    emptyText:       { fontFamily: F.sansMedium, fontSize: 15, color: C.primary },
    emptySubText:    { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, textAlign: 'center' },
    inputRow:        { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 12, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.bg },
    input:           { flex: 1, fontFamily: F.sans, fontSize: 14, color: C.fg, backgroundColor: C.card, borderWidth: 1, borderColor: C.border, paddingHorizontal: 14, paddingVertical: 10, maxHeight: 100 },
    sendBtn:         { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  });
}
