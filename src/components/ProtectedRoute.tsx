import { Navigate, Outlet } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import type { UserRole } from '../types/database'

interface ProtectedRouteProps {
  allowedRoles?: UserRole[]
}

export function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, profile, loading } = useAuth()

  if (loading) {
    return <div className="flex h-screen items-center justify-center">Cargando...</div>
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && profile && !allowedRoles.includes(profile.role)) {
    return <div className="flex h-screen items-center justify-center">No tienes permiso para ver esta página.</div>
  }

  if (allowedRoles && !profile) {
     return <div className="flex h-screen items-center justify-center">Error cargando perfil de usuario. Contacte soporte.</div>
  }

  return <Outlet />
}
