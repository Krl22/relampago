import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

export type StockItem = {
  id: string;
  product_name: string;
  unit: string | null;
  quantity: number;
  reserved: number;
  available: number;
};
export type StockMovement = {
  id: string;
  delta: number;
  quantity_after: number;
  reason: string;
  created_at: string;
  stock: { product_name: string } | null;
  order: { order_number: number } | null;
};
export const MOVEMENT_LIMIT = 50;
export const reasons: Record<string, string> = {
  entrega: "Pedido entregado",
  correccion: "Corrección de entrega",
  ingreso: "Ingreso al almacén",
  ajuste: "Ajuste de inventario",
  "saldo inicial": "Saldo inicial",
};
export const number = new Intl.NumberFormat("es-PE");
const date = new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima",
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
export const movementDate = (value: string) => date.format(new Date(value));
export const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("es");

type Snapshot = {
  items: StockItem[];
  moves: StockMovement[];
  stockError: string | null;
  movementError: string | null;
  updatedAt: string | null;
};

/** Only the existing company-scoped read endpoints are used. Requests are discarded on unmount. */
export function useMerchantStock(companyId: string) {
  const [snapshot, setSnapshot] = useState<Snapshot>({
    items: [],
    moves: [],
    stockError: null,
    movementError: null,
    updatedAt: null,
  });
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase
        .from("stock_availability")
        .select("id, product_name, unit, quantity, reserved, available")
        .eq("company_id", companyId)
        .order("product_name"),
      supabase
        .from("stock_movements")
        .select(
          "id, delta, quantity_after, reason, created_at, stock:stock_id (product_name), order:order_id (order_number)",
        )
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .order("id")
        .limit(MOVEMENT_LIMIT),
    ])
      .then(([stock, movements]) => {
        if (!alive) return;
        setSnapshot({
          items: stock.error
            ? []
            : (stock.data ?? []).map((item) => ({
                id: item.id ?? "",
                product_name: item.product_name ?? "",
                unit: item.unit,
                quantity: Number(item.quantity ?? 0),
                reserved: Number(item.reserved ?? 0),
                available: Number(item.available ?? 0),
              })),
          moves: movements.error
            ? []
            : ((movements.data ?? []) as unknown as StockMovement[]),
          stockError: stock.error
            ? "No se pudo consultar el inventario. Actualiza para volver a intentarlo."
            : null,
          movementError: movements.error
            ? "No se pudieron consultar los movimientos. Actualiza para volver a intentarlo."
            : null,
          updatedAt: new Date().toISOString(),
        });
      })
      .catch(() => {
        if (alive)
          setSnapshot({
            items: [],
            moves: [],
            stockError: "No se pudo conectar. Revisa tu conexión y actualiza.",
            movementError: "No se pudieron cargar los movimientos.",
            updatedAt: null,
          });
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [companyId, reload]);

  const refresh = () => {
    setLoading(true);
    setReload((value) => value + 1);
  };
  return { ...snapshot, loading, refresh };
}
