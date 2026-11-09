import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  AlertCircle, ArrowLeft, Calendar, CheckCircle2, Clock, Copy, CreditCard, Info, Loader2, QrCode, RefreshCw, Store, User,
} from "lucide-react";
import { format } from "date-fns";
import Navbar from "@/components/Navbar";
import { supabase } from "@/integrations/supabase/client";
import {
  MetodoPagamento, Pagamento as PagamentoCliente, TipoMensagem, buscarPagamentos, criarPagamento, formatarReais,
  mensagemDoPagamento, pagamentoAtual, pago, pixVencido, sincronizarPagamento,
} from "@/lib/pagamentos";
import { AVISO_PAGAMENTO_RESUMO } from "@/lib/privacidade";

type Agendamento = {
  id: string;
  data_hora: string;
  status: string;
  preco: number | null;
  servicos: { nome: string; preco: number } | null;
  barbeiros: { nome: string } | null;
};

const OPCOES: { metodo: MetodoPagamento; titulo: string; texto: string; Icone: typeof QrCode }[] = [
  { metodo: "pix", titulo: "PIX", texto: "QR Code ou código copia e cola. A confirmação chega em instantes.", Icone: QrCode },
  { metodo: "cartao", titulo: "Cartão de crédito", texto: "Na página segura do Mercado Pago. O número do cartão não passa pelo Visage Barber.", Icone: CreditCard },
  { metodo: "presencial", titulo: "Na barbearia", texto: "Pague no dia do atendimento, direto na barbearia.", Icone: Store },
];

const CORES: Record<TipoMensagem, string> = {
  sucesso: "border-green-500/40 text-green-500",
  aviso: "border-amber-500/40 text-amber-500",
  erro: "border-destructive/40 text-destructive",
  info: "border-border text-foreground",
};

// Consulta o banco a cada 5 s (o webhook atualiza) e o provedor a cada 30 s
// (caso o webhook nao chegue)
const INTERVALO_BANCO_MS = 5000;
const INTERVALO_PROVEDOR_MS = 30000;

const restante = (expira: string, agora: number) => {
  const s = Math.max(0, Math.floor((new Date(expira).getTime() - agora) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
};

export default function Pagamento() {
  const { agendamentoId = "" } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [agendamento, setAgendamento] = useState<Agendamento | null>(null);
  const [pagamento, setPagamento] = useState<PagamentoCliente | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [escolha, setEscolha] = useState<MetodoPagamento>("pix");
  // O cliente quer trocar a forma de uma cobranca ainda em aberto
  const [trocando, setTrocando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [verificando, setVerificando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [agora, setAgora] = useState(Date.now());

  const carregarPagamento = useCallback(async () => {
    setPagamento(pagamentoAtual(await buscarPagamentos([agendamentoId])));
  }, [agendamentoId]);

  useEffect(() => {
    let ativo = true;
    (async () => {
      const { data } = await supabase
        .from("agendamentos")
        .select("id, data_hora, status, preco, servicos(nome, preco), barbeiros(nome)")
        .eq("id", agendamentoId)
        .maybeSingle();
      if (!ativo) return;
      setAgendamento((data as unknown as Agendamento) ?? null);
      try { await carregarPagamento(); } catch { /* sem pagamento ainda */ }
      if (ativo) setCarregando(false);
    })();
    return () => { ativo = false; };
  }, [agendamentoId, carregarPagamento]);

  // Depende so do id: recarregar o pagamento a cada 5 s nao reinicia os relogios
  const pagamentoId = pagamento?.id;
  const sincronizar = useCallback(async (silencioso: boolean) => {
    if (!pagamentoId) return;
    setVerificando(true);
    try {
      setPagamento(await sincronizarPagamento(pagamentoId));
      if (!silencioso) setErro(null);
    } catch (e) {
      if (!silencioso) setErro((e as Error).message);
    }
    setVerificando(false);
  }, [pagamentoId]);

  const emAberto = !!pagamento && pagamento.status === "pending" && !pixVencido(pagamento, agora);
  const online = emAberto && pagamento!.metodo !== "presencial";

  // Voltou do Checkout Pro: confere o resultado no provedor
  useEffect(() => {
    if (params.get("retorno") && pagamento?.status === "pending") sincronizar(true);
    // so na chegada
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagamentoId]);

  // Cobranca online em aberto: acompanha ate o provedor confirmar
  useEffect(() => {
    if (!online || trocando) return;
    const banco = setInterval(() => { carregarPagamento().catch(() => {}); }, INTERVALO_BANCO_MS);
    const provedor = setInterval(() => sincronizar(true), INTERVALO_PROVEDOR_MS);
    const relogio = setInterval(() => setAgora(Date.now()), 1000);
    return () => { clearInterval(banco); clearInterval(provedor); clearInterval(relogio); };
  }, [online, trocando, carregarPagamento, sincronizar]);

  async function pagar() {
    setEnviando(true);
    setErro(null);
    try {
      const novo = await criarPagamento(agendamentoId, escolha);
      setPagamento(novo);
      setTrocando(false);
      setAgora(Date.now());
      if (escolha === "cartao" && novo.link_pagamento) window.location.assign(novo.link_pagamento);
    } catch (e) {
      setErro((e as Error).message);
    }
    setEnviando(false);
  }

  async function copiar(texto: string) {
    try {
      await navigator.clipboard.writeText(texto);
      setCopiado(true);
      setTimeout(() => setCopiado(false), 2500);
    } catch {
      setErro("Não foi possível copiar. Selecione o código e copie manualmente.");
    }
  }

  if (carregando) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="flex justify-center py-24"><Loader2 className="size-6 animate-spin text-primary" /></div>
      </div>
    );
  }

  if (!agendamento) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <main className="max-w-2xl mx-auto px-6 py-12 text-center">
          <p className="text-sm text-foreground">Agendamento não encontrado.</p>
          <button onClick={() => navigate("/meus-agendamentos")} className="mt-6 font-mono text-[10px] uppercase tracking-widest text-primary hover:underline">
            Ver meus agendamentos
          </button>
        </main>
      </div>
    );
  }

  const valor = pagamento?.valor ?? Number(agendamento.preco ?? agendamento.servicos?.preco ?? 0);
  const cancelado = agendamento.status === "cancelado";
  const mostrarOpcoes = !cancelado && !pago(pagamento) && pagamento?.status !== "refunded" && (!emAberto || trocando);
  const msg = pagamento && !(trocando && emAberto) ? mensagemDoPagamento(pagamento, agora) : null;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-8">
        <button
          onClick={() => navigate("/meus-agendamentos")}
          className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-4"
        >
          <ArrowLeft className="size-3" /> Meus agendamentos
        </button>
        <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-1">Pagamento</p>
        <h1 className="text-3xl font-light text-primary tracking-tighter mb-8">Resumo do pedido</h1>

        {/* Resumo */}
        <div className="border border-border mb-6">
          <div className="p-4 border-b border-border">
            <p className="text-sm font-bold text-primary">{agendamento.servicos?.nome ?? "Serviço"}</p>
            <div className="mt-2 flex flex-wrap gap-4 font-mono text-[10px] uppercase text-foreground">
              <span className="flex items-center gap-1"><User className="size-3" /> {agendamento.barbeiros?.nome}</span>
              <span className="flex items-center gap-1"><Calendar className="size-3" /> {format(new Date(agendamento.data_hora), "dd/MM/yyyy")}</span>
              <span className="flex items-center gap-1"><Clock className="size-3" /> {format(new Date(agendamento.data_hora), "HH:mm")}</span>
            </div>
          </div>
          {!!pagamento?.desconto && (
            <div className="px-4 pt-3 flex justify-between font-mono text-[10px] uppercase text-muted-foreground">
              <span>Desconto</span><span>- {formatarReais(pagamento.desconto)}</span>
            </div>
          )}
          <div className="p-4 flex justify-between items-baseline">
            <span className="font-mono text-[10px] uppercase text-muted-foreground">Total</span>
            <span className="text-2xl font-bold text-primary">{formatarReais(valor)}</span>
          </div>
        </div>

        {cancelado && !pago(pagamento) && (
          <p role="status" className="border border-destructive/40 p-4 text-sm text-destructive">
            Este agendamento foi cancelado e não pode ser pago.
          </p>
        )}

        {msg && (
          <div role="status" className={`border p-4 mb-6 flex items-start gap-3 ${CORES[msg.tipo]}`}>
            {msg.tipo === "sucesso" ? <CheckCircle2 className="size-5 shrink-0" /> : msg.tipo === "info" ? <Info className="size-5 shrink-0" /> : <AlertCircle className="size-5 shrink-0" />}
            <div>
              <p className="font-mono text-[10px] uppercase tracking-widest">{msg.titulo}</p>
              <p className="text-sm text-foreground mt-1">{msg.texto}</p>
            </div>
          </div>
        )}

        {/* PIX em aberto */}
        {emAberto && !trocando && pagamento!.metodo === "pix" && (
          <div className="border border-border p-6 mb-6 flex flex-col items-center text-center">
            {pagamento!.pix_qr_base64 && (
              <img src={`data:image/png;base64,${pagamento!.pix_qr_base64}`} alt="QR Code do PIX" className="size-56 bg-white p-2" />
            )}
            {pagamento!.expira_em && (
              <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mt-3">
                Expira em {restante(pagamento!.expira_em, agora)}
              </p>
            )}
            {pagamento!.pix_copia_cola && (
              <div className="w-full mt-5">
                <label htmlFor="pix-copia-cola" className="block font-mono text-[10px] uppercase tracking-widest text-foreground mb-2 text-left">
                  PIX copia e cola
                </label>
                <textarea
                  id="pix-copia-cola" readOnly rows={3} value={pagamento!.pix_copia_cola}
                  onFocus={(e) => e.currentTarget.select()}
                  className="w-full bg-background border border-border p-3 font-mono text-[11px] text-primary break-all resize-none"
                />
                <button
                  onClick={() => copiar(pagamento!.pix_copia_cola!)}
                  className="mt-2 w-full flex items-center justify-center gap-2 border border-primary py-3 font-mono text-[10px] uppercase tracking-widest text-primary hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  <Copy className="size-3" /> {copiado ? "Código copiado" : "Copiar código"}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cartao em aberto */}
        {emAberto && !trocando && pagamento!.metodo === "cartao" && pagamento!.link_pagamento && (
          <a
            href={pagamento!.link_pagamento}
            className="mb-6 w-full flex items-center justify-center gap-2 bg-primary text-primary-foreground py-4 font-mono text-[11px] tracking-[0.2em] uppercase hover:bg-accent transition-colors"
          >
            <CreditCard className="size-4" /> Continuar no Mercado Pago
          </a>
        )}

        {emAberto && !trocando && (
          <div className="flex flex-col sm:flex-row gap-3 mb-6">
            {pagamento!.metodo !== "presencial" && (
              <button
                onClick={() => sincronizar(false)} disabled={verificando}
                className="flex-1 flex items-center justify-center gap-2 border border-border py-3 font-mono text-[10px] uppercase tracking-widest text-foreground hover:border-primary disabled:opacity-50"
              >
                <RefreshCw className={`size-3 ${verificando ? "animate-spin" : ""}`} /> {verificando ? "Verificando..." : "Já paguei"}
              </button>
            )}
            <button
              onClick={() => { setTrocando(true); setErro(null); setEscolha(pagamento!.metodo === "pix" ? "cartao" : "pix"); }}
              className="flex-1 border border-border py-3 font-mono text-[10px] uppercase tracking-widest text-foreground hover:border-primary"
            >
              {pagamento!.metodo === "presencial" ? "Prefiro pagar agora" : "Trocar forma de pagamento"}
            </button>
          </div>
        )}

        {/* Escolha da forma de pagamento */}
        {mostrarOpcoes && (
          <fieldset className="mb-6">
            <legend className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-3">Como você quer pagar?</legend>
            <div className="space-y-2">
              {OPCOES.map(({ metodo, titulo, texto, Icone }) => (
                <label
                  key={metodo}
                  className={`flex items-start gap-3 border p-4 cursor-pointer transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent ${
                    escolha === metodo ? "border-primary bg-card" : "border-border hover:border-primary/50"
                  }`}
                >
                  <input type="radio" name="metodo" value={metodo} checked={escolha === metodo} onChange={() => setEscolha(metodo)} className="sr-only" />
                  <Icone className="size-5 text-primary shrink-0 mt-0.5" />
                  <span>
                    <span className="block text-sm font-bold text-primary">{titulo}</span>
                    <span className="block text-xs text-muted-foreground mt-0.5">{texto}</span>
                  </span>
                </label>
              ))}
            </div>
            <div className="flex gap-3 mt-4">
              {trocando && (
                <button
                  onClick={() => setTrocando(false)} disabled={enviando}
                  className="flex-1 border border-border py-3.5 font-mono text-[10px] uppercase tracking-widest text-foreground hover:border-primary"
                >
                  Voltar
                </button>
              )}
              <button
                onClick={pagar} disabled={enviando}
                className="flex-1 bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-50"
              >
                {enviando ? "Gerando..." : escolha === "presencial" ? "Confirmar pagamento na barbearia" : escolha === "pix" ? "Gerar PIX" : "Pagar com cartão"}
              </button>
            </div>
            <p className="text-xs text-muted-foreground mt-4">
              {AVISO_PAGAMENTO_RESUMO}{" "}
              <Link to="/privacidade#pagamentos" className="text-accent hover:underline">Aviso de Privacidade</Link>
            </p>
          </fieldset>
        )}

        {erro && <p role="alert" className="border border-destructive/40 p-3 text-sm text-destructive mb-6">{erro}</p>}

        {(pago(pagamento) || pagamento?.metodo === "presencial") && !trocando && (
          <button
            onClick={() => navigate("/meus-agendamentos")}
            className="w-full border border-border py-3 font-mono text-[10px] uppercase tracking-widest text-foreground hover:border-primary"
          >
            Ver meus agendamentos
          </button>
        )}
      </main>
    </div>
  );
}
