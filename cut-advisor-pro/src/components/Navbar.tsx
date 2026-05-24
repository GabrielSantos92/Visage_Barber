import { useState } from "react";
import { Menu, X, LogOut, User, Calendar, Settings, Scissors } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { Link } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const publicNavItems = [
  { label: "01. Serviços", href: "#services" },
  { label: "02. Visagismo IA", href: "#ai" },
  { label: "03. Agendar", href: "/agendar", isRoute: true },
];

const Navbar = () => {
  const [open, setOpen] = useState(false);
  const { user, role, signOut } = useAuth();

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-background/80 backdrop-blur-md">
      <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
        <Link to="/" className="flex items-center gap-4">
          <div className="size-8 bg-primary flex items-center justify-center">
            <div className="size-4 bg-background" />
          </div>
          <span className="font-mono text-sm tracking-widest text-primary font-bold">
            METRIC // GROOMING
          </span>
        </Link>

        {/* Desktop */}
        <div className="hidden md:flex items-center gap-8 font-mono text-[10px] tracking-widest uppercase">
          {publicNavItems.map((item, i) =>
            item.isRoute ? (
              <Link key={i} to={item.href} className="text-foreground hover:text-primary transition-colors">
                {item.label}
              </Link>
            ) : (
              <a key={i} href={item.href} className={`${i === 0 ? "text-primary" : "text-foreground"} hover:text-primary transition-colors`}>
                {item.label}
              </a>
            )
          )}
          <div className="h-4 w-px bg-border" />
          {user ? (
            <div className="flex items-center gap-4">
              {role === "admin" && (
                <Link to="/admin/barbeiros" className="text-foreground hover:text-primary transition-colors flex items-center gap-1">
                  <Settings className="size-3" /> ADMIN
                </Link>
              )}
              {role === "barbeiro" && (
                <Link to="/barbeiro/agenda" className="text-foreground hover:text-primary transition-colors flex items-center gap-1">
                  <Scissors className="size-3" /> AGENDA
                </Link>
              )}
              <Link to="/meus-agendamentos" className="text-foreground hover:text-primary transition-colors flex items-center gap-1">
                <Calendar className="size-3" /> SESSÕES
              </Link>
              <Link to="/perfil" className="text-primary flex items-center gap-1 hover:underline">
                <User className="size-3" />
                {user.user_metadata?.nome?.split(" ")[0] || "PERFIL"}
              </Link>
              <button
                onClick={signOut}
                className="text-muted-foreground hover:text-destructive transition-colors flex items-center gap-1"
              >
                <LogOut className="size-3" /> SAIR
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              <Link to="/barbeiro/login" className="text-foreground hover:text-primary transition-colors flex items-center gap-1">
                <Scissors className="size-3" /> BARBEIRO
              </Link>
              <Link to="/login" className="text-primary hover:underline">
                LOGIN
              </Link>
            </div>
          )}
        </div>

        <button className="md:hidden text-primary" onClick={() => setOpen(!open)}>
          {open ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile menu */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="md:hidden border-t border-border overflow-hidden bg-background"
          >
            <div className="px-6 py-6 space-y-4">
              {publicNavItems.map((item, i) =>
                item.isRoute ? (
                  <Link key={i} to={item.href} className="block font-mono text-xs tracking-widest uppercase text-foreground hover:text-primary transition-colors" onClick={() => setOpen(false)}>
                    {item.label}
                  </Link>
                ) : (
                  <a key={i} href={item.href} className="block font-mono text-xs tracking-widest uppercase text-foreground hover:text-primary transition-colors" onClick={() => setOpen(false)}>
                    {item.label}
                  </a>
                )
              )}
              <div className="h-px bg-border my-2" />
              {user ? (
                <>
                  {role === "admin" && (
                    <Link to="/admin/barbeiros" className="block font-mono text-xs tracking-widest uppercase text-foreground hover:text-primary transition-colors" onClick={() => setOpen(false)}>
                      PAINEL ADMIN
                    </Link>
                  )}
                  {role === "barbeiro" && (
                    <Link to="/barbeiro/agenda" className="block font-mono text-xs tracking-widest uppercase text-foreground hover:text-primary transition-colors" onClick={() => setOpen(false)}>
                      MINHA AGENDA
                    </Link>
                  )}
                  <Link to="/meus-agendamentos" className="block font-mono text-xs tracking-widest uppercase text-foreground hover:text-primary transition-colors" onClick={() => setOpen(false)}>
                    MEUS AGENDAMENTOS
                  </Link>
                  <Link to="/perfil" className="block font-mono text-xs tracking-widest uppercase text-primary" onClick={() => setOpen(false)}>
                    MEU PERFIL
                  </Link>
                  <button onClick={() => { signOut(); setOpen(false); }} className="block font-mono text-xs tracking-widest uppercase text-foreground hover:text-destructive transition-colors">
                    SAIR
                  </button>
                </>
              ) : (
                <>
                  <Link to="/barbeiro/login" className="block font-mono text-xs tracking-widest uppercase text-foreground hover:text-primary transition-colors" onClick={() => setOpen(false)}>
                    ÁREA DO BARBEIRO
                  </Link>
                  <Link to="/login" className="block font-mono text-xs tracking-widest uppercase text-primary" onClick={() => setOpen(false)}>
                    LOGIN CLIENTE
                  </Link>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
};

export default Navbar;
