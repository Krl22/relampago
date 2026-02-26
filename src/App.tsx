import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './components/AuthProvider'
import { ProtectedRoute } from './components/ProtectedRoute'
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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />
          <Route path="/pedido-express" element={<PublicOrderPage />} />
          
          <Route element={<ProtectedRoute />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Dashboard />} />
              
              {/* Admin & Staff Routes */}
              <Route element={<ProtectedRoute allowedRoles={['admin', 'staff']} />}>
                <Route path="/orders" element={<Orders />} />
                <Route path="/companies" element={<Companies />} />
                <Route path="/couriers" element={<Couriers />} />
                <Route path="/stock" element={<Stock />} />
              </Route>

              {/* Courier Routes */}
              <Route element={<ProtectedRoute allowedRoles={['courier']} />}>
                <Route path="/my-deliveries" element={<MyDeliveries />} />
              </Route>

              {/* Client Routes */}
              <Route element={<ProtectedRoute allowedRoles={['client']} />}>
                <Route path="/my-stock" element={<MyStock />} />
              </Route>
            </Route>
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}

export default App
