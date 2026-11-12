import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, PackageSearch, Search } from "lucide-react";
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
import { normalized, number, type StockItem } from "./data";

const PAGE_SIZE = 12;
const filters = [
  { value: "all", label: "Todos" },
  { value: "low", label: "Pocas unidades" },
  { value: "empty", label: "Sin disponible" },
] as const;
type Filter = (typeof filters)[number]["value"];

function Availability({ value }: { value: number }) {
  return (
    <span
      className={cn(
        "inline-flex min-w-10 justify-end font-semibold tabular-nums",
        value <= 0
          ? "text-red-700"
          : value <= 5
            ? "text-amber-800"
            : "text-emerald-700",
      )}
    >
      {number.format(value)}
    </span>
  );
}

export function StockInventory({ items }: { items: StockItem[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");
  const [sort, setSort] = useState("name");
  const [page, setPage] = useState(0);
  const filtered = useMemo(
    () =>
      items
        .filter(
          (item) =>
            normalized(item.product_name).includes(normalized(query.trim())) &&
            (filter === "all" ||
              (filter === "low"
                ? item.available > 0 && item.available <= 5
                : item.available <= 0)),
        )
        .sort((a, b) =>
          sort === "available"
            ? a.available - b.available ||
              a.product_name.localeCompare(b.product_name, "es")
            : a.product_name.localeCompare(b.product_name, "es"),
        ),
    [items, query, filter, sort],
  );
  const currentPage = Math.min(
    page,
    Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1),
  );
  const visible = filtered.slice(
    currentPage * PAGE_SIZE,
    (currentPage + 1) * PAGE_SIZE,
  );
  const clear = () => {
    setQuery("");
    setFilter("all");
    setPage(0);
  };

  return (
    <div>
      <div className="space-y-3 border-b border-slate-200 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="font-semibold text-slate-900">Productos</h2>
            <p className="mt-0.5 text-xs text-slate-500">
              {number.format(items.length)} productos en el almacén de Relámpago
            </p>
          </div>
          <label className="relative block min-w-0 sm:w-64">
            <span className="sr-only">Buscar producto</span>
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
              placeholder="Buscar producto…"
              className="h-11 bg-white pl-9"
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap gap-1.5"
            role="group"
            aria-label="Filtrar disponibilidad"
          >
            {filters.map((option) => (
              <button
                key={option.value}
                type="button"
                aria-pressed={filter === option.value}
                onClick={() => {
                  setFilter(option.value);
                  setPage(0);
                }}
                className={cn(
                  "min-h-11 rounded-md border px-3 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600",
                  filter === option.value
                    ? "border-blue-700 bg-blue-50 text-blue-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-slate-500">
            Ordenar
            <select
              className="min-h-11 max-w-full rounded-md border border-slate-200 bg-white px-2 text-slate-700 focus-visible:outline-blue-600"
              value={sort}
              onChange={(event) => {
                setSort(event.target.value);
                setPage(0);
              }}
            >
              <option value="name">Por nombre</option>
              <option value="available">Menor disponible</option>
            </select>
          </label>
        </div>
      </div>
      {visible.length === 0 ? (
        <div className="space-y-2 px-5 py-12 text-center text-sm text-slate-500">
          <PackageSearch
            className="mx-auto mb-3 h-8 w-8 text-slate-400"
            aria-hidden="true"
          />
          <p className="font-medium text-slate-700">
            {items.length
              ? "No hay productos con estos filtros"
              : "Aún no tienes stock registrado"}
          </p>
          <p>
            {items.length
              ? "Prueba con otro nombre o cambia la disponibilidad."
              : "Tus productos aparecerán aquí cuando se registren en el almacén."}
          </p>
          {items.length > 0 && (
            <Button variant="outline" onClick={clear}>
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
                  <TableHead className="w-[45%] text-xs">Producto</TableHead>
                  <TableHead className="text-right text-xs">
                    En almacén
                  </TableHead>
                  <TableHead className="text-right text-xs">
                    Comprometido
                  </TableHead>
                  <TableHead className="text-right text-xs">
                    Disponible
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map((item) => (
                  <TableRow key={item.id} className="h-14">
                    <TableCell className="break-words font-medium text-slate-800">
                      {item.product_name}
                      {item.unit && (
                        <span className="ml-1 text-xs font-normal text-slate-500">
                          ({item.unit})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {number.format(item.quantity)}
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-slate-500">
                      {number.format(item.reserved)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Availability value={item.available} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <ul
            className="divide-y divide-slate-200 md:hidden"
            aria-label="Productos en almacén"
          >
            {visible.map((item) => (
              <li key={item.id} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 break-words text-sm font-semibold text-slate-800">
                    {item.product_name}
                    {item.unit && (
                      <span className="ml-1 font-normal text-slate-500">
                        ({item.unit})
                      </span>
                    )}
                  </p>
                  <div className="shrink-0 text-right">
                    <Availability value={item.available} />
                    <p className="text-[11px] text-slate-500">Disponible</p>
                  </div>
                </div>
                <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs">
                  <div className="min-w-0 space-y-1">
                    <dt className="text-slate-500">En almacén</dt>
                    <dd className="break-all text-sm font-medium tabular-nums">
                      {number.format(item.quantity)}
                    </dd>
                  </div>
                  <div className="min-w-0 space-y-1">
                    <dt className="text-slate-500">Comprometido</dt>
                    <dd className="break-all text-sm font-medium tabular-nums">
                      {number.format(item.reserved)}
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200 px-4 py-3">
        <p role="status" className="text-xs text-slate-500">
          {filtered.length
            ? `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} de ${number.format(filtered.length)}`
            : "0 productos"}
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label="Página anterior de productos"
            disabled={currentPage === 0}
            onClick={() => setPage(currentPage - 1)}
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            className="h-11 w-11 p-0"
            aria-label="Página siguiente de productos"
            disabled={(currentPage + 1) * PAGE_SIZE >= filtered.length}
            onClick={() => setPage(currentPage + 1)}
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
