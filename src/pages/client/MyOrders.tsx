import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, format, parseISO, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../../lib/supabase";
import type { Database, OrderStatus } from "../../types/database";
import { useAuth } from "../../components/AuthProvider";
import { Card, CardContent } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { StatusBadge, OrderBadges } from "../../components/OrderBadges";
import { ORDER_STATUSES, STATUS_META, districtName } from "../../lib/orderMeta";
import { money } from "../../lib/settlement";
import { scheduleLabel } from "../../lib/cutoff";
import { Camera, FileSpreadsheet, Plus, RefreshCw, Search } from "lucide-react";
import { cn } from "@/lib/utils";

type OrderRow = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "id"
  | "order_number"
  | "created_at"
  | "scheduled_date"
  | "recipient_name"
  | "recipient_phone"
  | "destination_district"
  | "destination_address"
  | "product_details"
  | "packages_count"
  | "amount_to_collect"
  | "amount_collected"
  | "payment_method"
  | "status"
  | "total_amount"
  | "delivery_notes"
  | "delivered_at"
  | "origin_type"
  | "service_type"
  | "agency_name"
  | "agency_destination"
  | "settlement_id"
> & { deliveries: { proof_image_url: string | null }[] };

const COLUMNS =
  "id, order_number, created_at, scheduled_date, recipient_name, recipient_phone, destination_district, destination_address, product_details, packages_count, amount_to_collect, amount_collected, payment_method, status, total_amount, delivery_notes, delivered_at, origin_type, service_type, agency_name, agency_destination, settlement_id, deliveries (proof_image_url)";

const PAGE = 50;
const selectClass =
  "flex h-9 w-full items-center rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring";

type Counts = { pending: number; active: number; deliveredToday: number };

/** Los pedidos del comercio: filtros por fecha / estado / texto y foto de entrega. No ve al motorizado ni anula pedidos (eso lo gestiona Relámpago). */
export default function MyOrders() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [from, setFrom] = useState(() => format(subDays(new Date(), 29), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [status, setStatus] = useState<"" | "active" | OrderStatus>("");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{ key: string; orders: OrderRow[]; total: number } | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [reload, setReload] = useState(0);
  const [photo, setPhoto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Búsqueda con pequeño retraso para no consultar en cada tecla
  useEffect(() => {
    const t = window.setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 350);
    return () => window.clearTimeout(t);
  }, [search]);

  // Clave de la consulta actual: mientras el resultado cargado no la tenga, se muestra "cargando"
  const queryKey = JSON.stringify([companyId, from, to, status, query, page, reload]);
  const loading = result?.key !== queryKey;
  const orders = result?.key === queryKey ? result.orders : [];
  const total = result?.key === queryKey ? result.total : 0;

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    const fromIso = new Date(`${from}T00:00:00-05:00`).toISOString();
    const toIso = addDays(new Date(`${to}T00:00:00-05:00`), 1).toISOString();
    let q = supabase
      .from("orders")
      .select(COLUMNS, { count: "exact" })
      .eq("company_id", companyId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: false })
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (status === "active") q = q.in("status", ["pending", "picked_up", "in_transit"]);
    else if (status) q = q.eq("status", status);
    if (query) {
      const s = query.replace(/[%,()]/g, " ");
      const asNumber = /^\d+$/.test(s) ? `,order_number.eq.${s}` : "";
      q = q.or(`recipient_name.ilike.%${s}%,recipient_phone.ilike.%${s}%,destination_address.ilike.%${s}%,product_details.ilike.%${s}%${asNumber}`);
    }
    q.then(({ data, error, count }) => {
      if (cancelled) return;
      if (error) {
        console.error(error);
        setError("No se pudieron cargar los pedidos.");
      } else {
        setError(null);
        setResult({ key: queryKey, orders: (data ?? []) as unknown as OrderRow[], total: count ?? 0 });
      }
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, from, to, status, query, page, reload, queryKey]);

  // Resumen de arriba: pendientes, en camino y entregados hoy
  useEffect(() => {
    if (!companyId) return;
    const todayIso = new Date(`${format(new Date(), "yyyy-MM-dd")}T00:00:00-05:00`).toISOString();
    Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "pending"),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["picked_up", "in_transit"]),
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "delivered").gte("delivered_at", todayIso),
    ]).then(([p, a, d]) => setCounts({ pending: p.count ?? 0, active: a.count ?? 0, deliveredToday: d.count ?? 0 }));
  }, [companyId, reload]);

  const pages = Math.max(1, Math.ceil(total / PAGE));
  const statusOptions = useMemo(() => ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })), []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold">Mis pedidos</h1>
          <p className="text-xs text-muted-foreground">¿Necesitas cambiar o anular un pedido? Escríbenos a Relámpago Courier.</p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline">
            <Link to="/carga-masiva">
              <FileSpreadsheet className="mr-2 h-4 w-4" /> Carga masiva
            </Link>
          </Button>
          <Button asChild>
            <Link to="/nuevo-pedido">
              <Plus className="mr-2 h-4 w-4" /> Nuevo pedido
            </Link>
          </Button>
        </div>
      </div>

      {counts && (
        <div className="grid grid-cols-3 gap-3">
          <Summary label="Pendientes" value={counts.pending} className="text-yellow-700" />
          <Summary label="En camino" value={counts.active} className="text-blue-700" />
          <Summary label="Entregados hoy" value={counts.deliveredToday} className="text-green-700" />
        </div>
      )}

      <Card>
        <CardContent className="grid gap-3 p-4 md:grid-cols-5">
          <div className="space-y-1 md:col-span-2">
            <Label className="text-xs">Buscar</Label>
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Destinatario, teléfono, dirección, producto o Nº" className="h-9 pl-8" />
            </div>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Estado</Label>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as typeof status);
                setPage(0);
              }}
              className={selectClass}
            >
              <option value="">Todos</option>
              <option value="active">En proceso</option>
              {statusOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Desde</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                if (e.target.value) setFrom(e.target.value);
                setPage(0);
              }}
              className="h-9"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Hasta</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                if (e.target.value) setTo(e.target.value);
                setPage(0);
              }}
              className="h-9"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="flex items-center justify-between border-b px-4 py-2 text-sm text-muted-foreground">
            <span>
              {loading ? "Cargando…" : `${total} pedido${total === 1 ? "" : "s"}`}
              {pages > 1 && ` · página ${page + 1} de ${pages}`}
            </span>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" onClick={() => setReload((t) => t + 1)} title="Actualizar">
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </Button>
              <Button size="sm" variant="outline" className="h-7" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                Anterior
              </Button>
              <Button size="sm" variant="outline" className="h-7" disabled={page + 1 >= pages} onClick={() => setPage((p) => p + 1)}>
                Siguiente
              </Button>
            </div>
          </div>
          {error && <div className="p-4 text-sm text-destructive">{error}</div>}
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-20">Nº</TableHead>
                  <TableHead>Fecha</TableHead>
                  <TableHead>Destinatario</TableHead>
                  <TableHead>Destino</TableHead>
                  <TableHead>Producto</TableHead>
                  <TableHead className="text-right">A cobrar</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead className="text-right">Servicio</TableHead>
                  <TableHead className="w-24"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {!loading && orders.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="py-10 text-center text-muted-foreground">
                      No hay pedidos con estos filtros.
                    </TableCell>
                  </TableRow>
                )}
                {orders.map((o) => {
                  const collected = o.amount_collected != null ? Number(o.amount_collected) : null;
                  const toCollect = Number(o.amount_to_collect ?? 0);
                  const proof = o.deliveries?.[0]?.proof_image_url ?? null;
                  return (
                    <TableRow key={o.id}>
                      <TableCell className="font-mono text-xs">{o.order_number}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs">
                        {o.created_at ? format(parseISO(o.created_at), "d MMM HH:mm", { locale: es }) : ""}
                        {(o.status === "pending" || o.status === "picked_up") && (
                          <div className="text-[11px] font-medium text-primary">para {scheduleLabel(o.scheduled_date)}</div>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="font-medium">{o.recipient_name}</div>
                        <div className="text-xs text-muted-foreground">{o.recipient_phone}</div>
                      </TableCell>
                      <TableCell className="max-w-[260px]">
                        <div className="text-sm">{districtName(o.destination_district)}</div>
                        <div className="truncate text-xs text-muted-foreground" title={o.destination_address ?? ""}>
                          {o.destination_address}
                        </div>
                        <OrderBadges order={o} compact className="mt-1" />
                      </TableCell>
                      <TableCell className="max-w-[200px]">
                        <div className="truncate text-sm" title={o.product_details ?? ""}>
                          {o.product_details}
                        </div>
                        {(o.packages_count ?? 1) > 1 && <div className="text-xs text-muted-foreground">{o.packages_count} paquetes</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {toCollect > 0 ? money(toCollect) : <span className="text-muted-foreground">—</span>}
                        {o.status === "delivered" && collected != null && collected !== toCollect && (
                          <div className="text-[11px] text-amber-700">cobrado {money(collected)}</div>
                        )}
                        {o.status === "delivered" && o.payment_method && <div className="text-[11px] text-muted-foreground">{o.payment_method}</div>}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={o.status} />
                        {o.status === "delivered" && o.delivered_at && (
                          <div className="mt-1 text-[11px] text-muted-foreground">{format(parseISO(o.delivered_at), "d MMM HH:mm", { locale: es })}</div>
                        )}
                        {o.status === "failed" && o.delivery_notes && <div className="mt-1 max-w-[180px] text-[11px] text-red-700">{o.delivery_notes}</div>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-sm">
                        {o.total_amount != null ? money(Number(o.total_amount)) : <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          {proof && (
                            <Button size="icon" variant="ghost" title="Foto de entrega" onClick={() => setPhoto(proof)}>
                              <Camera className="h-4 w-4" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={!!photo} onOpenChange={(o) => !o && setPhoto(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Foto de entrega</DialogTitle>
          </DialogHeader>
          {photo && <img src={photo} alt="Evidencia de entrega" className="max-h-[70vh] w-full rounded object-contain" />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Summary({ label, value, className }: { label: string; value: number; className: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className={cn("text-2xl font-bold tabular-nums", className)}>{value}</div>
        <div className="text-xs text-muted-foreground">{label}</div>
      </CardContent>
    </Card>
  );
}
