import { useEffect, useState, useRef } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Truck, MapPin, Phone, User, Camera, Check, Image as ImageIcon } from 'lucide-react'
import { useAuth } from '../components/AuthProvider'

type Order = Database['public']['Tables']['orders']['Row']

export default function MyDeliveries() {
  const { user } = useAuth()
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const cameraInputRef = useRef<HTMLInputElement>(null)
  const galleryInputRef = useRef<HTMLInputElement>(null)

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

      // Use upsert or insert for delivery proof
      const { error: deliveryError } = await supabase
        .from('deliveries')
        .insert({
          order_id: selectedOrder.id,
          courier_id: user!.id,
          proof_image_url: publicUrl,
          delivered_at: new Date().toISOString()
        })
      
      if (deliveryError) throw deliveryError

      // Update order status
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

  const handlePaymentMethodChange = async (orderId: string, method: string) => {
    try {
        const { error } = await supabase
            .from('orders')
            .update({ payment_method: method })
            .eq('id', orderId)

        if (error) throw error
        
        // Optimistic update locally
        setOrders(prev => prev.map(o => o.id === orderId ? { ...o, payment_method: method } : o))
    } catch (error) {
        console.error('Error updating payment method:', error)
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
                
                <div className="pt-2 border-t mt-2">
                  <label className="text-xs font-medium text-gray-500 mb-1 block">Método de Pago</label>
                  <select 
                    className="w-full text-sm border rounded p-1 bg-white"
                    value={order.payment_method || ''}
                    onChange={(e) => handlePaymentMethodChange(order.id, e.target.value)}
                  >
                    <option value="">Seleccionar...</option>
                    <option value="Motorizado">Motorizado</option>
                    <option value="Directo a comercio">Directo a comercio</option>
                    <option value="Relampago Courier">Relampago Courier</option>
                  </select>
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
              <p className="text-sm text-gray-500 text-center">
                Selecciona una opción para subir la prueba de entrega.
              </p>
              
              {uploading ? (
                <div className="flex justify-center py-8">
                  <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div 
                    className="border-2 border-dashed border-blue-200 bg-blue-50 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-blue-100 transition-colors gap-2"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="h-8 w-8 text-blue-600" />
                    <span className="text-sm font-medium text-blue-800 text-center">Tomar Foto</span>
                  </div>

                  <div 
                    className="border-2 border-dashed border-gray-200 bg-gray-50 rounded-lg p-6 flex flex-col items-center justify-center cursor-pointer hover:bg-gray-100 transition-colors gap-2"
                    onClick={() => galleryInputRef.current?.click()}
                  >
                    <ImageIcon className="h-8 w-8 text-gray-600" />
                    <span className="text-sm font-medium text-gray-800 text-center">Subir de Galería</span>
                  </div>
                </div>
              )}

              {/* Hidden Inputs */}
              <input 
                type="file" 
                ref={cameraInputRef} 
                className="hidden" 
                accept="image/*" 
                capture="environment"
                onChange={handleFileUpload}
                disabled={uploading}
              />
              <input 
                type="file" 
                ref={galleryInputRef} 
                className="hidden" 
                accept="image/*" 
                onChange={handleFileUpload}
                disabled={uploading}
              />
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
