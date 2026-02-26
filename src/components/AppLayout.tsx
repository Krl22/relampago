import { useState } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { 
  LayoutDashboard, 
  Package, 
  Truck, 
  Boxes, 
  LogOut, 
  Menu, 
  X,
  Building2,
  Users
} from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

export default function AppLayout() {
  const { profile, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  const role = profile?.role

  const navItems = [
    {
      label: 'Dashboard',
      href: '/',
      icon: LayoutDashboard,
      roles: ['admin', 'staff'],
    },
    {
      label: 'Pedidos',
      href: '/orders',
      icon: Package,
      roles: ['admin', 'staff'],
    },
    {
      label: 'Empresas',
      href: '/companies',
      icon: Building2,
      roles: ['admin', 'staff'],
    },
    {
      label: 'Motorizados',
      href: '/couriers',
      icon: Users,
      roles: ['admin', 'staff'],
    },
    {
      label: 'Mis Envíos',
      href: '/my-deliveries',
      icon: Truck,
      roles: ['courier'],
    },
    {
      label: 'Mi Stock',
      href: '/my-stock',
      icon: Boxes,
      roles: ['client'],
    },
    {
      label: 'Inventario Global',
      href: '/stock',
      icon: Boxes,
      roles: ['admin'],
    }
  ]

  const filteredNavItems = navItems.filter(item => 
    item.roles.includes(role || '')
  )

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 transform bg-white shadow-lg transition-transform duration-200 ease-in-out lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center justify-between px-6 border-b">
          <span className="text-xl font-bold text-primary">Relámpago</span>
          <button 
            onClick={() => setSidebarOpen(false)} 
            className="lg:hidden"
          >
            <X className="h-6 w-6" />
          </button>
        </div>

        <nav className="mt-6 px-4 space-y-2">
          {filteredNavItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition-colors",
                location.pathname === item.href
                  ? "bg-primary/10 text-primary"
                  : "text-gray-700 hover:bg-gray-100"
              )}
              onClick={() => setSidebarOpen(false)}
            >
              <item.icon className="h-5 w-5" />
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 w-full border-t p-4">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="flex flex-col">
              <span className="text-sm font-medium">{profile?.full_name || 'Usuario'}</span>
              <span className="text-xs text-gray-500 capitalize">{role}</span>
            </div>
          </div>
          <Button 
            variant="outline" 
            className="w-full justify-start gap-2" 
            onClick={handleSignOut}
          >
            <LogOut className="h-4 w-4" />
            Cerrar Sesión
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top Header (Mobile only mostly) */}
        <header className="flex h-16 items-center justify-between bg-white px-6 shadow-sm lg:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="h-6 w-6" />
          </button>
          <span className="font-semibold">Relámpago Courier</span>
          <div className="w-6" /> {/* Spacer */}
        </header>

        <main className="flex-1 overflow-y-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
