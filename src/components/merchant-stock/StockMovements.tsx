import { useMemo, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  History,
  Search,
} from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { cn } from "../../lib/utils";
import {
  MOVEMENT_LIMIT,
  movementDate,
  normalized,
  number,
  reasons,
  type StockMovement,
} from "./data";

function Change({ delta }: { delta: number }) {
  const Icon = delta < 0 ? ArrowUpRight : ArrowDownLeft;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap font-semibold tabular-nums",
        delta < 0 ? "text-red-700" : "text-emerald-700",
      )}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      {delta > 0 ? "+" : ""}
      {number.format(delta)}
    </span>
  );
}

export function RecentStockMovements({ moves }: { moves: StockMovement[] }) {
  return (
    <ul className="divide-y divide-slate-100">
      {moves.slice(0, 4).map((movement) => (
        <li key={movement.id} className="space-y-1 p-4">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words text-sm font-medium text-slate-800">
              {movement.stock?.product_name ?? "Producto no disponible"}
            </p>
            <Change delta={movement.delta} />
          </div>
          <p className="text-xs text-slate-500">
            {reasons[movement.reason] ?? movement.reason}
          </p>
          <time
            className="block text-xs text-slate-400"
            dateTime={movement.created_at}
          >
            {movementDate(movement.created_at)}
          </time>
        </li>
      ))}
    </ul>
  );
}

export function StockMovements({ moves }: { moves: StockMovement[] }) {
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState("all");
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      moves.filter(
        (movement) =>
          normalized(
            `${movement.stock?.product_name ?? ""} ${reasons[movement.reason] ?? movement.reason} ${movement.order?.order_number ?? ""}`,
          ).includes(normalized(query.trim())) &&
          (direction === "all" ||
            (direction === "in" ? movement.delta > 0 : movement.delta < 0)),
      ),
    [moves, query, direction],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / 10) - 1),
  );
  const visible = filtered.slice(currentPage * 10, currentPage * 10 + 10);

  return (
    <div>
      <div className="space-y-3 border-b border-slate-200 p-4">
        <div>
          <h2 className="font-semibold text-slate-900">Movimientos de stock</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Consulta los últimos {MOVEMENT_LIMIT} registros del comercio.
            Horario de Lima.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <label className="relative block min-w-0 flex-1">
            <span className="sr-only">
              Buscar movimiento por producto, motivo o pedido
            </span>
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400"
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setPage(0);
              }}
              placeholder="Producto, motivo o pedido…"
              className="h-11 bg-white pl-9"
            />
          </label>
          <label className="sr-only" htmlFor="stock-movement-direction">
            Tipo de movimiento
          </label>
          <select
            id="stock-movement-direction"
            value={direction}
            onChange={(event) => {
              setDirection(event.target.value);
              setPage(0);
            }}
            className="min-h-11 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 focus-visible:outline-blue-600"
          >
            <option value="all">Todos los movimientos</option>
            <option value="in">Entradas (+)</option>
            <option value="out">Salidas (−)</option>
          </select>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="space-y-2 px-5 py-12 text-center text-sm text-slate-500">
          <History
            aria-hidden="true"
            className="mx-auto mb-3 h-8 w-8 text-slate-400"
          />
          <p className="font-medium text-slate-700">
            {moves.length
              ? "No hay coincidencias en los movimientos recientes"
              : "Todavía no hay movimientos"}
          </p>
          <p>
            {moves.length
              ? "Cambia la búsqueda o el tipo de movimiento."
              : "Los ingresos, ajustes y entregas aparecerán aquí."}
          </p>
          {moves.length > 0 && (
            <Button
              variant="outline"
              onClick={() => {
                setQuery("");
                setDirection("all");
                setPage(0);
              }}
            >
              Limpiar filtros
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="hidden md:block">
            <Table>
              <TableHeader className="bg-slate-50">
                <TableRow>
                  <TableHead className="text-xs">Producto / motivo</TableHead>
                  <TableHead className="text-xs">Fecha</TableHead>
                  <TableHead className="text-right text-xs">Cambio</TableHead>
                  <TableHead className="text-right text-xs">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((movement) => (
                  <TableRow key={movement.id}>
                    <TableCell>
                      <p className="break-words font-medium text-slate-800">
                        {movement.stock?.product_name ??
                          "Producto no disponible"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {reasons[movement.reason] ?? movement.reason}
                        {movement.order &&
                          ` · pedido #${movement.order.order_number}`}
                      </p>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      <time dateTime={movement.created_at}>
                        {movementDate(movement.created_at)}
                      </time>
                    </TableCell>
                    <TableCell className="text-right">
                      <Change delta={movement.delta} />
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number.format(movement.quantity_after)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul
            className="divide-y divide-slate-200 md:hidden"
            aria-label="Movimientos de stock"
          >
            {visible.map((movement) => (
              <li key={movement.id} className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm font-semibold text-slate-800">
                    {movement.stock?.product_name ?? "Producto no disponible"}
                  </p>
                  <Change delta={movement.delta} />
                </div>
                <p className="text-xs text-slate-500">
                  {reasons[movement.reason] ?? movement.reason}
                  {movement.order &&
                    ` · pedido #${movement.order.order_number}`}
                </p>
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <time dateTime={movement.created_at}>
                    {movementDate(movement.created_at)}
                  </time>
                  <span>
                    Saldo:{" "}
                    <b className="font-medium text-slate-700">
                      {number.format(movement.quantity_after)}
                    </b>
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
        <p role="status" className="text-xs text-slate-500">
          {filtered.length
            ? `${currentPage * 10 + 1}–${Math.min((currentPage + 1) * 10, filtered.length)} de ${filtered.length} registros`
            : "0 registros"}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label="Página anterior de movimientos"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label="Página siguiente de movimientos"
            disabled={(currentPage + 1) * 10 >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
