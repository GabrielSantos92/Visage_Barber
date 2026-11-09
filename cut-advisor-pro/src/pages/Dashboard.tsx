import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfMonth, startOfDay, endOfDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, Users, Scissors, Calendar, Clock, CheckCircle2, XCircle, AlertCircle, DollarSign, Award } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import { AdminNav } from "@/components/admin/AdminNav";
import { Navigate } from "react-router-dom";
import type { Enums } from "@/integrations/supabase/types";
import { buscarResumo, intervaloDoPeriodo } from "@/lib/financeiro";
import { formatarReais } from "@/lib/pagamentos";
import PainelBarbeiro from "@/components/barbeiro/PainelBarbeiro";

type Status = Enums<"agendamento_status">;

interface KPI {
  label: string;
  value: string | number;
  sub: string;
  icon: React.ElementType;
  accent?: boolean;
}

interface Agendamento {
  id: string;
  data_hora: string;
  status: Status;
  cliente_id?: string;
  // Preco congelado na reserva (o do servico pode ter mudado depois)
  preco?: number | null;
  profiles: { nome: string } | null;
  servicos: { nome: string; preco: number } | null;
  barbeiros?: { nome: string } | null;
}

const statusConfig: Record<Status, { label: string; color: string; icon: React.ElementType }> = {
  confirmado: { label: "CONFIRMADO", color: "text-green-400 border-green-400/20 bg-green-400/5",     icon: CheckCircle2 },
  concluido:  { label: "CONCLUÍDO",  color: "text-primary border-primary/20 bg-primary/5",           icon: CheckCircle2 },
  cancelado:  { label: "CANCELADO",  color: "text-destructive border-destructive/20 bg-destructive/5", icon: XCircle },
};

// cliente_id referencia auth.users, nao profiles: o embed do PostgREST nao existe.
// Em profiles a coluna equivalente e user_id (profiles.id e uma PK propria),
// por isso os perfis sao buscados em uma segunda consulta.
async function withClientes(rows: any[] | null): Promise<Agendamento[]> {
  const list = rows ?? [];
  const ids = [...new Set(list.map((a: any) => a.cliente_id).filter(Boolean))];
  const perfis: Record<string, { nome: string }> = {};
  if (ids.length > 0) {
    const { data: profs } = await supabase.from("profiles").select("user_id, nome").in("user_id", ids);
    (profs ?? []).forEach((p: any) => { perfis[p.user_id] = { nome: p.nome }; });
  }
  return list.map((a: any) => ({ ...a, profiles: perfis[a.cliente_id] ?? null })) as Agendamento[];
}

// Receita do mes: servicos concluidos e pagos, pelos lancamentos do financeiro.
// Se o financeiro nao responder (ex.: migration ainda nao aplicada), nao inventa valor.
const receitaKpi = (valor: number | null): KPI => ({
  label: "RECEITA DO MÊS",
  value: valor == null ? "—" : formatarReais(valor),
  sub: valor == null ? "financeiro indisponível" : "concluídos e pagos, após descontos e reembolsos",
  icon: DollarSign,
});

const fadeUp = (i: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay: i * 0.08 },
});

// /dashboard: o barbeiro ve o Painel do Barbeiro (visao do dia + financeiro,
// igual a aba Painel do app); o admin, o painel administrativo
export default function Dashboard() {
  const { role, loading: authLoading } = useAuth();
  if (authLoading) return null;
  if (role === "barbeiro") return <PainelBarbeiro />;
  if (role !== "admin") return <Navigate to="/" replace />;
  return <PainelAdmin />;
}

function PainelAdmin() {
  const { user } = useAuth();
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [recentes, setRecentes] = useState<Agendamento[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<Status, number>>({ confirmado: 0, concluido: 0, cancelado: 0 });
  const [loading, setLoading] = useState(true);
  // Indicadores que o dashboard do admin mobile tambem mostra
  const [destaque, setDestaque] = useState<{ criadosNoMes: number; maisRequisitado: string | null } | null>(null);

  useEffect(() => {
    if (!user) return;
    loadAdminData();
  }, [user]);

  async function loadAdminData() {
    setLoading(true);
    await supabase.rpc("concluir_agendamentos_passados");
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const todayEnd = endOfDay(now).toISOString();
    const mes = intervaloDoPeriodo("mes", now);

    const [
      { count: totalHoje },
      receitaMes,
      { count: totalClientes },
      { data: barbeirosAtivos },
      { data: recentsData },
      { data: allStatus },
    ] = await Promise.all([
      supabase.from("agendamentos").select("*", { count: "exact", head: true })
        .gte("data_hora", todayStart).lte("data_hora", todayEnd),
      // Mesmo calculo do Financeiro: servicos concluidos e pagos no mes, ja sem
      // descontos e reembolsos (lancamentos do banco)
      buscarResumo(mes).then((r) => r.faturamento).catch(() => null),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("barbeiros").select("id, nome").eq("ativo", true),
      supabase.from("agendamentos")
        .select("id, data_hora, status, cliente_id, preco, servicos(nome, preco), barbeiros(nome)")
        .order("data_hora", { ascending: false }).limit(8),
      supabase.from("agendamentos").select("status, created_at, barbeiro_id"),
    ]);

    const counts: Record<Status, number> = { confirmado: 0, concluido: 0, cancelado: 0 };
    (allStatus ?? []).forEach(a => { if (a.status in counts) counts[a.status as Status]++; });

    // Mesmo calculo do admin mobile: agendamentos criados no mes e barbeiro (ativo) com mais agendamentos
    const criadosNoMes = (allStatus ?? []).filter(a => new Date(a.created_at) >= startOfMonth(now)).length;
    const porBarbeiro: Record<string, number> = {};
    (allStatus ?? []).forEach(a => { porBarbeiro[a.barbeiro_id] = (porBarbeiro[a.barbeiro_id] ?? 0) + 1; });
    const maxId = Object.entries(porBarbeiro).sort((a, b) => b[1] - a[1])[0]?.[0];
    const maisRequisitado = maxId ? ((barbeirosAtivos ?? []).find(b => b.id === maxId)?.nome ?? null) : null;
    setDestaque({ criadosNoMes, maisRequisitado });

    setKpis([
      { label: "AGENDAMENTOS HOJE", value: totalHoje ?? 0, sub: format(now, "dd 'de' MMMM", { locale: ptBR }), icon: Calendar, accent: true },
      receitaKpi(receitaMes),
      { label: "CLIENTES", value: totalClientes ?? 0, sub: "cadastrados", icon: Users },
      { label: "BARBEIROS ATIVOS", value: barbeirosAtivos?.length ?? 0, sub: "em operação", icon: Scissors },
    ]);
    setRecentes(await withClientes(recentsData as any));
    setStatusCounts(counts);
    setLoading(false);
  }

  const totalGeral = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <AdminNav />
      <div className="max-w-7xl mx-auto px-6 py-10">

        {/* Header */}
        <motion.div {...fadeUp(0)} className="border-b border-border pb-6 mb-10">
          <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-2">
            PAINEL ADMINISTRATIVO
          </p>
          <h1 className="text-4xl font-light text-primary tracking-tighter">Dashboard</h1>
        </motion.div>

        {/* KPI Cards */}
        {loading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {[0,1,2,3].map(i => (
              <div key={i} className="border border-border p-6 animate-pulse">
                <div className="h-3 w-24 bg-card rounded mb-4" />
                <div className="h-8 w-16 bg-card rounded mb-2" />
                <div className="h-3 w-20 bg-card rounded" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
            {kpis.map((kpi, i) => (
              <motion.div key={i} {...fadeUp(i + 1)}
                className={`border p-6 ${kpi.accent ? "border-accent/40 bg-accent/5" : "border-border"}`}
              >
                <div className="flex items-center justify-between mb-4">
                  <p className="font-mono text-[9px] tracking-[0.2em] text-foreground uppercase">{kpi.label}</p>
                  <kpi.icon size={14} className={kpi.accent ? "text-accent" : "text-foreground/40"} />
                </div>
                <p className={`text-3xl font-light tracking-tighter mb-1 ${kpi.accent ? "text-accent" : "text-primary"}`}>
                  {kpi.value}
                </p>
                <p className="font-mono text-[10px] text-foreground/50">{kpi.sub}</p>
              </motion.div>
            ))}
          </div>
        )}

        {!loading && destaque && (
          <motion.div {...fadeUp(5)} className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
            <div className="border border-border p-6 flex items-center justify-between gap-4">
              <div>
                <p className="font-mono text-[9px] tracking-[0.2em] text-foreground uppercase mb-2">Agendamentos criados este mês</p>
                <p className="text-3xl font-light tracking-tighter text-primary">{destaque.criadosNoMes}</p>
              </div>
              <TrendingUp size={14} className="text-foreground/40 shrink-0" />
            </div>
            <div className="border border-border p-6 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-mono text-[9px] tracking-[0.2em] text-foreground uppercase mb-2">Barbeiro mais requisitado</p>
                <p className="text-2xl font-light tracking-tighter text-primary truncate">{destaque.maisRequisitado ?? "—"}</p>
              </div>
              <Award size={14} className="text-foreground/40 shrink-0" />
            </div>
          </motion.div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* Recent Appointments */}
          <motion.div {...fadeUp(5)} className="lg:col-span-2 border border-border">
            <div className="flex items-center justify-between px-6 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <Clock size={13} className="text-accent" />
                <p className="font-mono text-[10px] tracking-[0.2em] text-foreground uppercase">
                  Agendamentos Recentes
                </p>
              </div>
              <p className="font-mono text-[9px] text-foreground/40">{recentes.length} registros</p>
            </div>

            {loading ? (
              <div className="divide-y divide-border">
                {[0,1,2,3].map(i => (
                  <div key={i} className="px-6 py-4 animate-pulse flex gap-4">
                    <div className="h-4 w-32 bg-card rounded" />
                    <div className="h-4 w-24 bg-card rounded" />
                    <div className="h-4 w-16 bg-card rounded ml-auto" />
                  </div>
                ))}
              </div>
            ) : recentes.length === 0 ? (
              <div className="px-6 py-12 text-center">
                <p className="font-mono text-[10px] text-foreground/40 tracking-widest">NENHUM AGENDAMENTO</p>
              </div>
            ) : (
              <div className="divide-y divide-border">
                {recentes.map((a, i) => {
                  const cfg = statusConfig[a.status];
                  const Icon = cfg.icon;
                  const dataHora = new Date(a.data_hora);
                  return (
                    <motion.div key={a.id} {...fadeUp(i)} className="px-6 py-4 flex items-center gap-4 hover:bg-card/50 transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-primary font-medium truncate">
                          {(a.profiles as any)?.nome ?? "—"}
                        </p>
                        <p className="font-mono text-[10px] text-foreground/50 mt-0.5">
                          {(a.servicos as any)?.nome ?? "—"}
                          {(a.barbeiros as any)?.nome && (
                            <span className="text-foreground/30"> · {(a.barbeiros as any).nome}</span>
                          )}
                        </p>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="font-mono text-[10px] text-foreground/70">
                          {isToday(dataHora) ? "Hoje" : format(dataHora, "dd/MM")}
                          {" · "}
                          {format(dataHora, "HH:mm")}
                        </p>
                        {(a.preco ?? a.servicos?.preco) != null && (
                          <p className="font-mono text-[10px] text-foreground/40 mt-0.5">
                            {formatarReais(a.preco ?? a.servicos?.preco)}
                          </p>
                        )}
                      </div>
                      <div className={`flex-shrink-0 flex items-center gap-1.5 border px-2 py-1 ${cfg.color}`}>
                        <Icon size={10} />
                        <span className="font-mono text-[9px] tracking-wider">{cfg.label}</span>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>

          {/* Status Distribution */}
          <motion.div {...fadeUp(6)} className="border border-border">
            <div className="flex items-center gap-2 px-6 py-4 border-b border-border">
              <TrendingUp size={13} className="text-accent" />
              <p className="font-mono text-[10px] tracking-[0.2em] text-foreground uppercase">
                Distribuição
              </p>
            </div>
            <div className="p-6 space-y-5">
              {loading ? (
                [0,1,2,3].map(i => <div key={i} className="h-10 bg-card rounded animate-pulse" />)
              ) : (
                (["confirmado", "concluido", "cancelado"] as Status[]).map((status) => {
                  const cfg = statusConfig[status];
                  const count = statusCounts[status];
                  const pct = totalGeral > 0 ? Math.round((count / totalGeral) * 100) : 0;
                  const Icon = cfg.icon;
                  return (
                    <div key={status}>
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Icon size={11} className={cfg.color.split(" ")[0]} />
                          <span className={`font-mono text-[10px] tracking-wider ${cfg.color.split(" ")[0]}`}>
                            {cfg.label}
                          </span>
                        </div>
                        <span className="font-mono text-[10px] text-foreground/50">{count}</span>
                      </div>
                      <div className="h-1 bg-border w-full">
                        <motion.div
                          initial={{ width: 0 }}
                          animate={{ width: `${pct}%` }}
                          transition={{ duration: 0.8, delay: 0.3 }}
                          className={`h-full ${
                            status === "confirmado" ? "bg-green-400" :
                            status === "concluido"  ? "bg-primary" :
                            "bg-destructive"
                          }`}
                        />
                      </div>
                      <p className="font-mono text-[9px] text-foreground/30 mt-1 text-right">{pct}%</p>
                    </div>
                  );
                })
              )}
            </div>

            {/* Total */}
            {!loading && (
              <div className="border-t border-border px-6 py-4 flex items-center justify-between">
                <p className="font-mono text-[10px] text-foreground/50 tracking-widest">TOTAL GERAL</p>
                <p className="font-mono text-lg text-primary">{totalGeral}</p>
              </div>
            )}
          </motion.div>

        </div>
      </div>
    </div>
  );
}
