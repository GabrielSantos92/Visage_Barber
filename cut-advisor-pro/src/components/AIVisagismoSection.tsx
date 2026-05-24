import { motion } from "framer-motion";

const steps = [
  {
    num: "01",
    title: "Mapeamento Facial",
    desc: "IA proprietária analisa estrutura craniana, densidade capilar e vetores de crescimento para determinar sua silhueta ideal.",
    progress: "w-1/3",
  },
  {
    num: "02",
    title: "Análise de Textura",
    desc: "Avaliação a nível de fibra da força folicular e padrão de cachos para recomendação precisa de tratamento e produto.",
    progress: "w-1/2",
  },
  {
    num: "03",
    title: "Prova Virtual",
    desc: "Renderização neural de alta fidelidade do estilo proposto em diferentes ambientes de iluminação antes da primeira lâmina.",
    progress: "w-3/4",
  },
];

const AIVisagismoSection = () => {
  return (
    <section id="ai" className="px-6 lg:px-20 py-24 border-t border-border">
      <div className="max-w-7xl mx-auto">
        <div className="flex items-center gap-4 mb-12">
          <div className="h-px flex-1 bg-border" />
          <h2 className="font-mono text-xs uppercase tracking-[0.3em] text-primary px-4">
            Diagnóstico Morfológico
          </h2>
          <div className="h-px flex-1 bg-border" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {steps.map((step, i) => (
            <motion.div
              key={step.num}
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: i * 0.15 }}
              className="border border-border p-8 group hover:border-primary transition-colors"
            >
              <div className="font-mono text-2xl text-primary mb-6 tracking-tighter">
                {step.num}
              </div>
              <h3 className="text-xl font-bold text-primary mb-4 uppercase italic tracking-tight">
                {step.title}
              </h3>
              <p className="text-sm text-foreground mb-8 leading-relaxed">
                {step.desc}
              </p>
              <div className="h-1 bg-border w-full relative overflow-hidden">
                <div
                  className={`absolute inset-0 bg-primary ${step.progress} group-hover:translate-x-[200%] transition-transform duration-700 ease-in-out`}
                />
              </div>
            </motion.div>
          ))}
        </div>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          className="mt-12 flex justify-center"
        >
          <button className="group flex items-center gap-4 px-8 py-5 bg-secondary border border-border hover:border-accent transition-all">
            <div className="size-10 border border-accent/30 flex items-center justify-center group-hover:bg-accent transition-colors">
              <span className="text-accent group-hover:text-accent-foreground font-bold">+</span>
            </div>
            <span className="uppercase tracking-widest text-xs font-bold text-primary">
              Enviar Foto para Análise
            </span>
          </button>
        </motion.div>
      </div>
    </section>
  );
};

export default AIVisagismoSection;
