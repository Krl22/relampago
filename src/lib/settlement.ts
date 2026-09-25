import type { Database } from "../types/database";
import { RELAMPAGO_HELD_METHODS } from "./tariff";

export type SettlementOrder = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "id"
  | "order_number"
  | "recipient_name"
  | "destination_district"
  | "product_details"
  | "packages_count"
  | "amount_to_collect"
  | "amount_collected"
  | "status"
  | "payment_method"
  | "total_amount"
  | "surcharge"
  | "delivery_notes"
  | "comments"
  | "created_at"
  | "settlement_id"
>;

/** Lo que efectivamente se cobró (si el motorizado no lo registró, el monto previsto). */
export const collectedOf = (o: SettlementOrder) =>
  Number(o.amount_collected ?? o.amount_to_collect ?? 0);

/** ¿Este pedido suma a "Recaudado"? Entregado y el dinero quedó en Relámpago. */
export const heldByRelampago = (o: SettlementOrder) =>
  o.status === "delivered" && !!o.payment_method && RELAMPAGO_HELD_METHODS.includes(o.payment_method);

/** ¿Este pedido cobra servicio? Entregados siempre; fallidos solo si el admin les puso monto. */
export const chargesService = (o: SettlementOrder) =>
  o.status === "delivered" || (o.status === "failed" && Number(o.total_amount ?? 0) > 0);

export type SettlementTotals = { collected: number; service: number; balance: number; counted: number };

export function computeSettlement(orders: SettlementOrder[]): SettlementTotals {
  let collected = 0;
  let service = 0;
  let counted = 0;
  for (const o of orders) {
    if (heldByRelampago(o)) collected += collectedOf(o);
    if (chargesService(o)) {
      service += Number(o.total_amount ?? 0);
      counted++;
    }
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  return { collected: r(collected), service: r(service), balance: r(collected - service), counted };
}

export const money = (n: number) => `S/ ${n.toFixed(2)}`;
