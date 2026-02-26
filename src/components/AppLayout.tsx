import { useState, useEffect } from 'react'
import { Outlet, Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from './AuthProvider'
import { supabase } from '../lib/supabase'
import { 
  LayoutDashboard, 
  Package, 
  Truck, 
  Boxes, 
  LogOut, 
  Menu, 
  X,
  Building2,
  Users,
  Zap
} from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'

export default function AppLayout() {
  const { profile, signOut } = useAuth()
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [counts, setCounts] = useState({
    orders: 0,
    companies: 0,
    couriers: 0,
    stock: 0
  })
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    if (profile?.role === 'admin' || profile?.role === 'staff') {
      fetchCounts()
    }
  }, [profile, location.pathname]) // Re-fetch on navigation to keep updated

  const fetchCounts = async () => {
    try {
      const [ordersRes, companiesRes, couriersRes, stockRes] = await Promise.all([
        supabase.from('orders').select('*', { count: 'exact', head: true }),
        supabase.from('companies').select('*', { count: 'exact', head: true }),
        supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('role', 'courier'),
        supabase.from('stock').select('*', { count: 'exact', head: true })
      ])

      setCounts({
        orders: ordersRes.count || 0,
        companies: companiesRes.count || 0,
        couriers: couriersRes.count || 0,
        stock: stockRes.count || 0
      })
    } catch (error) {
      console.error('Error fetching counts:', error)
    }
  }

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
      count: counts.orders
    },
    {
      label: 'Empresas',
      href: '/companies',
      icon: Building2,
      roles: ['admin', 'staff'],
      count: counts.companies
    },
    {
      label: 'Motorizados',
      href: '/couriers',
      icon: Users,
      roles: ['admin', 'staff'],
      count: counts.couriers
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
      count: counts.stock
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
          "fixed inset-y-0 left-0 z-50 w-64 transform bg-primary text-primary-foreground shadow-xl transition-transform duration-200 ease-in-out lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-20 items-center px-6 border-b border-white/10">
          <div className="flex items-center gap-2">
            <div className="p-2 bg-white/10 rounded-full">
              <Zap className="h-6 w-6 text-accent fill-accent" />
            </div>
            <span className="text-xl font-bold tracking-tight">Relámpago</span>
          </div>
          <button 
            onClick={() => setSidebarOpen(false)} 
            className="lg:hidden ml-auto text-white/80 hover:text-white"
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
                "flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200",
                location.pathname === item.href
                  ? "bg-white text-primary shadow-md translate-x-1"
                  : "text-white/80 hover:bg-white/10 hover:text-white hover:translate-x-1"
              )}
              onClick={() => setSidebarOpen(false)}
            >
              <div className="flex items-center gap-3">
                <item.icon className={cn("h-5 w-5", location.pathname === item.href ? "text-primary" : "text-white/70")} />
                {item.label}
              </div>
              {item.count !== undefined && (
                <span className={cn(
                  "text-xs px-2 py-0.5 rounded-full font-bold",
                  location.pathname === item.href 
                    ? "bg-primary/10 text-primary" 
                    : "bg-white/20 text-white"
                )}>
                  {item.count}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 w-full p-4 border-t border-white/10 bg-black/5">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="h-10 w-10 rounded-full bg-accent/20 flex items-center justify-center border-2 border-accent">
              <span className="text-accent font-bold text-lg">{profile?.full_name?.[0] || 'U'}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white">{profile?.full_name || 'Usuario'}</span>
              <span className="text-xs text-white/60 capitalize">{role}</span>
            </div>
          </div>
          <Button 
            variant="ghost" 
            className="w-full justify-start gap-2 text-white/80 hover:text-white hover:bg-white/10" 
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
