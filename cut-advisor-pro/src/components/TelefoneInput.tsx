import { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from "react";
import { editarTelefone } from "@/lib/telefone";

type Props = Omit<React.InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type"> & {
  value: string;                       // texto formatado, ex.: "(11) 98765-4321"
  onChange: (formatado: string) => void;
};

// Campo de telefone com a mascara brasileira aplicada enquanto se digita.
// O estilo vem de quem usa (className), para manter o visual de cada formulario.
const TelefoneInput = forwardRef<HTMLInputElement, Props>(({ value, onChange, onSelect, onKeyDown, ...props }, ref) => {
  const input = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => input.current!);
  // Cursor antes da edicao (distingue Delete de Backspace) e onde ele deve ficar depois
  const cursorAntes = useRef<number | undefined>(undefined);
  const cursorDepois = useRef<number | null>(null);

  useLayoutEffect(() => {
    const el = input.current;
    if (el && cursorDepois.current !== null && document.activeElement === el) {
      el.setSelectionRange(cursorDepois.current, cursorDepois.current);
    }
    cursorDepois.current = null;
  }, [value]);

  function lembrarCursor(el: HTMLInputElement) {
    cursorAntes.current = el.selectionStart ?? undefined;
  }

  return (
    <input
      {...props}
      ref={input}
      type="tel"
      inputMode="numeric"
      autoComplete={props.autoComplete ?? "tel-national"}
      value={value}
      onKeyDown={(e) => { lembrarCursor(e.currentTarget); onKeyDown?.(e); }}
      onSelect={(e) => { lembrarCursor(e.currentTarget); onSelect?.(e); }}
      onChange={(e) => {
        const el = e.currentTarget;
        const r = editarTelefone(value, el.value, el.selectionStart ?? el.value.length, cursorAntes.current);
        cursorDepois.current = r.cursor;
        cursorAntes.current = r.cursor;
        if (r.texto === value) {
          // Nada mudou (letra, simbolo ou campo cheio): desfaz o que o navegador inseriu
          el.value = value;
          el.setSelectionRange(r.cursor, r.cursor);
        } else {
          onChange(r.texto);
        }
      }}
    />
  );
});
TelefoneInput.displayName = "TelefoneInput";

export default TelefoneInput;
