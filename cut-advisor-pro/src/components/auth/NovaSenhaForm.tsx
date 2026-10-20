import { useState } from "react";
import { Lock, Eye, EyeOff, AlertCircle } from "lucide-react";
import { SENHA_MIN, validarNovaSenha } from "@/lib/recuperacaoSenha";

interface Props {
  // Devolve a mensagem de erro, ou null se a senha foi alterada
  onSalvar: (senha: string) => Promise<string | null>;
}

// Formulario de nova senha usado pelo link do e-mail
const NovaSenhaForm = ({ onSalvar }: Props) => {
  const [senha, setSenha] = useState("");
  const [confirmacao, setConfirmacao] = useState("");
  const [mostrar, setMostrar] = useState(false);
  const [loading, setLoading] = useState(false);
  const [erros, setErros] = useState<{ senha?: string; confirmacao?: string; geral?: string }>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const validacao = validarNovaSenha(senha, confirmacao);
    setErros(validacao);
    if (Object.keys(validacao).length > 0) return;

    setLoading(true);
    const erro = await onSalvar(senha);
    setLoading(false);
    if (erro) setErros({ geral: erro });
  };

  const Erro = ({ texto }: { texto?: string }) =>
    texto ? (
      <p className="mt-1 text-xs text-destructive flex items-center gap-1">
        <AlertCircle className="size-3 shrink-0" /> {texto}
      </p>
    ) : null;

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="nova-senha" className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
          Nova senha
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            id="nova-senha"
            type={mostrar ? "text" : "password"}
            autoComplete="new-password"
            value={senha}
            onChange={(e) => { setSenha(e.target.value); setErros({}); }}
            className="w-full bg-card border border-border pl-10 pr-12 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            placeholder={`Mínimo ${SENHA_MIN} caracteres`}
          />
          <button
            type="button"
            onClick={() => setMostrar(!mostrar)}
            aria-label={mostrar ? "Ocultar senha" : "Mostrar senha"}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-primary transition-colors"
          >
            {mostrar ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <Erro texto={erros.senha} />
      </div>

      <div>
        <label htmlFor="confirmar-senha" className="font-mono text-[10px] uppercase tracking-widest text-foreground block mb-2">
          Confirmar nova senha
        </label>
        <div className="relative">
          <Lock className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <input
            id="confirmar-senha"
            type={mostrar ? "text" : "password"}
            autoComplete="new-password"
            value={confirmacao}
            onChange={(e) => { setConfirmacao(e.target.value); setErros({}); }}
            className="w-full bg-card border border-border pl-10 pr-4 py-3 text-sm text-primary placeholder:text-muted-foreground focus:outline-none focus:border-primary transition-colors"
            placeholder="Digite a senha novamente"
          />
        </div>
        <Erro texto={erros.confirmacao} />
      </div>

      <Erro texto={erros.geral} />

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50 disabled:pointer-events-none"
      >
        {loading ? <span className="font-mono text-xs animate-pulse">SALVANDO...</span> : "SALVAR NOVA SENHA"}
      </button>
    </form>
  );
};

export default NovaSenhaForm;
