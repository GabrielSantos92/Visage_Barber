import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

type Servico = {
  id: string;
  nome: string;
  descricao: string | null;
  preco: number;
  duracao_min: number;
};

const ServicesSection = () => {
  const [servicos, setServicos] = useState<Servico[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase
      .from("servicos")
      .select("id, nome, descricao, preco, duracao_min")
      .eq("ativo", true)
      .order("preco")
      .then(({ data }) => {
        if (data) setServicos(data);
        setLoading(false);
      });
  }, []);

  return (
    <section id="services" className="px-6 lg:px-20 py-24 border-t border-border">
      <div className="max-w-7xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-baseline mb-12 gap-4">
          <div>
            <span className="font-mono text-[10px] uppercase text-muted-foreground block mb-2">
              Catálogo // 2026
            </span>
            <h2 className="text-4xl font-bold text-primary uppercase italic tracking-tighter">
              Protocolos de Execução
            </h2>
          </div>
          <span className="font-mono text-[10px] text-foreground">
            TOTAL_ACTIVE: {String(servicos.length).padStart(2, "0")}
          </span>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-20 border border-border animate-pulse bg-card" />
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            {servicos.map((svc, i) => (
              <motion.div
                key={svc.id}
                initial={{ opacity: 0, x: -20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="group flex flex-col md:flex-row md:items-center justify-between p-6 border border-border hover:bg-primary hover:text-primary-foreground transition-all cursor-pointer"
              >
                <div className="flex items-center gap-8 mb-4 md:mb-0">
                  <span className="font-mono text-xs opacity-50">
                    {String(i + 1).padStart(3, "0")}
                  </span>
                  <div>
                    <h4 className="text-xl md:text-2xl font-bold uppercase tracking-tight">
                      {svc.nome}
                    </h4>
                    {svc.descricao && (
                      <p className="text-xs font-mono opacity-60 uppercase tracking-widest mt-1">
                        {svc.descricao}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-12 font-mono">
                  <div className="text-right">
                    <span className="block text-[10px] opacity-50 uppercase">Duração</span>
                    <span className="text-sm font-bold">{svc.duracao_min}.00m</span>
                  </div>
                  <div className="text-right">
                    <span className="block text-[10px] opacity-50 uppercase">Valor</span>
                    <span className="text-sm font-bold">R$ {Number(svc.preco).toFixed(2)}</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
};

export default ServicesSection;
