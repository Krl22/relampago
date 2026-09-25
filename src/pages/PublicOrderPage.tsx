import { useEffect, useState } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { OrderForm } from '../components/OrderForm'
import { CutoffNotice } from '../components/CutoffNotice'
import { useAuth } from '../components/AuthProvider'
import { Button } from '../components/ui/button'
import { supabase } from '../lib/supabase'
import { LogIn, Truck } from 'lucide-react'

/**
 * Formulario público de pedidos (sin cuenta). Se usa mientras los comercios reciben su cuenta;
 * cuando la central lo cierra desde el Dashboard, esta página solo indica cómo ingresar.
 */
export default function PublicOrderPage() {
  const [params] = useSearchParams()
  const token = params.get('c')
  const { user, profile, loading } = useAuth()
  const [open, setOpen] = useState<boolean | null>(null)

  useEffect(() => {
    supabase.rpc('public_form_open').then(({ data, error }) => setOpen(error ? true : data !== false))
  }, [])

  // Un comercio con cuenta siempre pide desde su portal
  if (!loading && user && profile?.role === 'client' && profile.company_id) return <Navigate to="/nuevo-pedido" replace />

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-4 rounded-full">
              <Truck className="h-12 w-12 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            Relámpago Courier
          </h1>
        </div>

        {open === null ? (
          <div className="py-10 text-center text-sm text-gray-500">Cargando…</div>
        ) : open ? (
          <>
            <CutoffNotice />
            {!token && !user && (
              <div className="rounded-lg border bg-white p-3 text-center text-sm text-gray-700">
                ¿Ya tienes cuenta?{' '}
                <Link to="/login" className="font-medium text-primary underline">Ingresa</Link>
                {' '}y registra tus pedidos desde tu portal.
              </div>
            )}
            <OrderForm intakeToken={token} />
          </>
        ) : (
          <div className="rounded-lg border bg-white p-8 text-center space-y-4">
            <h2 className="text-xl font-bold text-gray-900">Ahora los pedidos se registran desde tu cuenta</h2>
            <p className="text-gray-600">
              Ingresa al portal de Relámpago Courier para registrar tus envíos, ver su estado y tus liquidaciones.
              Si aún no tienes acceso, pídelo a Relámpago y te creamos tu cuenta.
            </p>
            <Button asChild size="lg">
              <Link to="/login"><LogIn className="mr-2 h-4 w-4" /> Ingresar</Link>
            </Button>
          </div>
        )}

        <div className="text-center text-sm text-gray-500 mt-8">
          &copy; {new Date().getFullYear()} Relámpago Courier. Todos los derechos reservados.
        </div>
      </div>
    </div>
  )
}
