import { Link } from "react-router-dom";
import { courierOrdersQuery } from "../../lib/courierRecord";
import { useEffect, useRef, useState } from "react";
import { Eye, Loader2, Search } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/database";
import {
  companyRelatedQuery,
  recordDate,
  RELATED_PAGE_SIZE,
  type RecordSection,
} from "../../lib/companyRecord";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../ui/dialog";
import { StatusBadge, OrderBadges } from "../OrderBadges";
import {
  ORDER_STATUSES,
  PICKUP_STATUS_META,
  STATUS_META,
  districtName,
} from "../../lib/orderMeta";
import { money } from "../../lib/settlement";
import { cn } from "../../lib/utils";

type Order = Database["public"]["Tables"]["orders"]["Row"] & {
  company?: { id: string; name: string } | null;
  courier: { full_name: string | null } | null;
  deliveries: { proof_image_url: string | null }[];
};
type Pickup = Database["public"]["Tables"]["pickups"]["Row"];
type Settlement = Database["public"]["Tables"]["settlements"]["Row"];
type Related = Order | Pickup | Settlement;
const labels = {
  orders: "Pedidos",
  pickups: "Recojos",
  settlements: "Liquidaciones",
};

export function RecordField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="break-words text-sm font-medium">
        {children === null || children === undefined || children === ""
          ? "—"
          : children}
      </dd>
    </div>
  );
}

function OrderDetail({
  order,
  onClose,
}: {
  order: Order;
  onClose: () => void;
}) {
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Pedido #{order.order_number}</DialogTitle>
          <DialogDescription>
            Consulta del pedido de este comercio.
          </DialogDescription>
        </DialogHeader>
        <StatusBadge status={order.status} />
        <dl className="grid grid-cols-1 gap-4 rounded-md border bg-slate-50 p-4 sm:grid-cols-2">
          <RecordField label="Destinatario">{order.recipient_name}</RecordField>
          <RecordField label="Teléfono">{order.recipient_phone}</RecordField>
          <RecordField label="Dirección">
            {order.destination_address}
          </RecordField>
          <RecordField label="Distrito">
            {districtName(order.destination_district)}
          </RecordField>
          <RecordField label="Programado">
            {recordDate(order.scheduled_date)}
          </RecordField>
          <RecordField label="Motorizado">
            {order.courier?.full_name || "Sin asignar"}
          </RecordField>
          <RecordField label="Producto">{order.product_details}</RecordField>
          <RecordField label="Paquetes">
            {order.packages_count ?? 1}
          </RecordField>
          <RecordField label="A cobrar">
            {money(Number(order.amount_to_collect ?? 0))}
          </RecordField>
          <RecordField label="Cobrado">
            {order.amount_collected !== null
              ? money(Number(order.amount_collected))
              : "Sin registrar"}
          </RecordField>
          <RecordField label="Servicio">
            {order.total_amount !== null
              ? money(Number(order.total_amount))
              : "Sin tarifa"}
          </RecordField>
          <RecordField label="Método de pago">
            {order.payment_method}
          </RecordField>
          <RecordField label="Entregado">
            {recordDate(order.delivered_at)}
          </RecordField>
          <RecordField label="Origen">
            {order.origin_type === "warehouse"
              ? "Almacén de Relámpago"
              : "Recojo en comercio"}
          </RecordField>
          <RecordField label="Comentarios">{order.comments}</RecordField>
          <RecordField label="Observaciones de entrega">
            {order.delivery_notes}
          </RecordField>
          {order.agency_name && (
            <RecordField label="Agencia / destino">
              {order.agency_name} · {order.agency_destination}
            </RecordField>
          )}
        </dl>
        {order.deliveries
          .filter((delivery) => delivery.proof_image_url)
          .map((delivery, index) => (
            <img
              key={`${delivery.proof_image_url}-${index}`}
              loading="lazy"
              src={delivery.proof_image_url!}
              alt={`Evidencia de entrega del pedido ${order.order_number}`}
              className="max-h-80 w-full rounded-md border object-contain"
            />
          ))}
      </DialogContent>
    </Dialog>
  );
}

function RecordRow({
  row,
  section,
  onOrder,
}: {
  row: Related;
  section: RecordSection;
  onOrder: (order: Order) => void;
}) {
  if (section === "orders") {
    const order = row as Order;
    return (
      <TableRow>
        <TableCell>
          <button
            className="font-semibold text-primary hover:underline"
            onClick={() => onOrder(order)}
          >
            #{order.order_number}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">
            {recordDate(order.scheduled_date)}
          </p>
        </TableCell>
        <TableCell>
          <p className="font-medium">{order.recipient_name}</p>
          {order.company && <CompanyLink order={order} />}
          <p className="max-w-64 break-words text-xs text-muted-foreground">
            {order.destination_address}
          </p>
        </TableCell>
        <TableCell>
          <StatusBadge status={order.status} />
        </TableCell>
        <TableCell>{order.courier?.full_name || "Sin asignar"}</TableCell>
        <TableCell className="text-right tabular-nums">
          {money(Number(order.amount_to_collect ?? 0))}
        </TableCell>
        <TableCell>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Ver pedido ${order.order_number}`}
            onClick={() => onOrder(order)}
          >
            <Eye className="h-4 w-4" />
          </Button>
        </TableCell>
      </TableRow>
    );
  }
  if (section === "pickups") {
    const pickup = row as Pickup;
    return (
      <TableRow>
        <TableCell className="font-semibold">#{pickup.pickup_number}</TableCell>
        <TableCell>{recordDate(pickup.scheduled_date)}</TableCell>
        <TableCell className="max-w-72 break-words">{pickup.address}</TableCell>
        <TableCell>
          <span
            className={cn(
              "rounded px-2 py-1 text-xs",
              PICKUP_STATUS_META[pickup.status].badge,
            )}
          >
            {PICKUP_STATUS_META[pickup.status].label}
          </span>
        </TableCell>
        <TableCell className="text-right">
          {pickup.received_packages} / {pickup.packages_count ?? "Sin indicar"}
        </TableCell>
      </TableRow>
    );
  }
  const settlement = row as Settlement;
  return (
    <TableRow>
      <TableCell className="font-semibold">
        #{settlement.settlement_number}
      </TableCell>
      <TableCell className="text-xs">
        {recordDate(settlement.period_from)} –{" "}
        {recordDate(settlement.period_to)}
      </TableCell>
      <TableCell className="text-right">
        {money(Number(settlement.collected))}
      </TableCell>
      <TableCell className="text-right">
        {money(Number(settlement.service))}
      </TableCell>
      <TableCell className="text-right font-semibold">
        {money(Number(settlement.balance))}
      </TableCell>
      <TableCell>
        <span
          className={cn(
            "rounded px-2 py-1 text-xs",
            settlement.paid_at
              ? "bg-green-50 text-green-800"
              : "bg-amber-50 text-amber-800",
          )}
        >
          {settlement.paid_at ? "Pagado" : "Pendiente"}
        </span>
        <p className="mt-1 max-w-44 break-words text-xs text-muted-foreground">
          {settlement.paid_reference || settlement.notes}
        </p>
      </TableCell>
    </TableRow>
  );
}

function RelatedCard({
  row,
  section,
  onOrder,
}: {
  row: Related;
  section: RecordSection;
  onOrder: (order: Order) => void;
}) {
  if (section === "orders") {
    const order = row as Order;
    return (
      <article className="space-y-3 rounded-md border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Pedido #{order.order_number}
          </h3>
          <StatusBadge status={order.status} />
        </div>
        <p className="break-words text-sm font-medium">
          {order.recipient_name}
        </p>
        {order.company && <CompanyLink order={order} />}
        <p className="break-words text-xs text-muted-foreground">
          {order.destination_address} ·{" "}
          {districtName(order.destination_district)}
        </p>
        <OrderBadges order={order} compact />
        <p className="text-xs text-muted-foreground">
          {recordDate(order.scheduled_date)} ·{" "}
          {order.courier?.full_name || "Sin motorizado"}
        </p>
        <Button
          variant="outline"
          className="w-full"
          onClick={() => onOrder(order)}
        >
          Ver pedido
        </Button>
      </article>
    );
  }
  if (section === "pickups") {
    const pickup = row as Pickup;
    return (
      <article className="space-y-3 rounded-md border bg-white p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">
            Recojo #{pickup.pickup_number}
          </h3>
          <span
            className={cn(
              "rounded px-2 py-1 text-xs",
              PICKUP_STATUS_META[pickup.status].badge,
            )}
          >
            {PICKUP_STATUS_META[pickup.status].label}
          </span>
        </div>
        <p className="break-words text-sm">{pickup.address}</p>
        <p className="text-xs text-muted-foreground">
          {recordDate(pickup.scheduled_date)} · {pickup.contact_name}{" "}
          {pickup.contact_phone}
        </p>
        <p className="rounded bg-slate-50 p-2 text-xs">
          Paquetes recibidos: <b>{pickup.received_packages}</b> /{" "}
          {pickup.packages_count ?? "Sin indicar"} esperados
        </p>
        {pickup.notes && (
          <p className="break-words text-xs text-muted-foreground">
            {pickup.notes}
          </p>
        )}
      </article>
    );
  }
  const settlement = row as Settlement;
  return (
    <article className="space-y-3 rounded-md border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Liquidación #{settlement.settlement_number}
        </h3>
        <span className="text-xs text-muted-foreground">
          {settlement.paid_at
            ? `Pagado ${recordDate(settlement.paid_at)}`
            : "Pago pendiente"}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {recordDate(settlement.period_from)} –{" "}
        {recordDate(settlement.period_to)}
      </p>
      <dl className="grid grid-cols-2 gap-3">
        <RecordField label="Recaudado">
          {money(Number(settlement.collected))}
        </RecordField>
        <RecordField label="Servicio">
          {money(Number(settlement.service))}
        </RecordField>
        <RecordField label="Saldo">
          {money(Number(settlement.balance))}
        </RecordField>
        <RecordField label="Pedidos">{settlement.orders_count}</RecordField>
      </dl>
      {(settlement.paid_reference || settlement.notes) && (
        <p className="break-words text-xs text-muted-foreground">
          {settlement.paid_reference} {settlement.notes}
        </p>
      )}
    </article>
  );
}

function RelatedRecordList({
  recordId,
  recordKind,
  section,
  refresh,
}: {
  recordId: string;
  recordKind: "company" | "courier";
  section: RecordSection;
  refresh: number;
}) {
  const [search, setSearch] = useState("");
  const [stableSearch, setStableSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState<Order | null>(null);
  const [result, setResult] = useState<{
    key: string;
    rows: Related[];
    total: number;
    error: string | null;
  } | null>(null);
  const top = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([
    recordId,
    recordKind,
    section,
    stableSearch,
    status,
    from,
    to,
    page,
    refresh,
  ]);
  const current = result?.key === key ? result : null;
  const invalidDates = !!from && !!to && from > to;
  useEffect(() => {
    const timer = setTimeout(() => {
      setStableSearch(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (invalidDates) return;
    let alive = true;
    const load = async () => {
      try {
        const filters = { search: stableSearch, status, from, to, page };
        const { data, error, count } = await (recordKind === "courier"
          ? courierOrdersQuery(supabase, recordId, filters)
          : companyRelatedQuery(supabase, recordId, section, filters));
        if (alive)
          setResult({
            key,
            rows: (data ?? []) as unknown as Related[],
            total: count ?? 0,
            error: error?.message ?? null,
          });
      } catch (error) {
        if (alive)
          setResult({
            key,
            rows: [],
            total: 0,
            error:
              error instanceof Error
                ? error.message
                : "No se pudieron cargar los registros.",
          });
      }
    };
    void load();
    return () => {
      alive = false;
    };
  }, [
    recordId,
    recordKind,
    section,
    stableSearch,
    status,
    from,
    to,
    page,
    refresh,
    key,
    invalidDates,
  ]);
  const changePage = (next: number) => {
    setPage(next);
    top.current?.scrollIntoView({ block: "start" });
  };
  const headers =
    section === "orders"
      ? [
          "Pedido / fecha",
          "Destinatario",
          "Estado",
          "Motorizado",
          "A cobrar",
          "Detalle",
        ]
      : section === "pickups"
        ? ["Recojo", "Fecha", "Dirección", "Estado", "Paquetes recibidos"]
        : ["Liquidación", "Período", "Recaudado", "Servicio", "Saldo", "Pago"];
  return (
    <div ref={top} className="scroll-mt-16 space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-semibold">
          {labels[section]}{" "}
          {recordKind === "courier" ? "del motorizado" : "del comercio"}
        </h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>
              {section === "orders"
                ? "Destinatario o nº de pedido"
                : section === "pickups"
                  ? "Dirección o nº de recojo"
                  : "Nº de liquidación"}
            </span>
            <div className="relative">
              <Search
                className="absolute left-3 top-3 h-4 w-4"
                aria-hidden="true"
              />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="bg-white pl-9"
                placeholder="Buscar…"
              />
            </div>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Estado</span>
            <select
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(0);
              }}
              className="h-10 w-full rounded border bg-white px-2 text-sm"
            >
              <option value="all">Todos</option>
              {section === "orders" ? (
                ORDER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_META[value].label}
                  </option>
                ))
              ) : section === "pickups" ? (
                Object.entries(PICKUP_STATUS_META).map(([value, meta]) => (
                  <option key={value} value={value}>
                    {meta.label}
                  </option>
                ))
              ) : (
                <>
                  <option value="unpaid">Pago pendiente</option>
                  <option value="paid">Pagado</option>
                </>
              )}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Desde</span>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Hasta</span>
            <Input
              type="date"
              value={to}
              onChange={(e) => {
                setTo(e.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {section === "settlements"
            ? "Incluye los períodos que se cruzan con el rango indicado."
            : "Las fechas filtran el día programado de atención."}
        </p>
      </div>
      {invalidDates ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          La fecha desde no puede ser posterior a la fecha hasta.
        </p>
      ) : !current ? (
        <p
          role="status"
          className="flex items-center gap-2 p-5 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando registros…
        </p>
      ) : current.error ? (
        <p
          role="alert"
          className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700"
        >
          No se pudieron cargar los registros: {current.error}
        </p>
      ) : (
        <>
          {current.rows.length === 0 ? (
            <div className="rounded-lg border bg-white p-8 text-center text-sm text-muted-foreground">
              No hay registros con estos filtros.
            </div>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-2 xl:hidden">
                {current.rows.map((row) => (
                  <RelatedCard
                    key={row.id}
                    row={row}
                    section={section}
                    onOrder={setSelected}
                  />
                ))}
              </div>
              <div className="hidden overflow-hidden rounded-lg border bg-white xl:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHead key={header}>{header}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {current.rows.map((row) => (
                      <RecordRow
                        key={row.id}
                        row={row}
                        section={section}
                        onOrder={setSelected}
                      />
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white px-4 py-3">
            <p role="status" className="text-xs text-muted-foreground">
              {current.total === 0
                ? "0 registros"
                : `${page * RELATED_PAGE_SIZE + 1}–${Math.min((page + 1) * RELATED_PAGE_SIZE, current.total)} de ${current.total}`}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => changePage(page - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * RELATED_PAGE_SIZE >= current.total}
                onClick={() => changePage(page + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}
      {selected && (
        <OrderDetail order={selected} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

export function CompanyRelatedList(props: {
  companyId: string;
  section: RecordSection;
  refresh: number;
}) {
  return (
    <RelatedRecordList
      recordId={props.companyId}
      recordKind="company"
      section={props.section}
      refresh={props.refresh}
    />
  );
}
export function CourierOrderList(props: {
  courierId: string;
  refresh: number;
}) {
  return (
    <RelatedRecordList
      recordId={props.courierId}
      recordKind="courier"
      section="orders"
      refresh={props.refresh}
    />
  );
}

function CompanyLink({ order }: { order: Order }) {
  return order.company ? (
    <Link
      className="inline-flex min-h-9 items-center text-xs font-medium text-primary hover:underline"
      to={`/comercios/${order.company.id}`}
      state={{
        recordOrigin: {
          path: `/couriers/${order.assigned_courier}?tab=orders`,
        },
      }}
    >
      {order.company.name}
    </Link>
  ) : null;
}
