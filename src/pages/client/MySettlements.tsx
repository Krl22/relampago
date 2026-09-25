import { useEffect, useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/database";
import { useMyCompany } from "../../hooks/useMyCompany";
import { SettlementReport } from "../../components/SettlementReport";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../../components/ui/table";
import { computeSettlement, money, type SettlementOrder } from "../../lib/settlement";
import { Printer } from "lucide-react";
import { cn } from "@/lib/utils";

type Settlement = Database["public"]["Tables"]["settlements"]["Row"];

const ORDER_COLUMNS =
  "id, order_number, recipient_name, destination_district, product_details, packages_count, amount_to_collect, amount_collected, status, payment_method, total_amount, surcharge, delivery_notes, comments, created_at, settlement_id";

/** Liquidaciones del comercio: las ya registradas por Relámpago (imprimibles) y lo acumulado desde la última. */
export default function MySettlements() {
  const { company, companyId } = useMyCompany();
  const [history, setHistory] = useState<Settlement[]>([]);
  const [selected, setSelected] = useState<Settlement | null>(null);
  const [loaded, setLoaded] = useState<{ id: string; orders: SettlementOrder[] } | null>(null);
  const [pendingOrders, setPendingOrders] = useState<SettlementOrder[]>([]);
  const orders = selected && loaded?.id === selected.id ? loaded.orders : [];
  const loading = !!selected && loaded?.id !== selected.id;

  useEffect(() => {
    if (!companyId) return;
    supabase
      .from("settlements")
      .select("*")
      .eq("company_id", companyId)
      .order("period_to", { ascending: false })
      .limit(50)
      .then(({ data }) => setHistory(data ?? []));
    // Entregados que todavía no entran en ninguna liquidación
    supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("company_id", companyId)
      .is("settlement_id", null)
      .in("status", ["delivered", "failed"])
      .order("created_at", { ascending: true })
      .limit(1000)
      .then(({ data }) => setPendingOrders((data ?? []) as SettlementOrder[]));
  }, [companyId]);

  useEffect(() => {
    if (!selected) return;
    let cancelled = false;
    supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("settlement_id", selected.id)
      .order("created_at", { ascending: true })
      .limit(2000)
      .then(({ data }) => {
        if (cancelled) return;
        setLoaded({ id: selected.id, orders: (data ?? []) as SettlementOrder[] });
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  const pendingTotals = useMemo(() => computeSettlement(pendingOrders), [pendingOrders]);
  const selectedTotals = useMemo(
    () =>
      selected
        ? { collected: Number(selected.collected), service: Number(selected.service), balance: Number(selected.balance), counted: selected.orders_count }
        : computeSettlement([]),
    [selected],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-3xl font-bold">Mis liquidaciones</h1>
        {selected && (
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>
              Cerrar
            </Button>
            <Button variant="outline" onClick={() => window.print()} disabled={loading}>
              <Printer className="mr-2 h-4 w-4" /> Imprimir / PDF
            </Button>
          </div>
        )}
      </div>

      {selected && company ? (
        <SettlementReport company={company} from={selected.period_from} to={selected.period_to} orders={orders} totals={selectedTotals} loading={loading} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Por liquidar</CardTitle>
              <CardDescription>Pedidos entregados que aún no entran en una liquidación. Relámpago la registra y te la envía.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-4">
              <Stat label="Pedidos" value={String(pendingTotals.counted)} />
              <Stat label="Recaudado" value={money(pendingTotals.collected)} hint="Dinero cobrado por Relámpago" />
              <Stat label="Servicio" value={money(pendingTotals.service)} />
              <Stat
                label="Saldo"
                value={money(pendingTotals.balance)}
                className={pendingTotals.balance >= 0 ? "text-green-700" : "text-red-700"}
                hint={pendingTotals.balance >= 0 ? "A tu favor" : "A favor de Relámpago"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Liquidaciones registradas</CardTitle>
            </CardHeader>
            <CardContent className="p-0 sm:p-6 sm:pt-0">
              {history.length === 0 ? (
                <div className="px-6 py-8 text-center text-sm text-muted-foreground sm:px-0">Todavía no tienes liquidaciones registradas.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Período</TableHead>
                        <TableHead className="text-right">Recaudado</TableHead>
                        <TableHead className="text-right">Servicio</TableHead>
                        <TableHead className="text-right">Saldo</TableHead>
                        <TableHead>Pedidos</TableHead>
                        <TableHead>Pago</TableHead>
                        <TableHead></TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {history.map((s) => (
                        <TableRow key={s.id} className="cursor-pointer" onClick={() => setSelected(s)}>
                          <TableCell className="font-mono text-xs">{s.settlement_number}</TableCell>
                          <TableCell className="whitespace-nowrap text-xs">
                            {format(parseISO(s.period_from), "d MMM", { locale: es })} – {format(parseISO(s.period_to), "d MMM yyyy", { locale: es })}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{money(Number(s.collected))}</TableCell>
                          <TableCell className="text-right tabular-nums">{money(Number(s.service))}</TableCell>
                          <TableCell className={cn("text-right font-semibold tabular-nums", Number(s.balance) >= 0 ? "text-green-700" : "text-red-700")}>
                            {money(Number(s.balance))}
                          </TableCell>
                          <TableCell>{s.orders_count}</TableCell>
                          <TableCell className="text-xs">
                            {s.paid_at ? (
                              <span className="text-green-700">
                                Pagado {format(parseISO(s.paid_at), "d/MM")}
                                {s.paid_reference && ` · ${s.paid_reference}`}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Pendiente</span>
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button size="sm" variant="outline" className="h-7">
                              Ver
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, hint, className }: { label: string; value: string; hint?: string; className?: string }) {
  return (
    <div className="rounded-md border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn("text-xl font-bold tabular-nums", className)}>{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground">{hint}</div>}
    </div>
  );
}
