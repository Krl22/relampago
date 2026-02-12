import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { supabase } from '../lib/supabase'
import type { Database } from '../types/database'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Label } from '../components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { Edit, Plus, Search, Loader2, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { es } from 'date-fns/locale'

type StockItem = Database['public']['Tables']['stock']['Row'] & {
  companies: { name: string } | null
}

type Company = Database['public']['Tables']['companies']['Row']

const stockSchema = z.object({
  company_id: z.string().min(1, "Selecciona una empresa"),
  product_name: z.string().min(2, "El nombre del producto es requerido"),
  quantity: z.coerce.number().min(0, "La cantidad debe ser mayor o igual a 0"),
  unit: z.string().optional(),
})

type StockFormValues = z.infer<typeof stockSchema>

export default function Stock() {
  const [stock, setStock] = useState<StockItem[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedCompanyId, setSelectedCompanyId] = useState<string>('all')
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [editingItem, setEditingItem] = useState<StockItem | null>(null)

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StockFormValues>({
    resolver: zodResolver(stockSchema) as any,
  })

  useEffect(() => {
    fetchStock()
    fetchCompanies()
  }, [])

  useEffect(() => {
    if (editingItem) {
      setValue('company_id', editingItem.company_id)
      setValue('product_name', editingItem.product_name)
      setValue('quantity', editingItem.quantity)
      setValue('unit', editingItem.unit || '')
    } else {
      reset({ company_id: '', product_name: '', quantity: 0, unit: '' })
    }
  }, [editingItem, setValue, reset])

  const fetchStock = async () => {
    try {
      const { data, error } = await supabase
        .from('stock')
        .select(`
          *,
          companies (name)
        `)
        .order('created_at', { ascending: false })

      if (error) throw error
      // @ts-ignore
      setStock(data || [])
    } catch (error) {
      console.error('Error fetching stock:', error)
    } finally {
      setLoading(false)
    }
  }

  const fetchCompanies = async () => {
    const { data } = await supabase.from('companies').select('*').order('name')
    if (data) setCompanies(data)
  }

  const onSubmit = async (data: StockFormValues) => {
    try {
      if (editingItem) {
        const { error } = await supabase
          .from('stock')
          .update(data)
          .eq('id', editingItem.id)
        if (error) throw error
      } else {
        const { error } = await supabase
          .from('stock')
          .insert(data)
        if (error) throw error
      }

      setIsDialogOpen(false)
      setEditingItem(null)
      fetchStock()
    } catch (error) {
      console.error('Error saving stock:', error)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este producto?')) return

    try {
      const { error } = await supabase.from('stock').delete().eq('id', id)
      if (error) throw error
      fetchStock()
    } catch (error) {
      console.error('Error deleting stock:', error)
    }
  }

  const filteredStock = stock.filter(item => {
    const matchesSearch = item.product_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (item.companies?.name && item.companies.name.toLowerCase().includes(searchTerm.toLowerCase()))
    
    const matchesCompany = selectedCompanyId === 'all' || item.company_id === selectedCompanyId

    return matchesSearch && matchesCompany
  })

  const openNewDialog = () => {
    setEditingItem(null)
    setIsDialogOpen(true)
  }

  const openEditDialog = (item: StockItem) => {
    setEditingItem(item)
    setIsDialogOpen(true)
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Inventario Global</h1>
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Nuevo Producto
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado de Productos</CardTitle>
          <div className="flex flex-col gap-4 md:flex-row md:items-center">
            <div className="relative max-w-sm flex-1">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar por producto..."
                className="pl-8"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
            <select
              className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:w-[250px]"
              value={selectedCompanyId}
              onChange={(e) => setSelectedCompanyId(e.target.value)}
            >
              <option value="all">Todas las empresas</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-center py-4">Cargando inventario...</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead>Cantidad</TableHead>
                  <TableHead>Unidad</TableHead>
                  <TableHead>Última Actualización</TableHead>
                  <TableHead className="text-right">Acciones</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredStock.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center">No se encontraron productos.</TableCell>
                  </TableRow>
                ) : (
                  filteredStock.map((item) => (
                    <TableRow key={item.id}>
                      <TableCell className="font-medium text-blue-600">
                        {item.companies?.name || 'Sin asignar'}
                      </TableCell>
                      <TableCell>{item.product_name}</TableCell>
                      <TableCell className="font-bold">{item.quantity}</TableCell>
                      <TableCell>{item.unit || '-'}</TableCell>
                      <TableCell>{format(new Date(item.created_at), 'dd/MM/yyyy', { locale: es })}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" onClick={() => openEditDialog(item)}>
                          <Edit className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={() => handleDelete(item.id)}>
                          <Trash2 className="h-4 w-4" />
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingItem ? 'Editar Producto' : 'Nuevo Producto'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company_id">Empresa</Label>
              <select
                id="company_id"
                {...register('company_id')}
                className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!!editingItem} // Opcional: bloquear cambio de empresa al editar
              >
                <option value="">Seleccionar empresa...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {errors.company_id && <span className="text-sm text-destructive">{errors.company_id.message}</span>}
            </div>

            <div className="space-y-2">
              <Label htmlFor="product_name">Nombre del Producto</Label>
              <Input id="product_name" {...register('product_name')} placeholder="Ej. Zapatillas Nike Talla 42" />
              {errors.product_name && <span className="text-sm text-destructive">{errors.product_name.message}</span>}
            </div>
            
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantity">Cantidad</Label>
                <Input id="quantity" type="number" {...register('quantity')} />
                {errors.quantity && <span className="text-sm text-destructive">{errors.quantity.message}</span>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unidad (Opcional)</Label>
                <Input id="unit" {...register('unit')} placeholder="Ej. cajas, unidades" />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {editingItem ? 'Guardar Cambios' : 'Agregar Stock'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
