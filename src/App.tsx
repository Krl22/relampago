import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './components/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
import { CourierTrackingProvider } from './components/CourierTrackingProvider'
import { ImpersonationBanner } from './components/ImpersonationBanner'
import Login from './pages/Login'
import AppLayout from './components/AppLayout'
import Dashboard from './pages/Dashboard'
import Orders from './pages/Orders'
import MyDeliveries from './pages/MyDeliveries'
import MyStock from './pages/MyStock'
import PublicOrderPage from './pages/PublicOrderPage'
import Companies from './pages/Companies'
import Stock from './pages/Stock'
import Couriers from './pages/Couriers'
import CourierMap from './pages/CourierMap'
import MyRoute from './pages/MyRoute'
import Pickups from './pages/Pickups'
import Settlements from './pages/Settlements'
import { ClientCompanyGate } from './components/ClientCompanyGate'
import MyOrders from './pages/client/MyOrders'
import NewOrder from './pages/client/NewOrder'
import BulkOrders from './pages/client/BulkOrders'
import MySettlements from './pages/client/MySettlements'
import MyCompany from './pages/client/MyCompany'
import Coverage from './pages/Coverage'
import { loadDistricts } from './lib/districts'

// Los formularios usan la lista de distritos: se carga apenas abre la app
void loadDistricts().catch(() => undefined)

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <CourierTrackingProvider>
        <ImpersonationBanner />
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/pedido-express" element={<PublicOrderPage />} />
          <Route path="/cobertura" element={<Coverage standalone />} />
          
          <Route element={<ProtectedRoute />}>
            {/* Pantalla completa (sin sidebar) para el motorizado en ruta */}
            <Route element={<ProtectedRoute allowedRoles={['courier', 'admin', 'staff']} />}>
              <Route path="/mi-ruta" element={<MyRoute />} />
            </Route>

            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tarifario" element={<Coverage />} />
              
              {/* Admin & Staff Routes */}
              <Route element={<ProtectedRoute allowedRoles={['admin', 'staff']} />}>
                <Route path="/orders" element={<Orders />} />
                <Route path="/comercios" element={<Companies />} />
                <Route path="/companies" element={<Navigate to="/comercios" replace />} />
                <Route path="/couriers" element={<Couriers />} />
                <Route path="/stock" element={<Stock />} />
                <Route path="/mapa" element={<CourierMap />} />
                <Route path="/recojos" element={<Pickups />} />
                <Route path="/liquidaciones" element={<Settlements />} />
              </Route>

              {/* Courier Routes (admin/staff que también reparten entran aquí) */}
              <Route element={<ProtectedRoute allowedRoles={['courier', 'admin', 'staff']} />}>
                <Route path="/my-deliveries" element={<MyDeliveries />} />
              </Route>

              {/* Portal del comercio (necesita una empresa vinculada) */}
              <Route element={<ProtectedRoute allowedRoles={['client']} />}>
                <Route element={<ClientCompanyGate />}>
                  <Route path="/mis-pedidos" element={<MyOrders />} />
                  <Route path="/nuevo-pedido" element={<NewOrder />} />
                  <Route path="/carga-masiva" element={<BulkOrders />} />
                  <Route path="/mis-direcciones" element={<Navigate to="/mi-comercio" replace />} />
                  <Route path="/my-stock" element={<MyStock />} />
                  <Route path="/mis-liquidaciones" element={<MySettlements />} />
                  <Route path="/mi-comercio" element={<MyCompany />} />
                </Route>
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </CourierTrackingProvider>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
