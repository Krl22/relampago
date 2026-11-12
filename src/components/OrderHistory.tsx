import { useEffect, useState } from "react";
import { History, Inbox, RefreshCw } from "lucide-react";
import { cn } from "../lib/utils";
import { supabase } from "../lib/supabase";
import type { Database, OrderStatus } from "../types/database";
import { districtName, STATUS_META } from "../lib/orderMeta";
import { StatusBadge } from "./OrderBadges";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

type HistoricalOrder = Pick<Database["public"]["Tables"]["orders"]["Row"],
  "id" | "order_number" | "status" | "recipient_name" | "destination_address" | "destination_district" |
  "scheduled_date" | "delivered_at" | "tariff" | "total_amount" | "amount_collected" | "payment_method" | "delivery_notes"> & {
    companies: { name: string } | null;
  };
const HISTORY_STATUSES: OrderStatus[] = ["delivered", "failed", "cancelled"];
const PAGE_SIZE = 10;
const money = (value: number | null) => value == null ? "Sin registrar" : `S/ ${Number(value).toFixed(2)}`;
const deliveredDate = (value: string) => new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima", dateStyle: "short", timeStyle: "short",
}).format(new Date(value));
const scheduledDate = (value: string) => value.split("-").reverse().join("/");

/** Personal, read-only history; never fetch other couriers' orders. */
export function OrderHistory({ courierId, refreshToken }: { courierId: string; refreshToken: number }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<OrderStatus | "all">("all");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; orders: HistoricalOrder[]; total: number; error: string | null } | null>(null);
  const key = JSON.stringify([courierId, from, to, status, page, refreshToken, reload]);
  const invalidRange = !!from && !!to && from > to;
  const loading = !invalidRange && result?.key !== key;
  const current = result?.key === key ? result : null;
  const total = current?.total ?? 0;

  useEffect(() => {
    if (invalidRange) return;
    let cancelled = false;
    let query = supabase.from("orders")
      .select("id, order_number, status, recipient_name, destination_address, destination_district, scheduled_date, delivered_at, tariff, total_amount, amount_collected, payment_method, delivery_notes, companies(name)", { count: "exact" })
      .eq("assigned_courier", courierId)
      .in("status", HISTORY_STATUSES)
      .order("updated_at", { ascending: false })
      .order("id", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (status !== "all") query = query.eq("status", status);
    if (from) query = query.gte("scheduled_date", from);
    if (to) query = query.lte("scheduled_date", to);
    query.then(({ data, error, count }) => {
      if (!cancelled) setResult({ key, orders: (data ?? []) as HistoricalOrder[], total: count ?? 0, error: error?.message ?? null });
    });
    return () => { cancelled = true; };
  }, [courierId, from, to, status, page, key, invalidRange]);

  const filtered = !!(from || to || status !== "all");
  const fieldClass = "h-10 w-full min-w-0";

  return (
    <section id="order-history" aria-labelledby="order-history-title" className="scroll-mt-20 space-y-3">
      <Card>
        <CardContent className="space-y-4 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 id="order-history-title" className="flex items-center gap-2 text-base font-semibold">
                <History className="h-5 w-5 text-primary" aria-hidden="true" /> Historial de pedidos
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">Entregados, no entregados y anulados. Solo consulta.</p>
            </div>
            <Button variant="ghost" size="icon" className="shrink-0" aria-label="Actualizar historial" title="Actualizar historial"
              onClick={() => { setPage(0); setReload((n) => n + 1); }} disabled={loading}>
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} aria-hidden="true" />
            </Button>
          </div>
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-xs font-medium text-muted-foreground">Fecha de entrega programada</legend>
            <div className="grid grid-cols-2 gap-2">
              <div className="min-w-0 space-y-1">
                <Label htmlFor="order-history-from" className="text-xs">Desde</Label>
                <Input id="order-history-from" type="date" value={from} max={to || undefined} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className={fieldClass} />
              </div>
              <div className="min-w-0 space-y-1">
                <Label htmlFor="order-history-to" className="text-xs">Hasta</Label>
                <Input id="order-history-to" type="date" value={to} min={from || undefined} onChange={(e) => { setTo(e.target.value); setPage(0); }} className={fieldClass} />
              </div>
            </div>
          </fieldset>
          <div className="space-y-1">
            <Label htmlFor="order-history-status" className="text-xs">Estado</Label>
            <select id="order-history-status" value={status} onChange={(e) => { setStatus(e.target.value as OrderStatus | "all"); setPage(0); }}
              className={cn(fieldClass, "rounded-md border border-input bg-background px-3 text-sm")}>
              <option value="all">Todos los finalizados</option>
              {HISTORY_STATUSES.map((value) => <option key={value} value={value}>{STATUS_META[value].label}</option>)}
            </select>
          </div>
          {filtered && (
            <Button variant="link" size="sm" className="h-auto px-0" onClick={() => { setFrom(""); setTo(""); setStatus("all"); setPage(0); }}>
              Limpiar filtros
            </Button>
          )}
        </CardContent>
      </Card>

      {invalidRange ? <p role="alert" className="text-sm text-destructive">La fecha «desde» no puede ser posterior a la fecha «hasta».</p>
        : loading ? <p role="status" className="py-2 text-center text-sm text-muted-foreground">Cargando historial…</p>
        : current?.error ? <p role="alert" className="text-sm text-destructive">No se pudo cargar el historial: {current.error}</p>
        : <>
          {current?.orders.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              <Inbox className="h-6 w-6 opacity-70" aria-hidden="true" />
              {filtered ? "No hay pedidos finalizados con estos filtros." : "Aún no tienes pedidos finalizados. Aquí verás los que entregues."}
            </div>
          )}
          {current?.orders.map((order) => (
            <Card key={order.id}>
              <CardContent className="space-y-3 p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="font-semibold">Pedido #{order.order_number}</h3>
                    {order.companies?.name && <p className="truncate text-xs text-muted-foreground">{order.companies.name}</p>}
                  </div>
                  <StatusBadge status={order.status} />
                </div>
                <div>
                  <p className="font-medium">{order.recipient_name ?? "Sin destinatario"}</p>
                  <p className="text-muted-foreground">{order.destination_address}{order.destination_district ? ` · ${districtName(order.destination_district)}` : ""}</p>
                </div>
                <dl className="grid grid-cols-2 gap-x-3 gap-y-2 rounded-lg bg-muted p-3 text-xs">
                  <div>
                    <dt className="text-muted-foreground">Programada</dt>
                    <dd className="font-medium">{scheduledDate(order.scheduled_date)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Entregado</dt>
                    <dd className="font-medium">{order.delivered_at ? deliveredDate(order.delivered_at) : "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Servicio{order.tariff ? ` · ${order.tariff}` : ""}</dt>
                    <dd className="font-medium">{money(order.total_amount)}</dd>
                  </div>
                  <div>
                    <dt className="text-muted-foreground">Cobrado{order.payment_method ? ` · ${order.payment_method}` : ""}</dt>
                    <dd className="font-medium">{money(order.amount_collected)}</dd>
                  </div>
                </dl>
                {order.delivery_notes && <p className="rounded-lg border-l-2 border-primary/40 bg-muted px-3 py-2 text-xs text-muted-foreground">{order.delivery_notes}</p>}
              </CardContent>
            </Card>
          ))}
          {total > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total} pedidos</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((n) => n + 1)}>Siguiente</Button>
            </div>
          </div>}
        </>}
    </section>
  );
}
