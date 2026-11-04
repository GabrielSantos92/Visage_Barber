import React, { useRef, useState } from 'react';
import { TextInput, TextInputProps } from 'react-native';
import { editarTelefone } from '../lib/telefone';

type Props = Omit<TextInputProps, 'value' | 'onChangeText' | 'keyboardType'> & {
  value: string;                          // texto formatado, ex.: "(11) 98765-4321"
  onChangeText: (formatado: string) => void;
};

type Selecao = { start: number; end: number };

// Campo de telefone com a mascara brasileira aplicada enquanto se digita.
// O estilo vem de quem usa (style), para manter o visual de cada formulario.
export default function TelefoneInput({ value, onChangeText, onSelectionChange, ...props }: Props) {
  // Ultima selecao conhecida antes da edicao (o onChangeText nao informa o cursor)
  const selecao = useRef<Selecao>({ start: value.length, end: value.length });
  // Cursor imposto depois de formatar; liberado no proximo onSelectionChange.
  // Trocar este estado tambem forca o re-render que desfaz no campo nativo um
  // caractere rejeitado (letra, simbolo ou digito alem do limite).
  const [cursor, setCursor] = useState<Selecao | undefined>(undefined);

  return (
    <TextInput
      {...props}
      value={value}
      keyboardType="phone-pad"
      textContentType="telephoneNumber"
      autoComplete="tel"
      selection={cursor}
      onSelectionChange={(e) => {
        selecao.current = e.nativeEvent.selection;
        if (cursor) setCursor(undefined);
        onSelectionChange?.(e);
      }}
      onChangeText={(novo) => {
        const { start, end } = selecao.current;
        // Onde o cursor ficou: depois do que foi inserido no lugar da selecao
        const cursorNovo = Math.max(0, Math.min(novo.length, end + (novo.length - value.length)));
        const r = editarTelefone(value, novo, cursorNovo, start === end ? start : undefined);
        const pos = { start: r.cursor, end: r.cursor };
        selecao.current = pos;
        setCursor(pos);
        if (r.texto !== value) onChangeText(r.texto);
      }}
    />
  );
}
