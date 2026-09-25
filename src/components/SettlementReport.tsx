import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";
import { BUSINESS } from "../lib/business";
import { STATUS_META, districtName } from "../lib/orderMeta";
import { chargesService, heldByRelampago, money, type SettlementOrder, type SettlementTotals } from "../lib/settlement";
import { Zap } from "lucide-react";
import { cn } from "@/lib/utils";

export type ReportCompany = { name: string; yape_number: string | null; yape_holder: string | null };

function observations(o: SettlementOrder): string {
  const parts: string[] = [];
  if (Number(o.surcharge ?? 0) > 0) parts.push(`R${Number(o.surcharge)}`);
  if (o.payment_method === "Izipay") parts.push("Izipay: +5% del monto cobrado");
  if (o.amount_collected != null && o.amount_to_collect != null && Number(o.amount_collected) !== Number(o.amount_to_collect))
    parts.push(`Cobrado ${money(Number(o.amount_collected))} de ${money(Number(o.amount_to_collect))}`);
  if (o.delivery_notes) parts.push(o.delivery_notes);
  return parts.join(" // ");
}

/**
 * El reporte de liquidación tal como se le entrega al comercio (imprimible).
 * Lo usan el admin (/liquidaciones) y el comercio (/mis-liquidaciones).
 */
export function SettlementReport({
  company,
  from,
  to,
  orders,
  totals,
  loading,
}: {
  company: ReportCompany;
  from: string;
  to: string;
  orders: SettlementOrder[];
  totals: SettlementTotals;
  loading?: boolean;
}) {
  return (
    <div className="rounded-lg border bg-white p-6 shadow-sm print:border-0 print:p-0 print:shadow-none">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="rounded-full bg-primary p-2 text-white print:bg-primary">
            <Zap className="h-6 w-6 fill-accent text-accent" />
          </div>
          <div>
            <div className="text-xl font-bold uppercase text-primary">{BUSINESS.name}</div>
            <div className="text-xs text-gray-600">RUC: {BUSINESS.ruc}</div>
            <div className="text-xs text-gray-600">{BUSINESS.address}</div>
          </div>
        </div>
        <div className="text-right text-sm">
          <div className="font-semibold">{company.name}</div>
          <div className="text-xs text-gray-600">
            {format(parseISO(from), "d 'de' MMMM", { locale: es })} – {format(parseISO(to), "d 'de' MMMM yyyy", { locale: es })}
          </div>
          {company.yape_number && (
            <div className="text-xs text-gray-600">
              Yape: {company.yape_number}
              {company.yape_holder && ` · ${company.yape_holder}`}
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-3">
        <TotalBox label="Recaudado" value={totals.collected} className="bg-cyan-300" hint="Cobrado por Relámpago (efectivo, cuenta Relámpago, Izipay)" />
        <TotalBox label="Servicio" value={totals.service} className="bg-pink-200" hint={`${totals.counted} pedidos con servicio`} />
        <TotalBox
          label="Saldo"
          value={totals.balance}
          className="bg-yellow-300"
          hint={totals.balance >= 0 ? `${BUSINESS.name} abona al comercio` : "El comercio abona a Relámpago"}
        />
      </div>

      <div className="mt-6 overflow-x-auto">
        {loading ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Cargando…</div>
        ) : orders.length === 0 ? (
          <div className="py-6 text-center text-sm text-muted-foreground">Sin pedidos en este período.</div>
        ) : (
          <Table className="text-xs">
            <TableHeader>
              <TableRow className="bg-gray-100">
                <TableHead className="h-8">Nº Pedido</TableHead>
                <TableHead className="h-8">Destinatario</TableHead>
                <TableHead className="h-8">Distrito</TableHead>
                <TableHead className="h-8">Producto</TableHead>
                <TableHead className="h-8 text-center">Cant</TableHead>
                <TableHead className="h-8 text-right">Monto cobrar</TableHead>
                <TableHead className="h-8">Estado</TableHead>
                <TableHead className="h-8">Método de pago</TableHead>
                <TableHead className="h-8 text-right">Monto servicio</TableHead>
                <TableHead className="h-8">Observaciones</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders.map((o) => {
                const held = heldByRelampago(o);
                const delivered = o.status === "delivered";
                const rowBg = held ? "bg-cyan-100" : delivered ? "bg-green-100" : "";
                return (
                  <TableRow key={o.id} className={cn(rowBg, "hover:bg-inherit")}>
                    <TableCell className="py-1 font-mono">{o.order_number}</TableCell>
                    <TableCell className="py-1">{o.recipient_name}</TableCell>
                    <TableCell className="py-1">{districtName(o.destination_district)}</TableCell>
                    <TableCell className="max-w-[220px] truncate py-1" title={o.product_details ?? ""}>
                      {o.product_details}
                    </TableCell>
                    <TableCell className="py-1 text-center">{o.packages_count ?? 1}</TableCell>
                    <TableCell className="py-1 text-right tabular-nums">{Number(o.amount_to_collect ?? 0).toFixed(0)}</TableCell>
                    <TableCell className="py-1">{STATUS_META[o.status].label}</TableCell>
                    <TableCell className="py-1">{delivered ? (o.payment_method ?? "—") : ""}</TableCell>
                    <TableCell className={cn("py-1 text-right tabular-nums", chargesService(o) && "bg-pink-100")}>
                      {chargesService(o) ? Number(o.total_amount ?? 0).toFixed(2).replace(/\.00$/, "") : ""}
                    </TableCell>
                    <TableCell className="max-w-[260px] py-1 text-[11px]">{observations(o) || (o.status !== "delivered" ? o.comments : "")}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="mt-4 flex flex-wrap gap-4 text-[11px] text-gray-500 print:mt-6">
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-green-200" /> Entregado, cobrado directo por el comercio</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-cyan-200" /> Entregado, dinero en Relámpago (entra en Recaudado)</span>
        <span className="flex items-center gap-1"><span className="h-3 w-3 rounded-sm bg-pink-200" /> Monto del servicio</span>
      </div>
    </div>
  );
}

function TotalBox({ label, value, className, hint }: { label: string; value: number; className: string; hint?: string }) {
  return (
    <div className="flex overflow-hidden rounded-md border">
      <div className="flex w-32 items-center justify-center bg-gray-50 px-3 text-sm font-semibold">{label}:</div>
      <div className={cn("flex-1 px-4 py-2", className)}>
        <div className="text-xl font-bold tabular-nums">{money(value)}</div>
        {hint && <div className="text-[11px] text-gray-700">{hint}</div>}
      </div>
    </div>
  );
}
