import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Loader2, PackageOpen } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { courierPickupsQuery } from "../../lib/courierRecord";
import { recordDate, RELATED_PAGE_SIZE } from "../../lib/companyRecord";
import type { Database } from "../../types/database";
import { PICKUP_STATUS_META, districtName } from "../../lib/orderMeta";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { cn } from "../../lib/utils";

type Assignment = Pick<
  Database["public"]["Tables"]["pickup_assignments"]["Row"],
  "pickup_id" | "packages_count" | "picked_up_at" | "assigned_at"
> & {
  pickup: Database["public"]["Tables"]["pickups"]["Row"] & {
    company: { id: string; name: string } | null;
  };
};

export function CourierPickups({
  courierId,
  refresh,
}: {
  courierId: string;
  refresh: number;
}) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [status, setStatus] = useState("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [result, setResult] = useState<{
    key: string;
    rows: Assignment[];
    total: number;
    error: string | null;
  } | null>(null);
  const key = JSON.stringify([
    courierId,
    refresh,
    debounced,
    status,
    from,
    to,
    page,
  ]);
  const current = result?.key === key ? result : null;
  const invalidDates = !!from && !!to && from > to;
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebounced(search);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => {
    if (invalidDates) return;
    let alive = true;
    Promise.resolve(
      courierPickupsQuery(supabase, courierId, {
        search: debounced,
        status,
        from,
        to,
        page,
      }),
    )
      .then(({ data, error, count }) => {
        if (alive)
          setResult({
            key,
            rows: (data ?? []) as unknown as Assignment[],
            total: count ?? 0,
            error: error?.message ?? null,
          });
      })
      .catch((error: unknown) => {
        if (alive)
          setResult({
            key,
            rows: [],
            total: 0,
            error:
              error instanceof Error
                ? error.message
                : "No se pudieron cargar los recojos.",
          });
      });
    return () => {
      alive = false;
    };
  }, [
    courierId,
    refresh,
    debounced,
    status,
    from,
    to,
    page,
    key,
    invalidDates,
  ]);
  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-white p-4">
        <h2 className="font-semibold">Recojos asignados</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Incluye asignaciones abiertas y completadas. Distingue lo recibido por
          esta cuenta del total del recojo.
        </p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Dirección o nº de recojo</span>
            <Input
              type="search"
              placeholder="Buscar…"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Estado</span>
            <select
              className="h-10 w-full rounded-md border bg-white px-2 text-sm"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(0);
              }}
            >
              <option value="all">Todos</option>
              {Object.entries(PICKUP_STATUS_META).map(([value, meta]) => (
                <option key={value} value={value}>
                  {meta.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Programado desde</span>
            <Input
              type="date"
              value={from}
              onChange={(event) => {
                setFrom(event.target.value);
                setPage(0);
              }}
            />
          </label>
          <label className="space-y-1 text-xs text-muted-foreground">
            <span>Hasta</span>
            <Input
              type="date"
              value={to}
              onChange={(event) => {
                setTo(event.target.value);
                setPage(0);
              }}
            />
          </label>
        </div>
      </div>
      {invalidDates ? (
        <p role="alert" className="text-sm text-red-700">
          La fecha desde no puede ser posterior a la fecha hasta.
        </p>
      ) : !current ? (
        <p
          role="status"
          className="flex items-center gap-2 p-4 text-sm text-muted-foreground"
        >
          <Loader2 className="h-4 w-4 animate-spin" />
          Cargando recojos…
        </p>
      ) : current.error ? (
        <p
          role="alert"
          className="rounded border bg-red-50 p-4 text-sm text-red-700"
        >
          {current.error}
        </p>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-2">
            {current.rows.map((assignment) => {
              const pickup = assignment.pickup;
              return (
                <article
                  key={assignment.pickup_id}
                  className="space-y-3 rounded-lg border bg-white p-4"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="flex items-center gap-2 text-sm font-semibold">
                      <PackageOpen className="h-4 w-4 text-primary" />
                      Recojo #{pickup.pickup_number}
                    </h3>
                    <span
                      className={cn(
                        "rounded px-2 py-1 text-xs",
                        PICKUP_STATUS_META[pickup.status].badge,
                      )}
                    >
                      {PICKUP_STATUS_META[pickup.status].label}
                    </span>
                  </div>
                  {pickup.company && (
                    <Link
                      className="inline-flex min-h-9 items-center text-sm font-medium text-primary hover:underline"
                      to={`/comercios/${pickup.company.id}`}
                      state={{
                        recordOrigin: {
                          path: `/couriers/${courierId}?tab=pickups`,
                        },
                      }}
                    >
                      {pickup.company.name}
                    </Link>
                  )}
                  <p className="break-words text-sm">
                    {pickup.address} · {districtName(pickup.district)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Programado: {recordDate(pickup.scheduled_date)}
                  </p>
                  <dl className="grid grid-cols-2 gap-3 rounded-md bg-slate-50 p-3 text-xs">
                    <div>
                      <dt className="text-muted-foreground">
                        Recibidos por este motorizado
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {assignment.packages_count ?? "Sin registrar"}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">
                        Total del recojo
                      </dt>
                      <dd className="mt-1 font-semibold">
                        {pickup.received_packages} de{" "}
                        {pickup.packages_count ?? "sin indicar"}
                      </dd>
                    </div>
                  </dl>
                  <p className="text-xs text-muted-foreground">
                    {assignment.picked_up_at
                      ? `Recepción registrada: ${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", dateStyle: "short", timeStyle: "short" }).format(new Date(assignment.picked_up_at))}`
                      : "Todavía no registra una recepción."}
                  </p>
                  {pickup.notes && (
                    <p className="break-words text-xs text-muted-foreground">
                      {pickup.notes}
                    </p>
                  )}
                </article>
              );
            })}
          </div>
          {current.rows.length === 0 && (
            <p className="rounded-md border bg-white p-6 text-center text-sm text-muted-foreground">
              No hay recojos con estos filtros.
            </p>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border bg-white p-3">
            <p role="status" className="text-xs text-muted-foreground">
              {current.total
                ? `${page * RELATED_PAGE_SIZE + 1}–${Math.min((page + 1) * RELATED_PAGE_SIZE, current.total)} de ${current.total}`
                : "0 registros"}
            </p>
            <div className="flex gap-2">
              <Button
                variant="outline"
                disabled={page === 0}
                onClick={() => setPage((value) => value - 1)}
              >
                Anterior
              </Button>
              <Button
                variant="outline"
                disabled={(page + 1) * RELATED_PAGE_SIZE >= current.total}
                onClick={() => setPage((value) => value + 1)}
              >
                Siguiente
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
