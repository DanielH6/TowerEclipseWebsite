import type { ReactNode } from "react";
import { Navigate, useLocation } from "./router";
import { useAuth } from "./AuthContext";
import type { AppRole } from "./types";

export default function ProtectedRoute({
  children,
  role,
  roles,
}: {
  children: ReactNode;
  role?: AppRole;
  roles?: AppRole[];
}) {
  const { loading, auth } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <section className="content-band loading-band">
        <div className="loading-spinner" aria-label="Loading authentication" />
      </section>
    );
  }

  if (!auth) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (role && auth.user.role !== role) {
    return <Navigate to="/bugs" replace />;
  }

  if (roles && !roles.includes(auth.user.role)) {
    return <Navigate to="/bugs" replace />;
  }

  return children;
}
