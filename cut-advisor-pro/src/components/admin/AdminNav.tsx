import { NavLink } from "react-router-dom";
import { LayoutDashboard, Scissors, Tags, Users } from "lucide-react";
import Navbar from "@/components/Navbar";

// Mesmas areas das abas do admin mobile (Dashboard, Usuarios e Barbeiros), mais o
// cadastro de servicos, que so existe na web
const itens = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { to: "/admin/barbeiros", label: "Barbeiros", icon: Scissors },
  { to: "/admin/servicos", label: "Serviços", icon: Tags },
  { to: "/admin/usuarios", label: "Usuários", icon: Users },
];

export const AdminNav = () => (
  <div className="border-b border-border bg-card/40">
    <div className="max-w-7xl mx-auto px-6 flex items-center gap-6 overflow-x-auto">
      <span className="font-mono text-[9px] tracking-[0.3em] text-muted-foreground uppercase shrink-0">Admin</span>
      {itens.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          className={({ isActive }) =>
            `flex items-center gap-2 py-3 border-b-2 font-mono text-[10px] tracking-widest uppercase transition-colors shrink-0 ${
              isActive ? "border-primary text-primary" : "border-transparent text-foreground hover:text-primary"
            }`
          }
        >
          <Icon className="size-3" /> {label}
        </NavLink>
      ))}
    </div>
  </div>
);

const AdminLayout = ({ children }: { children: React.ReactNode }) => (
  <div className="min-h-screen bg-background">
    <Navbar />
    <AdminNav />
    <main className="max-w-7xl mx-auto px-6 py-10">{children}</main>
  </div>
);

export default AdminLayout;
