import { OrderForm } from '../components/OrderForm'
import { Truck } from 'lucide-react'

export default function PublicOrderPage() {
  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-3xl mx-auto space-y-8">
        <div className="text-center">
          <div className="flex justify-center mb-4">
            <div className="bg-primary/10 p-4 rounded-full">
              <Truck className="h-12 w-12 text-primary" />
            </div>
          </div>
          <h1 className="text-4xl font-extrabold text-gray-900 tracking-tight">
            Relámpago Courier
          </h1>
          <p className="mt-2 text-lg text-gray-600">
            Registra tu pedido express de forma rápida y segura.
          </p>
        </div>

        <OrderForm />
        
        <div className="text-center text-sm text-gray-500 mt-8">
          &copy; {new Date().getFullYear()} Relámpago Courier. Todos los derechos reservados.
        </div>
      </div>
    </div>
  )
}
