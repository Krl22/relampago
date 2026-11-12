import { RecordHeader } from "../components/design/RecordHeader";
import { MetricStrip } from "../components/design/MetricStrip";
import { RecordLayout } from "../components/design/RecordLayout";
import { useEffect, useState } from "react";
import {
  Link,
  useLocation,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  ArrowLeft,
  Building2,
  KeyRound,
  MapPin,
  RefreshCw,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import { recordOrigin } from "../lib/recordNavigation";
import {
  COMPANY_FIELDS,
  recordDate,
  validCompanyId,
  type CompanyRecord,
} from "../lib/companyRecord";
import { ACTIVE_STATUSES, districtName } from "../lib/orderMeta";
import { Button } from "../components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { RecordTabs } from "../components/design/RecordTabs";
import {
  CompanyRelatedList,
  RecordField,
} from "../components/company-record/CompanyRelatedList";
import {
  CompanyRecordAccesses,
  CompanyRecordActivity,
  CompanyRecordAddresses,
  CompanyRecordDetails,
} from "../components/company-record/CompanyRecordInfo";
import { CompanyAccessDialog } from "../components/CompanyAccessDialog";
import { CompanyAddressesDialog } from "../components/CompanyAddressesDialog";
import { CompanyViewAsDialog } from "../components/CompanyViewAsDialog";
import { MerchantStockWorkspace } from "../components/merchant-stock/MerchantStockWorkspace";
import { StatusBadge } from "../components/OrderBadges";
import type { Database } from "../types/database";

const tabs = [
  { id: "overview", label: "Resumen" },
  { id: "details", label: "Detalles" },
  { id: "orders", label: "Pedidos" },
  { id: "inventory", label: "Inventario" },
  { id: "pickups", label: "Recojos" },
  { id: "settlements", label: "Liquidaciones" },
  { id: "addresses", label: "Direcciones" },
  { id: "accesses", label: "Accesos" },
  { id: "activity", label: "Actividad" },
] as const;
type Tab = (typeof tabs)[number]["id"];
type RecentOrder = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_number" | "recipient_name" | "status" | "scheduled_date"
>;
type Snapshot = {
  company: CompanyRecord | null;
  error: string | null;
  counts: (number | null)[];
  recent: RecentOrder[];
  recentError: boolean;
};

export default function CompanyRecordPage() {
  const { companyId = "" } = useParams();
  if (!validCompanyId(companyId))
    return (
      <div role="alert" className="space-y-3 rounded-lg border bg-white p-6">
        <h1 className="text-xl font-semibold">El comercio no es válido</h1>
        <Link className="text-primary underline" to="/comercios">
          Volver a comercios
        </Link>
      </div>
    );
  return <CompanyRecordContent key={companyId} companyId={companyId} />;
}

function CompanyRecordContent({ companyId }: { companyId: string }) {
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
  const [accessOpen, setAccessOpen] = useState(false);
  const [addressesOpen, setAddressesOpen] = useState(false);
  const [viewAsOpen, setViewAsOpen] = useState(false);
  const key = `${companyId}:${refresh}`;
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
    let active = true;
    const load = async () => {
      try {
        const [
          company,
          activeOrders,
          delivered,
          stock,
          pickups,
          unpaid,
          recent,
        ] = await Promise.all([
          supabase
            .from("companies")
            .select(COMPANY_FIELDS)
            .eq("id", companyId)
            .maybeSingle(),
          supabase
            .from("orders")
            .select("id", { head: true, count: "exact" })
            .eq("company_id", companyId)
            .in("status", ACTIVE_STATUSES),
          supabase
            .from("orders")
            .select("id", { head: true, count: "exact" })
            .eq("company_id", companyId)
            .eq("status", "delivered"),
          supabase
            .from("stock")
            .select("id", { head: true, count: "exact" })
            .eq("company_id", companyId),
          supabase
            .from("pickups")
            .select("id", { head: true, count: "exact" })
            .eq("company_id", companyId)
            .in("status", ["pending", "assigned"]),
          supabase
            .from("settlements")
            .select("id", { head: true, count: "exact" })
            .eq("company_id", companyId)
            .is("paid_at", null),
          supabase
            .from("orders")
            .select("id,order_number,recipient_name,status,scheduled_date")
            .eq("company_id", companyId)
            .order("created_at", { ascending: false })
            .order("id", { ascending: false })
            .limit(5),
        ]);
        if (active)
          setResult({
            key,
            data: {
              company: company.data,
              error: company.error?.message ?? null,
              counts: [activeOrders, delivered, stock, pickups, unpaid].map(
                (response) => (response.error ? null : (response.count ?? 0)),
              ),
              recent: recent.data ?? [],
              recentError: !!recent.error,
            },
          });
      } catch (error) {
        if (active)
          setResult({
            key,
            data: {
              company: null,
              error:
                error instanceof Error
                  ? error.message
                  : "No se pudo cargar el comercio.",
              counts: [],
              recent: [],
              recentError: true,
            },
          });
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [companyId, refresh, key]);
  const backState = (location.state as { companyList?: unknown } | null)
    ?.companyList;
  const origin = recordOrigin(location.state);
  const back = (
    <Link
      to={origin?.path ?? "/comercios"}
      state={{
        companyList: backState,
        stockList: (location.state as { stockList?: unknown } | null)
          ?.stockList,
      }}
      className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
    >
      <ArrowLeft className="h-4 w-4" />
      {origin?.label ?? "Comercios"}
    </Link>
  );
  if (!current)
    return (
      <div className="space-y-3">
        {back}
        <p
          role="status"
          className="rounded-lg border bg-white p-6 text-sm text-muted-foreground"
        >
          Cargando ficha del comercio…
        </p>
      </div>
    );
  if (current.error || !current.company)
    return (
      <div className="space-y-4">
        {back}
        <div role="alert" className="space-y-3 rounded-lg border bg-white p-6">
          <h1 className="text-xl font-semibold">
            {current.error
              ? "No se pudo abrir el comercio"
              : "Comercio no encontrado"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {current.error ||
              "Puede haber sido eliminado o no estar disponible para tu cuenta."}
          </p>
          <Button
            onClick={() => setRefresh((value) => value + 1)}
            variant="outline"
          >
            Reintentar
          </Button>
        </div>
      </div>
    );
  const company = current.company;
  const metrics = [
    { label: "Pedidos activos", tab: "orders" },
    { label: "Entregados", tab: "orders" },
    { label: "Productos", tab: "inventory" },
    { label: "Recojos abiertos", tab: "pickups" },
    { label: "Pagos pendientes", tab: "settlements" },
  ] as const;
  return (
    <div data-page="company-record" className="min-w-0 space-y-4">
      {back}
      <RecordHeader
        title={company.name}
        recordType="Comercio"
        icon={Building2}
        meta={
          <>
            <span>RUC: {company.ruc || "Sin registrar"}</span>
            <span>{districtName(company.district) || "Sin distrito"}</span>
            {company.skip_cutoff && (
              <span className="rounded bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
                Prioritario por stock
              </span>
            )}
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
            <Button variant="outline" onClick={() => setAddressesOpen(true)}>
              <MapPin className="mr-2 h-4 w-4" />
              Direcciones
            </Button>
            <Button onClick={() => setAccessOpen(true)}>
              <KeyRound className="mr-2 h-4 w-4" />
              Gestionar accesos
            </Button>
          </>
        }
      >
        <MetricStrip
          columns={5}
          items={metrics.map((metric, index) => ({
            label: metric.label,
            value: current.counts[index] ?? "—",
          }))}
        />
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
        label={`Secciones de ${company.name}`}
      >
        {(section) => {
          if (!visited.has(section) && section !== tab) return null;
          if (section === "overview")
            return (
              <RecordLayout
                aside={
                  <>
                    <Card>
                      <CardHeader>
                        <CardTitle>Contacto</CardTitle>
                      </CardHeader>
                      <CardContent>
                        <dl className="space-y-4">
                          <RecordField label="Persona de contacto">
                            {company.contact_name}
                          </RecordField>
                          <RecordField label="Teléfono">
                            {company.phone ? (
                              <a
                                href={`tel:${company.phone.replace(/[^\d+]/g, "")}`}
                                className="text-primary underline"
                              >
                                {company.phone}
                              </a>
                            ) : (
                              "—"
                            )}
                          </RecordField>
                          <RecordField label="Correo">
                            {company.email ? (
                              <a
                                href={`mailto:${company.email}`}
                                className="break-all text-primary underline"
                              >
                                {company.email}
                              </a>
                            ) : (
                              "—"
                            )}
                          </RecordField>
                          <RecordField label="Dirección principal">
                            {company.address}
                          </RecordField>
                        </dl>
                      </CardContent>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardTitle>Información del registro</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-3 text-xs text-muted-foreground">
                        <p>Registrado: {recordDate(company.created_at)}</p>
                        <p>
                          {company.skip_cutoff
                            ? "La prioridad se activa por tener inventario registrado en Relámpago."
                            : "Los envíos pueden salir del almacén o requerir recojo en una dirección del comercio."}
                        </p>
                        <Button
                          variant="outline"
                          className="w-full"
                          onClick={() => selectTab("details")}
                        >
                          Ver detalles
                        </Button>
                      </CardContent>
                    </Card>
                  </>
                }
              >
                <Card>
                  <CardHeader className="flex-row items-center justify-between">
                    <CardTitle>Últimos pedidos</CardTitle>
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
                        No se pudieron cargar los últimos pedidos.
                      </p>
                    ) : current.recent.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Este comercio todavía no tiene pedidos.
                      </p>
                    ) : (
                      <ul className="divide-y">
                        {current.recent.map((order) => (
                          <li
                            key={order.id}
                            className="flex flex-wrap items-center justify-between gap-3 py-3"
                          >
                            <div className="min-w-0">
                              <p className="break-words text-sm font-medium">
                                #{order.order_number} · {order.recipient_name}
                              </p>
                              <p className="mt-1 text-xs text-muted-foreground">
                                Programado: {recordDate(order.scheduled_date)}
                              </p>
                            </div>
                            <StatusBadge status={order.status} />
                          </li>
                        ))}
                      </ul>
                    )}
                  </CardContent>
                </Card>
              </RecordLayout>
            );
          if (section === "details")
            return <CompanyRecordDetails company={company} />;
          if (
            section === "orders" ||
            section === "pickups" ||
            section === "settlements"
          )
            return (
              <CompanyRelatedList
                companyId={companyId}
                section={section}
                refresh={refresh}
              />
            );
          if (section === "inventory")
            return (
              <MerchantStockWorkspace
                key={`${companyId}:${refresh}`}
                companyId={companyId}
                heading="Inventario del comercio"
                showNewOrder={false}
                nestedInRecord
              />
            );
          if (section === "addresses")
            return (
              <CompanyRecordAddresses companyId={companyId} refresh={refresh} />
            );
          if (section === "accesses")
            return (
              <div className="space-y-3">
                <div className="flex flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setViewAsOpen(true)}>
                    Ver como una cuenta
                  </Button>
                  <Button onClick={() => setAccessOpen(true)}>
                    Gestionar accesos
                  </Button>
                </div>
                <CompanyRecordAccesses
                  companyId={companyId}
                  refresh={refresh}
                />
              </div>
            );
          return (
            <CompanyRecordActivity companyId={companyId} refresh={refresh} />
          );
        }}
      </RecordTabs>
      <CompanyAccessDialog
        company={company}
        open={accessOpen}
        onOpenChange={(open) => {
          setAccessOpen(open);
          if (!open) setRefresh((value) => value + 1);
        }}
      />
      <CompanyAddressesDialog
        company={company}
        open={addressesOpen}
        onOpenChange={(open) => {
          setAddressesOpen(open);
          if (!open) setRefresh((value) => value + 1);
        }}
      />
      {viewAsOpen && (
        <CompanyViewAsDialog
          company={company}
          onClose={() => setViewAsOpen(false)}
          onManageAccess={() => {
            setViewAsOpen(false);
            setAccessOpen(true);
          }}
        />
      )}
    </div>
  );
}
