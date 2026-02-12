import { useAuth } from '../components/AuthProvider'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Truck, CheckCircle, Clock, Copy, ExternalLink, Loader2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'

export default function Dashboard() {
  const { profile } = useAuth()
  const [copied, setCopied] = useState(false)
  const [stats, setStats] = useState({
    pending: 0,
    in_transit: 0,
    delivered: 0,
    courier_pending: 0
  })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchStats()
  }, [profile])

  const fetchStats = async () => {
    try {
      if (profile?.role === 'courier') {
        const { count } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .eq('assigned_courier', profile.id)
          .in('status', ['pending', 'in_transit'])
        
        setStats(prev => ({ ...prev, courier_pending: count || 0 }))
      } else {
        // Admin/Staff Stats
        const { data } = await supabase
          .from('orders')
          .select('status')
        
        if (data) {
          const pending = data.filter(o => o.status === 'pending').length
          const in_transit = data.filter(o => o.status === 'in_transit').length
          const delivered = data.filter(o => o.status === 'delivered').length // TODO: Filtrar por fecha "hoy" si se desea
          setStats({ pending, in_transit, delivered, courier_pending: 0 })
        }
      }
    } catch (error) {
      console.error('Error fetching stats:', error)
    } finally {
      setLoading(false)
    }
  }

  const copyPublicLink = () => {
    const url = `${window.location.origin}/pedido-express`
    navigator.clipboard.writeText(url)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (profile?.role === 'courier') {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Bienvenido, {profile.full_name}</h1>
        <p className="text-gray-500">Aquí están tus tareas para hoy.</p>
        
        <div className="grid gap-4 md:grid-cols-2">
           <Card>
             <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
               <CardTitle className="text-sm font-medium">Envíos Pendientes</CardTitle>
               <Truck className="h-4 w-4 text-muted-foreground" />
             </CardHeader>
             <CardContent>
               <div className="text-2xl font-bold">
                 {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.courier_pending}
               </div>
               <p className="text-xs text-muted-foreground">Asignados a ti</p>
             </CardContent>
           </Card>
        </div>
      </div>
    )
  }

  if (profile?.role === 'client') {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Bienvenido</h1>
        <p>Gestiona tu stock desde el menú.</p>
      </div>
    )
  }

  // Admin and Staff
  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold">Dashboard</h1>
        
        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="p-4 flex items-center gap-4">
            <div className="text-sm">
              <p className="font-medium">Formulario Público de Pedidos</p>
              <p className="text-xs text-muted-foreground">Comparte este link con tus clientes</p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={copyPublicLink}>
                {copied ? <CheckCircle className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? 'Copiado' : 'Copiar Link'}
              </Button>
              <Link to="/pedido-express" target="_blank">
                <Button size="icon" variant="ghost">
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
      
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pedidos Pendientes</CardTitle>
            <Clock className="h-4 w-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.pending}
            </div>
            <p className="text-xs text-muted-foreground">Por procesar</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">En Ruta</CardTitle>
            <Truck className="h-4 w-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.in_transit}
            </div>
            <p className="text-xs text-muted-foreground">En camino a entrega</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Entregados (Hoy)</CardTitle>
            <CheckCircle className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? <Loader2 className="h-6 w-6 animate-spin" /> : stats.delivered}
            </div>
            <p className="text-xs text-muted-foreground">Misión cumplida</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Resumen Reciente</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500">No hay datos recientes.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
