import { useAuth } from "@/contexts/AuthContext";
import { Navigate } from "react-router-dom";
import type { Enums } from "@/integrations/supabase/types";

type AppRole = Enums<"app_role">;

interface Props {
  children: React.ReactNode;
  roles?: AppRole[];
}

const ProtectedRoute = ({ children, roles }: Props) => {
  const { user, role, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="font-mono text-xs text-muted-foreground animate-pulse">
          SYS_LOADING...
        </div>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (roles && role && !roles.includes(role)) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
