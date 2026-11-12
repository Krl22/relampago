import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderStatus, PickupStatus } from "../types/database";

export const COMPANY_FIELDS =
  "id,name,ruc,address,district,phone,email,contact_name,yape_number,yape_holder,invoice_igv,t1_rate,skip_cutoff,created_at";
export type CompanyRecord = Pick<
  Database["public"]["Tables"]["companies"]["Row"],
  | "id"
  | "name"
  | "ruc"
  | "address"
  | "district"
  | "phone"
  | "email"
  | "contact_name"
  | "yape_number"
  | "yape_holder"
  | "invoice_igv"
  | "t1_rate"
  | "skip_cutoff"
  | "created_at"
>;
export type RecordSection = "orders" | "pickups" | "settlements";
export type RelatedFilters = {
  search: string;
  status: string;
  from: string;
  to: string;
  page: number;
};
export const RELATED_PAGE_SIZE = 12;
const displayDate = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  dateStyle: "medium",
});
export function recordDate(value: string | null | undefined) {
  if (!value) return "—";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00Z` : value);
  return Number.isNaN(parsed.getTime()) ? "—" : displayDate.format(parsed);
}
export const validCompanyId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const orderStatuses = [
  "pending",
  "picked_up",
  "in_transit",
  "delivered",
  "failed",
  "cancelled",
];
const pickupStatuses = [
  "pending",
  "assigned",
  "picked_up",
  "failed",
  "cancelled",
];

/** Every related list is scoped by commerce before applying user-controlled filters. */
export function companyRelatedQuery(
  client: SupabaseClient<Database>,
  companyId: string,
  section: RecordSection,
  filters: RelatedFilters,
) {
  if (!validCompanyId(companyId))
    throw new Error("El identificador del comercio no es válido.");
  if (!Number.isSafeInteger(filters.page) || filters.page < 0)
    throw new Error("Página no válida.");
  if (
    (filters.from && !/^\d{4}-\d{2}-\d{2}$/.test(filters.from)) ||
    (filters.to && !/^\d{4}-\d{2}-\d{2}$/.test(filters.to)) ||
    (filters.from && filters.to && filters.from > filters.to)
  )
    throw new Error("Revisa el rango de fechas.");
  const search = filters.search
    .trim()
    .replace(/[%_\\]/g, "")
    .slice(0, 120);
  const number =
    /^\d+$/.test(search) && Number.isSafeInteger(Number(search))
      ? Number(search)
      : null;
  const start = filters.page * RELATED_PAGE_SIZE;
  if (!Number.isSafeInteger(start + RELATED_PAGE_SIZE))
    throw new Error("Página no válida.");
  if (section === "orders") {
    let query = client
      .from("orders")
      .select(
        "*, courier:profiles!orders_assigned_courier_fkey(full_name), deliveries(proof_image_url)",
        { count: "exact" },
      )
      .eq("company_id", companyId);
    if (filters.status !== "all") {
      if (!orderStatuses.includes(filters.status))
        throw new Error("Estado no válido.");
      query = query.eq("status", filters.status as OrderStatus);
    }
    if (search)
      query =
        number !== null
          ? query.eq("order_number", number)
          : query.ilike("recipient_name", `%${search}%`);
    if (filters.from) query = query.gte("scheduled_date", filters.from);
    if (filters.to) query = query.lte("scheduled_date", filters.to);
    return query
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(start, start + RELATED_PAGE_SIZE - 1);
  }
  if (section === "pickups") {
    let query = client
      .from("pickups")
      .select("*", { count: "exact" })
      .eq("company_id", companyId);
    if (filters.status !== "all") {
      if (!pickupStatuses.includes(filters.status))
        throw new Error("Estado no válido.");
      query = query.eq("status", filters.status as PickupStatus);
    }
    if (search)
      query =
        number !== null
          ? query.eq("pickup_number", number)
          : query.ilike("address", `%${search}%`);
    if (filters.from) query = query.gte("scheduled_date", filters.from);
    if (filters.to) query = query.lte("scheduled_date", filters.to);
    return query
      .order("scheduled_date", { ascending: false })
      .order("id", { ascending: false })
      .range(start, start + RELATED_PAGE_SIZE - 1);
  }
  if (section !== "settlements") throw new Error("Sección no válida.");
  let query = client
    .from("settlements")
    .select("*", { count: "exact" })
    .eq("company_id", companyId);
  if (filters.status === "paid") query = query.not("paid_at", "is", null);
  else if (filters.status === "unpaid") query = query.is("paid_at", null);
  else if (filters.status !== "all") throw new Error("Estado no válido.");
  if (search) {
    if (number === null) throw new Error("Busca la liquidación por su número.");
    query = query.eq("settlement_number", number);
  }
  if (filters.from) query = query.gte("period_to", filters.from);
  if (filters.to) query = query.lte("period_from", filters.to);
  return query
    .order("period_to", { ascending: false })
    .order("id", { ascending: false })
    .range(start, start + RELATED_PAGE_SIZE - 1);
}
