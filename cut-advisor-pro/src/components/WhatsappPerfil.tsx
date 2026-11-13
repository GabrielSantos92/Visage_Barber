import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { format } from "date-fns";
import { MessageSquare, Loader2, RotateCcw } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import {
  AVISO_WHATSAPP_CONCORDANCIA, AVISO_WHATSAPP_RESUMO, buscarConsentimentoWhatsapp, celularParaWhatsapp,
  concederConsentimentoWhatsapp, revogarConsentimentoWhatsapp, type SituacaoConsentimento,
} from "@/lib/privacidade";

// Secao "Mensagens pelo WhatsApp" do perfil: o usuario autoriza (ou deixa de
// autorizar) a confirmacao de presenca enviada 2 horas antes do atendimento.
// `telefone` e o numero SALVO no cadastro: sem celular valido nao da para ativar.
export default function WhatsappPerfil({ telefone }: { telefone: string | null | undefined }) {
  const [situacao, setSituacao] = useState<SituacaoConsentimento | null>(null);
  const [erro, setErro] = useState(false);
  const [aceito, setAceito] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const temCelular = celularParaWhatsapp(telefone);

  function carregar() {
    setErro(false);
    buscarConsentimentoWhatsapp().then(setSituacao).catch(() => setErro(true));
  }

  useEffect(() => { carregar(); }, []);

  async function ativar() {
    if (salvando || !aceito || !temCelular) return;
    setSalvando(true);
    try {
      setSituacao(await concederConsentimentoWhatsapp());
      setAceito(false);
      toast.success("Mensagens pelo WhatsApp ativadas.");
    } catch {
      toast.error("Não foi possível ativar. Verifique sua conexão e tente novamente.");
    }
    setSalvando(false);
  }

  async function desativar() {
    if (salvando) return;
    setSalvando(true);
    try {
      setSituacao(await revogarConsentimentoWhatsapp());
      toast.success("Mensagens pelo WhatsApp desativadas.");
    } catch {
      toast.error("Não foi possível desativar. Verifique sua conexão e tente novamente.");
    }
    setSalvando(false);
  }

  return (
    <section aria-labelledby="whatsapp-titulo" className="border border-border p-5 mt-6">
      <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-3 flex items-center gap-2">
        <MessageSquare className="size-3" /> WhatsApp
      </p>
      <h2 id="whatsapp-titulo" className="text-sm font-bold text-primary mb-2">Mensagens pelo WhatsApp</h2>
      <p className="text-sm text-foreground leading-relaxed mb-3">{AVISO_WHATSAPP_RESUMO}</p>

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
        <>
          <p className="text-sm text-foreground leading-relaxed">
            Ativadas
            {situacao.concedido_em ? ` em ${format(new Date(situacao.concedido_em), "dd/MM/yyyy 'às' HH:mm")}` : ""}
            {situacao.origem ? ` pelo ${situacao.origem === "web" ? "site" : "aplicativo"}` : ""}. Para parar, desative aqui ou responda
            PARAR no WhatsApp.
          </p>
          {!temCelular && (
            <p className="text-sm text-destructive leading-relaxed mt-2">
              Seu cadastro está sem um celular válido: salve um celular com DDD para receber as mensagens.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="text-sm text-foreground leading-relaxed">Desativadas. Nenhuma mensagem é enviada.</p>
          {temCelular ? (
            <label className="flex items-start gap-3 mt-3 text-sm text-foreground leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                checked={aceito}
                onChange={(e) => setAceito(e.target.checked)}
                className="mt-1 accent-current"
              />
              <span>{AVISO_WHATSAPP_CONCORDANCIA}</span>
            </label>
          ) : (
            <p className="text-sm text-muted-foreground leading-relaxed mt-2">
              Para ativar, salve antes um celular com DDD no seu perfil.
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-4">
        <Link to="/privacidade#whatsapp" className="font-mono text-[10px] uppercase tracking-widest text-accent hover:underline">
          Aviso de Privacidade
        </Link>
        {situacao && !erro && (situacao.consentido ? (
          <button
            onClick={desativar}
            disabled={salvando}
            className="px-4 py-2 border border-destructive/30 text-destructive font-mono text-[10px] uppercase tracking-widest hover:bg-destructive hover:text-destructive-foreground transition-colors disabled:opacity-50"
          >
            {salvando && <Loader2 className="inline size-3 mr-2 animate-spin" />}
            Desativar mensagens
          </button>
        ) : temCelular ? (
          <button
            onClick={ativar}
            disabled={salvando || !aceito}
            className="px-4 py-2 border border-primary text-primary font-mono text-[10px] uppercase tracking-widest hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
          >
            {salvando && <Loader2 className="inline size-3 mr-2 animate-spin" />}
            Ativar mensagens
          </button>
        ) : null)}
      </div>
    </section>
  );
}
