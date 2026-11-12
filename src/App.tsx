import { lazy, Suspense } from "react";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider } from "./components/AuthProvider";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { CourierTrackingProvider } from "./components/CourierTrackingProvider";
import { ImpersonationBanner } from "./components/ImpersonationBanner";
const Login = lazy(() => import("./pages/Login"));
const ActivateAccount = lazy(() => import("./pages/ActivateAccount"));
import AppLayout from "./components/AppLayout";
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Orders = lazy(() => import("./pages/Orders"));
const MyDeliveries = lazy(() => import("./pages/MyDeliveries"));
const MyPickups = lazy(() => import("./pages/MyPickups"));
const MyStock = lazy(() => import("./pages/MyStock"));
const PublicOrderPage = lazy(() => import("./pages/PublicOrderPage"));
const Companies = lazy(() => import("./pages/Companies"));
const CompanyRecordPage = lazy(() => import("./pages/CompanyRecordPage"));
const CourierRecordPage = lazy(() => import("./pages/CourierRecordPage"));
const Stock = lazy(() => import("./pages/Stock"));
const Couriers = lazy(() => import("./pages/Couriers"));
const CourierMap = lazy(() => import("./pages/CourierMap"));
const MyRoute = lazy(() => import("./pages/MyRoute"));
const Pickups = lazy(() => import("./pages/Pickups"));
const Settlements = lazy(() => import("./pages/Settlements"));
import { ClientCompanyGate } from "./components/ClientCompanyGate";
const MyOrders = lazy(() => import("./pages/client/MyOrders"));
const NewOrder = lazy(() => import("./pages/client/NewOrder"));
const BulkOrders = lazy(() => import("./pages/client/BulkOrders"));
const MySettlements = lazy(() => import("./pages/client/MySettlements"));
const MyCompany = lazy(() => import("./pages/client/MyCompany"));
const Coverage = lazy(() => import("./pages/Coverage"));
const EnterpriseChat = lazy(() => import("./pages/EnterpriseChat"));
import { loadDistricts } from "./lib/districts";
import { DesignProvider } from "./components/design/DesignProvider";
import { AppearanceBar } from "./components/design/AppearanceBar";
import { PageLoading } from "./components/design/PageLoading";
import { PageBoundary } from "./components/design/PageBoundary";
import "./lightning.css";

// Los formularios usan la lista de distritos: se carga apenas abre la app
void loadDistricts().catch(() => undefined);

function App() {
  return (
    <BrowserRouter>
      <DesignProvider>
        <AuthProvider>
          <CourierTrackingProvider>
            <ImpersonationBanner />
            <PageBoundary>
              <Suspense fallback={<PageLoading />}>
                <Routes>
                  {/* Public Routes */}
                  <Route
                    path="/login"
                    element={
                      <>
                        <AppearanceBar />
                        <Login />
                      </>
                    }
                  />
                  <Route
                    path="/activar-cuenta"
                    element={
                      <>
                        <AppearanceBar />
                        <ActivateAccount />
                      </>
                    }
                  />
                  <Route
                    path="/pedido-express"
                    element={
                      <>
                        <AppearanceBar />
                        <PublicOrderPage />
                      </>
                    }
                  />
                  <Route
                    path="/cobertura"
                    element={
                      <>
                        <AppearanceBar />
                        <Coverage standalone />
                      </>
                    }
                  />

                  <Route element={<ProtectedRoute />}>
                    {/* Pantalla completa (sin sidebar) para el motorizado en ruta */}
                    <Route
                      element={<ProtectedRoute allowedRoles={["courier"]} />}
                    >
                      <Route path="/mi-ruta" element={<MyRoute />} />
                    </Route>

                    <Route element={<AppLayout />}>
                      <Route
                        element={<ProtectedRoute allowedRoles={["admin"]} />}
                      >
                        <Route path="/asistente" element={<EnterpriseChat />} />
                        <Route
                          path="/comercios/:companyId"
                          element={<CompanyRecordPage />}
                        />
                        <Route
                          path="/couriers/:courierId"
                          element={<CourierRecordPage />}
                        />
                      </Route>
                      <Route path="/" element={<Dashboard />} />
                      <Route
                        element={
                          <ProtectedRoute
                            allowedRoles={["admin", "staff", "client"]}
                          />
                        }
                      >
                        <Route path="/tarifario" element={<Coverage />} />
                      </Route>

                      {/* Admin & Staff Routes */}
                      <Route
                        element={
                          <ProtectedRoute allowedRoles={["admin", "staff"]} />
                        }
                      >
                        <Route path="/orders" element={<Orders />} />
                        <Route path="/comercios" element={<Companies />} />
                        <Route
                          path="/companies"
                          element={<Navigate to="/comercios" replace />}
                        />
                        <Route path="/couriers" element={<Couriers />} />
                        <Route path="/stock" element={<Stock />} />
                        <Route path="/mapa" element={<CourierMap />} />
                        <Route path="/recojos" element={<Pickups />} />
                        <Route
                          path="/liquidaciones"
                          element={<Settlements />}
                        />
                      </Route>

                      {/* El reparto usa cuentas independientes de motorizado. */}
                      <Route
                        element={<ProtectedRoute allowedRoles={["courier"]} />}
                      >
                        <Route
                          path="/my-deliveries"
                          element={<MyDeliveries />}
                        />
                        <Route path="/my-pickups" element={<MyPickups />} />
                      </Route>

                      {/* Portal del comercio (necesita una empresa vinculada) */}
                      <Route
                        element={<ProtectedRoute allowedRoles={["client"]} />}
                      >
                        <Route element={<ClientCompanyGate />}>
                          <Route path="/mis-pedidos" element={<MyOrders />} />
                          <Route path="/nuevo-pedido" element={<NewOrder />} />
                          <Route
                            path="/carga-masiva"
                            element={<BulkOrders />}
                          />
                          <Route
                            path="/mis-direcciones"
                            element={<Navigate to="/mi-comercio" replace />}
                          />
                          <Route path="/my-stock" element={<MyStock />} />
                          <Route
                            path="/mis-liquidaciones"
                            element={<MySettlements />}
                          />
                          <Route path="/mi-comercio" element={<MyCompany />} />
                        </Route>
                      </Route>
                    </Route>
                  </Route>

                  <Route path="*" element={<Navigate to="/" replace />} />
                </Routes>
              </Suspense>
            </PageBoundary>
          </CourierTrackingProvider>
        </AuthProvider>
      </DesignProvider>
    </BrowserRouter>
  );
}

export default App;
