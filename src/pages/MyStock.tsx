import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../lib/supabase";
import { useAuth } from "../components/AuthProvider";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { cn } from "@/lib/utils";

type Item = { id: string; product_name: string; unit: string | null; quantity: number; reserved: number; available: number };
type Movement = {
  id: string;
  delta: number;
  quantity_after: number;
  reason: string;
  created_at: string;
  stock: { product_name: string } | null;
  order: { order_number: number } | null;
};

const REASON: Record<string, string> = {
  entrega: "Pedido entregado",
  correccion: "Corrección de entrega",
  ingreso: "Ingreso al almacén",
  ajuste: "Ajuste de inventario",
  "saldo inicial": "Saldo inicial",
};

/** Stock del comercio en el almacén: lo que hay, lo comprometido en pedidos en curso y sus movimientos. */
export default function MyStock() {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [items, setItems] = useState<Item[] | null>(null);
  const [moves, setMoves] = useState<Movement[]>([]);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    supabase
      .from("stock_availability")
      .select("id, product_name, unit, quantity, reserved, available")
      .eq("company_id", companyId)
      .order("product_name")
      .then(({ data, error }) => {
        if (!alive) return;
        if (error) console.error("Error cargando stock:", error);
        setItems(
          (data ?? []).map((d) => ({
            id: d.id ?? "",
            product_name: d.product_name ?? "",
            unit: d.unit,
            quantity: Number(d.quantity ?? 0),
            reserved: Number(d.reserved ?? 0),
            available: Number(d.available ?? 0),
          })),
        );
      });
    supabase
      .from("stock_movements")
      .select("id, delta, quantity_after, reason, created_at, stock:stock_id (product_name), order:order_id (order_number)")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(50)
      .then(({ data }) => alive && setMoves((data ?? []) as unknown as Movement[]));
    return () => {
      alive = false;
    };
  }, [companyId]);

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Mi stock</h1>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Productos en el almacén de Relámpago</CardTitle>
          <CardDescription>
            <b>Comprometido</b>: unidades en pedidos que aún no se entregan. Se descuentan del stock cuando el pedido se entrega.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0 sm:p-6 sm:pt-0">
          {items === null ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">No tienes productos en el almacén.</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Producto</TableHead>
                    <TableHead className="text-right">En almacén</TableHead>
                    <TableHead className="text-right">Comprometido</TableHead>
                    <TableHead className="text-right">Disponible</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="font-medium">
                        {it.product_name}
                        {it.unit && <span className="ml-1 text-xs text-muted-foreground">({it.unit})</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{it.quantity}</TableCell>
                      <TableCell className="text-right tabular-nums text-amber-700">{it.reserved || "—"}</TableCell>
                      <TableCell className={cn("text-right font-bold tabular-nums", it.available <= 0 ? "text-red-700" : it.available <= 5 ? "text-amber-700" : "text-green-700")}>
                        {it.available}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {moves.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Movimientos recientes</CardTitle>
          </CardHeader>
          <CardContent className="p-0 sm:p-6 sm:pt-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Fecha</TableHead>
                    <TableHead>Producto</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead className="text-right">Cantidad</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {moves.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap text-xs">{format(parseISO(m.created_at), "d MMM HH:mm", { locale: es })}</TableCell>
                      <TableCell className="text-sm">{m.stock?.product_name ?? "—"}</TableCell>
                      <TableCell className="text-sm">
                        {REASON[m.reason] ?? m.reason}
                        {m.order && <span className="text-muted-foreground"> · pedido #{m.order.order_number}</span>}
                      </TableCell>
                      <TableCell className={cn("text-right font-medium tabular-nums", m.delta < 0 ? "text-red-700" : "text-green-700")}>
                        {m.delta > 0 ? `+${m.delta}` : m.delta}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.quantity_after}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
