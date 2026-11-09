import React from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, KeyboardAvoidingView,
} from 'react-native';
import { F, Theme } from '../../../lib/theme';

// Pecas comuns das abas do Financeiro do admin no app

export type Estilos = ReturnType<typeof makeStyles>;

// Filtros que valem para a Visao geral e para Pagamentos (datas AAAA-MM-DD, fim inclusivo)
export interface FiltrosFinanceiro { inicio: string; fim: string; barbeiroId: string | null; servicoId: string | null }

// "12,5" -> 12.5; vazio -> 0
export const numero = (v: string) => (v.trim() === '' ? 0 : Number(v.replace(',', '.')));
export const paraCampo = (v: number) => v.toFixed(2).replace('.', ',');
export const dataHora = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export function Cartao({ s, rotulo, valor, sub }: { s: Estilos; rotulo: string; valor: string; sub?: string }) {
  return (
    <View style={s.cartao} accessible accessibilityLabel={`${rotulo}: ${valor}${sub ? `. ${sub}` : ''}`}>
      <Text style={s.cartaoRotulo}>{rotulo}</Text>
      <Text style={s.cartaoValor}>{valor}</Text>
      {!!sub && <Text style={s.cartaoSub}>{sub}</Text>}
    </View>
  );
}

// Uma opcao por vez, em linha com rolagem horizontal
export function Chips<T extends string>({ s, C, opcoes, valor, onChange, rotulo }: {
  s: Estilos; C: Theme; opcoes: { valor: T; rotulo: string }[]; valor: T; onChange: (v: T) => void; rotulo: string;
}) {
  return (
    <ScrollView
      horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filtros}
      accessibilityRole="radiogroup" accessibilityLabel={rotulo}
    >
      {opcoes.map((o) => {
        const ativo = o.valor === valor;
        return (
          <TouchableOpacity
            key={o.valor || 'todos'} style={[s.chip, ativo && s.chipAtivo]} onPress={() => onChange(o.valor)}
            accessibilityRole="radio" accessibilityState={{ checked: ativo }}
          >
            <Text style={[s.chipText, ativo && { color: C.primaryFg }]}>{o.rotulo}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

export function Secao({ s, titulo, children }: { s: Estilos; titulo: string; children?: React.ReactNode }) {
  return (
    <>
      <Text style={s.secao} accessibilityRole="header">{titulo}</Text>
      {children}
    </>
  );
}

// Painel que sobe da parte de baixo da tela
export function Folha({ s, visivel, onFechar, children }: {
  s: Estilos; visivel: boolean; onFechar: () => void; children: React.ReactNode;
}) {
  return (
    <Modal visible={visivel} transparent animationType="fade" onRequestClose={onFechar}>
      <KeyboardAvoidingView behavior="padding" style={s.fundo}>
        <View style={s.modal}>
          <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export function Botoes({ s, C, onCancelar, onConfirmar, salvando, rotulo = 'CONFIRMAR', desabilitado = false }: {
  s: Estilos; C: Theme; onCancelar: () => void; onConfirmar: () => void; salvando: boolean; rotulo?: string; desabilitado?: boolean;
}) {
  const bloqueado = salvando || desabilitado;
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
      <TouchableOpacity style={[s.botao, s.botaoSecundario]} onPress={onCancelar} disabled={salvando} accessibilityRole="button">
        <Text style={[s.botaoText, { color: C.primary }]}>CANCELAR</Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.botao, bloqueado && { opacity: 0.5 }]} onPress={onConfirmar} disabled={bloqueado}
        accessibilityRole="button" accessibilityState={{ disabled: bloqueado }}
      >
        {salvando ? <ActivityIndicator color={C.primaryFg} size="small" /> : <Text style={s.botaoText}>{rotulo}</Text>}
      </TouchableOpacity>
    </View>
  );
}

// Caixa de confirmacao (ex.: autorizar a devolucao de uma duplicidade)
export function Confirmacao({ s, C, marcado, onChange, texto }: {
  s: Estilos; C: Theme; marcado: boolean; onChange: (v: boolean) => void; texto: string;
}) {
  return (
    <TouchableOpacity
      style={s.confirmacao} onPress={() => onChange(!marcado)}
      accessibilityRole="checkbox" accessibilityState={{ checked: marcado }} accessibilityLabel={texto}
    >
      <View style={[s.caixa, marcado && { backgroundColor: C.primary, borderColor: C.primary }]}>
        {marcado && <Text style={{ color: C.primaryFg, fontSize: 11, lineHeight: 13 }}>✓</Text>}
      </View>
      <Text style={[s.nota, { flex: 1, marginTop: 0, color: C.primary }]}>{texto}</Text>
    </TouchableOpacity>
  );
}

export function makeStyles(C: Theme) {
  return StyleSheet.create({
    screen:          { flex: 1, backgroundColor: C.bg },
    header:          { paddingHorizontal: 24, paddingTop: 56, paddingBottom: 20, borderBottomWidth: 1, borderBottomColor: C.border },
    headerLabel:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 4 },
    headerTitle:     { fontFamily: F.sansLight, fontSize: 26, color: C.primary, letterSpacing: -0.5 },
    segmentos:       { flexDirection: 'row', marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.border },
    segmento:        { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, paddingHorizontal: 4 },
    segmentoAtivo:   { backgroundColor: C.primary },
    segmentoText:    { fontFamily: F.mono, fontSize: 9, color: C.fg, letterSpacing: 1, textAlign: 'center' },
    filtros:         { gap: 8, paddingHorizontal: 24, paddingTop: 12, paddingBottom: 4 },
    chip:            { borderWidth: 1, borderColor: C.border, paddingHorizontal: 12, paddingVertical: 10 },
    chipAtivo:       { backgroundColor: C.primary, borderColor: C.primary },
    chipText:        { fontFamily: F.mono, fontSize: 10, color: C.fg, letterSpacing: 1 },
    datas:           { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 24, paddingTop: 8 },
    data:            { flex: 1, borderWidth: 1, borderColor: C.border, color: C.primary, fontFamily: F.mono, fontSize: 12, paddingHorizontal: 10, paddingVertical: 10 },
    legenda:         { fontFamily: F.mono, fontSize: 9, color: C.mutedFg, letterSpacing: 1 },
    erro:            { marginHorizontal: 24, marginTop: 12, borderWidth: 1, borderColor: C.destructive, color: C.destructive, padding: 12, fontFamily: F.sans, fontSize: 13 },
    sucesso:         { marginHorizontal: 24, marginTop: 12, borderWidth: 1, borderColor: C.success, color: C.primary, padding: 12, fontFamily: F.sans, fontSize: 13 },
    grid:            { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 24, paddingTop: 16 },
    cartao:          { width: '48%', flexGrow: 1, borderWidth: 1, borderColor: C.border, padding: 12 },
    cartaoRotulo:    { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 1.2 },
    cartaoValor:     { fontFamily: F.sansMedium, fontSize: 17, color: C.primary, marginTop: 6 },
    cartaoSub:       { fontFamily: F.mono, fontSize: 8, color: C.mutedFg, letterSpacing: 0.5, marginTop: 4, lineHeight: 12 },
    receita:         { marginHorizontal: 24, marginTop: 8, borderWidth: 1, borderColor: C.accent, padding: 14 },
    alerta:          { marginHorizontal: 24, marginTop: 16, borderWidth: 1, borderColor: C.warning, padding: 14, gap: 10 },
    alertaTexto:     { fontFamily: F.sans, fontSize: 13, color: C.primary, lineHeight: 19 },
    nota:            { fontFamily: F.sans, fontSize: 12, color: C.mutedFg, lineHeight: 17, marginTop: 6 },
    secao:           { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, paddingHorizontal: 24, marginTop: 24, marginBottom: 8 },
    bloco:           { marginHorizontal: 24, borderWidth: 1, borderColor: C.border, padding: 14 },
    semanaRow:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 24, marginTop: 24, marginBottom: 8 },
    vazio:           { fontFamily: F.sans, fontSize: 13, color: C.mutedFg, paddingHorizontal: 24 },
    linha:           { flexDirection: 'row', alignItems: 'center', gap: 12, marginHorizontal: 24, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.border },
    linhaTitulo:     { fontFamily: F.sans, fontSize: 14, color: C.primary, marginBottom: 2 },
    linhaValor:      { fontFamily: F.sansMedium, fontSize: 14, color: C.primary },
    selo:            { fontFamily: F.mono, fontSize: 9, color: C.warning, letterSpacing: 1, marginTop: 3 },
    acao:            { borderWidth: 1, borderColor: C.primary, paddingHorizontal: 12, paddingVertical: 10, alignSelf: 'flex-start' },
    acaoText:        { fontFamily: F.mono, fontSize: 10, color: C.primary, letterSpacing: 1.2 },
    campo:           { flex: 1, borderWidth: 1, borderColor: C.border, color: C.primary, fontFamily: F.sans, fontSize: 14, paddingHorizontal: 12, paddingVertical: 12 },
    fundo:           { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
    modal:           { backgroundColor: C.bg, borderTopWidth: 1, borderTopColor: C.border, padding: 24, maxHeight: '88%' },
    modalTitulo:     { fontFamily: F.mono, fontSize: 10, color: C.mutedFg, letterSpacing: 1.5, marginBottom: 10 },
    opcoes:          { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 12 },
    botao:           { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: C.primary, paddingVertical: 14 },
    botaoSecundario: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.border },
    botaoText:       { fontFamily: F.mono, fontSize: 10, color: C.primaryFg, letterSpacing: 1.5 },
    confirmacao:     { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 12 },
    caixa:           { width: 18, height: 18, borderWidth: 1, borderColor: C.mutedFg, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
    evento:          { borderLeftWidth: 2, borderLeftColor: C.border, paddingLeft: 10, marginBottom: 12 },
  });
}
