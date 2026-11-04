import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { ShieldCheck, Loader2, RotateCcw } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  buscarConsentimentoVisagismo, revogarConsentimentoVisagismo, type SituacaoConsentimento,
} from "@/lib/privacidade";

// Secao "Privacidade" do perfil: mostra a autorizacao para a analise por foto
// e permite revoga-la (art. 8, par. 5 da LGPD), com confirmacao antes.
export default function PrivacidadePerfil() {
  const [situacao, setSituacao] = useState<SituacaoConsentimento | null>(null);
  const [erro, setErro] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [revogando, setRevogando] = useState(false);

  function carregar() {
    setErro(false);
    buscarConsentimentoVisagismo().then(setSituacao).catch(() => setErro(true));
  }

  useEffect(() => { carregar(); }, []);

  async function revogar() {
    if (revogando) return;
    setRevogando(true);
    try {
      setSituacao(await revogarConsentimentoVisagismo());
      setConfirmando(false);
      toast.success("Autorização revogada. Nenhuma nova foto será enviada para análise.");
    } catch {
      toast.error("Não foi possível revogar a autorização. Verifique sua conexão e tente novamente.");
    }
    setRevogando(false);
  }

  return (
    <section aria-labelledby="privacidade-titulo" className="border border-border p-5 mt-10">
      <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-3 flex items-center gap-2">
        <ShieldCheck className="size-3" /> Privacidade
      </p>
      <h2 id="privacidade-titulo" className="text-sm font-bold text-primary mb-2">Análise de visagismo por foto</h2>

      {erro ? (
        <div className="text-sm text-foreground">
          Não foi possível carregar sua autorização.{" "}
          <button onClick={carregar} className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-accent hover:underline">
            <RotateCcw className="size-3" /> Tentar novamente
          </button>
        </div>
      ) : !situacao ? (
        <p className="font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</p>
      ) : situacao.consentido ? (
        <p className="text-sm text-foreground leading-relaxed">
          Você autorizou o uso da sua foto
          {situacao.concedido_em ? ` em ${format(new Date(situacao.concedido_em), "dd/MM/yyyy 'às' HH:mm")}` : ""}
          {situacao.origem ? ` pelo ${situacao.origem === "web" ? "site" : "aplicativo"}` : ""}.
        </p>
      ) : (
        <p className="text-sm text-foreground leading-relaxed">
          Não autorizado. O aviso de privacidade será exibido quando você usar a análise por foto.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4">
        <Link to="/privacidade" className="font-mono text-[10px] uppercase tracking-widest text-accent hover:underline">
          Aviso de Privacidade
        </Link>
        {situacao?.consentido && (
          <button
            onClick={() => setConfirmando(true)}
            className="px-4 py-2 border border-destructive/30 text-destructive font-mono text-[10px] uppercase tracking-widest hover:bg-destructive hover:text-destructive-foreground transition-colors"
          >
            Revogar autorização
          </button>
        )}
      </div>

      <AlertDialog open={confirmando} onOpenChange={(aberto) => { if (!aberto && !revogando) setConfirmando(false); }}>
        <AlertDialogContent className="border-border bg-background sm:rounded-none max-w-[calc(100%-2rem)] sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-primary">Revogar autorização?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>Ao revogar:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Nenhuma nova foto será enviada para a análise de visagismo até que você concorde novamente.</li>
                  <li>Análises já realizadas não são desfeitas.</li>
                  <li>Análises salvas no aplicativo continuam disponíveis até que você as exclua em "Análises salvas".</li>
                  <li>O registro da sua concordância e desta revogação é mantido como histórico.</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revogando} className="rounded-none font-mono text-[10px] tracking-widest uppercase">
              Voltar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={revogando}
              onClick={(e) => { e.preventDefault(); revogar(); }}
              className="rounded-none bg-destructive text-destructive-foreground hover:bg-destructive/90 font-mono text-[10px] tracking-widest uppercase"
            >
              {revogando && <Loader2 className="size-3 mr-2 animate-spin" />}
              {revogando ? "Revogando..." : "Revogar autorização"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
