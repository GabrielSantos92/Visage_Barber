import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/contexts/AuthContext";
import Index from "./pages/Index";
import Login from "./pages/Login";
import Register from "./pages/Register";
import ForgotPassword from "./pages/ForgotPassword";
import ResetPassword from "./pages/ResetPassword";
import Booking from "./pages/Booking";
import MeusAgendamentos from "./pages/MeusAgendamentos";
import Perfil from "./pages/Perfil";
import Catalogo from "./pages/Catalogo";
import BarbeiroAgenda from "./pages/BarbeiroAgenda";
import BarbeiroLogin from "./pages/BarbeiroLogin";
import AdminBarbeiros from "./pages/admin/AdminBarbeiros";
import NotFound from "./pages/NotFound";
import ProtectedRoute from "./components/ProtectedRoute";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/agendar" element={<ProtectedRoute><Booking /></ProtectedRoute>} />
            <Route path="/meus-agendamentos" element={<ProtectedRoute><MeusAgendamentos /></ProtectedRoute>} />
            <Route path="/perfil" element={<ProtectedRoute><Perfil /></ProtectedRoute>} />
            <Route path="/catalogo" element={<Catalogo />} />
            <Route path="/barbeiro/agenda" element={<ProtectedRoute roles={["barbeiro", "admin"]}><BarbeiroAgenda /></ProtectedRoute>} />
            <Route path="/barbeiro/login" element={<BarbeiroLogin />} />
            <Route path="/admin/barbeiros" element={<AdminBarbeiros />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
