import React, { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { StorageService } from '../../services/storage';

interface RouteProps {
  children: React.ReactNode;
  fallback?: React.ReactNode;
}

/**
 * Protects admin portal routes.
 */
export const ProtectedRoute: React.FC<RouteProps> = ({ children, fallback }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    const checkAuth = () => {
      const user = StorageService.getCurrentUser();
      const adminSession = StorageService.getAdminSession();
      setIsAuthenticated(Boolean(user || adminSession));
    };

    checkAuth();
  }, [location.pathname]);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-3 border-sky-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback ? <>{fallback}</> : <Navigate to="/admin/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

export const AdminRoute: React.FC<RouteProps> = ProtectedRoute;

/**
 * Protects rider/phlebo mobile routes.
 */
export const RiderRoute: React.FC<RouteProps> = ({ children, fallback }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    const checkRiderAuth = () => {
      const riderSession = StorageService.getRiderSession();
      setIsAuthenticated(Boolean(riderSession));
    };

    checkRiderAuth();
  }, [location.pathname]);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback ? <>{fallback}</> : <Navigate to="/rider/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};

/**
 * Protects client diagnostic lab portal routes.
 */
export const ClientRoute: React.FC<RouteProps> = ({ children, fallback }) => {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const location = useLocation();

  useEffect(() => {
    const checkClientAuth = () => {
      const clientSession = StorageService.getClientSession();
      setIsAuthenticated(Boolean(clientSession));
    };

    checkClientAuth();
  }, [location.pathname]);

  if (isAuthenticated === null) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-8 h-8 border-3 border-teal-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return fallback ? <>{fallback}</> : <Navigate to="/client/login" state={{ from: location }} replace />;
  }

  return <>{children}</>;
};