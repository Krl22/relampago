type FulfillmentOrder = {
  origin_type: string;
  status: string;
  pickups: { status: string } | null;
};

/** Address pickups must be received; warehouse orders need explicit withdrawal. */
export function isReadyForRoute(order: FulfillmentOrder): boolean {
  return order.status === "picked_up" || order.status === "in_transit" ||
    (order.status === "pending" && order.origin_type === "pickup" && order.pickups?.status === "picked_up");
}
