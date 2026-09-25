import { Warehouse, PackageOpen, Wallet } from "lucide-react";
import type { Database, OrderStatus } from "../types/database";
import { ORIGIN_META, SERVICE_META, STATUS_META } from "../lib/orderMeta";
import { cn } from "@/lib/utils";

type OrderLike = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "origin_type"
  | "service_type"
  | "amount_to_collect"
  | "agency_name"
  | "agency_destination"
> & { pickup_number?: number | null };

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  const meta = STATUS_META[status] ?? STATUS_META.pending;
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", meta.badge, className)}>
      {meta.label}
    </span>
  );
}

/**
 * Chips compactos con lo que el motorizado/admin necesita ver de un vistazo:
 * origen (almacén / recojo #n), agencia y monto a cobrar.
 */
export function OrderBadges({ order, className, compact = false }: { order: OrderLike; className?: string; compact?: boolean }) {
  const service = SERVICE_META[order.service_type] ?? SERVICE_META.delivery;
  const chip = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap";
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {order.origin_type === "pickup" ? (
        <span className={cn(chip, "bg-purple-100 text-purple-800")} title="El paquete se recoge en una dirección">
          <PackageOpen className="h-3 w-3" /> {ORIGIN_META.pickup}
          {order.pickup_number ? ` #${order.pickup_number}` : ""}
        </span>
      ) : (
        !compact && (
          <span className={cn(chip, "bg-gray-100 text-gray-600")} title="Sale del almacén de Relámpago">
            <Warehouse className="h-3 w-3" /> {ORIGIN_META.warehouse}
          </span>
        )
      )}
      {order.service_type !== "delivery" && (
        <span className={cn(chip, service.badge)} title={service.hint}>
          {service.label}
          {order.service_type === "agency" && order.agency_name ? `: ${order.agency_name}` : ""}
          {order.service_type === "agency" && order.agency_destination ? ` → ${order.agency_destination}` : ""}
        </span>
      )}
      {(order.amount_to_collect ?? 0) > 0 && (
        <span className={cn(chip, "bg-emerald-100 text-emerald-800")} title="Cobrar al destinatario">
          <Wallet className="h-3 w-3" /> S/ {Number(order.amount_to_collect).toFixed(2)}
        </span>
      )}
    </div>
  );
}
