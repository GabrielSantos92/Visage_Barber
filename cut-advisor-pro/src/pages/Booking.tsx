import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { Calendar, Clock, User, Scissors, ChevronLeft, ChevronRight, Check, ArrowLeft } from "lucide-react";
import { format, addDays, startOfDay, isSameDay, isAfter, setHours, setMinutes } from "date-fns";
import { ptBR } from "date-fns/locale";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "@/components/ui/sonner";
import Navbar from "@/components/Navbar";

type Barbeiro = { id: string; nome: string; especialidade: string | null };
type Servico = { id: string; nome: string; preco: number; duracao_min: number };

const STEPS = ["Barbeiro", "Serviço", "Data", "Horário", "Confirmar"];

const Booking = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [step, setStep] = useState(0);
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [selectedBarbeiro, setSelectedBarbeiro] = useState<Barbeiro | null>(null);
  const [selectedServico, setSelectedServico] = useState<Servico | null>(null);
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [selectedTime, setSelectedTime] = useState<string | null>(null);
  const [availableSlots, setAvailableSlots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Generate next 14 days (skip Sundays)
  const dates = Array.from({ length: 14 }, (_, i) => addDays(startOfDay(new Date()), i + 1))
    .filter(d => d.getDay() !== 0);

  useEffect(() => {
    const fetchBarbeiros = async () => {
      const { data } = await supabase.from("barbeiros").select("id, nome, especialidade");
      if (data) setBarbeiros(data);
    };
    fetchBarbeiros();
  }, []);

  useEffect(() => {
    if (!selectedBarbeiro) return;
    const fetchServicos = async () => {
      const { data } = await supabase
        .from("barbeiro_servicos")
        .select("servico_id, servicos(id, nome, preco, duracao_min)")
        .eq("barbeiro_id", selectedBarbeiro.id);
      if (data) {
        setServicos(data.map((d: any) => d.servicos).filter(Boolean));
      }
    };
    fetchServicos();
  }, [selectedBarbeiro]);

  useEffect(() => {
    if (!selectedBarbeiro || !selectedDate || !selectedServico) return;
    const fetchSlots = async () => {
      setLoading(true);
      const dayOfWeek = selectedDate.getDay();

      // Get barbeiro schedule for this day
      const { data: horarios } = await supabase
        .from("horarios_disponiveis")
        .select("hora_inicio, hora_fim")
        .eq("barbeiro_id", selectedBarbeiro.id)
        .eq("dia_semana", dayOfWeek);

      if (!horarios || horarios.length === 0) {
        setAvailableSlots([]);
        setLoading(false);
        return;
      }

      // Get existing appointments for this barbeiro on this date
      const dateStr = format(selectedDate, "yyyy-MM-dd");
      const { data: existing } = await supabase
        .from("agendamentos")
        .select("data_hora, servico_id")
        .eq("barbeiro_id", selectedBarbeiro.id)
        .gte("data_hora", `${dateStr}T00:00:00`)
        .lte("data_hora", `${dateStr}T23:59:59`)
        .in("status", ["pendente", "confirmado"]);

      const bookedTimes = new Set(
        (existing || []).map(a => format(new Date(a.data_hora), "HH:mm"))
      );

      // Generate time slots
      const slots: string[] = [];
      const duration = selectedServico.duracao_min;
      for (const h of horarios) {
        const [startH, startM] = h.hora_inicio.split(":").map(Number);
        const [endH, endM] = h.hora_fim.split(":").map(Number);
        let current = startH * 60 + startM;
        const end = endH * 60 + endM;

        while (current + duration <= end) {
          const hour = Math.floor(current / 60);
          const min = current % 60;
          const timeStr = `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;

          // Check if slot is not booked and is in the future
          const slotDate = setMinutes(setHours(selectedDate, hour), min);
          if (!bookedTimes.has(timeStr) && isAfter(slotDate, new Date())) {
            slots.push(timeStr);
          }
          current += 30; // 30 min intervals
        }
      }

      setAvailableSlots(slots);
      setLoading(false);
    };
    fetchSlots();
  }, [selectedBarbeiro, selectedDate, selectedServico]);

  const handleSubmit = async () => {
    if (!user || !selectedBarbeiro || !selectedServico || !selectedDate || !selectedTime) return;

    setSubmitting(true);
    const [h, m] = selectedTime.split(":").map(Number);
    const dataHora = setMinutes(setHours(selectedDate, h), m);

    const { error } = await supabase.from("agendamentos").insert({
      cliente_id: user.id,
      barbeiro_id: selectedBarbeiro.id,
      servico_id: selectedServico.id,
      data_hora: dataHora.toISOString(),
    });

    setSubmitting(false);

    if (error) {
      toast.error("Erro ao agendar. Tente novamente.");
      return;
    }

    toast.success("Agendamento realizado com sucesso!");
    navigate("/meus-agendamentos");
  };

  const canProceed = () => {
    if (step === 0) return !!selectedBarbeiro;
    if (step === 1) return !!selectedServico;
    if (step === 2) return !!selectedDate;
    if (step === 3) return !!selectedTime;
    return true;
  };

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-2xl mx-auto px-6 py-8">
        {/* Header */}
        <div className="mb-8">
          <button onClick={() => navigate("/")} className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-4">
            <ArrowLeft className="size-3" /> Voltar
          </button>
          <div className="inline-block px-2 py-1 border border-border mb-4">
            <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
              BOOKING // PROTOCOL
            </span>
          </div>
          <h1 className="text-3xl font-light tracking-tighter text-primary">
            AGENDAR <span className="font-bold italic">SESSÃO</span>
          </h1>
        </div>

        {/* Progress Steps */}
        <div className="flex items-center gap-1 mb-8 overflow-x-auto">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-1">
              <button
                onClick={() => i < step && setStep(i)}
                className={`font-mono text-[10px] uppercase tracking-widest px-3 py-1.5 transition-colors ${
                  i === step
                    ? "bg-primary text-primary-foreground"
                    : i < step
                    ? "bg-card text-primary border border-border cursor-pointer"
                    : "text-muted-foreground"
                }`}
              >
                {String(i + 1).padStart(2, "0")}. {s}
              </button>
              {i < STEPS.length - 1 && <div className="w-4 h-px bg-border flex-shrink-0" />}
            </div>
          ))}
        </div>

        {/* Step Content */}
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -20 }}
            transition={{ duration: 0.3 }}
          >
            {/* Step 0: Select Barbeiro */}
            {step === 0 && (
              <div className="space-y-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-4">
                  <User className="inline size-3 mr-1" /> Selecione seu barbeiro
                </p>
                {barbeiros.map((b) => (
                  <button
                    key={b.id}
                    onClick={() => { setSelectedBarbeiro(b); setSelectedServico(null); }}
                    className={`w-full text-left p-4 border transition-all ${
                      selectedBarbeiro?.id === b.id
                        ? "border-primary bg-card"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-4">
                        <div className="size-12 bg-secondary flex items-center justify-center font-bold text-primary text-lg">
                          {b.nome.charAt(0)}
                        </div>
                        <div>
                          <p className="text-sm font-bold text-primary">{b.nome}</p>
                          <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                            {b.especialidade || "Barbeiro"}
                          </p>
                        </div>
                      </div>
                      {selectedBarbeiro?.id === b.id && (
                        <Check className="size-5 text-accent" />
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 1: Select Servico */}
            {step === 1 && (
              <div className="space-y-3">
                <p className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-4">
                  <Scissors className="inline size-3 mr-1" /> Selecione o serviço
                </p>
                {servicos.map((s) => (
                  <button
                    key={s.id}
                    onClick={() => setSelectedServico(s)}
                    className={`w-full text-left p-4 border transition-all ${
                      selectedServico?.id === s.id
                        ? "border-primary bg-card"
                        : "border-border hover:border-primary/50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-primary">{s.nome}</p>
                        <p className="font-mono text-[10px] text-muted-foreground uppercase">
                          {s.duracao_min} min
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-lg font-bold text-primary">
                          R$ {Number(s.preco).toFixed(2)}
                        </span>
                        {selectedServico?.id === s.id && (
                          <Check className="size-5 text-accent" />
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {/* Step 2: Select Date */}
            {step === 2 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-4">
                  <Calendar className="inline size-3 mr-1" /> Selecione a data
                </p>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                  {dates.map((d) => (
                    <button
                      key={d.toISOString()}
                      onClick={() => { setSelectedDate(d); setSelectedTime(null); }}
                      className={`p-3 border text-center transition-all ${
                        selectedDate && isSameDay(selectedDate, d)
                          ? "border-primary bg-card"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      <span className="block font-mono text-[10px] uppercase text-muted-foreground">
                        {format(d, "EEE", { locale: ptBR })}
                      </span>
                      <span className="block text-lg font-bold text-primary">
                        {format(d, "dd")}
                      </span>
                      <span className="block font-mono text-[10px] uppercase text-muted-foreground">
                        {format(d, "MMM", { locale: ptBR })}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Step 3: Select Time */}
            {step === 3 && (
              <div>
                <p className="font-mono text-[10px] uppercase tracking-widest text-foreground mb-4">
                  <Clock className="inline size-3 mr-1" /> Selecione o horário
                </p>
                {loading ? (
                  <div className="text-center py-12">
                    <span className="font-mono text-xs text-muted-foreground animate-pulse">
                      CARREGANDO HORÁRIOS...
                    </span>
                  </div>
                ) : availableSlots.length === 0 ? (
                  <div className="text-center py-12 border border-border">
                    <p className="text-sm text-foreground">Nenhum horário disponível nesta data.</p>
                    <button
                      onClick={() => setStep(2)}
                      className="mt-3 font-mono text-[10px] uppercase tracking-widest text-primary hover:underline"
                    >
                      Escolher outra data
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                    {availableSlots.map((t) => (
                      <button
                        key={t}
                        onClick={() => setSelectedTime(t)}
                        className={`p-3 border font-mono text-sm font-bold transition-all ${
                          selectedTime === t
                            ? "border-primary bg-card text-primary"
                            : "border-border text-foreground hover:border-primary/50"
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Step 4: Confirm */}
            {step === 4 && (
              <div className="border border-border">
                <div className="p-4 border-b border-border">
                  <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
                    RESUMO DO AGENDAMENTO
                  </span>
                </div>
                <div className="divide-y divide-border">
                  <div className="p-4 flex justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">Barbeiro</span>
                    <span className="text-sm font-bold text-primary">{selectedBarbeiro?.nome}</span>
                  </div>
                  <div className="p-4 flex justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">Serviço</span>
                    <span className="text-sm font-bold text-primary">{selectedServico?.nome}</span>
                  </div>
                  <div className="p-4 flex justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">Data</span>
                    <span className="text-sm font-bold text-primary">
                      {selectedDate && format(selectedDate, "dd 'de' MMMM, yyyy", { locale: ptBR })}
                    </span>
                  </div>
                  <div className="p-4 flex justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">Horário</span>
                    <span className="text-sm font-bold text-primary">{selectedTime}</span>
                  </div>
                  <div className="p-4 flex justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">Duração</span>
                    <span className="text-sm font-bold text-primary">{selectedServico?.duracao_min} min</span>
                  </div>
                  <div className="p-4 flex justify-between">
                    <span className="font-mono text-[10px] uppercase text-muted-foreground">Valor</span>
                    <span className="text-lg font-bold text-primary">
                      R$ {selectedServico && Number(selectedServico.preco).toFixed(2)}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* Navigation buttons */}
        <div className="flex gap-3 mt-8">
          {step > 0 && (
            <button
              onClick={() => setStep(step - 1)}
              className="flex-1 border border-border py-3.5 font-bold tracking-widest text-sm uppercase text-foreground transition-all hover:border-primary active:scale-95"
            >
              <ChevronLeft className="inline size-4 mr-1" /> VOLTAR
            </button>
          )}
          {step < 4 ? (
            <button
              onClick={() => setStep(step + 1)}
              disabled={!canProceed()}
              className="flex-1 bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
            >
              PRÓXIMO <ChevronRight className="inline size-4 ml-1" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={submitting}
              className="flex-1 bg-primary text-primary-foreground py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
            >
              {submitting ? (
                <span className="font-mono text-xs animate-pulse">PROCESSANDO...</span>
              ) : (
                "CONFIRMAR AGENDAMENTO"
              )}
            </button>
          )}
        </div>
      </main>
    </div>
  );
};

export default Booking;
