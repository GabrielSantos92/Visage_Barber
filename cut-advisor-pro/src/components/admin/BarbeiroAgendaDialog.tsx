import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/components/ui/sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import {
  DIAS_NOMES, DiaConfig, agendaParaHorarios, defaultAgenda, horariosParaAgenda, validarAgenda,
} from "@/lib/agendaSemanal";

interface Props {
  barbeiro: { id: string; nome: string } | null;
  onClose: () => void;
}

const timeCls =
  "bg-background border border-border px-2 py-2 font-mono text-xs text-primary focus:outline-none focus:border-primary transition-colors";

// Horario de trabalho semanal do barbeiro (tabela horarios_disponiveis)
const BarbeiroAgendaDialog = ({ barbeiro, onClose }: Props) => {
  const [agenda, setAgenda] = useState<DiaConfig[]>(defaultAgenda());
  const [loading, setLoading] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function carregar(barbeiroId: string) {
    setLoading(true); setErro(null);
    const { data, error } = await supabase
      .from("horarios_disponiveis")
      .select("dia_semana, hora_inicio, hora_fim")
      .eq("barbeiro_id", barbeiroId);
    if (error) setErro(error.message);
    else setAgenda(horariosParaAgenda(data ?? []));
    setLoading(false);
  }

  useEffect(() => {
    if (barbeiro) carregar(barbeiro.id);
  }, [barbeiro?.id]);

  const updateDia = (i: number, patch: Partial<DiaConfig>) =>
    setAgenda((prev) => prev.map((d, idx) => (idx === i ? { ...d, ...patch } : d)));

  async function salvar() {
    if (!barbeiro) return;
    const problema = validarAgenda(agenda);
    if (problema) { toast.error(problema); return; }

    setSaving(true);
    const { error: delError } = await supabase.from("horarios_disponiveis").delete().eq("barbeiro_id", barbeiro.id);
    if (delError) { setSaving(false); toast.error(delError.message); return; }

    const linhas = agendaParaHorarios(barbeiro.id, agenda);
    if (linhas.length > 0) {
      const { error } = await supabase.from("horarios_disponiveis").insert(linhas);
      if (error) { setSaving(false); toast.error(error.message); return; }
    }

    setSaving(false);
    toast.success(`Agenda de ${barbeiro.nome} salva.`);
    onClose();
  }

  return (
    <Dialog open={!!barbeiro} onOpenChange={(aberto) => { if (!aberto && !saving) onClose(); }}>
      <DialogContent aria-describedby={undefined} className="max-w-2xl p-0 gap-0 border-border bg-background sm:rounded-none">
        <div className="px-6 py-4 border-b border-border">
          <DialogTitle className="font-mono text-[10px] tracking-widest text-muted-foreground font-normal uppercase">
            Agenda — {barbeiro?.nome}
          </DialogTitle>
          <p className="text-xs text-muted-foreground mt-2">
            Ative os dias de trabalho e defina o horário. Use o botão de pausa para incluir o almoço.
          </p>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <div className="py-12 text-center font-mono text-xs text-muted-foreground animate-pulse">CARREGANDO...</div>
          ) : erro ? (
            <div className="py-10 px-6 text-center">
              <p className="text-sm text-destructive mb-4">{erro}</p>
              <button
                onClick={() => barbeiro && carregar(barbeiro.id)}
                className="border border-border px-4 py-2 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary transition-colors"
              >
                Tentar novamente
              </button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {DIAS_NOMES.map((diaNome, i) => {
                const d = agenda[i];
                return (
                  <div key={i} className="px-6 py-3">
                    <div className="flex flex-wrap items-center gap-3 min-h-9">
                      <Switch
                        checked={d.ativo}
                        onCheckedChange={(ativo) => updateDia(i, { ativo })}
                        aria-label={`Trabalha em ${diaNome}`}
                      />
                      <span className={`font-mono text-[11px] tracking-widest uppercase w-10 ${d.ativo ? "text-primary" : "text-muted-foreground"}`}>
                        {diaNome}
                      </span>

                      {d.ativo ? (
                        <>
                          <input type="time" value={d.inicio} onChange={(e) => updateDia(i, { inicio: e.target.value })} className={timeCls} aria-label={`Início em ${diaNome}`} />
                          <span className="font-mono text-xs text-muted-foreground">→</span>
                          <input type="time" value={d.fim} onChange={(e) => updateDia(i, { fim: e.target.value })} className={timeCls} aria-label={`Fim em ${diaNome}`} />
                          <button
                            type="button"
                            onClick={() => updateDia(i, { almoco: !d.almoco })}
                            aria-pressed={d.almoco}
                            className={`flex items-center gap-1.5 border px-2.5 py-2 font-mono text-[9px] tracking-widest uppercase transition-colors ${
                              d.almoco ? "border-accent text-accent" : "border-border text-muted-foreground hover:text-primary"
                            }`}
                          >
                            <Coffee className="size-3" /> Almoço
                          </button>
                        </>
                      ) : (
                        <span className="font-mono text-[9px] tracking-widest text-muted-foreground">FOLGA</span>
                      )}
                    </div>

                    {d.ativo && d.almoco && (
                      <div className="flex flex-wrap items-center gap-3 mt-2 pl-[5.25rem]">
                        <span className="font-mono text-[9px] tracking-widest text-muted-foreground">PAUSA</span>
                        <input type="time" value={d.almocoInicio} onChange={(e) => updateDia(i, { almocoInicio: e.target.value })} className={timeCls} aria-label={`Início do almoço em ${diaNome}`} />
                        <span className="font-mono text-xs text-muted-foreground">→</span>
                        <input type="time" value={d.almocoFim} onChange={(e) => updateDia(i, { almocoFim: e.target.value })} className={timeCls} aria-label={`Fim do almoço em ${diaNome}`} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
          <button
            onClick={onClose} disabled={saving}
            className="border border-border px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase text-foreground hover:bg-secondary transition-colors disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={salvar} disabled={saving || loading || !!erro}
            className="bg-primary text-primary-foreground px-5 py-2.5 font-mono text-[10px] tracking-widest uppercase hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {saving ? "Salvando..." : "Salvar agenda"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default BarbeiroAgendaDialog;
