const Footer = () => {
  return (
    <footer className="border-t border-border mt-16 py-12">
      <div className="max-w-7xl mx-auto px-6 grid grid-cols-1 md:grid-cols-4 gap-12">
        <div className="md:col-span-2">
          <div className="font-mono text-xs text-primary mb-6 uppercase tracking-[0.2em]">
            Metric Technical Systems
          </div>
          <p className="text-sm text-foreground max-w-sm font-mono leading-relaxed">
            Todos os protocolos executados com esterilização de grau ISO e
            equipamentos de precisão cirúrgica. Estilo não é subjetivo — é
            engenharia.
          </p>
        </div>
        <div className="space-y-4">
          <div className="font-mono text-[10px] text-muted-foreground uppercase">
            Coordenadas
          </div>
          <div className="text-sm font-mono text-primary">
            23.5505° S
            <br />
            46.6333° W
          </div>
        </div>
        <div className="space-y-4">
          <div className="font-mono text-[10px] text-muted-foreground uppercase">
            Rede
          </div>
          <div className="flex flex-col gap-2 font-mono text-sm uppercase">
            <a href="#" className="hover:text-primary transition-colors text-foreground">
              Instagram
            </a>
            <a href="#" className="hover:text-primary transition-colors text-foreground">
              WhatsApp
            </a>
          </div>
        </div>
      </div>
      <div className="max-w-7xl mx-auto px-6 mt-12 pt-12 border-t border-border/50 flex flex-col md:flex-row justify-between items-center gap-4">
        <span className="font-mono text-[10px] text-muted-foreground">
          © 2026 METRIC_SYSTEMS. TODOS OS DIREITOS RESERVADOS.
        </span>
        <div className="flex gap-8 font-mono text-[10px] text-muted-foreground uppercase">
          <span>Ver: 1.0.0-MVP</span>
          <span>Encoding: UTF-8</span>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
