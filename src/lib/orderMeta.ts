import type { OrderStatus, OriginType, PickupStatus, ServiceType } from "../types/database";

/** Etiquetas y colores de estado de pedido (Tailwind). */
export const STATUS_META: Record<OrderStatus, { label: string; badge: string; dot: string }> = {
  pending: { label: "Pendiente", badge: "bg-yellow-100 text-yellow-800", dot: "bg-yellow-500" },
  picked_up: { label: "Recogido", badge: "bg-purple-100 text-purple-800", dot: "bg-purple-500" },
  in_transit: { label: "En ruta", badge: "bg-blue-100 text-blue-800", dot: "bg-blue-500" },
  delivered: { label: "Entregado", badge: "bg-green-100 text-green-800", dot: "bg-green-500" },
  failed: { label: "No entregado", badge: "bg-red-100 text-red-800", dot: "bg-red-500" },
  cancelled: { label: "Anulado", badge: "bg-gray-200 text-gray-700", dot: "bg-gray-400" },
};
export const ORDER_STATUSES = Object.keys(STATUS_META) as OrderStatus[];
/** Estados que siguen "vivos" para el motorizado y el mapa. */
export const ACTIVE_STATUSES: OrderStatus[] = ["pending", "picked_up", "in_transit"];

export const PICKUP_STATUS_META: Record<PickupStatus, { label: string; badge: string }> = {
  pending: { label: "Sin asignar", badge: "bg-yellow-100 text-yellow-800" },
  assigned: { label: "Asignado", badge: "bg-blue-100 text-blue-800" },
  picked_up: { label: "Recogido", badge: "bg-green-100 text-green-800" },
  failed: { label: "Fallido", badge: "bg-red-100 text-red-800" },
  cancelled: { label: "Anulado", badge: "bg-gray-200 text-gray-700" },
};

export const SERVICE_META: Record<ServiceType, { label: string; badge: string; hint: string }> = {
  delivery: { label: "Entrega", badge: "bg-gray-100 text-gray-700", hint: "Entrega normal" },
  exchange: { label: "Cambio", badge: "bg-orange-100 text-orange-800", hint: "Entregar y recoger otra prenda/producto" },
  return: { label: "Retorno", badge: "bg-pink-100 text-pink-800", hint: "Solo recoger del destinatario y traer" },
  agency: { label: "Agencia", badge: "bg-indigo-100 text-indigo-800", hint: "Dejar en agencia para provincia" },
};

export const ORIGIN_META: Record<OriginType, string> = {
  warehouse: "Almacén",
  pickup: "Recojo",
};

/** "10:00–17:00", "hasta 17:00", "desde 10:00" o null. Las horas vienen como "HH:MM:SS". */
export function formatTimeWindow(after: string | null | undefined, before: string | null | undefined): string | null {
  const a = after ? after.slice(0, 5) : null;
  const b = before ? before.slice(0, 5) : null;
  if (a && b) return `${a}–${b}`;
  if (a) return `desde ${a}`;
  if (b) return `hasta ${b}`;
  return null;
}

/** Nombre del distrito sin la tarifa embebida: "Ate (s/10.00 - s/13.00)" -> "Ate". */
export const districtName = (d: string | null | undefined) => (d ? d.split(" (")[0] : "");

// La lista de distritos vive en la base (public.districts): ver src/lib/districts.ts

export const isAgencyDistrict = (d: string | null | undefined) => /agencia/i.test(d ?? "");
