import { lazy, Suspense, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ExternalLink } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/database";
import { STATUS_META } from "../../lib/orderMeta";
import { Button } from "../ui/button";
import { PageLoading } from "../design/PageLoading";
import { courierActivityQuery } from "../../lib/courierRecord";

const MapPreview = lazy(() => import("./CourierMapPreview"));
type Location = Database["public"]["Tables"]["courier_locations"]["Row"];
type Event = {
  id: number;
  created_at: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  order: { order_number: number } | null;
  actor: { full_name: string | null } | null;
};
const time = (value: string) =>
  new Intl.DateTimeFormat("es-PE", {
    timeZone: "America/Lima",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

export function CourierLocation({
  courierId,
  refresh,
}: {
  courierId: string;
  refresh: number;
}) {
  const [result, setResult] = useState<{
    key: string;
    location: Location | null;
    error: string | null;
  } | null>(null);
  const key = `${courierId}:${refresh}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    let alive = true;
    Promise.resolve(
      supabase
        .from("courier_locations")
        .select(
          "courier_id,lat,lng,accuracy,heading,speed,recorded_at,updated_at",
        )
        .eq("courier_id", courierId)
        .maybeSingle(),
    )
      .then(({ data, error }) => {
        if (alive)
          setResult({ key, location: data, error: error?.message ?? null });
      })
      .catch((error: unknown) => {
        if (alive)
          setResult({
            key,
            location: null,
            error:
              error instanceof Error
                ? error.message
                : "No se pudo cargar la ubicación.",
          });
      });
    return () => {
      alive = false;
    };
  }, [courierId, refresh, key]);
  if (!current) return <PageLoading />;
  if (current.error)
    return (
      <p
        role="alert"
        className="rounded border bg-red-50 p-4 text-sm text-red-700"
      >
        {current.error}
      </p>
    );
  const point = current.location;
  if (!point)
    return (
      <div className="space-y-2 rounded-lg border bg-white p-6">
        <h2 className="font-semibold">Sin ubicación reportada</h2>
        <p className="text-sm text-muted-foreground">
          Esta cuenta todavía no tiene un punto GPS registrado.
        </p>
      </div>
    );
  if (
    !Number.isFinite(point.lat) ||
    !Number.isFinite(point.lng) ||
    Math.abs(point.lat) > 90 ||
    Math.abs(point.lng) > 180
  )
    return (
      <p
        role="alert"
        className="rounded border bg-red-50 p-4 text-sm text-red-700"
      >
        La ubicación guardada no tiene coordenadas válidas.
      </p>
    );
  return (
    <section className="space-y-4 rounded-lg border bg-white p-4">
      <div>
        <h2 className="font-semibold">Última ubicación reportada</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {time(point.recorded_at)} · hora de Lima
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          Es el último punto guardado; no confirma la presencia actual del
          motorizado. Usa Actualizar para volver a consultarlo.
        </p>
      </div>
      <dl className="grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs text-muted-foreground">Coordenadas</dt>
          <dd className="mt-1 text-sm tabular-nums">
            {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Precisión reportada</dt>
          <dd className="mt-1 text-sm">
            {point.accuracy !== null
              ? `± ${Math.round(point.accuracy)} m`
              : "Sin indicar"}
          </dd>
        </div>
      </dl>
      <Suspense fallback={<PageLoading />}>
        <MapPreview lat={point.lat} lng={point.lng} />
      </Suspense>
      <Button asChild variant="outline">
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${point.lat},${point.lng}`}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink className="mr-2 h-4 w-4" />
          Abrir punto en Google Maps
        </a>
      </Button>
    </section>
  );
}

const eventLabels: Record<string, string> = {
  created: "Pedido creado",
  status_change: "Cambio de estado",
  assigned: "Asignación de motorizado",
};
const statusLabel = (value: string | null) =>
  value && value in STATUS_META
    ? STATUS_META[value as keyof typeof STATUS_META].label
    : value;
export function CourierActivity({
  courierId,
  refresh,
}: {
  courierId: string;
  refresh: number;
}) {
  const [result, setResult] = useState<{
    key: string;
    events: Event[];
    error: string | null;
  } | null>(null);
  const key = `${courierId}:${refresh}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    let alive = true;
    Promise.resolve(courierActivityQuery(supabase, courierId))
      .then(({ data, error }) => {
        if (alive)
          setResult({
            key,
            events: (data ?? []) as unknown as Event[],
            error: error?.message ?? null,
          });
      })
      .catch((error: unknown) => {
        if (alive)
          setResult({
            key,
            events: [],
            error:
              error instanceof Error
                ? error.message
                : "No se pudo cargar la actividad.",
          });
      });
    return () => {
      alive = false;
    };
  }, [courierId, refresh, key]);
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-semibold">Actividad registrada</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Últimos 50 eventos de pedidos: acciones realizadas por esta cuenta y
          asignaciones registradas a su nombre. No incluye inicios de sesión ni
          cambios de perfil.
        </p>
      </div>
      {!current ? (
        <PageLoading />
      ) : current.error ? (
        <p
          role="alert"
          className="rounded border bg-red-50 p-4 text-sm text-red-700"
        >
          {current.error}
        </p>
      ) : current.events.length === 0 ? (
        <p className="rounded border bg-white p-6 text-sm text-muted-foreground">
          No hay eventos registrados para esta cuenta.
        </p>
      ) : (
        <ol className="divide-y rounded-lg border bg-white">
          {current.events.map((event) => (
            <li key={event.id} className="space-y-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-semibold">
                  {eventLabels[event.event_type] ?? event.event_type}
                  {event.order ? ` · pedido #${event.order.order_number}` : ""}
                </p>
                <time
                  dateTime={event.created_at}
                  className="text-xs text-muted-foreground"
                >
                  {time(event.created_at)}
                </time>
              </div>
              <p className="text-xs text-muted-foreground">
                {event.actor?.full_name || "Sistema / usuario no disponible"}
                {event.to_status
                  ? ` · ${event.from_status ? `${statusLabel(event.from_status)} → ` : ""}${statusLabel(event.to_status)}`
                  : ""}
              </p>
            </li>
          ))}
        </ol>
      )}
      <Link
        className="inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
        to="/couriers"
      >
        Ir al listado de motorizados
      </Link>
    </section>
  );
}
