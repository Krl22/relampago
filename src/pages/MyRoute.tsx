import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  MapPinOff,
  Navigation,
  PackageOpen,
  Phone,
  RefreshCw,
  Route as RouteIcon,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { useAuth } from "../components/AuthProvider";
import { useCourierTracking } from "../components/CourierTrackingProvider";
import { TrackingBadge } from "../components/TrackingBadge";
import { OrderBadges } from "../components/OrderBadges";
import { Button } from "../components/ui/button";
import { LIMA_CENTER, type LatLng } from "../lib/geo";
import { ACTIVE_STATUSES, STATUS_META, districtName, formatTimeWindow } from "../lib/orderMeta";
import {
  formatKm,
  googleMapsDirectionsUrl,
  googleMapsMultiStopUrl,
  orderStops,
  routeLength,
  type Stop,
} from "../lib/routing";
import { cn } from "@/lib/utils";

type Order = Database["public"]["Tables"]["orders"]["Row"] & {
  pickups: { pickup_number: number; status: string } | null;
};
type Pickup = Database["public"]["Tables"]["pickups"]["Row"] & { companies: { name: string } | null };

/** Una parada de la ruta: un recojo o una entrega. */
type RouteItem = { kind: "pickup"; id: string; pickup: Pickup } | { kind: "order"; id: string; order: Order };

const PICKUP_COLOR = "#7c3aed";

function stopIcon(n: number, color: string, selected: boolean, isPickup: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="flex h-8 w-8 items-center justify-center ${isPickup ? "rounded-lg" : "rounded-full"} text-sm font-bold text-white shadow-md" style="background:${color};border:3px solid ${selected ? "#111827" : "#fff"}">${n}</div>`,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

const meIcon = L.divIcon({
  className: "",
  html: `<div class="relative h-6 w-6"><span class="absolute inset-0 animate-ping rounded-full bg-blue-500 opacity-40"></span><div class="absolute inset-0 rounded-full border-[3px] border-white bg-blue-600 shadow"></div></div>`,
  iconSize: [24, 24],
  iconAnchor: [12, 12],
});

function FitAll({ points, token }: { points: LatLng[]; token: string }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].lat, points[0].lng], 15);
      return;
    }
    map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 16 });
    // Solo al cargar y al pulsar "Recalcular": no reencuadrar con cada latido del GPS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, map]);
  return null;
}

const itemColor = (it: RouteItem) => (it.kind === "pickup" ? PICKUP_COLOR : STATUS_META[it.order.status]?.dot ? statusHex(it.order.status) : "#6b7280");
const statusHex = (s: string) => ({ in_transit: "#2563eb", pending: "#f59e0b", picked_up: "#7c3aed" })[s] ?? "#6b7280";
const itemTitle = (it: RouteItem) =>
  it.kind === "pickup" ? `Recojo · ${it.pickup.companies?.name ?? "—"}` : (it.order.recipient_name ?? "—");
const itemAddress = (it: RouteItem) =>
  it.kind === "pickup"
    ? `${it.pickup.address}${it.pickup.district ? ` · ${districtName(it.pickup.district)}` : ""}`
    : `${it.order.destination_district ? `${districtName(it.order.destination_district)} · ` : ""}${it.order.destination_address}`;
const itemPhone = (it: RouteItem) => (it.kind === "pickup" ? it.pickup.contact_phone : it.order.recipient_phone);
const itemCoords = (it: RouteItem): LatLng | null =>
  it.kind === "pickup"
    ? it.pickup.lat != null && it.pickup.lng != null
      ? { lat: it.pickup.lat, lng: it.pickup.lng }
      : null
    : it.order.destination_lat != null && it.order.destination_lng != null
      ? { lat: it.order.destination_lat, lng: it.order.destination_lng }
      : null;

export default function MyRoute() {
  const { user } = useAuth();
  const { position, status: trackingStatus } = useCourierTracking();
  const [items, setItems] = useState<RouteItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    Promise.all([
      supabase
        .from("orders")
        .select("*, pickups(pickup_number, status)")
        .eq("assigned_courier", user.id)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: true }),
      supabase
        .from("pickup_assignments")
        .select("pickup_id, picked_up_at, pickups(*, companies(name))")
        .eq("courier_id", user.id)
        .is("picked_up_at", null),
    ]).then(([ordersRes, pickupsRes]) => {
      if (cancelled) return;
      if (ordersRes.error) console.error("Error cargando pedidos:", ordersRes.error);
      if (pickupsRes.error) console.error("Error cargando recojos:", pickupsRes.error);
      const orders = ((ordersRes.data ?? []) as Order[]).map<RouteItem>((o) => ({ kind: "order", id: o.id, order: o }));
      const pickups = ((pickupsRes.data ?? []) as { pickup_id: string; pickups: Pickup | null }[])
        .filter((a) => a.pickups && !["failed", "cancelled", "picked_up"].includes(a.pickups.status))
        .map<RouteItem>((a) => ({ kind: "pickup", id: a.pickup_id, pickup: a.pickups! }));
      setItems([...pickups, ...orders]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [user, reloadToken]);

  // El origen de la ruta se fija con la primera posición GPS (y al recalcular), no con
  // cada latido, para que el orden de paradas no baile mientras el motorizado conduce.
  if (!origin && position) setOrigin(position);

  const recalc = () => {
    setOrigin(position);
    setFitToken((t) => t + 1);
    setLoading(true);
    setReloadToken((t) => t + 1);
  };

  const { ordered, withoutCoords } = useMemo(() => {
    const withCoords = items.filter((it) => itemCoords(it));
    const withoutCoords = items.filter((it) => !itemCoords(it));
    const toStop = (it: RouteItem): Stop<RouteItem> => ({ ...itemCoords(it)!, data: it });

    // Orden: primero los recojos, luego lo que ya está en ruta, luego lo pendiente/recogido.
    // Cada bloque se ordena por cercanía partiendo de donde terminó el anterior.
    const start = origin ?? (withCoords[0] ? toStop(withCoords[0]) : LIMA_CENTER);
    const blocks: ((it: RouteItem) => boolean)[] = [
      (it) => it.kind === "pickup",
      (it) => it.kind === "order" && it.order.status === "in_transit",
      (it) => it.kind === "order" && it.order.status !== "in_transit",
    ];
    const ordered: Stop<RouteItem>[] = [];
    let from: LatLng = start;
    for (const match of blocks) {
      const block = orderStops(from, withCoords.filter(match).map(toStop));
      ordered.push(...block);
      if (block.length) from = block[block.length - 1];
    }
    return { ordered, withoutCoords };
  }, [items, origin]);

  const totalMeters = useMemo(
    () => (origin ? routeLength(origin, ordered) : ordered.length > 1 ? routeLength(ordered[0], ordered.slice(1)) : 0),
    [origin, ordered],
  );

  const polyline = useMemo<[number, number][]>(() => {
    const pts: LatLng[] = origin ? [origin, ...ordered] : ordered;
    return pts.map((p) => [p.lat, p.lng]);
  }, [origin, ordered]);

  const fitPoints = useMemo<LatLng[]>(() => (origin ? [origin, ...ordered] : [...ordered]), [origin, ordered]);
  const fullRouteUrl = googleMapsMultiStopUrl(position ?? origin, ordered);
  const pickupsCount = items.filter((it) => it.kind === "pickup").length;

  return (
    <div className="flex h-dvh flex-col bg-gray-100">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b bg-white px-3 shadow-sm">
        <Link to="/my-deliveries" className="rounded-md p-2 hover:bg-gray-100" aria-label="Volver">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 font-semibold">
            <RouteIcon className="h-4 w-4 text-primary" /> Mi ruta
          </div>
          <div className="truncate text-xs text-muted-foreground">
            {ordered.length} paradas{pickupsCount > 0 && ` (${pickupsCount} recojo${pickupsCount === 1 ? "" : "s"})`}
            {ordered.length > 0 && ` · ${formatKm(totalMeters)} en línea recta`}
          </div>
        </div>
        <TrackingBadge />
        <Button size="icon" variant="ghost" onClick={recalc} title="Recalcular desde mi posición">
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
        </Button>
      </header>

      <div className="relative isolate z-0 min-h-0 flex-1">
        <MapContainer center={[LIMA_CENTER.lat, LIMA_CENTER.lng]} zoom={12} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <FitAll points={fitPoints} token={`${fitToken}-${origin ? 1 : 0}-${items.length}`} />

          {polyline.length > 1 && (
            <Polyline positions={polyline} pathOptions={{ color: "#2563eb", weight: 4, opacity: 0.6, dashArray: "8 8" }} />
          )}

          {position && <Marker position={[position.lat, position.lng]} icon={meIcon} />}

          {ordered.map((s, i) => (
            <Marker
              key={s.data.id}
              position={[s.lat, s.lng]}
              icon={stopIcon(i + 1, itemColor(s.data), s.data.id === selectedId, s.data.kind === "pickup")}
              eventHandlers={{ click: () => setSelectedId(s.data.id) }}
            >
              <Popup>
                <div className="space-y-1 text-sm">
                  <div className="font-bold">
                    {i + 1}. {itemTitle(s.data)}
                  </div>
                  <div className="text-xs text-gray-600">{itemAddress(s.data)}</div>
                  <a
                    className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 underline"
                    href={googleMapsDirectionsUrl(s, position)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <Navigation className="h-3 w-3" /> Navegar
                  </a>
                </div>
              </Popup>
            </Marker>
          ))}
        </MapContainer>

        {trackingStatus !== "active" && (
          <div className="pointer-events-none absolute left-1/2 top-3 z-[500] -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-xs font-medium shadow">
            Sin tu posición GPS la ruta se ordena desde la primera parada.
          </div>
        )}
      </div>

      <div className="max-h-[45dvh] shrink-0 overflow-y-auto border-t bg-white">
        {fullRouteUrl && (
          <div className="sticky top-0 z-10 border-b bg-white p-3">
            <Button asChild className="w-full">
              <a href={fullRouteUrl} target="_blank" rel="noreferrer">
                <Navigation className="mr-2 h-4 w-4" /> Abrir ruta completa en Google Maps
              </a>
            </Button>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Cargando…
          </div>
        ) : ordered.length === 0 && withoutCoords.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">No tienes recojos ni envíos pendientes.</div>
        ) : (
          <ol className="divide-y">
            {ordered.map((s, i) => {
              const it = s.data;
              const phone = itemPhone(it);
              return (
                <li
                  key={it.id}
                  className={cn("flex items-center gap-3 p-3", it.id === selectedId && "bg-primary/5")}
                  onClick={() => setSelectedId(it.id)}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center text-sm font-bold text-white",
                      it.kind === "pickup" ? "rounded-lg" : "rounded-full",
                    )}
                    style={{ background: itemColor(it) }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1 truncate font-medium">
                      {it.kind === "pickup" && <PackageOpen className="h-3.5 w-3.5 shrink-0 text-purple-600" />}
                      {itemTitle(it)}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">{itemAddress(it)}</div>
                    {it.kind === "order" ? (
                      <OrderBadges order={{ ...it.order, pickup_number: it.order.pickups?.pickup_number ?? null }} compact className="mt-1" />
                    ) : (
                      <div className="mt-1 text-[11px] text-purple-800">
                        {it.pickup.packages_count != null && `${it.pickup.packages_count} pqt`}
                        {formatTimeWindow(it.pickup.pickup_after, it.pickup.pickup_before) && ` · ${formatTimeWindow(it.pickup.pickup_after, it.pickup.pickup_before)}`}
                        {it.pickup.contact_name && ` · ${it.pickup.contact_name}`}
                      </div>
                    )}
                  </div>
                  {phone && (
                    <a href={`tel:${phone}`} className="rounded-md p-2 text-gray-600 hover:bg-gray-100" aria-label="Llamar">
                      <Phone className="h-4 w-4" />
                    </a>
                  )}
                  <Button asChild size="sm">
                    <a href={googleMapsDirectionsUrl(s, position)} target="_blank" rel="noreferrer">
                      <Navigation className="mr-1.5 h-4 w-4" /> Ir
                    </a>
                  </Button>
                </li>
              );
            })}
            {withoutCoords.map((it) => (
              <li key={it.id} className="flex items-center gap-3 p-3 text-sm">
                <span
                  className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center bg-gray-200 text-gray-500",
                    it.kind === "pickup" ? "rounded-lg" : "rounded-full",
                  )}
                >
                  <MapPinOff className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 truncate font-medium">
                    {it.kind === "pickup" && <PackageOpen className="h-3.5 w-3.5 shrink-0 text-purple-600" />}
                    {itemTitle(it)}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">Sin punto en el mapa · {itemAddress(it)}</div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <a
                    href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${itemAddress(it)}, Lima`)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink className="mr-1.5 h-4 w-4" /> Buscar
                  </a>
                </Button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
