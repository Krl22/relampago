import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Label } from '../components/ui/label'
import { Textarea } from '../components/ui/textarea'
import { Edit, Loader2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

type Order = Database['public']['Tables']['orders']['Row'] & {
  companies: { name: string } | null
  assigned_courier_profile: { full_name: string | null } | null
}

type Profile = Database['public']['Tables']['profiles']['Row']

const orderSchema = z.object({
  assigned_courier: z.string().nullable(),
  status: z.enum(['pending', 'in_transit', 'delivered']),
  payment_method: z.string().optional(),
  tariff: z.string().optional(),
  total_amount: z.coerce.number().min(0).optional(),
  delivery_notes: z.string().optional(),
})

type OrderFormValues = z.infer<typeof orderSchema>

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([])
  const [couriers, setCouriers] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState<Order | null>(null)

  const {
    register,
    handleSubmit,
    setValue,
    formState: { isSubmitting },
  } = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema) as any,
  })

  useEffect(() => {
    fetchOrders()
    fetchCouriers()
  }, [])

  useEffect(() => {
    if (editingOrder) {
      setValue('assigned_courier', editingOrder.assigned_courier || '')
      setValue('status', editingOrder.status)
      setValue('payment_method', editingOrder.payment_method || '')
      setValue('tariff', editingOrder.tariff || '')
      setValue('total_amount', editingOrder.total_amount || 0)
      setValue('delivery_notes', editingOrder.delivery_notes || '')
    }
  }, [editingOrder, setValue])

  const fetchCouriers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .eq('role', 'courier')
    if (data) setCouriers(data)
  }

  const fetchOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          companies (name),
          assigned_courier_profile:profiles!assigned_courier (full_name)
        `)
        .order('created_at', { ascending: false })

      if (error) {
        console.error('Error fetching orders:', error)
      } else {
        // @ts-ignore
        setOrders(data || [])
      }
    } catch (error) {
      console.error('Unexpected error:', error)
    } finally {
      setLoading(false)
    }
  }

  const onUpdateOrder = async (data: OrderFormValues) => {
    if (!editingOrder) return

    try {
      const { error } = await supabase
        .from('orders')
        .update({
          assigned_courier: data.assigned_courier || null,
          status: data.status,
          payment_method: data.payment_method || null,
          tariff: data.tariff || null,
          total_amount: data.total_amount || null,
          delivery_notes: data.delivery_notes || null,
        })
        .eq('id', editingOrder.id)

      if (error) throw error

      setIsDialogOpen(false)
      setEditingOrder(null)
      fetchOrders()
    } catch (error) {
      console.error('Error updating order:', error)
    }
  }

  const openEditDialog = (order: Order) => {
    setEditingOrder(order)
    setIsDialogOpen(true)
  }

  const filteredOrders = orders.filter(order => {
    const matchesStatus = filterStatus === 'all' || order.status === filterStatus
    const matchesSearch = 
      order.recipient_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      order.id.toLowerCase().includes(searchTerm.toLowerCase())
    return matchesStatus && matchesSearch
  })

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Pedidos</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gestión de Pedidos</CardTitle>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
             <Input 
               placeholder="Buscar por ID o Destinatario..." 
               value={searchTerm}
               onChange={(e) => setSearchTerm(e.target.value)}
               className="max-w-sm"
             />
             <select 
               className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:w-[200px]"
               value={filterStatus}
               onChange={(e) => setFilterStatus(e.target.value)}
             >
               <option value="all">Todos los estados</option>
               <option value="pending">Pendiente</option>
               <option value="in_transit">En Ruta</option>
               <option value="delivered">Entregado</option>
             </select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">Cargando pedidos...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Destinatario</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Repartidor Asignado</TableHead>
                  <TableHead>Tarifa</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center">No se encontraron pedidos.</TableCell>
                  </TableRow>
                ) : (
                  filteredOrders.map((order) => (
                    <TableRow key={order.id}>
                      <TableCell className="font-mono text-xs">{order.id.slice(0, 8)}...</TableCell>
                      <TableCell>{order.companies?.name || 'N/A'}</TableCell>
                      <TableCell>{order.recipient_name}</TableCell>
                      <TableCell>
                        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                          order.status === 'delivered' ? 'bg-green-100 text-green-800' :
                          order.status === 'in_transit' ? 'bg-blue-100 text-blue-800' :
                          'bg-yellow-100 text-yellow-800'
                        }`}>
                          {order.status === 'delivered' ? 'Entregado' :
                           order.status === 'in_transit' ? 'En Ruta' : 'Pendiente'}
                        </span>
                      </TableCell>
                      <TableCell>{order.assigned_courier_profile?.full_name || 'Sin asignar'}</TableCell>
                      <TableCell>{order.tariff || '-'}</TableCell>
                      <TableCell>{format(new Date(order.created_at), 'dd/MM/yyyy HH:mm', { locale: es })}</TableCell>
                      <TableCell className="text-right">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(order)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Gestionar Pedido #{editingOrder?.id.slice(0, 8)}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onUpdateOrder)} className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="assigned_courier">Asignar Motorizado</Label>
                <select
                  id="assigned_courier"
                  {...register('assigned_courier')}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Sin asignar</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>{c.full_name}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Estado del Pedido</Label>
                <select
                  id="status"
                  {...register('status')}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_transit">En Ruta</option>
                  <option value="delivered">Entregado</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tariff">Tarifa</Label>
                <select
                  id="tariff"
                  {...register('tariff')}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Seleccionar...</option>
                  <option value="T1">Tarifa 1 (T1)</option>
                  <option value="T2">Tarifa 2 (T2)</option>
                  <option value="T3">Tarifa 3 (T3)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_amount">Monto Total (Servicio)</Label>
                <Input id="total_amount" type="number" step="0.01" {...register('total_amount')} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment_method">Método de Pago</Label>
                <select
                  id="payment_method"
                  {...register('payment_method')}
                  className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Seleccionar...</option>
                  <option value="Motorizado">Motorizado</option>
                  <option value="Directo a comercio">Directo a comercio</option>
                  <option value="Relampago Courier">Relampago Courier</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery_notes">Notas de Logística</Label>
              <Textarea 
                id="delivery_notes" 
                {...register('delivery_notes')} 
                placeholder="Instrucciones internas, observaciones de entrega..." 
              />
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar Cambios
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
