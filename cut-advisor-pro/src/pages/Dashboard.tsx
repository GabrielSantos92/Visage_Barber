import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { format, startOfMonth, endOfMonth, startOfDay, endOfDay, isToday } from "date-fns";
import { ptBR } from "date-fns/locale";
import { TrendingUp, Users, Scissors, Calendar, Clock, CheckCircle2, XCircle, AlertCircle, DollarSign } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import Navbar from "@/components/Navbar";
import { Navigate } from "react-router-dom";
import type { Enums } from "@/integrations/supabase/types";

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
  profiles: { nome: string } | null;
  servicos: { nome: string; preco: number } | null;
  barbeiros?: { nome: string } | null;
}

const statusConfig: Record<Status, { label: string; color: string; icon: React.ElementType }> = {
  pendente:   { label: "PENDENTE",   color: "text-yellow-400 border-yellow-400/20 bg-yellow-400/5",   icon: AlertCircle },
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

const fadeUp = (i: number) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay: i * 0.08 },
});

export default function Dashboard() {
  const { user, role, loading: authLoading } = useAuth();
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [recentes, setRecentes] = useState<Agendamento[]>([]);
  const [statusCounts, setStatusCounts] = useState<Record<Status, number>>({ pendente: 0, confirmado: 0, concluido: 0, cancelado: 0 });
  const [loading, setLoading] = useState(true);
  const [barbeiroId, setBarbeiroId] = useState<string | null>(null);

  const isAdmin = role === "admin";
  const isBarbeiro = role === "barbeiro";

  useEffect(() => {
    if (!user || authLoading) return;
    if (isBarbeiro) {
      supabase.from("barbeiros").select("id").eq("user_id", user.id).single()
        .then(({ data }) => { if (data) setBarbeiroId(data.id); });
    } else if (isAdmin) {
      loadAdminData();
    }
  }, [user, role, authLoading]);

  useEffect(() => {
    if (isBarbeiro && barbeiroId) loadBarbeiroData();
  }, [barbeiroId]);

  async function loadAdminData() {
    setLoading(true);
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const todayEnd = endOfDay(now).toISOString();
    const monthStart = startOfMonth(now).toISOString();
    const monthEnd = endOfMonth(now).toISOString();

    const [
      { count: totalHoje },
      { data: agendsMes },
      { count: totalClientes },
      { count: barbeirosAtivos },
      { data: recentsData },
      { data: allStatus },
    ] = await Promise.all([
      supabase.from("agendamentos").select("*", { count: "exact", head: true })
        .gte("data_hora", todayStart).lte("data_hora", todayEnd),
      supabase.from("agendamentos").select("servicos(preco), status")
        .gte("data_hora", monthStart).lte("data_hora", monthEnd),
      supabase.from("profiles").select("*", { count: "exact", head: true }),
      supabase.from("barbeiros").select("*", { count: "exact", head: true }).eq("ativo", true),
      supabase.from("agendamentos")
        .select("id, data_hora, status, cliente_id, servicos(nome, preco), barbeiros(nome)")
        .order("data_hora", { ascending: false }).limit(8),
      supabase.from("agendamentos").select("status"),
    ]);

    const receitaMes = (agendsMes ?? [])
      .filter(a => a.status === "concluido")
      .reduce((sum, a) => sum + ((a.servicos as any)?.preco ?? 0), 0);

    const counts: Record<Status, number> = { pendente: 0, confirmado: 0, concluido: 0, cancelado: 0 };
    (allStatus ?? []).forEach(a => { if (a.status in counts) counts[a.status as Status]++; });

    setKpis([
      { label: "AGENDAMENTOS HOJE", value: totalHoje ?? 0, sub: format(now, "dd 'de' MMMM", { locale: ptBR }), icon: Calendar, accent: true },
      { label: "RECEITA DO MÊS", value: `R$ ${receitaMes.toFixed(2).replace(".", ",")}`, sub: "serviços concluídos", icon: DollarSign },
      { label: "CLIENTES", value: totalClientes ?? 0, sub: "cadastrados", icon: Users },
      { label: "BARBEIROS ATIVOS", value: barbeirosAtivos ?? 0, sub: "em operação", icon: Scissors },
    ]);
    setRecentes(await withClientes(recentsData as any));
    setStatusCounts(counts);
    setLoading(false);
  }

  async function loadBarbeiroData() {
    setLoading(true);
    const now = new Date();
    const todayStart = startOfDay(now).toISOString();
    const todayEnd = endOfDay(now).toISOString();
    const monthStart = startOfMonth(now).toISOString();
    const monthEnd = endOfMonth(now).toISOString();

    const [
      { data: hoje },
      { data: mes },
      { data: recentsData },
      { data: allStatus },
    ] = await Promise.all([
      supabase.from("agendamentos").select("id, status, servicos(preco)")
        .eq("barbeiro_id", barbeiroId!).gte("data_hora", todayStart).lte("data_hora", todayEnd),
      supabase.from("agendamentos").select("status, servicos(preco)")
        .eq("barbeiro_id", barbeiroId!).gte("data_hora", monthStart).lte("data_hora", monthEnd),
      supabase.from("agendamentos")
        .select("id, data_hora, status, cliente_id, servicos(nome, preco)")
        .eq("barbeiro_id", barbeiroId!).order("data_hora", { ascending: false }).limit(8),
      supabase.from("agendamentos").select("status").eq("barbeiro_id", barbeiroId!),
    ]);

    const receitaMes = (mes ?? [])
      .filter(a => a.status === "concluido")
      .reduce((sum, a) => sum + ((a.servicos as any)?.preco ?? 0), 0);

    const pendentes = (hoje ?? []).filter(a => a.status === "pendente").length;
    const confirmados = (hoje ?? []).filter(a => a.status === "confirmado").length;

    const counts: Record<Status, number> = { pendente: 0, confirmado: 0, concluido: 0, cancelado: 0 };
    (allStatus ?? []).forEach(a => { if (a.status in counts) counts[a.status as Status]++; });

    setKpis([
      { label: "ATENDIMENTOS HOJE", value: hoje?.length ?? 0, sub: format(now, "EEEE, dd/MM", { locale: ptBR }), icon: Calendar, accent: true },
      { label: "RECEITA DO MÊS", value: `R$ ${receitaMes.toFixed(2).replace(".", ",")}`, sub: "serviços concluídos", icon: DollarSign },
      { label: "PENDENTES HOJE", value: pendentes, sub: "aguardando confirmação", icon: AlertCircle },
      { label: "CONFIRMADOS HOJE", value: confirmados, sub: "prontos para atender", icon: CheckCircle2 },
    ]);
    setRecentes(await withClientes(recentsData as any));
    setStatusCounts(counts);
    setLoading(false);
  }

  if (authLoading) return null;
  if (!isAdmin && !isBarbeiro) return <Navigate to="/" replace />;

  const totalGeral = Object.values(statusCounts).reduce((a, b) => a + b, 0);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-7xl mx-auto px-6 py-10">

        {/* Header */}
        <motion.div {...fadeUp(0)} className="border-b border-border pb-6 mb-10">
          <p className="font-mono text-[10px] text-accent tracking-[0.3em] uppercase mb-2">
            {isAdmin ? "PAINEL ADMINISTRATIVO" : "PAINEL DO BARBEIRO"}
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
                          {isAdmin && (a.barbeiros as any)?.nome && (
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
                        {(a.servicos as any)?.preco != null && (
                          <p className="font-mono text-[10px] text-foreground/40 mt-0.5">
                            R$ {Number((a.servicos as any).preco).toFixed(2).replace(".", ",")}
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
                (["confirmado", "pendente", "concluido", "cancelado"] as Status[]).map((status) => {
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
                            status === "pendente"   ? "bg-yellow-400" :
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
