import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import heroImage from "@/assets/hero-barbershop.jpg";

const HeroSection = () => {
  return (
    <section className="grid grid-cols-1 lg:grid-cols-12 gap-0 items-start">
      <div className="lg:col-span-7 px-6 py-16 lg:px-20 lg:py-24 flex flex-col justify-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="inline-block px-2 py-1 border border-border mb-6">
            <span className="font-mono text-[10px] uppercase tracking-tighter text-foreground">
              Model: 2024-V2 // Performance Grooming
            </span>
          </div>
          <h1 className="text-5xl md:text-7xl lg:text-8xl font-light tracking-tighter text-primary leading-[0.9] mb-8">
            CALIBRATE <br />
            <span className="font-bold italic">YOUR IDENTITY</span>
          </h1>
          <p className="max-w-[45ch] text-lg text-foreground leading-relaxed mb-12">
            Estética de precisão para o indivíduo de alta performance. Nossos
            protocolos tratam o estilo como disciplina cirúrgica, utilizando
            análise morfológica por IA para alcançar simetria matemática.
          </p>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          id="booking"
          className="max-w-md border border-border p-1"
        >
          <div className="bg-card p-6 flex flex-col gap-6">
            <div className="flex justify-between items-end border-b border-border pb-4">
              <span className="font-mono text-[10px] uppercase text-foreground">
                Agendar Sessão
              </span>
              <span className="font-mono text-[10px] uppercase text-primary">
                Step 01/03
              </span>
            </div>
            <div className="grid grid-cols-2 gap-px bg-border">
              <button className="bg-background p-4 text-left hover:bg-primary hover:text-primary-foreground transition-colors">
                <span className="block font-mono text-[10px] uppercase opacity-50 mb-1">
                  Data
                </span>
                <span className="text-sm font-bold">24.ABR.26</span>
              </button>
              <button className="bg-background p-4 text-left hover:bg-primary hover:text-primary-foreground transition-colors">
                <span className="block font-mono text-[10px] uppercase opacity-50 mb-1">
                  Hora
                </span>
                <span className="text-sm font-bold">14:30</span>
              </button>
            </div>
            <Link to="/agendar" className="block w-full bg-primary text-primary-foreground py-4 font-bold tracking-widest text-sm uppercase transition-transform active:scale-95 hover:bg-accent hover:text-accent-foreground text-center">
              INICIAR PROTOCOLO
            </Link>
          </div>
        </motion.div>
      </div>

      <div className="lg:col-span-5 relative hidden lg:block">
        <div className="aspect-[4/5] bg-secondary relative overflow-hidden">
          <img
            src={heroImage}
            loading="lazy"
            className="w-full h-full object-cover grayscale opacity-70 contrast-125"
            alt="Interior da barbearia"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-transparent to-transparent" />
          <div className="absolute top-6 right-6 font-mono text-[10px] text-primary space-y-2">
            <div className="flex justify-between gap-8">
              <span>X-AXIS</span>
              <span>14.02</span>
            </div>
            <div className="flex justify-between gap-8">
              <span>Y-AXIS</span>
              <span>89.44</span>
            </div>
            <div className="flex justify-between gap-8">
              <span>SKEW</span>
              <span>0.00°</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default HeroSection;
