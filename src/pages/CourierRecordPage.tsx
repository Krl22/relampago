import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { ArrowLeft, MapPin, RefreshCw, Truck } from "lucide-react";
import { supabase } from "../lib/supabase";
import {
  COURIER_FIELDS,
  validCourierId,
  type CourierRecord,
} from "../lib/courierRecord";
import { recordDate } from "../lib/companyRecord";
import { ACTIVE_STATUSES } from "../lib/orderMeta";
import type { Database } from "../types/database";
import { RecordHeader } from "../components/design/RecordHeader";
import { RecordLayout } from "../components/design/RecordLayout";
import { MetricStrip } from "../components/design/MetricStrip";
import { RecordTabs } from "../components/design/RecordTabs";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { StatusBadge } from "../components/OrderBadges";
import {
  CourierOrderList,
  RecordField,
} from "../components/company-record/CompanyRelatedList";
import { CourierPickups } from "../components/courier-record/CourierPickups";
import {
  CourierActivity,
  CourierLocation,
} from "../components/courier-record/CourierRecordInfo";
import { ViewAsButton } from "../components/ViewAsButton";

const tabs = [
  { id: "overview", label: "Resumen" },
  { id: "details", label: "Datos" },
  { id: "orders", label: "Envíos" },
  { id: "pickups", label: "Recojos" },
  { id: "location", label: "Ubicación" },
  { id: "activity", label: "Actividad" },
] as const;
type Tab = (typeof tabs)[number]["id"];
type Recent = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_number" | "recipient_name" | "status" | "scheduled_date"
> & { company: { id: string; name: string } | null };
type Snapshot = {
  courier: CourierRecord | null;
  error: string | null;
  counts: (number | null)[];
  recent: Recent[];
  recentError: boolean;
};

export default function CourierRecordPage() {
  const { courierId = "" } = useParams();
  if (!validCourierId(courierId))
    return (
      <div role="alert" className="space-y-3 rounded-lg border bg-white p-6">
        <h1 className="text-xl font-semibold">El motorizado no es válido</h1>
        <Link className="text-primary underline" to="/couriers">
          Volver a motorizados
        </Link>
      </div>
    );
  return <CourierRecordContent key={courierId} courierId={courierId} />;
}

function CourierRecordContent({ courierId }: { courierId: string }) {
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const requested = params.get("tab");
  const tab: Tab = tabs.some((option) => option.id === requested)
    ? (requested as Tab)
    : "overview";
  const [visited, setVisited] = useState<Set<Tab>>(() => new Set([tab]));
  const [refresh, setRefresh] = useState(0);
  const [result, setResult] = useState<{ key: string; data: Snapshot } | null>(
    null,
  );
  const key = `${courierId}:${refresh}`;
  const current = result?.data ?? null;
  const refreshing = result?.key !== key;
  const selectTab = (next: Tab) => {
    setVisited((previous) => new Set([...previous, next]));
    setParams(
      (previous) => {
        const updated = new URLSearchParams(previous);
        updated.set("tab", next);
        return updated;
      },
      { replace: true },
    );
  };
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [courier, active, delivered, pickups, total, recent] =
          await Promise.all([
            supabase
              .from("profiles")
              .select(COURIER_FIELDS)
              .eq("id", courierId)
              .eq("role", "courier")
              .maybeSingle(),
            supabase
              .from("orders")
              .select("id", { head: true, count: "exact" })
              .eq("assigned_courier", courierId)
              .in("status", ACTIVE_STATUSES),
            supabase
              .from("orders")
              .select("id", { head: true, count: "exact" })
              .eq("assigned_courier", courierId)
              .eq("status", "delivered"),
            supabase
              .from("pickup_assignments")
              .select("pickup_id,pickup:pickups!inner(status)", {
                head: true,
                count: "exact",
              })
              .eq("courier_id", courierId)
              .in("pickup.status", ["pending", "assigned"]),
            supabase
              .from("pickup_assignments")
              .select("pickup_id", { head: true, count: "exact" })
              .eq("courier_id", courierId),
            supabase
              .from("orders")
              .select(
                "id,order_number,recipient_name,status,scheduled_date,company:companies(id,name)",
              )
              .eq("assigned_courier", courierId)
              .order("created_at", { ascending: false })
              .order("id", { ascending: false })
              .limit(5),
          ]);
        if (alive)
          setResult({
            key,
            data: {
              courier: courier.data,
              error: courier.error?.message ?? null,
              counts: [active, delivered, pickups, total].map((response) =>
                response.error ? null : (response.count ?? 0),
              ),
              recent: (recent.data ?? []) as Recent[],
              recentError: !!recent.error,
            },
          });
      } catch (error) {
        if (alive)
          setResult({
            key,
            data: {
              courier: null,
              error:
                error instanceof Error
                  ? error.message
                  : "No se pudo cargar el motorizado.",
              counts: [],
              recent: [],
              recentError: true,
            },
          });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [courierId, refresh, key]);
  const backState = (location.state as { courierList?: unknown } | null)
    ?.courierList;
  const back = (
    <Link
      to="/couriers"
      state={{ courierList: backState }}
      className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
    >
      <ArrowLeft className="h-4 w-4" />
      Motorizados
    </Link>
  );
  if (!current)
    return (
      <div className="space-y-4">
        {back}
        <p
          role="status"
          className="rounded-lg border bg-white p-6 text-sm text-muted-foreground"
        >
          Cargando ficha del motorizado…
        </p>
      </div>
    );
  if (current.error || !current.courier)
    return (
      <div className="space-y-4">
        {back}
        <div role="alert" className="space-y-3 rounded-lg border bg-white p-6">
          <h1 className="text-xl font-semibold">
            {current.error
              ? "No se pudo abrir la ficha"
              : "Motorizado no encontrado"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {current.error ||
              "La cuenta no existe, cambió de rol o no está disponible para tu usuario."}
          </p>
          <Button
            variant="outline"
            onClick={() => setRefresh((value) => value + 1)}
          >
            Reintentar
          </Button>
        </div>
      </div>
    );
  const courier = current.courier;
  const name = courier.full_name || "Motorizado sin nombre";
  const metrics = [
    "Envíos activos",
    "Entregados",
    "Recojos abiertos",
    "Recojos asignados",
  ].map((label, index) => ({ label, value: current.counts[index] ?? "—" }));
  return (
    <div data-page="courier-record" className="min-w-0 space-y-4">
      {back}
      <RecordHeader
        title={name}
        recordType="Motorizado"
        icon={Truck}
        meta={
          <>
            <span>{courier.email || "Correo sin registrar"}</span>
            <span>Registro: {recordDate(courier.created_at)}</span>
          </>
        }
        actions={
          <>
            <Button
              variant="outline"
              disabled={refreshing}
              onClick={() => setRefresh((value) => value + 1)}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              {refreshing ? "Actualizando…" : "Actualizar"}
            </Button>
            <Button onClick={() => selectTab("location")}>
              <MapPin className="mr-2 h-4 w-4" />
              Última ubicación
            </Button>
          </>
        }
      >
        <MetricStrip items={metrics} />
      </RecordHeader>
      {current.counts.some((value) => value === null) && (
        <p role="status" className="text-xs text-amber-800">
          Algunos indicadores no están disponibles. Usa Actualizar para volver a
          consultarlos.
        </p>
      )}
      <RecordTabs
        tabs={tabs}
        selected={tab}
        onSelect={selectTab}
        label={`Secciones de ${name}`}
      >
        {(section) => {
          if (!visited.has(section) && section !== tab) return null;
          if (section === "orders")
            return <CourierOrderList courierId={courierId} refresh={refresh} />;
          if (section === "pickups")
            return <CourierPickups courierId={courierId} refresh={refresh} />;
          if (section === "location")
            return <CourierLocation courierId={courierId} refresh={refresh} />;
          if (section === "activity")
            return <CourierActivity courierId={courierId} refresh={refresh} />;
          if (section === "details")
            return (
              <Card>
                <CardHeader>
                  <CardTitle>Datos de la cuenta</CardTitle>
                </CardHeader>
                <CardContent className="space-y-5">
                  <dl className="grid gap-4 sm:grid-cols-2">
                    <RecordField label="Nombre">{name}</RecordField>
                    <RecordField label="Correo">{courier.email}</RecordField>
                    <RecordField label="Rol">Motorizado</RecordField>
                    <RecordField label="Registro">
                      {recordDate(courier.created_at)}
                    </RecordField>
                  </dl>
                  <div className="border-t pt-4">
                    <p className="mb-3 text-xs text-muted-foreground">
                      La ficha se consulta con tu cuenta de administrador.
                      Entrar como esta persona es una acción opcional y sus
                      acciones son reales.
                    </p>
                    <ViewAsButton
                      target={{
                        id: courier.id,
                        full_name: courier.full_name,
                        role: "courier",
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            );
          return (
            <RecordLayout
              aside={
                <>
                  <Card>
                    <CardHeader>
                      <CardTitle>Cuenta de reparto</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <dl className="space-y-4">
                        <RecordField label="Nombre">{name}</RecordField>
                        <RecordField label="Correo">
                          {courier.email ? (
                            <a
                              href={`mailto:${courier.email}`}
                              className="break-all text-primary underline"
                            >
                              {courier.email}
                            </a>
                          ) : (
                            "—"
                          )}
                        </RecordField>
                        <RecordField label="Registrado">
                          {recordDate(courier.created_at)}
                        </RecordField>
                      </dl>
                      <Button
                        variant="outline"
                        className="mt-4 w-full"
                        onClick={() => selectTab("details")}
                      >
                        Ver datos
                      </Button>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardTitle>Consulta operativa</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-xs text-muted-foreground">
                      <p>
                        Los indicadores y los envíos corresponden a pedidos
                        asignados a esta cuenta. En Envíos y Recojos también
                        puedes consultar registros finalizados.
                      </p>
                      <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => selectTab("activity")}
                      >
                        Ver actividad
                      </Button>
                    </CardContent>
                  </Card>
                </>
              }
            >
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Últimos envíos asignados</CardTitle>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => selectTab("orders")}
                  >
                    Ver todos
                  </Button>
                </CardHeader>
                <CardContent>
                  {current.recentError ? (
                    <p role="alert" className="text-sm text-red-700">
                      No se pudieron cargar los últimos envíos.
                    </p>
                  ) : current.recent.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Esta cuenta todavía no tiene envíos asignados.
                    </p>
                  ) : (
                    <ul className="divide-y">
                      {current.recent.map((order) => (
                        <li key={order.id} className="space-y-2 py-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-semibold">
                              #{order.order_number} · {order.recipient_name}
                            </p>
                            <StatusBadge status={order.status} />
                          </div>
                          {order.company && (
                            <Link
                              className="inline-flex min-h-9 items-center text-sm font-medium text-primary hover:underline"
                              to={`/comercios/${order.company.id}`}
                              state={{
                                recordOrigin: {
                                  path: `/couriers/${courierId}?tab=overview`,
                                },
                              }}
                            >
                              {order.company.name}
                            </Link>
                          )}
                          <p className="text-xs text-muted-foreground">
                            Programado: {recordDate(order.scheduled_date)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </RecordLayout>
          );
        }}
      </RecordTabs>
    </div>
  );
}
