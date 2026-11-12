import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OrderStatus, PickupStatus } from "../types/database";
import {
  RELATED_PAGE_SIZE,
  validCompanyId,
  type RelatedFilters,
} from "./companyRecord.ts";

export const validCourierId = validCompanyId;
export const COURIER_FIELDS = "id,full_name,email,created_at,role";
export type CourierRecord = Pick<
  Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "full_name" | "email" | "created_at" | "role"
>;

function validate(courierId: string, filters: RelatedFilters) {
  if (!validCourierId(courierId))
    throw new Error("El identificador del motorizado no es válido.");
  const start = filters.page * RELATED_PAGE_SIZE;
  if (
    !Number.isSafeInteger(filters.page) ||
    filters.page < 0 ||
    !Number.isSafeInteger(start + RELATED_PAGE_SIZE)
  )
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
  return { start, search, number };
}

/** Uses the current administrator session and only reads this courier's assignments. */
export function courierOrdersQuery(
  client: SupabaseClient<Database>,
  courierId: string,
  filters: RelatedFilters,
) {
  const { start, search, number } = validate(courierId, filters);
  if (
    ![
      "all",
      "pending",
      "picked_up",
      "in_transit",
      "delivered",
      "failed",
      "cancelled",
    ].includes(filters.status)
  )
    throw new Error("Estado no válido.");
  let query = client
    .from("orders")
    .select(
      "*, company:companies(id,name), courier:profiles!orders_assigned_courier_fkey(full_name), deliveries(proof_image_url)",
      { count: "exact" },
    )
    .eq("assigned_courier", courierId);
  if (filters.status !== "all")
    query = query.eq("status", filters.status as OrderStatus);
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

export function courierPickupsQuery(
  client: SupabaseClient<Database>,
  courierId: string,
  filters: RelatedFilters,
) {
  const { start, search, number } = validate(courierId, filters);
  if (
    ![
      "all",
      "pending",
      "assigned",
      "picked_up",
      "failed",
      "cancelled",
    ].includes(filters.status)
  )
    throw new Error("Estado no válido.");
  let query = client
    .from("pickup_assignments")
    .select(
      "pickup_id,assigned_at,packages_count,picked_up_at,pickup:pickups!inner(*,company:companies(id,name))",
      { count: "exact" },
    )
    .eq("courier_id", courierId);
  if (filters.status !== "all")
    query = query.eq("pickup.status", filters.status as PickupStatus);
  if (search)
    query =
      number !== null
        ? query.eq("pickup.pickup_number", number)
        : query.ilike("pickup.address", `%${search}%`);
  if (filters.from) query = query.gte("pickup.scheduled_date", filters.from);
  if (filters.to) query = query.lte("pickup.scheduled_date", filters.to);
  return query
    .order("assigned_at", { ascending: false })
    .order("pickup_id", { ascending: false })
    .range(start, start + RELATED_PAGE_SIZE - 1);
}
export function courierActivityQuery(
  client: SupabaseClient<Database>,
  courierId: string,
) {
  if (!validCourierId(courierId))
    throw new Error("El identificador del motorizado no es válido.");
  return client
    .from("order_events")
    .select(
      "id,created_at,event_type,from_status,to_status,order:orders(order_number),actor:profiles!order_events_actor_id_fkey(full_name)",
    )
    .or(`actor_id.eq.${courierId},courier_id.eq.${courierId}`)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);
}
