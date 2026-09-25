import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { addDays, format, isToday, parseISO, startOfDay, subDays } from "date-fns";
import {
  CheckCircle,
  ExternalLink,
  Inbox,
  Loader2,
  LocateFixed,
  MapPin,
  Phone,
  RefreshCw,
  Truck,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  LIMA_CENTER,
  distanceMeters,
  kmh,
  presenceFor,
  timeAgo,
  type CourierPresence,
  type LatLng,
} from "../lib/geo";
import { PRESENCE, courierMarkerIcon, deliveryMarkerIcon, googleMapsUrl, trailColorFor } from "../lib/mapIcons";
import { isStaffRole } from "../lib/profiles";
import { formatKm } from "../lib/routing";
import { ACTIVE_STATUSES } from "../lib/orderMeta";
import { cn } from "@/lib/utils";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type CourierLocation = Database["public"]["Tables"]["courier_locations"]["Row"];
type OrderLite = Pick<
  Database["public"]["Tables"]["orders"]["Row"],
  | "id"
  | "status"
  | "assigned_courier"
  | "recipient_name"
  | "recipient_phone"
  | "destination_district"
  | "destination_address"
  | "destination_lat"
  | "destination_lng"
  | "created_at"
>;
type TrailPoint = { lat: number; lng: number; recorded_at: string };
type PickupPin = {
  id: string;
  pickup_number: number;
  address: string;
  district: string | null;
  lat: number | null;
  lng: number | null;
  status: string;
  packages_count: number | null;
  companies: { name: string } | null;
  pickup_assignments: { courier_id: string; picked_up_at: string | null }[];
};
type DeliveryEvent = {
  id: number;
  actor_id: string | null;
  lat: number | null;
  lng: number | null;
  created_at: string;
  orders: { recipient_name: string | null; destination_district: string | null } | null;
};

type CourierView = {
  profile: Profile;
  location: CourierLocation | null;
  presence: CourierPresence;
  pending: number;
  inTransit: number;
  current: OrderLite | null;
  color: string;
  trailMeters: number | null;
};

const ORDER_LITE_COLUMNS =
  "id,status,assigned_courier,recipient_name,recipient_phone,destination_district,destination_address,destination_lat,destination_lng,created_at";
const POLL_MS = 30_000;
const HISTORY_DAYS = 7;

const ORDER_PIN: Record<string, string> = { pending: "#f59e0b", picked_up: "#7c3aed", in_transit: "#2563eb" };

function pickupPinIcon(faded: boolean) {
  return L.divIcon({
    className: "",
    html: `<div class="flex h-7 w-7 items-center justify-center rounded-lg border-2 border-white bg-purple-600 text-white shadow" style="opacity:${faded ? 0.55 : 1}"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg></div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -14],
  });
}

function orderPinIcon(status: string, faded: boolean) {
  const color = ORDER_PIN[status] ?? "#6b7280";
  return L.divIcon({
    className: "",
    html: `<div class="flex h-6 w-6 items-center justify-center" style="opacity:${faded ? 0.55 : 1}"><svg width="24" height="24" viewBox="0 0 24 24" fill="${color}" stroke="#fff" stroke-width="1.5"><path d="M12 22s7-7.1 7-12a7 7 0 1 0-14 0c0 4.9 7 12 7 12z"/><circle cx="12" cy="10" r="2.5" fill="#fff" stroke="none"/></svg></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 22],
    popupAnchor: [0, -20],
  });
}

/** Distancia recorrida según el historial, ignorando saltos absurdos del GPS (> 2 km entre puntos). */
function trailDistance(points: TrailPoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = distanceMeters(points[i - 1], points[i]);
    if (d < 2000) total += d;
  }
  return total;
}

/** Encuadra todos los marcadores al inicio y vuela al motorizado seleccionado. */
function MapController({ focus, fitPoints, fitToken }: { focus: LatLng | null; fitPoints: LatLng[]; fitToken: number }) {
  const map = useMap();
  const fittedRef = useRef(false);

  useEffect(() => {
    if (fitPoints.length === 0) return;
    if (fittedRef.current && fitToken === 0) return;
    map.fitBounds(L.latLngBounds(fitPoints.map((p) => [p.lat, p.lng])), { padding: [40, 40], maxZoom: 15 });
    fittedRef.current = true;
    // fitToken cambia cuando el usuario pulsa "Centrar"; fitPoints solo la primera vez.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken, fitPoints.length > 0, map]);

  useEffect(() => {
    if (!focus) return;
    map.flyTo([focus.lat, focus.lng], Math.max(map.getZoom(), 15), { duration: 0.8 });
  }, [focus, map]);

  return null;
}

export default function CourierMap() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [locations, setLocations] = useState<Record<string, CourierLocation>>({});
  const [orders, setOrders] = useState<OrderLite[]>([]);
  const [pickupPins, setPickupPins] = useState<PickupPin[]>([]);
  const [deliveredToday, setDeliveredToday] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [onlyActive, setOnlyActive] = useState(false);
  const [showTrails, setShowTrails] = useState(false);
  const [showOrders, setShowOrders] = useState(true);
  const [day, setDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [trails, setTrails] = useState<Record<string, TrailPoint[]>>({});
  const [deliveries, setDeliveries] = useState<DeliveryEvent[]>([]);
  const [trailsLoading, setTrailsLoading] = useState(false);
  const [fitToken, setFitToken] = useState(0);
  const [, setTick] = useState(0);
  const markerRefs = useRef<Record<string, L.Marker | null>>({});

  const dayStart = useMemo(() => startOfDay(parseISO(day)), [day]);
  const dayEnd = useMemo(() => addDays(dayStart, 1), [dayStart]);
  const viewingToday = isToday(dayStart);

  const loadOrders = useCallback(async () => {
    const todayIso = startOfDay(new Date()).toISOString();
    const [activeRes, deliveredRes] = await Promise.all([
      supabase
        .from("orders")
        .select(ORDER_LITE_COLUMNS)
        .in("status", ACTIVE_STATUSES)
        .order("created_at", { ascending: true }),
      supabase
        .from("orders")
        .select("id", { count: "exact", head: true })
        .eq("status", "delivered")
        .gte("delivered_at", todayIso),
    ]);
    if (activeRes.data) setOrders(activeRes.data as OrderLite[]);
    setDeliveredToday(deliveredRes.count ?? 0);

    const { data: pk } = await supabase
      .from("pickups")
      .select("id, pickup_number, address, district, lat, lng, status, packages_count, companies(name), pickup_assignments(courier_id, picked_up_at)")
      .in("status", ["pending", "assigned"])
      .eq("scheduled_date", format(new Date(), "yyyy-MM-dd"));
    setPickupPins(((pk ?? []) as unknown as PickupPin[]).filter((p) => p.lat != null && p.lng != null));
  }, []);

  const loadLocations = useCallback(async () => {
    const { data, error } = await supabase.from("courier_locations").select("*");
    if (error) {
      console.error("Error cargando ubicaciones:", error);
      return;
    }
    const next: Record<string, CourierLocation> = {};
    for (const row of (data ?? []) as CourierLocation[]) next[row.courier_id] = row;
    setLocations(next);
  }, []);

  const loadAll = useCallback(async () => {
    setRefreshing(true);
    try {
      const { data } = await supabase
        .from("profiles")
        .select("*")
        .eq("is_courier", true)
        .order("full_name", { ascending: true });
      if (data) setProfiles(data);
      await Promise.all([loadLocations(), loadOrders()]);
    } catch (error) {
      console.error("Error cargando mapa:", error);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [loadLocations, loadOrders]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  // Realtime: ubicaciones y pedidos. El polling es respaldo por si Realtime no está habilitado.
  useEffect(() => {
    const channel = supabase
      .channel("courier-map")
      .on("postgres_changes", { event: "*", schema: "public", table: "courier_locations" }, (payload) => {
        if (payload.eventType === "DELETE") {
          const old = payload.old as Partial<CourierLocation>;
          if (old.courier_id) {
            setLocations((prev) => {
              const next = { ...prev };
              delete next[old.courier_id!];
              return next;
            });
          }
          return;
        }
        const row = payload.new as CourierLocation;
        setLocations((prev) => ({ ...prev, [row.courier_id]: row }));
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, () => {
        void loadOrders();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "pickups" }, () => {
        void loadOrders();
      })
      .subscribe((status) => setRealtime(status === "SUBSCRIBED"));

    const poll = setInterval(() => {
      void loadLocations();
      void loadOrders();
    }, POLL_MS);
    const tick = setInterval(() => setTick((t) => t + 1), 30_000);

    return () => {
      void supabase.removeChannel(channel);
      clearInterval(poll);
      clearInterval(tick);
    };
  }, [loadLocations, loadOrders]);

  // Recorridos y entregas del día elegido (de todos los que reparten)
  const loadTrails = useCallback(async () => {
    if (profiles.length === 0) return;
    setTrailsLoading(true);
    try {
      const ids = profiles.map((p) => p.id);
      const [histRes, evRes] = await Promise.all([
        supabase
          .from("courier_location_history")
          .select("courier_id,lat,lng,recorded_at")
          .in("courier_id", ids)
          .gte("recorded_at", dayStart.toISOString())
          .lt("recorded_at", dayEnd.toISOString())
          .order("recorded_at", { ascending: true })
          .limit(20000),
        supabase
          .from("order_events")
          .select("id,actor_id,lat,lng,created_at,orders(recipient_name,destination_district)")
          .eq("event_type", "status_change")
          .eq("to_status", "delivered")
          .gte("created_at", dayStart.toISOString())
          .lt("created_at", dayEnd.toISOString())
          .order("created_at", { ascending: true }),
      ]);
      if (histRes.error) throw histRes.error;
      if (evRes.error) throw evRes.error;

      const grouped: Record<string, TrailPoint[]> = {};
      for (const row of (histRes.data ?? []) as (TrailPoint & { courier_id: string })[]) {
        (grouped[row.courier_id] ??= []).push({ lat: row.lat, lng: row.lng, recorded_at: row.recorded_at });
      }
      setTrails(grouped);
      setDeliveries((evRes.data ?? []) as unknown as DeliveryEvent[]);
    } catch (error) {
      console.error("Error cargando recorridos:", error);
    } finally {
      setTrailsLoading(false);
    }
  }, [profiles, dayStart, dayEnd]);

  useEffect(() => {
    if (!showTrails) return;
    void loadTrails();
    // Mientras se mira "hoy", extender los recorridos cada minuto.
    if (!viewingToday) return;
    const id = setInterval(() => void loadTrails(), 60_000);
    return () => clearInterval(id);
  }, [showTrails, loadTrails, viewingToday]);

  const couriers = useMemo<CourierView[]>(() => {
    const now = new Date();
    return profiles
      .map((profile, index) => {
        const location = locations[profile.id] ?? null;
        const mine = orders.filter((o) => o.assigned_courier === profile.id);
        const inTransitOrders = mine.filter((o) => o.status === "in_transit");
        const trail = trails[profile.id];
        return {
          profile,
          location,
          presence: presenceFor(location?.recorded_at, location?.speed, now),
          pending: mine.filter((o) => o.status === "pending").length,
          inTransit: inTransitOrders.length,
          current: inTransitOrders[0] ?? null,
          color: trailColorFor(index),
          trailMeters: showTrails && trail ? trailDistance(trail) : null,
        };
      })
      .sort((a, b) => {
        const rank: Record<CourierPresence, number> = { moving: 0, idle: 1, offline: 2 };
        if (rank[a.presence] !== rank[b.presence]) return rank[a.presence] - rank[b.presence];
        return (a.profile.full_name ?? "").localeCompare(b.profile.full_name ?? "");
      });
  }, [profiles, locations, orders, trails, showTrails]);

  const visibleCouriers = useMemo(
    () => (onlyActive ? couriers.filter((c) => c.presence !== "offline") : couriers),
    [couriers, onlyActive],
  );

  const mapPoints = useMemo<LatLng[]>(
    () => couriers.filter((c) => c.location).map((c) => ({ lat: c.location!.lat, lng: c.location!.lng })),
    [couriers],
  );

  const selected = couriers.find((c) => c.profile.id === selectedId) ?? null;
  const focus = useMemo<LatLng | null>(
    () => (selected?.location ? { lat: selected.location.lat, lng: selected.location.lng } : null),
    // Solo re-volar cuando cambia el motorizado seleccionado, no con cada latido.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedId, selected?.location == null],
  );

  useEffect(() => {
    if (selectedId) markerRefs.current[selectedId]?.openPopup();
  }, [selectedId]);

  // Con un motorizado seleccionado, el mapa se concentra en él (recorrido, entregas y destinos).
  const trailCouriers = selectedId ? visibleCouriers.filter((c) => c.profile.id === selectedId) : visibleCouriers;
  const visibleDeliveries = deliveries.filter(
    (d) => d.lat != null && d.lng != null && trailCouriers.some((c) => c.profile.id === d.actor_id),
  );
  const visibleOrders = useMemo(() => {
    const withCoords = orders.filter((o) => o.destination_lat != null && o.destination_lng != null);
    return selectedId ? withCoords.filter((o) => o.assigned_courier === selectedId) : withCoords;
  }, [orders, selectedId]);

  const stats = useMemo(
    () => ({
      active: couriers.filter((c) => c.presence !== "offline").length,
      inTransit: orders.filter((o) => o.status === "in_transit").length,
      unassigned: orders.filter((o) => o.status === "pending" && !o.assigned_courier).length,
    }),
    [couriers, orders],
  );

  const courierName = (id: string | null) => profiles.find((p) => p.id === id)?.full_name || "—";

  return (
    <div className="flex flex-col gap-4 lg:h-[calc(100dvh-3rem)]">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Mapa</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              realtime ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600",
            )}
            title={realtime ? "Actualización en vivo" : "Actualizando cada 30 s"}
          >
            {realtime ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {realtime ? "En vivo" : "Cada 30 s"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setFitToken((t) => t + 1)} disabled={mapPoints.length === 0}>
            <LocateFixed className="mr-2 h-4 w-4" /> Centrar todos
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadAll()} disabled={refreshing}>
            <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} /> Actualizar
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={<Users className="h-4 w-4 text-green-600" />} label="Repartiendo ahora" value={`${stats.active} / ${couriers.length}`} />
        <StatCard icon={<Truck className="h-4 w-4 text-blue-500" />} label="Pedidos en ruta" value={stats.inTransit} />
        <StatCard icon={<CheckCircle className="h-4 w-4 text-green-500" />} label="Entregados hoy" value={deliveredToday} />
        <StatCard icon={<Inbox className="h-4 w-4 text-orange-500" />} label="Pendientes sin asignar" value={stats.unassigned} />
      </div>

      <div className="flex flex-col gap-4 lg:min-h-0 lg:flex-1 lg:flex-row">
        <Card className="relative isolate z-0 h-[55dvh] min-h-[320px] overflow-hidden lg:h-auto lg:flex-1">
          {loading ? (
            <div className="flex h-full items-center justify-center text-muted-foreground">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Cargando mapa…
            </div>
          ) : (
            <MapContainer center={[LIMA_CENTER.lat, LIMA_CENTER.lng]} zoom={11} className="h-full w-full" scrollWheelZoom>
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
              <MapController focus={focus} fitPoints={mapPoints} fitToken={fitToken} />

              {showTrails &&
                trailCouriers.map((c) => {
                  const pts = trails[c.profile.id];
                  if (!pts || pts.length < 2) return null;
                  return (
                    <Polyline
                      key={`trail-${c.profile.id}`}
                      positions={pts.map((p) => [p.lat, p.lng] as [number, number])}
                      pathOptions={{
                        color: c.color,
                        weight: selectedId === c.profile.id ? 5 : 3,
                        opacity: selectedId && selectedId !== c.profile.id ? 0.35 : 0.8,
                      }}
                    />
                  );
                })}

              {showTrails &&
                visibleDeliveries.map((d) => {
                  const c = couriers.find((x) => x.profile.id === d.actor_id);
                  return (
                    <Marker key={`del-${d.id}`} position={[d.lat!, d.lng!]} icon={deliveryMarkerIcon(c?.color ?? "#16a34a")}>
                      <Popup>
                        <div className="space-y-1 text-sm">
                          <div className="font-bold">Entrega · {format(parseISO(d.created_at), "HH:mm")}</div>
                          <div>{d.orders?.recipient_name ?? "—"}</div>
                          <div className="text-xs text-gray-500">
                            {d.orders?.destination_district?.split(" (")[0]} · {courierName(d.actor_id)}
                          </div>
                          <a className="inline-flex items-center gap-1 text-xs text-blue-700 underline" href={googleMapsUrl(d.lat!, d.lng!)} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3 w-3" /> Abrir en Google Maps
                          </a>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}

              {showOrders &&
                pickupPins
                  .filter((p) => !selectedId || p.pickup_assignments.some((a) => a.courier_id === selectedId))
                  .map((p) => (
                    <Marker key={`pickup-${p.id}`} position={[p.lat!, p.lng!]} icon={pickupPinIcon(false)}>
                      <Popup>
                        <div className="space-y-1 text-sm">
                          <div className="font-bold">Recojo #{p.pickup_number} · {p.companies?.name ?? "—"}</div>
                          <div className="text-xs text-gray-600">{p.address}</div>
                          <div className="text-xs text-gray-500">
                            {p.packages_count != null ? `${p.packages_count} pqt · ` : ""}
                            {p.pickup_assignments.length
                              ? p.pickup_assignments.map((a) => courierName(a.courier_id)).join(", ")
                              : "sin asignar"}
                          </div>
                          <a className="inline-flex items-center gap-1 text-xs text-blue-700 underline" href={googleMapsUrl(p.lat!, p.lng!)} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3 w-3" /> Abrir en Google Maps
                          </a>
                        </div>
                      </Popup>
                    </Marker>
                  ))}

              {showOrders &&
                visibleOrders.map((o) => (
                  <Marker
                    key={`order-${o.id}`}
                    position={[o.destination_lat!, o.destination_lng!]}
                    icon={orderPinIcon(o.status, !!selectedId && o.assigned_courier !== selectedId)}
                  >
                    <Popup>
                      <div className="space-y-1 text-sm">
                        <div className="font-bold">{o.recipient_name}</div>
                        <div className="text-xs text-gray-600">{o.destination_address}</div>
                        <div className="text-xs text-gray-500">
                          {o.status === "in_transit" ? "En ruta" : "Pendiente"} · {o.assigned_courier ? courierName(o.assigned_courier) : "sin asignar"}
                        </div>
                        <a className="inline-flex items-center gap-1 text-xs text-blue-700 underline" href={googleMapsUrl(o.destination_lat!, o.destination_lng!)} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-3 w-3" /> Abrir en Google Maps
                        </a>
                      </div>
                    </Popup>
                  </Marker>
                ))}

              {visibleCouriers
                .filter((c) => c.location)
                .map((c) => {
                  const name = c.profile.full_name || "Motorizado";
                  return (
                    <Marker
                      key={c.profile.id}
                      position={[c.location!.lat, c.location!.lng]}
                      icon={courierMarkerIcon(c.presence, isStaffRole(c.profile), c.profile.id === selectedId)}
                      ref={(m) => {
                        markerRefs.current[c.profile.id] = m;
                      }}
                      eventHandlers={{ click: () => setSelectedId(c.profile.id) }}
                      zIndexOffset={1000}
                    >
                      <Popup>
                        <div className="min-w-[210px] space-y-1 text-sm">
                          <div className="flex items-center gap-2 font-bold">
                            <span className={cn("h-2.5 w-2.5 rounded-full", PRESENCE[c.presence].dot)} />
                            {name}
                            {isStaffRole(c.profile) && (
                              <span className="rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-yellow-800">
                                {c.profile.role}
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-gray-500">
                            {PRESENCE[c.presence].label} · {timeAgo(c.location!.recorded_at)}
                          </div>
                          <div className="text-xs text-gray-500">
                            {kmh(c.location!.speed)}
                            {c.location!.accuracy != null && ` · ±${Math.round(c.location!.accuracy)} m`}
                            {c.trailMeters != null && ` · ${formatKm(c.trailMeters)} recorridos`}
                          </div>
                          <div className="pt-1 text-xs">
                            <b>{c.pending}</b> pendientes · <b>{c.inTransit}</b> en ruta
                          </div>
                          {c.current && (
                            <div className="rounded bg-blue-50 p-2 text-xs text-blue-900">
                              <div className="font-semibold">Entregando a {c.current.recipient_name}</div>
                              <div>{c.current.destination_district?.split(" (")[0] || c.current.destination_address}</div>
                            </div>
                          )}
                          <a className="inline-flex items-center gap-1 text-xs text-blue-700 underline" href={googleMapsUrl(c.location!.lat, c.location!.lng)} target="_blank" rel="noreferrer">
                            <ExternalLink className="h-3 w-3" /> Abrir en Google Maps
                          </a>
                        </div>
                      </Popup>
                    </Marker>
                  );
                })}
            </MapContainer>
          )}

          <div className="pointer-events-none absolute bottom-3 left-3 z-[500] flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-white/90 px-3 py-1.5 text-xs shadow">
            {(Object.keys(PRESENCE) as CourierPresence[]).map((k) => (
              <span key={k} className="flex items-center gap-1.5">
                <span className={cn("h-2.5 w-2.5 rounded-full", PRESENCE[k].dot)} />
                {PRESENCE[k].label}
              </span>
            ))}
            <span className="flex items-center gap-1.5">
              <span className="h-2.5 w-2.5 rounded-sm bg-gray-700" /> admin/staff
            </span>
            {showOrders && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3 w-3 text-amber-500" /> destino pendiente
                <MapPin className="h-3 w-3 text-blue-600" /> en ruta
                <span className="h-2.5 w-2.5 rounded-sm bg-purple-600" /> recojo
              </span>
            )}
          </div>

          {trailsLoading && (
            <div className="absolute right-3 top-3 z-[500] flex items-center gap-1 rounded-md bg-white/90 px-2 py-1 text-xs shadow">
              <Loader2 className="h-3 w-3 animate-spin" /> recorridos…
            </div>
          )}
        </Card>

        <Card className="flex flex-col lg:min-h-0 lg:w-96">
          <CardHeader className="space-y-3 pb-3">
            <CardTitle className="text-base">Motorizados</CardTitle>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <div className="flex items-center gap-2">
                <Checkbox id="only-active" checked={onlyActive} onCheckedChange={(v) => setOnlyActive(!!v)} />
                <Label htmlFor="only-active" className="cursor-pointer font-normal">Solo activos</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="show-orders" checked={showOrders} onCheckedChange={(v) => setShowOrders(!!v)} />
                <Label htmlFor="show-orders" className="cursor-pointer font-normal">Destinos</Label>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="show-trails" checked={showTrails} onCheckedChange={(v) => setShowTrails(!!v)} />
                <Label htmlFor="show-trails" className="cursor-pointer font-normal">Recorridos</Label>
              </div>
              <Input
                type="date"
                value={day}
                min={format(subDays(new Date(), HISTORY_DAYS - 1), "yyyy-MM-dd")}
                max={format(new Date(), "yyyy-MM-dd")}
                onChange={(e) => {
                  if (e.target.value) {
                    setDay(e.target.value);
                    setShowTrails(true);
                  }
                }}
                className="h-8 text-xs"
                title="Día de los recorridos (se guardan 7 días)"
              />
            </div>
            {selectedId && (
              <button type="button" className="text-xs text-primary underline" onClick={() => setSelectedId(null)}>
                Quitar selección (ver todos)
              </button>
            )}
          </CardHeader>
          <CardContent className="space-y-2 pt-0 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {loading ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Cargando…</div>
            ) : visibleCouriers.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                {couriers.length === 0 ? "No hay motorizados registrados." : "Ningún motorizado activo."}
              </div>
            ) : (
              visibleCouriers.map((c) => (
                <CourierCard
                  key={c.profile.id}
                  courier={c}
                  selected={c.profile.id === selectedId}
                  showColor={showTrails}
                  onSelect={() => setSelectedId((cur) => (cur === c.profile.id ? null : c.profile.id))}
                />
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: number | string }) {
  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div>
          <p className="text-xs font-medium text-muted-foreground">{label}</p>
          <p className="text-2xl font-bold">{value}</p>
        </div>
        {icon}
      </CardContent>
    </Card>
  );
}

function CourierCard({
  courier: c,
  selected,
  showColor,
  onSelect,
}: {
  courier: CourierView;
  selected: boolean;
  showColor: boolean;
  onSelect: () => void;
}) {
  const name = c.profile.full_name || "Motorizado";
  const staff = isStaffRole(c.profile);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") onSelect();
      }}
      className={cn(
        "w-full cursor-pointer rounded-lg border p-3 text-left transition-colors hover:bg-muted/60",
        selected && "border-primary bg-primary/5",
      )}
      style={showColor ? { borderLeftWidth: 4, borderLeftColor: c.color } : undefined}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("h-2.5 w-2.5 shrink-0", staff ? "rounded-sm" : "rounded-full", PRESENCE[c.presence].dot)} />
          <span className="truncate font-semibold">{name}</span>
          {staff && (
            <span className="shrink-0 rounded bg-yellow-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-yellow-800">
              {c.profile.role}
            </span>
          )}
        </div>
        <span className="shrink-0 text-xs text-muted-foreground">
          {c.location ? timeAgo(c.location.recorded_at) : "sin ubicación"}
        </span>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
        <span><b className="text-foreground">{c.pending}</b> pendientes</span>
        <span><b className="text-foreground">{c.inTransit}</b> en ruta</span>
        {c.presence !== "offline" && <span>{kmh(c.location?.speed)}</span>}
        {c.trailMeters != null && <span>{formatKm(c.trailMeters)} hoy</span>}
        {c.location && (
          <a
            href={googleMapsUrl(c.location.lat, c.location.lng)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-blue-700 hover:underline"
          >
            <ExternalLink className="h-3 w-3" /> Google Maps
          </a>
        )}
      </div>
      {c.current && (
        <div className="mt-2 space-y-0.5 rounded bg-blue-50 p-2 text-xs text-blue-900">
          <div className="flex items-center gap-1 font-semibold">
            <Truck className="h-3 w-3" /> {c.current.recipient_name}
          </div>
          <div className="flex items-center gap-1">
            <MapPin className="h-3 w-3 shrink-0" />
            <span className="truncate">{c.current.destination_district?.split(" (")[0] || c.current.destination_address}</span>
          </div>
          <div className="flex items-center gap-1">
            <Phone className="h-3 w-3" /> {c.current.recipient_phone}
          </div>
        </div>
      )}
    </div>
  );
}
