import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { useAuth } from '../components/AuthProvider'

type StockItem = Database['public']['Tables']['stock']['Row']

export default function MyStock() {
  const { profile } = useAuth()
  const [stock, setStock] = useState<StockItem[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (profile?.company_id) {
      fetchStock(profile.company_id)
    } else {
      setLoading(false)
    }
  }, [profile])

  const fetchStock = async (companyId: string) => {
    try {
      const { data, error } = await supabase
        .from('stock')
        .select('*')
        .eq('company_id', companyId)
        .order('product_name', { ascending: true })

      if (error) throw error
      setStock(data || [])
    } catch (error) {
      console.error('Error fetching stock:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Mi Inventario</h1>

      <Card>
        <CardHeader>
          <CardTitle>Productos en Stock</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">Cargando inventario...</div>
          ) : !profile?.company_id ? (
            <div className="text-center py-4 text-red-500">No tienes una empresa asignada. Contacta a soporte.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">Cantidad Disponible</TableHead>
                  <TableHead className="text-right">Última Actualización</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {stock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={3} className="text-center">No hay productos en inventario.</TableCell>
                  </TableRow>
                ) : (
                  stock.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium">{item.product_name}</TableCell>
                      <TableCell className={`text-right ${item.quantity < 10 ? 'text-red-600 font-bold' : ''}`}>
                        {item.quantity}
                      </TableCell>
                      <TableCell className="text-right text-gray-500">
                        {new Date(item.updated_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
