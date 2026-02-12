import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Truck, MapPin, Phone, User, Camera, Check } from 'lucide-react'
import { useAuth } from '../components/AuthProvider'

type Order = Database['public']['Tables']['orders']['Row']

export default function MyDeliveries() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (user) {
      fetchMyOrders()
    }
  }, [user])

  const fetchMyOrders = async () => {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('assigned_courier', user?.id)
        .in('status', ['pending', 'in_transit'])
        .order('created_at', { ascending: true })

      if (error) throw error
      setOrders(data || [])
    } catch (error) {
      console.error('Error fetching deliveries:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleStatusChange = async (orderId: string, newStatus: 'in_transit' | 'delivered') => {
    if (newStatus === 'delivered') {
      const order = orders.find(o => o.id === orderId)
      if (order) setSelectedOrder(order)
      return
    }

    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: newStatus })
        .eq('id', orderId)

      if (error) throw error
      fetchMyOrders()
    } catch (error) {
      console.error('Error updating status:', error)
    }
  }

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0 || !selectedOrder) return
    
    const file = event.target.files[0]
    const fileExt = file.name.split('.').pop()
    const fileName = `${selectedOrder.id}-${Math.random()}.${fileExt}`
    const filePath = `${fileName}`

    setUploading(true)
    try {
      const { error: uploadError } = await supabase.storage
        .from('proofs')
        .upload(filePath, file)

      if (uploadError) throw uploadError

      const { data: { publicUrl } } = supabase.storage
        .from('proofs')
        .getPublicUrl(filePath)

      const { error: deliveryError } = await supabase
        .from('deliveries')
        .insert({
          order_id: selectedOrder.id,
          courier_id: user!.id,
          proof_image_url: publicUrl,
          delivered_at: new Date().toISOString()
        })
      
      if (deliveryError) throw deliveryError

      const { error: updateError } = await supabase
        .from('orders')
        .update({ status: 'delivered' })
        .eq('id', selectedOrder.id)

      if (updateError) throw updateError

      setSelectedOrder(null)
      fetchMyOrders()
    } catch (error) {
      console.error('Error uploading proof:', error)
      alert('Error al subir la prueba de entrega. Asegúrate de que el bucket "proofs" exista y tengas permisos.')
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="space-y-6 max-w-md mx-auto">
      <h1 className="text-2xl font-bold">Mis Envíos</h1>

      {loading ? (
        <div className="text-center">Cargando...</div>
      ) : orders.length === 0 ? (
        <div className="text-center text-gray-500 py-10">
          <Truck className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No tienes envíos pendientes.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {orders.map(order => (
            <Card key={order.id} className="overflow-hidden">
              <div className={`h-2 w-full ${
                order.status === 'in_transit' ? 'bg-blue-500' : 'bg-yellow-500'
              }`} />
              <CardHeader className="pb-2">
                <div className="flex justify-between items-start">
                  <CardTitle className="text-lg">#{order.id.slice(0, 8)}</CardTitle>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${
                     order.status === 'in_transit' ? 'bg-blue-100 text-blue-800' : 'bg-yellow-100 text-yellow-800'
                  }`}>
                    {order.status === 'in_transit' ? 'En Ruta' : 'Pendiente'}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-start gap-2">
                  <User className="h-4 w-4 text-gray-500 mt-0.5" />
                  <span className="font-medium">{order.recipient_name}</span>
                </div>
                <div className="flex items-start gap-2">
                  <MapPin className="h-4 w-4 text-gray-500 mt-0.5" />
                  <span>{order.destination_address}</span>
                </div>
                <div className="flex items-start gap-2">
                  <Phone className="h-4 w-4 text-gray-500 mt-0.5" />
                  <a href={`tel:${order.recipient_phone}`} className="text-blue-600 underline">
                    {order.recipient_phone}
                  </a>
                </div>
              </CardContent>
              <CardFooter className="bg-gray-50 p-4 flex gap-2">
                {order.status === 'pending' && (
                  <Button 
                    className="w-full" 
                    onClick={() => handleStatusChange(order.id, 'in_transit')}
                  >
                    <Truck className="mr-2 h-4 w-4" /> Iniciar Ruta
                  </Button>
                )}
                {order.status === 'in_transit' && (
                  <Button 
                    className="w-full bg-green-600 hover:bg-green-700" 
                    onClick={() => handleStatusChange(order.id, 'delivered')}
                  >
                    <Check className="mr-2 h-4 w-4" /> Confirmar Entrega
                  </Button>
                )}
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Confirmar Entrega</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-gray-500">
                Sube una foto del paquete entregado o la firma del cliente para completar el pedido.
              </p>
              
              <div 
                className="border-2 border-dashed rounded-lg p-8 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                {uploading ? (
                   <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                ) : (
                  <>
                    <Camera className="h-10 w-10 text-gray-400 mb-2" />
                    <span className="text-sm font-medium text-gray-600">Tomar foto / Subir archivo</span>
                  </>
                )}
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  className="hidden" 
                  accept="image/*" 
                  capture="environment"
                  onChange={handleFileUpload}
                  disabled={uploading}
                />
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" onClick={() => setSelectedOrder(null)} disabled={uploading}>
                Cancelar
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  )
}
