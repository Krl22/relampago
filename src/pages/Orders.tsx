import { RowActions, RowActionsButton } from "../components/RowActions";
import { useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../lib/supabase";
import type { Database, OrderStatus } from "../types/database";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { useAuth } from "../components/AuthProvider";
import { downloadOrderBackup, parseOrderBackup } from "../lib/orderBackup";
import { Label } from "../components/ui/label";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Camera,
  CheckSquare,
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  MapPin,
  MapPinOff,
  PackageOpen,
  Trash2,
  Upload,
  Warehouse,
  X,
} from "lucide-react";
import { ORDER_STATUSES, STATUS_META, districtName } from "../lib/orderMeta";
import { priceText, useDistricts } from "../lib/districts";
import { StatusBadge } from "../components/OrderBadges";
import { googleMapsUrl } from "../lib/mapIcons";
import { TARIFF_AMOUNTS, TARIFF_CODES, computeFee } from "../lib/tariff";
import { EditableCell, type CellValue, type EditorType, type Option } from "../components/orders/EditableCell";
import { ColumnFilter, isFilterActive, type FilterValue } from "../components/orders/ColumnFilter";
import { cn } from "@/lib/utils";
import { AdminDeliveryDialog } from "../components/orders/AdminDeliveryDialog";

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
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin";
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
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Order | null>(null);
  const [deliverTarget, setDeliverTarget] = useState<Order | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [bulkDeleteIds, setBulkDeleteIds] = useState<string[] | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState("");
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportScope, setExportScope] = useState<"all" | "selected">("all");
  const [exportFormat, setExportFormat] = useState<"json" | "xlsx">("json");
  const [exporting, setExporting] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const pageSelectedCount = orders.filter((o) => selectedOrders.includes(o.id)).length;

  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .eq("role", "courier")
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
        label: "Fecha de registro",
        sort: "created_at",
        className: "whitespace-nowrap text-xs",
        filter: dateRange("created_at"),
        render: (o) => (o.created_at ? format(new Date(o.created_at), "dd/MM/yy HH:mm", { locale: es }) : dash),
      },
      {
        key: "scheduled_date",
        label: "Fecha de entrega",
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
      if (col.key === "company" || col.key === "courier" || col.key === "origin_type") reload();
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

  const openBulkDelete = () => {
    if (!isAdmin || !selectedOrders.length) return;
    setBulkDeleteIds([...selectedOrders]);
    setBulkDeleteConfirm("");
    setBulkDeleteError(null);
  };

  const confirmBulkDelete = async () => {
    if (!isAdmin || !bulkDeleteIds?.length || bulkDeleteConfirm !== "ELIMINAR" || bulkDeleting) return;
    setBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      const { data, error } = await supabase.rpc("admin_delete_orders", { p_ids: bulkDeleteIds });
      if (error) throw error;
      if (!data || data.length !== bulkDeleteIds.length) throw new Error("No se confirmó el borrado de la selección completa.");
      const deleted = new Set(data);
      setOrders((prev) => prev.filter((o) => !deleted.has(o.id)));
      setSelectedOrders((prev) => prev.filter((id) => !deleted.has(id)));
      setEditing(null);
      setBulkDeleteIds(null);
      setPage(0);
      reload();
    } catch (error) {
      setBulkDeleteError((error as Error).message);
    } finally {
      setBulkDeleting(false);
    }
  };

  const exportOrders = async () => {
    if (!isAdmin || exporting || (exportScope === "selected" && !selectedOrders.length)) return;
    setExporting(true);
    setExportError(null);
    setExportMessage(null);
    try {
      const { data, error } = await supabase.rpc("admin_export_orders", { p_ids: exportScope === "selected" ? [...selectedOrders] : null });
      if (error) throw error;
      const backup = parseOrderBackup(data);
      if (exportScope === "selected" && backup.orders.length !== selectedOrders.length) {
        throw new Error("La selección cambió. Recarga los pedidos antes de descargar.");
      }
      await downloadOrderBackup(backup, exportFormat);
      setExportMessage(`Descarga iniciada: ${backup.orders.length} pedidos. Comprueba que el archivo se guardó y se puede abrir antes de eliminar.`);
    } catch (error) {
      setExportError((error as Error).message);
    } finally {
      setExporting(false);
    }
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
    <div data-page="orders" className="min-w-0 max-w-full space-y-6">
      <div data-page-header="true" className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Pedidos</h1>
        <p className="text-sm text-muted-foreground">
          Haz clic en cualquier celda para editarla · Enter/Tab guarda · Esc cancela · clic derecho para más acciones.
        </p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Gestión de Pedidos</CardTitle>
            <div className="flex flex-wrap items-center gap-2">
              {isAdmin && <Button size="sm" variant="outline" onClick={() => { setExportOpen(true); setExportMessage(null); setExportError(null); }}>
                <Download className="mr-1 h-3.5 w-3.5" /> Descargar información
              </Button>}
              {Object.values(filters).some((v) => isFilterActive(v)) && (
                <Button size="sm" variant="ghost" onClick={() => setFilters({})}>
                  <X className="mr-1 h-3.5 w-3.5" /> Limpiar filtros
                </Button>
              )}
              <Button size="sm" variant={isSelectionMode ? "default" : "outline"} disabled={bulkDeleting} onClick={() => { setIsSelectionMode((v) => !v); setSelectedOrders([]); }}>
                <CheckSquare className="mr-1 h-3.5 w-3.5" /> {isSelectionMode ? "Salir de selección" : "Seleccionar"}
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {selectedOrders.length > 0 && (
            <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border bg-muted/40 p-2">
              <span className="text-sm font-medium">{selectedOrders.length} seleccionados</span>
              <Button size="sm" onClick={() => setIsBulkDialogOpen(true)}>
                Asignar Motorizado
              </Button>
              {isAdmin && <Button size="sm" variant="destructive" disabled={bulkDeleting} onClick={openBulkDelete}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Eliminar seleccionados
              </Button>}
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

          {/* One scroll container keeps the header and row actions visible on both axes. */}
          <div role="region" aria-label="Tabla de pedidos, desplázate para ver todas las columnas" tabIndex={0} className="max-h-[65dvh] w-full max-w-full overflow-auto rounded-md border">
            <table className="w-full min-w-[2400px] border-collapse text-sm">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="sticky left-0 top-0 z-30 w-10 bg-muted px-1 py-2"><span className="sr-only">Opciones</span></th>
                  {isSelectionMode && (
                    <th className="sticky top-0 z-20 w-9 bg-muted px-2 py-2">
                      <Checkbox
                        checked={orders.length > 0 && pageSelectedCount === orders.length ? true : pageSelectedCount > 0 ? "indeterminate" : false}
                        onCheckedChange={(c) => setSelectedOrders((prev) => c ? [...new Set([...prev, ...orders.map((o) => o.id)])] : prev.filter((id) => !orders.some((o) => o.id === id)))}
                        aria-label="Seleccionar pedidos de esta página"
                      />
                    </th>
                  )}
                  {columns.map((col) => (
                    <th
                      key={col.key}
                      className={cn("sticky top-0 z-20 whitespace-nowrap bg-muted px-2 py-2 text-left text-xs font-semibold text-muted-foreground", isFilterActive(filters[col.key]) && "bg-blue-50 text-primary")}
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
                      <RowActions key={order.id} label={`Pedido #${order.order_number}`} actions={[
                        { label: selectedOrders.includes(order.id) ? "Quitar de la selección" : "Seleccionar pedido", icon: CheckSquare, onSelect: () => {
                          setIsSelectionMode(true);
                          setSelectedOrders((prev) => prev.includes(order.id) ? prev.filter((id) => id !== order.id) : [...prev, order.id]);
                        } },
                        { label: "Ver foto de entrega", icon: Camera, disabled: !proof, onSelect: () => { if (proof) setPreviewImage(proof); } },
                        {
                          label: order.status === "delivered" ? "Subir foto de entrega" : "Completar entrega con foto",
                          icon: Upload,
                          disabled: order.status === "cancelled" || (order.status === "delivered" && !!proof),
                          onSelect: () => setDeliverTarget(order),
                        },
                        ...(isAdmin ? [{ label: "Eliminar pedido", icon: Trash2, destructive: true, onSelect: () => setDeleteTarget(order) }] : []),
                      ]}>
                      <tr className={cn("group border-b hover:bg-muted/30", savingId === order.id && "opacity-60", selectedOrders.includes(order.id) && "bg-primary/5")}>
                        <td className="sticky left-0 z-10 w-10 bg-background px-1 py-1 group-hover:bg-muted"><RowActionsButton /></td>
                        {isSelectionMode && (
                          <td className="px-2 py-1">
                            <Checkbox
                              checked={selectedOrders.includes(order.id)}
                              onCheckedChange={(c) => setSelectedOrders((prev) => (c ? [...new Set([...prev, order.id])] : prev.filter((id) => id !== order.id)))}
                              aria-label={`Seleccionar pedido #${order.order_number}`}
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
                      </tr>
                      </RowActions>
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
                aria-label="Pedidos por página"
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
              <Button variant="outline" size="sm" aria-label="Página anterior" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <span className="tabular-nums">
                {page + 1} / {Math.max(1, Math.ceil(totalCount / pageSize))}
              </span>
              <Button variant="outline" size="sm" aria-label="Página siguiente" disabled={(page + 1) * pageSize >= totalCount} onClick={() => setPage((p) => p + 1)}>
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Confirmación de borrado */}
      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar el pedido #{deleteTarget?.order_number}?</DialogTitle>
            <DialogDescription>El borrado del pedido es permanente.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 text-sm">
            <p>
              <b>{deleteTarget?.recipient_name}</b> · {districtName(deleteTarget?.destination_district)} · {deleteTarget?.companies?.name}
            </p>
            <p className="text-muted-foreground">
              Se borran también su historial, ítems y registros de entrega. Las fotos en Storage no se eliminan. Esta acción no se puede deshacer. Si solo quieres cancelarlo, cambia el estado a <b>Anulado</b>.
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

      <Dialog open={!!bulkDeleteIds} onOpenChange={(open) => { if (!open && !bulkDeleting) setBulkDeleteIds(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar {bulkDeleteIds?.length} pedidos seleccionados?</DialogTitle>
            <DialogDescription>
              Se eliminarán permanentemente los pedidos, entregas, historial e ítems. No se borran comercios, usuarios, recojos ni archivos de fotos.
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm">Descarga y revisa el respaldo JSON antes de limpiar datos que quieras conservar. Se incluyen selecciones hechas en otras páginas.</p>
          <Label htmlFor="bulk-delete-confirm">Escribe ELIMINAR para confirmar</Label>
          <Input id="bulk-delete-confirm" value={bulkDeleteConfirm} onChange={(e) => setBulkDeleteConfirm(e.target.value)} disabled={bulkDeleting} autoComplete="off" />
          {bulkDeleteError && <p role="alert" className="text-sm text-red-600">{bulkDeleteError}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={bulkDeleting} onClick={() => setBulkDeleteIds(null)}>Cancelar</Button>
            <Button variant="destructive" disabled={bulkDeleting || bulkDeleteConfirm !== "ELIMINAR"} onClick={() => void confirmBulkDelete()}>
              {bulkDeleting && <Loader2 className="mr-1 h-4 w-4 animate-spin" />} Eliminar {bulkDeleteIds?.length} pedidos
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={exportOpen} onOpenChange={(open) => { if (!exporting) setExportOpen(open); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Descargar información de pedidos</DialogTitle>
            <DialogDescription>La descarga no elimina datos. Guarda y comprueba el archivo antes de limpiar pedidos.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="export-scope">Pedidos a descargar</Label>
            <select id="export-scope" value={exportScope} onChange={(e) => setExportScope(e.target.value as "all" | "selected")} disabled={exporting} className="w-full rounded-md border bg-background p-2 text-sm">
              <option value="all">Todos los pedidos de la base (sin filtros ni paginación)</option>
              <option value="selected" disabled={!selectedOrders.length}>Solo seleccionados ({selectedOrders.length})</option>
            </select>
            <Label htmlFor="export-format">Formato</Label>
            <select id="export-format" value={exportFormat} onChange={(e) => setExportFormat(e.target.value as "json" | "xlsx")} disabled={exporting} className="w-full rounded-md border bg-background p-2 text-sm">
              <option value="json">JSON — respaldo con todos los campos originales</option>
              <option value="xlsx">Excel — consulta de pedidos y registros relacionados</option>
            </select>
          </div>
          <p className="text-xs text-muted-foreground">Incluye entregas, historial, ítems, recojos relacionados y movimientos de stock. Las fotos se conservan como enlaces; no se descargan las imágenes. El JSON es un respaldo de datos de pedidos, no de toda la base, y la app no tiene importación automática.</p>
          {exportError && <p role="alert" className="text-sm text-red-600">{exportError}</p>}
          {exportMessage && <p role="status" className="text-sm text-green-700">{exportMessage}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={exporting} onClick={() => setExportOpen(false)}>Cerrar</Button>
            <Button disabled={exporting || (exportScope === "selected" && !selectedOrders.length)} onClick={() => void exportOrders()}>
              {exporting ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Download className="mr-1 h-4 w-4" />} {exporting ? "Preparando…" : "Descargar archivo"}
            </Button>
          </div>
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

      {deliverTarget && (
        <AdminDeliveryDialog
          key={deliverTarget.id}
          order={deliverTarget}
          onClose={() => setDeliverTarget(null)}
          onDone={(r) => {
            const id = deliverTarget.id;
            setOrders((prev) =>
              prev.map((o) =>
                o.id === id
                  ? { ...o, status: r.status, amount_collected: r.amount_collected, payment_method: r.payment_method, deliveries: [{ proof_image_url: r.proofUrl }, ...(o.deliveries ?? [])] }
                  : o,
              ),
            );
            setDeliverTarget(null);
          }}
        />
      )}

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
