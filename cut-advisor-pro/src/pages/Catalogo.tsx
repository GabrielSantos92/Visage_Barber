import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { Scissors, Clock, ArrowLeft } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import Navbar from "@/components/Navbar";

type Barbeiro = {
  id: string;
  nome: string;
  especialidade: string | null;
  foto_url: string | null;
};

type Servico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  duracao_min: number;
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

const Catalogo = () => {
  const [barbeiros, setBarbeiros] = useState<Barbeiro[]>([]);
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loadingB, setLoadingB] = useState(true);
  const [loadingS, setLoadingS] = useState(true);

  useEffect(() => {
    supabase
      .from("barbeiros")
      .select("id, nome, especialidade, foto_url")
      .eq("ativo", true)
      .then(({ data }) => {
        if (data) setBarbeiros(data);
        setLoadingB(false);
      });

    supabase
      .from("servicos")
      .select("id, nome, descricao, preco, duracao_min")
      .eq("ativo", true)
      .order("preco")
      .then(({ data }) => {
        if (data) setServicos(data);
        setLoadingS(false);
      });
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="max-w-5xl mx-auto px-6 py-8">
        <Link to="/" className="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-widest text-foreground hover:text-primary transition-colors mb-4">
          <ArrowLeft className="size-3" /> Voltar
        </Link>

        <div className="inline-block px-2 py-1 border border-border mb-4">
          <span className="font-mono text-[10px] uppercase tracking-widest text-foreground">
            CATÁLOGO // 2026
          </span>
        </div>
        <h1 className="text-3xl font-light tracking-tighter text-primary mb-12">
          NOSSOS <span className="font-bold italic">SERVIÇOS</span>
        </h1>

        {/* Barbeiros */}
        <section className="mb-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-border" />
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-primary px-4">
              Barbeiros
            </h2>
            <div className="h-px flex-1 bg-border" />
          </div>

          {loadingB ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-28 border border-border animate-pulse bg-card" />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              {barbeiros.map((b, i) => (
                <motion.div
                  key={b.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.1 }}
                  className="border border-border p-6 flex items-center gap-4 hover:border-primary transition-colors"
                >
                  <div className="size-14 bg-secondary flex items-center justify-center font-bold text-primary text-xl flex-shrink-0">
                    {b.nome.charAt(0)}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-primary">{b.nome}</p>
                    <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest mt-0.5">
                      {b.especialidade || "Barbeiro"}
                    </p>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* Serviços */}
        <section className="mb-16">
          <div className="flex items-center gap-4 mb-6">
            <div className="h-px flex-1 bg-border" />
            <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-primary px-4">
              Serviços
            </h2>
            <div className="h-px flex-1 bg-border" />
          </div>

          {loadingS ? (
            <div className="space-y-3">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-16 border border-border animate-pulse bg-card" />
              ))}
            </div>
          ) : (
            <div className="space-y-3">
              {servicos.map((s, i) => (
                <motion.div
                  key={s.id}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.07 }}
                  className="flex items-center justify-between p-4 border border-border hover:border-primary transition-colors"
                >
                  <div className="flex items-center gap-4">
                    <Scissors className="size-4 text-muted-foreground flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-primary">{s.nome}</p>
                      {s.descricao && (
                        <p className="font-mono text-[10px] text-muted-foreground uppercase tracking-widest">
                          {s.descricao}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-8 font-mono">
                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                      <Clock className="size-3" /> {s.duracao_min}min
                    </span>
                    <span className="text-sm font-bold text-primary">
                      R$ {Number(s.preco).toFixed(2)}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          )}
        </section>

        {/* CTA */}
        <div className="text-center py-8 border border-border">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-4">
            Pronto para agendar?
          </p>
          <Link
            to="/agendar"
            className="inline-block bg-primary text-primary-foreground px-8 py-3.5 font-bold tracking-widest text-sm uppercase transition-all active:scale-95 hover:bg-accent hover:text-accent-foreground"
          >
            AGENDAR AGORA
          </Link>
        </div>
      </main>
    </div>
  );
};

export default Catalogo;
