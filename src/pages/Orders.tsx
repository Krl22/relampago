import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../lib/supabase";
import type { Database, OrderStatus } from "../types/database";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Camera,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Loader2,
  MapPin,
  MapPinOff,
  PackageOpen,
  Trash2,
  Warehouse,
  X,
} from "lucide-react";
import { ORDER_STATUSES, STATUS_META, districtName } from "../lib/orderMeta";
import { priceText, useDistricts } from "../lib/districts";
import { StatusBadge } from "../components/OrderBadges";
import { LocationPicker } from "../components/LocationPicker";
import { googleMapsUrl } from "../lib/mapIcons";
import { TARIFF_AMOUNTS, TARIFF_CODES, computeFee, tariffFor } from "../lib/tariff";
import { EditableCell, type CellValue, type EditorType, type Option } from "../components/orders/EditableCell";
import { ColumnFilter, isFilterActive, type FilterValue } from "../components/orders/ColumnFilter";
import type { LatLng } from "../lib/geo";
import { cn } from "@/lib/utils";

type Order = Database["public"]["Tables"]["orders"]["Row"] & {
  companies: { name: string; invoice_igv: boolean; t1_rate: number | null } | null;
  assigned_courier_profile: { full_name: string | null } | null;
  deliveries: { proof_image_url: string | null }[];
  pickups: { pickup_number: number; status: string } | null;
};
type OrderUpdate = Database["public"]["Tables"]["orders"]["Update"];
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type CompanyLite = { id: string; name: string };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Query = any;

/** Definición de columna: cómo se muestra, filtra, ordena y edita. */
type Column = {
  key: string;
  label: string;
  className?: string;
  sort?: string; // clave de orden en el servidor
  filter?:
    | { kind: "text"; apply: (q: Query, v: string) => Query }
    | { kind: "values"; options: () => Option[]; apply: (q: Query, v: string[]) => Query }
    | { kind: "date"; apply: (q: Query, v: { from?: string; to?: string }) => Query };
  edit?: {
    type: EditorType;
    options?: () => Option[];
    step?: string;
    get: (o: Order) => CellValue;
    patch: (v: CellValue, o: Order) => OrderUpdate;
  };
  render: (o: Order) => React.ReactNode;
};

const orderSchema = z.object({
  tariff: z.string().optional(),
  surcharge: z.coerce.number().min(0).max(500).optional(),
  total_amount: z.coerce.number().min(0).optional(),
  delivery_notes: z.string().optional(),
});
type OrderFormValues = z.infer<typeof orderSchema>;

const PAYMENT_METHODS: Option[] = [
  { value: "", label: "—" },
  { value: "Motorizado", label: "Motorizado (efectivo)" },
  { value: "Directo a comercio", label: "Directo a comercio" },
  { value: "Relampago Courier", label: "Relampago Courier" },
  { value: "Izipay", label: "Izipay (tarjeta)" },
];
const like = (v: string) => `%${v.trim()}%`;
const dash = <span className="text-muted-foreground">—</span>;
const money = (n: number | null | undefined) => (n == null ? dash : `S/ ${Number(n).toFixed(2)}`);

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [couriers, setCouriers] = useState<Profile[]>([]);
  const districts = useDistricts();
  const [companies, setCompanies] = useState<CompanyLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [totalCount, setTotalCount] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);
  const reload = () => setReloadToken((t) => t + 1);

  const [sortConfig, setSortConfig] = useState<{ key: string; direction: "asc" | "desc" }>({ key: "order_number", direction: "desc" });
  const [filters, setFilters] = useState<Record<string, FilterValue | undefined>>({});
  const [debouncedFilters, setDebouncedFilters] = useState(filters);
  const [editing, setEditing] = useState<{ id: string; key: string } | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);

  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkCourier, setBulkCourier] = useState("");
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; order: Order } | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Diálogo "Gestionar": pin en el mapa + tarifa por zona
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [editDestination, setEditDestination] = useState<LatLng | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { isSubmitting },
  } = useForm<OrderFormValues>({ resolver: zodResolver(orderSchema) as never });
  const watchedTariff = watch("tariff");
  const watchedSurcharge = Number(watch("surcharge") ?? 0);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .eq("is_courier", true)
      .order("full_name", { ascending: true })
      .then(({ data }) => setCouriers(data ?? []));
    supabase
      .from("companies")
      .select("id, name")
      .order("name")
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedFilters(filters);
      setPage(0);
    }, 350);
    return () => window.clearTimeout(t);
  }, [filters]);

  useEffect(() => {
    if (editingOrder) {
      setValue("tariff", editingOrder.tariff || "");
      setValue("surcharge", Number(editingOrder.surcharge ?? 0));
      setValue("total_amount", editingOrder.total_amount || 0);
      setValue("delivery_notes", editingOrder.delivery_notes || "");
      setUpdateError(null);
      setEditDestination(
        editingOrder.destination_lat != null && editingOrder.destination_lng != null
          ? { lat: editingOrder.destination_lat, lng: editingOrder.destination_lng }
          : null,
      );
    }
  }, [editingOrder, setValue]);

  // ---------------------------------------------------------------------------
  // Columnas
  // ---------------------------------------------------------------------------
  const columns = useMemo<Column[]>(() => {
    const courierOptions = (): Option[] => [{ value: "", label: "Sin asignar" }, ...couriers.map((c) => ({ value: c.id, label: c.full_name ?? "—" }))];
    const companyOptions = (): Option[] => [{ value: "", label: "—" }, ...companies.map((c) => ({ value: c.id, label: c.name }))];
    const text = (col: string) => ({ kind: "text" as const, apply: (q: Query, v: string) => q.ilike(col, like(v)) });
    const NULL = "__null__";
    // Lista de valores (varios a la vez). NULL representa "sin valor" (p. ej. sin motorizado).
    const values = (col: string, options: () => Option[]) => ({
      kind: "values" as const,
      options,
      apply: (q: Query, v: string[]) => {
        const real = v.filter((x) => x !== NULL);
        if (v.includes(NULL)) {
          const list = real.map((x) => `"${x.replace(/"/g, "")}"`).join(",");
          return q.or(real.length ? `${col}.is.null,${col}.in.(${list})` : `${col}.is.null`);
        }
        return q.in(col, real);
      },
    });
    const dateRange = (col: string) => ({
      kind: "date" as const,
      apply: (q: Query, v: { from?: string; to?: string }) => {
        if (v.from) q = q.gte(col, new Date(`${v.from}T00:00:00-05:00`).toISOString());
        if (v.to) q = q.lt(col, addDays(new Date(`${v.to}T00:00:00-05:00`), 1).toISOString());
        return q;
      },
    });
    // Columna de tipo date (sin hora): se compara tal cual, sin zona horaria
    const dayRange = (col: string) => ({
      kind: "date" as const,
      apply: (q: Query, v: { from?: string; to?: string }) => {
        if (v.from) q = q.gte(col, v.from);
        if (v.to) q = q.lte(col, v.to);
        return q;
      },
    });
    const textEdit = (col: keyof OrderUpdate) => ({
      type: "text" as const,
      get: (o: Order) => (o[col as keyof Order] as string | null) ?? "",
      patch: (v: CellValue) => ({ [col]: (v as string | null) || null }) as OrderUpdate,
    });
    const numberEdit = (col: keyof OrderUpdate, step = "0.01") => ({
      type: "number" as const,
      step,
      get: (o: Order) => (o[col as keyof Order] as number | null) ?? null,
      patch: (v: CellValue) => ({ [col]: v == null ? null : Number(v) }) as OrderUpdate,
    });

    return [
      {
        key: "order_number",
        label: "Nº",
        sort: "order_number",
        className: "font-mono text-xs text-muted-foreground",
        filter: { kind: "text", apply: (q, v) => (Number.isFinite(Number(v.replace(/^#/, ""))) ? q.eq("order_number", Number(v.replace(/^#/, ""))) : q) },
        render: (o) => `#${o.order_number}`,
      },
      {
        key: "created_at",
        label: "Fecha",
        sort: "created_at",
        className: "whitespace-nowrap text-xs",
        filter: dateRange("created_at"),
        render: (o) => (o.created_at ? format(new Date(o.created_at), "dd/MM/yy HH:mm", { locale: es }) : dash),
      },
      {
        key: "scheduled_date",
        label: "Para",
        sort: "scheduled_date",
        className: "whitespace-nowrap text-xs",
        filter: dayRange("scheduled_date"),
        edit: { type: "date", get: (o) => o.scheduled_date, patch: (v) => (v ? { scheduled_date: v as string } : {}) },
        render: (o) => {
          const late = o.created_at && o.scheduled_date > format(new Date(o.created_at), "yyyy-MM-dd");
          return (
            <span className={late ? "font-medium text-amber-700" : undefined} title={late ? "Llegó después del horario de corte" : undefined}>
              {format(parseISO(o.scheduled_date), "EEE dd/MM", { locale: es })}
            </span>
          );
        },
      },
      {
        key: "company",
        label: "Comercio",
        sort: "companies(name)",
        className: "whitespace-nowrap",
        filter: values("company_id", () => [{ value: NULL, label: "(sin comercio)" }, ...companies.map((c) => ({ value: c.id, label: c.name }))]),
        edit: { type: "select", options: companyOptions, get: (o) => o.company_id ?? "", patch: (v) => ({ company_id: (v as string) || null }) },
        render: (o) => o.companies?.name ?? dash,
      },
      {
        key: "origin_type",
        label: "Origen",
        className: "whitespace-nowrap text-xs",
        filter: values("origin_type", () => [{ value: "warehouse", label: "Almacén" }, { value: "pickup", label: "Recojo" }]),
        edit: {
          type: "select",
          options: () => [{ value: "warehouse", label: "Almacén" }, { value: "pickup", label: "Recojo" }],
          get: (o) => o.origin_type,
          patch: (v) => ({ origin_type: v as "warehouse" | "pickup" }),
        },
        render: (o) =>
          o.origin_type === "pickup" ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-purple-100 px-2 py-0.5 font-medium text-purple-800">
              <PackageOpen className="h-3 w-3" /> Recojo{o.pickups ? ` #${o.pickups.pickup_number}` : ""}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Warehouse className="h-3 w-3" /> Almacén
            </span>
          ),
      },
      {
        key: "recipient_name",
        label: "Destinatario",
        sort: "recipient_name",
        className: "max-w-[170px] truncate",
        filter: text("recipient_name"),
        edit: textEdit("recipient_name"),
        render: (o) => <span title={o.recipient_name ?? ""}>{o.recipient_name}</span>,
      },
      {
        key: "recipient_phone",
        label: "Teléfono",
        sort: "recipient_phone",
        className: "whitespace-nowrap",
        filter: text("recipient_phone"),
        edit: textEdit("recipient_phone"),
        render: (o) => o.recipient_phone,
      },
      {
        key: "destination_address",
        label: "Dirección",
        sort: "destination_address",
        className: "max-w-[220px] truncate",
        filter: text("destination_address"),
        edit: textEdit("destination_address"),
        render: (o) => (
          <span title={o.destination_address}>
            {o.destination_lat != null && o.destination_lng != null ? (
              <a href={googleMapsUrl(o.destination_lat, o.destination_lng)} target="_blank" rel="noreferrer" className="mr-1 inline-flex align-middle text-blue-600" onClick={(e) => e.stopPropagation()} title="Abrir en Google Maps">
                <MapPin className="h-3.5 w-3.5" />
              </a>
            ) : (
              <MapPinOff className="mr-1 inline h-3.5 w-3.5 align-middle text-gray-300" />
            )}
            {o.destination_address}
          </span>
        ),
      },
      {
        key: "destination_district",
        label: "Distrito",
        sort: "destination_district",
        className: "whitespace-nowrap",
        filter: values("destination_district", () => districts.map((d) => ({ value: d.name, label: d.name }))),
        edit: {
          type: "select",
          options: () => districts.map((d) => ({ value: d.name, label: `${d.name} (${priceText(d)})` })),
          get: (o) => o.destination_district ?? "",
          // El distrito del pedido es obligatorio: elegir vacío no cambia nada
          patch: (v) => (v ? { destination_district: v as string } : {}),
        },
        render: (o) => districtName(o.destination_district) || dash,
      },
      {
        key: "product_details",
        label: "Detalles",
        sort: "product_details",
        className: "max-w-[200px] truncate",
        filter: text("product_details"),
        edit: textEdit("product_details"),
        render: (o) => <span title={o.product_details ?? ""}>{o.product_details || dash}</span>,
      },
      {
        key: "packages_count",
        label: "Pqt",
        className: "text-center",
        edit: numberEdit("packages_count", "1"),
        render: (o) => o.packages_count ?? 1,
      },
      {
        key: "status",
        label: "Estado",
        sort: "status",
        className: "whitespace-nowrap",
        filter: values("status", () => ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label }))),
        edit: { type: "select", options: () => ORDER_STATUSES.map((s) => ({ value: s, label: STATUS_META[s].label })), get: (o) => o.status, patch: (v) => ({ status: v as OrderStatus }) },
        render: (o) => <StatusBadge status={o.status} />,
      },
      {
        key: "courier",
        label: "Motorizado",
        sort: "assigned_courier_profile(full_name)",
        className: "whitespace-nowrap",
        filter: values("assigned_courier", () => [{ value: NULL, label: "(sin asignar)" }, ...couriers.map((c) => ({ value: c.id, label: c.full_name ?? "—" }))]),
        edit: { type: "select", options: courierOptions, get: (o) => o.assigned_courier ?? "", patch: (v) => ({ assigned_courier: (v as string) || null }) },
        render: (o) => o.assigned_courier_profile?.full_name ?? <span className="text-muted-foreground">Sin asignar</span>,
      },
      {
        key: "tariff",
        label: "Tarifa",
        sort: "tariff",
        className: "whitespace-nowrap",
        filter: values("tariff", () => [{ value: NULL, label: "(sin tarifa)" }, ...TARIFF_CODES.map((t) => ({ value: t, label: t }))]),
        edit: { type: "select", options: () => [{ value: "", label: "—" }, ...TARIFF_CODES.map((t) => ({ value: t, label: `${t} · S/ ${TARIFF_AMOUNTS[t]}` }))], get: (o) => o.tariff ?? "", patch: (v) => ({ tariff: (v as string) || null }) },
        render: (o) => o.tariff || dash,
      },
      { key: "surcharge", label: "Recarga", className: "text-xs", edit: numberEdit("surcharge", "0.5"), render: (o) => (Number(o.surcharge ?? 0) > 0 ? `R${Number(o.surcharge)}` : dash) },
      { key: "total_amount", label: "Monto servicio", sort: "total_amount", className: "whitespace-nowrap", filter: { kind: "text", apply: (q, v) => (Number.isFinite(Number(v)) ? q.eq("total_amount", Number(v)) : q) }, edit: numberEdit("total_amount"), render: (o) => money(o.total_amount) },
      { key: "amount_to_collect", label: "A cobrar", sort: "amount_to_collect", className: "whitespace-nowrap", filter: { kind: "text", apply: (q, v) => (Number.isFinite(Number(v)) ? q.eq("amount_to_collect", Number(v)) : q) }, edit: numberEdit("amount_to_collect"),
        render: (o) => (
          <span>
            {money(o.amount_to_collect)}
            {o.amount_collected != null && Number(o.amount_collected) !== Number(o.amount_to_collect ?? 0) && (
              <span className="ml-1 text-[11px] font-semibold text-amber-700" title="Lo que realmente cobró el motorizado">
                · cobrado {Number(o.amount_collected).toFixed(2)}
              </span>
            )}
          </span>
        ),
      },
      {
        key: "payment_method",
        label: "Método pago",
        sort: "payment_method",
        className: "whitespace-nowrap",
        filter: values("payment_method", () => [{ value: NULL, label: "(sin definir)" }, ...PAYMENT_METHODS.filter((o) => o.value)]),
        edit: { type: "select", options: () => PAYMENT_METHODS, get: (o) => o.payment_method ?? "", patch: (v) => ({ payment_method: (v as string) || null }) },
        render: (o) => o.payment_method || dash,
      },
      {
        key: "agency_name",
        label: "Agencia",
        className: "whitespace-nowrap text-xs",
        edit: { type: "text", get: (o) => o.agency_name ?? "", patch: (v) => ({ agency_name: (v as string) || null, service_type: v ? "agency" : "delivery" }) },
        render: (o) => o.agency_name || dash,
      },
      { key: "agency_destination", label: "Ciudad", className: "whitespace-nowrap text-xs", edit: textEdit("agency_destination"), render: (o) => o.agency_destination || dash },
      { key: "recipient_dni", label: "DNI", className: "whitespace-nowrap text-xs", edit: textEdit("recipient_dni"), render: (o) => o.recipient_dni || dash },
      { key: "comments", label: "Comentarios", sort: "comments", className: "max-w-[200px] truncate", filter: text("comments"), edit: textEdit("comments"), render: (o) => <span title={o.comments ?? ""}>{o.comments || dash}</span> },
      { key: "delivery_notes", label: "Notas", sort: "delivery_notes", className: "max-w-[200px] truncate", filter: text("delivery_notes"), edit: textEdit("delivery_notes"), render: (o) => <span title={o.delivery_notes ?? ""}>{o.delivery_notes || dash}</span> },
    ];
  }, [couriers, companies, districts]);

  const editableKeys = useMemo(() => columns.filter((c) => c.edit).map((c) => c.key), [columns]);

  // ---------------------------------------------------------------------------
  // Consulta al servidor (filtros, orden, paginación)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const f = debouncedFilters;

    let q: Query = supabase.from("orders").select(
      `
        *,
        companies (name, invoice_igv, t1_rate),
        assigned_courier_profile:profiles!assigned_courier (full_name),
        deliveries (proof_image_url),
        pickups (pickup_number, status)
      `,
      { count: "exact" },
    );
    for (const col of columns) {
      const v = f[col.key];
      if (!col.filter || !isFilterActive(v)) continue;
      if (col.filter.kind === "text" && typeof v === "string") q = col.filter.apply(q, v);
      else if (col.filter.kind === "values" && Array.isArray(v)) q = col.filter.apply(q, v);
      else if (col.filter.kind === "date" && typeof v === "object" && !Array.isArray(v)) q = col.filter.apply(q, v);
    }
    const sortCol = columns.find((c) => c.key === sortConfig.key)?.sort ?? "order_number";
    q = q.order(sortCol, { ascending: sortConfig.direction === "asc", nullsFirst: false });
    if (sortCol !== "order_number") q = q.order("order_number", { ascending: false });

    const from = page * pageSize;
    q.range(from, from + pageSize - 1).then(({ data, error, count }: { data: Order[] | null; error: unknown; count: number | null }) => {
      if (cancelled) return;
      if (error) console.error("Error fetching orders:", error);
      else {
        setOrders(data ?? []);
        setTotalCount(count ?? 0);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [debouncedFilters, sortConfig, page, pageSize, reloadToken, columns]);

  // ---------------------------------------------------------------------------
  // Edición celda a celda
  // ---------------------------------------------------------------------------
  const saveCell = async (order: Order, col: Column, value: CellValue, move?: "next" | "prev") => {
    const edit = col.edit!;
    const current = edit.get(order);
    const changed = String(current ?? "") !== String(value ?? "");
    if (changed) {
      let patch = edit.patch(value, order);
      // Tarifa / recarga / método de pago recalculan el monto del servicio
      if (["tariff", "surcharge", "payment_method"].includes(col.key)) {
        const next = { ...order, ...patch };
        const fee = computeFee({
          tariff: next.tariff,
          surcharge: Number(next.surcharge ?? 0),
          company: order.companies,
          paymentMethod: next.payment_method,
          amountCollected: next.amount_collected ?? next.amount_to_collect ?? 0,
        });
        if (fee != null) patch = { ...patch, total_amount: fee };
      }
      const previous = order;
      setOrders((prev) => prev.map((o) => (o.id === order.id ? ({ ...o, ...patch } as Order) : o)));
      setSavingId(order.id);
      const { data, error } = await supabase.from("orders").update(patch).eq("id", order.id).select("id");
      setSavingId(null);
      if (error || !data || data.length === 0) {
        setOrders((prev) => prev.map((o) => (o.id === order.id ? previous : o)));
        alert("No se pudo guardar: " + ((error as { message?: string } | null)?.message ?? "sin permiso o el pedido ya no existe"));
        setEditing(null);
        return;
      }
      // Empresa/motorizado cambian datos que vienen del join: recargar en segundo plano
      if (col.key === "company" || col.key === "courier") reload();
    }
    if (move) {
      const idx = editableKeys.indexOf(col.key);
      const nextKey = editableKeys[move === "next" ? idx + 1 : idx - 1];
      setEditing(nextKey ? { id: order.id, key: nextKey } : null);
    } else {
      setEditing(null);
    }
  };

  const handleSort = (key: string) =>
    setSortConfig((cur) => ({ key, direction: cur.key === key && cur.direction === "desc" ? "asc" : "desc" }));

  // ---------------------------------------------------------------------------
  // Acciones
  // ---------------------------------------------------------------------------
  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.from("orders").delete().eq("id", deleteTarget.id).select("id");
    setDeleting(false);
    if (error || !data || data.length === 0) {
      alert("No se pudo eliminar: " + ((error as { message?: string } | null)?.message ?? "sin permiso"));
      return;
    }
    setOrders((prev) => prev.filter((o) => o.id !== deleteTarget.id));
    setSelectedOrders((prev) => prev.filter((id) => id !== deleteTarget.id));
    setTotalCount((n) => Math.max(0, n - 1));
    setDeleteTarget(null);
  };

  const handleBulkAssign = async () => {
    if (!bulkCourier || selectedOrders.length === 0) return;
    setIsBulkSubmitting(true);
    const { error } = await supabase.from("orders").update({ assigned_courier: bulkCourier }).in("id", selectedOrders);
    setIsBulkSubmitting(false);
    if (error) {
      alert("Error al asignar motorizado: " + error.message);
      return;
    }
    setSelectedOrders([]);
    setIsSelectionMode(false);
    setIsBulkDialogOpen(false);
    setBulkCourier("");
    reload();
  };

  const onUpdateOrder = async (data: OrderFormValues) => {
    if (!editingOrder) return;
    setUpdateError(null);
    const { data: updated, error } = await supabase
      .from("orders")
      .update({
        tariff: data.tariff || null,
        surcharge: data.surcharge ?? 0,
        total_amount: data.total_amount ?? null,
        delivery_notes: data.delivery_notes || null,
        destination_lat: editDestination?.lat ?? null,
        destination_lng: editDestination?.lng ?? null,
        tariff_zone: editDestination ? (tariffFor(editDestination).zones[0] ?? null) : editingOrder.tariff_zone,
      })
      .eq("id", editingOrder.id)
      .select("id");
    if (error || !updated || updated.length === 0) {
      setUpdateError((error as { message?: string } | null)?.message ?? "No se actualizó ningún registro. Verifica permisos.");
      return;
    }
    setIsDialogOpen(false);
    setEditingOrder(null);
    reload();
  };

  const feeInput = (over: Partial<{ tariff: string | null; surcharge: number }> = {}) => ({
    tariff: over.tariff ?? watchedTariff,
    surcharge: over.surcharge ?? watchedSurcharge,
    company: editingOrder?.companies,
    paymentMethod: editingOrder?.payment_method ?? null,
    amountCollected: editingOrder?.amount_collected ?? editingOrder?.amount_to_collect ?? 0,
  });

  const openManage = (o: Order) => {
    setEditingOrder(o);
    setIsDialogOpen(true);
  };

  const SortIcon = ({ columnKey }: { columnKey: string }) =>
    sortConfig.key !== columnKey ? (
      <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground/50" />
    ) : sortConfig.direction === "asc" ? (
      <ArrowUp className="ml-1 h-3 w-3" />
    ) : (
      <ArrowDown className="ml-1 h-3 w-3" />
    );


  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Pedidos</h1>
        <p className="text-sm text-muted-foreground">
          Haz clic en cualquier celda para editarla · Enter/Tab guarda · Esc cancela · clic derecho para más acciones.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Gestión de Pedidos</CardTitle>
            <div className="flex items-center gap-2">
              {Object.values(filters).some((v) => isFilterActive(v)) && (
                <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
                  <X className="mr-1 h-3.5 w-3.5" /> Limpiar filtros
                </Button>
              )}
              <Button size="sm" variant={isSelectionMode ? "default" : "outline"} onClick={() => setIsSelectionMode((v) => !v)}>
                <CheckSquare className="mr-1 h-3.5 w-3.5" /> {isSelectionMode ? "Salir de selección" : "Seleccionar"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedOrders.length > 0 && (
            <div className="mb-4 flex items-center gap-4 rounded-lg border bg-muted/40 p-2">
              <span className="text-sm font-medium">{selectedOrders.length} seleccionados</span>
              <Button size="sm" onClick={() => setIsBulkDialogOpen(true)}>
                Asignar Motorizado
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setSelectedOrders([])}>
                Quitar selección
              </Button>
            </div>
          )}

          {columns.some((c) => isFilterActive(filters[c.key])) && (
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
              {columns
                .filter((c) => isFilterActive(filters[c.key]))
                .map((c) => {
                  const v = filters[c.key]!;
                  const text =
                    typeof v === "string"
                      ? `contiene "${v}"`
                      : Array.isArray(v)
                        ? (c.filter?.kind === "values" ? c.filter.options().filter((o) => v.includes(o.value)).map((o) => o.label) : v).join(", ")
                        : [v.from && `desde ${v.from}`, v.to && `hasta ${v.to}`].filter(Boolean).join(" ");
                  return (
                    <span key={c.key} className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-primary">
                      <b>{c.label}:</b> <span className="max-w-[260px] truncate">{text}</span>
                      <button type="button" className="ml-1 rounded-full hover:bg-primary/20" onClick={() => setFilters((f) => ({ ...f, [c.key]: undefined }))} aria-label="Quitar filtro">
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
            </div>
          )}

          <div className="overflow-x-auto rounded-md border">
            <table className="w-full min-w-[2400px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  {isSelectionMode && (
                    <th className="w-9 px-2 py-2">
                      <Checkbox
                        checked={orders.length > 0 && selectedOrders.length === orders.length}
                        onCheckedChange={(c) => setSelectedOrders(c ? orders.map((o) => o.id) : [])}
                        aria-label="Seleccionar todo"
                      />
                    </th>
                  )}
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn("whitespace-nowrap px-2 py-2 text-left text-xs font-semibold text-muted-foreground", isFilterActive(filters[col.key]) && "bg-primary/10 text-primary")}
                    >
                      <span className="inline-flex items-center">
                        <span className={cn(col.sort && "cursor-pointer select-none hover:text-foreground")} onClick={() => col.sort && handleSort(col.key)}>
                          {col.label}
                        </span>
                        {col.sort && (
                          <span className="cursor-pointer" onClick={() => handleSort(col.key)}>
                            <SortIcon columnKey={col.key} />
                          </span>
                        )}
                        {col.filter && (
                          <ColumnFilter
                            label={col.label}
                            def={col.filter.kind === "values" ? { kind: "values", options: col.filter.options() } : { kind: col.filter.kind }}
                            value={filters[col.key]}
                            onChange={(v) => setFilters((f) => ({ ...f, [col.key]: v }))}
                          />
                        )}
                      </span>
                    </th>
                  ))}
                  <th className="px-2 py-2 text-left text-xs font-semibold text-muted-foreground">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {loading && orders.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 2} className="py-8 text-center text-muted-foreground">
                      Cargando pedidos…
                    </td>
                  </tr>
                ) : orders.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length + 2} className="py-8 text-center text-muted-foreground">
                      No hay pedidos con esos filtros.
                    </td>
                  </tr>
                ) : (
                  orders.map((order) => {
                    const proof = order.deliveries?.[0]?.proof_image_url ?? null;
                    return (
                      <tr
                        key={order.id}
                        className={cn("border-b hover:bg-muted/30", savingId === order.id && "opacity-60", selectedOrders.includes(order.id) && "bg-primary/5")}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({ x: e.clientX, y: e.clientY, order });
                        }}
                      >
                        {isSelectionMode && (
                          <td className="px-2 py-1">
                            <Checkbox
                              checked={selectedOrders.includes(order.id)}
                              onCheckedChange={(c) => setSelectedOrders((prev) => (c ? [...prev, order.id] : prev.filter((id) => id !== order.id)))}
                            />
                          </td>
                        )}
                        {columns.map((col) =>
                          col.edit ? (
                            <EditableCell
                              key={col.key}
                              value={col.edit.get(order)}
                              type={col.edit.type}
                              options={col.edit.options?.()}
                              step={col.edit.step}
                              display={col.render(order)}
                              editing={editing?.id === order.id && editing.key === col.key}
                              onStartEdit={() => setEditing({ id: order.id, key: col.key })}
                              onCancel={() => setEditing(null)}
                              onSave={(v, move) => void saveCell(order, col, v, move)}
                              className={col.className}
                            />
                          ) : (
                            <td key={col.key} className={cn("px-2 py-1 align-middle", col.className)}>
                              {col.render(order)}
                            </td>
                          ),
                        )}
                        <td className="whitespace-nowrap px-2 py-1">
                          <div className="flex gap-0.5">
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Mapa, pin y tarifa por zona" onClick={() => openManage(order)}>
                              <MapPin className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" title={proof ? "Ver foto de entrega" : "Sin foto"} disabled={!proof} onClick={() => proof && setPreviewImage(proof)}>
                              <Camera className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7 text-red-600 hover:text-red-700" title="Eliminar" onClick={() => setDeleteTarget(order)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex flex-col items-center justify-between gap-3 text-sm sm:flex-row">
            <div className="text-muted-foreground">
              {totalCount === 0 ? "Sin pedidos" : `Mostrando ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, totalCount)} de ${totalCount}`}
              {loading && orders.length > 0 && <Loader2 className="ml-2 inline h-3.5 w-3.5 animate-spin" />}
            </div>
            <div className="flex items-center gap-2">
              <select
                value={pageSize}
                onChange={(e) => {
                  setPageSize(Number(e.target.value));
                  setPage(0);
                }}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                {[25, 50, 100, 200].map((n) => (
                  <option key={n} value={n}>
                    {n} por página
                  </option>
                ))}
              </select>
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tabular-nums">
                {page + 1} / {Math.max(1, Math.ceil(totalCount / pageSize))}
              </span>
              <Button variant="outline" size="sm" disabled={(page + 1) * pageSize >= totalCount} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Menú contextual */}
      {contextMenu && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <MenuItem icon={<MapPin className="mr-2 h-4 w-4" />} label="Mapa y tarifa por zona" onClick={() => openManage(contextMenu.order)} />
            <MenuItem
              icon={<CheckSquare className="mr-2 h-4 w-4" />}
              label="Seleccionar"
              onClick={() => {
                setIsSelectionMode(true);
                setSelectedOrders((prev) => (prev.includes(contextMenu.order.id) ? prev : [...prev, contextMenu.order.id]));
              }}
            />
            <MenuItem
              icon={<Camera className="mr-2 h-4 w-4" />}
              label="Ver foto de entrega"
              disabled={!contextMenu.order.deliveries?.[0]?.proof_image_url}
              onClick={() => setPreviewImage(contextMenu.order.deliveries[0].proof_image_url!)}
            />
            <div className="-mx-1 my-1 h-px bg-muted" />
            <MenuItem icon={<Trash2 className="mr-2 h-4 w-4" />} label="Eliminar" className="text-red-600" onClick={() => setDeleteTarget(contextMenu.order)} />
          </div>
        </div>
      )}

      {/* Confirmación de borrado */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar el pedido #{deleteTarget?.order_number}?</DialogTitle>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <p>
              <b>{deleteTarget?.recipient_name}</b> · {districtName(deleteTarget?.destination_district)} · {deleteTarget?.companies?.name}
            </p>
            <p className="text-muted-foreground">
              Se borran también su historial y la foto de entrega. Esta acción no se puede deshacer. Si solo quieres cancelarlo, cambia el estado a <b>Anulado</b>.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Sí, eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Gestionar: pin + tarifa por zona */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-h-[92dvh] max-w-3xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Pedido #{editingOrder?.order_number} · {editingOrder?.recipient_name}
            </DialogTitle>
          </DialogHeader>
          {updateError && <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-600">{updateError}</div>}
          <form onSubmit={handleSubmit(onUpdateOrder)} className="space-y-5">
            <div className="space-y-2">
              <Label>
                Punto de entrega en el mapa
                {!editDestination && <span className="ml-2 text-xs font-normal text-amber-700">(sin punto: ubícalo para calcular la tarifa y la ruta del motorizado)</span>}
              </Label>
              {isDialogOpen && <LocationPicker value={editDestination} onChange={setEditDestination} heightClass="h-64" />}
            </div>

            {editDestination &&
              (() => {
                const z = tariffFor(editDestination);
                const suggested = computeFee(feeInput({ tariff: z.tariff }));
                return (
                  <div className="flex flex-wrap items-center gap-2 rounded-md border border-sky-200 bg-sky-50 p-2 text-xs text-sky-900">
                    <span>
                      Zona del mapa: <b>{z.zones[0] ?? "fuera de cobertura"}</b>
                      {z.tariff && ` → ${z.tariff} (S/ ${z.amount})`}
                      {z.flags.includes("zona_roja") && " · ⚠ Zona roja"}
                      {z.flags.includes("sin_acceso") && " · ⛔ Sin acceso"}
                    </span>
                    {z.tariff && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7"
                        onClick={() => {
                          setValue("tariff", z.tariff!);
                          if (suggested != null) setValue("total_amount", suggested);
                        }}
                      >
                        Aplicar {z.tariff}
                        {suggested != null && ` · S/ ${suggested}`}
                      </Button>
                    )}
                  </div>
                );
              })()}

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tariff">Tarifa</Label>
                <select
                  id="tariff"
                  {...register("tariff", {
                    onChange: (e) => {
                      const fee = computeFee(feeInput({ tariff: e.target.value }));
                      if (fee != null) setValue("total_amount", fee);
                    },
                  })}
                  className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm"
                >
                  <option value="">Seleccionar...</option>
                  {TARIFF_CODES.map((t) => (
                    <option key={t} value={t}>
                      {t} · S/ {TARIFF_AMOUNTS[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="surcharge">Recarga (S/.)</Label>
                <Input
                  id="surcharge"
                  type="number"
                  step="0.5"
                  min="0"
                  {...register("surcharge", {
                    onChange: (e) => {
                      const fee = computeFee(feeInput({ surcharge: Number(e.target.value || 0) }));
                      if (fee != null) setValue("total_amount", fee);
                    },
                  })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_amount">Monto del servicio</Label>
                <Input id="total_amount" type="number" step="0.01" {...register("total_amount")} />
                {editingOrder?.companies?.invoice_igv && <p className="text-[11px] text-muted-foreground">Comercio con factura: incluye IGV 18%.</p>}
                {editingOrder?.companies?.t1_rate != null && <p className="text-[11px] text-muted-foreground">T1 pactada: S/ {editingOrder.companies.t1_rate}.</p>}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery_notes">Notas de logística</Label>
              <Textarea id="delivery_notes" {...register("delivery_notes")} placeholder="Instrucciones internas, observaciones de entrega..." />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                Cerrar
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Asignación masiva */}
      <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Asignar motorizado a {selectedOrders.length} pedidos</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="bulk-courier">Motorizado</Label>
            <select id="bulk-courier" className="flex h-10 w-full items-center rounded-md border border-input bg-background px-3 py-2 text-sm" value={bulkCourier} onChange={(e) => setBulkCourier(e.target.value)}>
              <option value="">Seleccionar...</option>
              {couriers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.full_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setIsBulkDialogOpen(false)}>
              Cancelar
            </Button>
            <Button onClick={() => void handleBulkAssign()} disabled={!bulkCourier || isBulkSubmitting}>
              {isBulkSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Asignar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Foto de entrega */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="max-w-2xl overflow-hidden border-0 bg-transparent p-0 shadow-none">
          {previewImage && (
            <div className="relative">
              <img src={previewImage} alt="Prueba de entrega" className="h-auto w-full rounded-lg shadow-2xl" />
              <Button className="absolute right-2 top-2 h-8 w-8 rounded-full bg-black/50 p-2 text-white hover:bg-black/70" onClick={() => setPreviewImage(null)}>
                ×
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function MenuItem({ icon, label, onClick, className, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; className?: string; disabled?: boolean }) {
  return (
    <div
      className={cn(
        "relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      onClick={onClick}
    >
      {icon} {label}
    </div>
  );
}
