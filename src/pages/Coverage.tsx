import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, Polygon, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { TARIFF_AMOUNTS, TARIFF_ZONES, tariffFor, IZIPAY_RATE, type Zone } from "../lib/tariff";
import { priceText, useDistricts } from "../lib/districts";
import { LIMA_CENTER, type LatLng } from "../lib/geo";
import { nominatimSearch } from "../lib/nominatim";
import { Loader2, Search, Truck } from "lucide-react";
import { cn } from "@/lib/utils";

const TARIFF_COLORS: Record<string, string> = { T1: "#16a34a", T2: "#ca8a04", T3: "#ea580c", T4: "#7c3aed" };
const FLAG_STYLE = {
  zona_roja: { color: "#dc2626", fillColor: "#dc2626", fillOpacity: 0.15, dashArray: "6 4", weight: 2 },
  sin_acceso: { color: "#111827", fillColor: "#111827", fillOpacity: 0.4, weight: 1 },
};

const zoneStyle = (z: Zone) =>
  z.kind === "flag" && z.flag
    ? FLAG_STYLE[z.flag]
    : { color: TARIFF_COLORS[z.tariff ?? ""] ?? "#64748b", fillColor: TARIFF_COLORS[z.tariff ?? ""] ?? "#64748b", fillOpacity: 0.22, weight: 1 };

// Primero las tarifas y encima las banderas (zona roja / sin acceso)
const ZONES_SORTED = [...TARIFF_ZONES].sort((a, b) => (a.kind === "flag" ? 1 : 0) - (b.kind === "flag" ? 1 : 0) || (a.amount ?? 0) - (b.amount ?? 0));

const pinIcon = L.divIcon({
  className: "",
  html: '<div style="width:18px;height:18px;border-radius:50%;background:#0f48c4;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

function ClickToCheck({ onPick }: { onPick: (p: LatLng) => void }) {
  useMapEvents({ click: (e) => onPick({ lat: e.latlng.lat, lng: e.latlng.lng }) });
  return null;
}

function FlyTo({ target }: { target: LatLng | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo([target.lat, target.lng], Math.max(map.getZoom(), 15), { duration: 0.6 });
  }, [map, target]);
  return null;
}


/**
 * Tarifario y mapa de cobertura: precios por zona, el mapa con las zonas y un buscador para
 * saber la tarifa de una dirección. Público en /cobertura y dentro del sistema en /tarifario.
 */
export default function Coverage({ standalone = false }: { standalone?: boolean }) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [point, setPoint] = useState<LatLng | null>(null);
  const [fly, setFly] = useState<LatLng | null>(null);
  const result = point ? tariffFor(point) : null;

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setNotFound(false);
    try {
      const found = await nominatimSearch({ q, limit: "1" });
      if (found[0]) {
        const p = { lat: Number(found[0].lat), lng: Number(found[0].lon) };
        setPoint(p);
        setFly(p);
      } else setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setSearching(false);
    }
  };

  const catalog = useDistricts();
  const districts = catalog.filter((d) => d.kind === "district");
  const agencies = catalog.filter((d) => d.kind === "agency");

  const content = (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {(["T1", "T2", "T3", "T4"] as const).map((t) => (
          <Card key={t}>
            <CardContent className="flex items-center gap-3 p-4">
              <span className="h-10 w-2 rounded-full" style={{ background: TARIFF_COLORS[t] }} />
              <div>
                <div className="text-2xl font-bold tabular-nums">S/ {TARIFF_AMOUNTS[t]}</div>
                <div className="text-xs text-muted-foreground">Tarifa {t.slice(1)}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Mapa de cobertura</CardTitle>
          <CardDescription>Busca una dirección o toca el mapa para ver la tarifa de ese punto.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void search();
                }
              }}
              placeholder="Ej. Av. Larco 345, Miraflores"
            />
            <Button type="button" variant="outline" onClick={() => void search()} disabled={searching}>
              {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          {notFound && <p className="text-xs text-amber-700">No encontré esa dirección. Prueba solo con la calle y el distrito, o toca el mapa.</p>}
          {result && (
            <div
              className={cn(
                "rounded-md p-3 text-sm",
                result.flags.includes("sin_acceso") ? "bg-red-50 text-red-800" : result.tariff ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900",
              )}
            >
              {result.flags.includes("sin_acceso") ? (
                <>⛔ Esa zona no tiene cobertura.</>
              ) : result.tariff ? (
                <>
                  Tarifa: <b>S/ {result.amount}</b> ({result.zones[0]})
                  {result.flags.includes("zona_roja") && " · ⚠ Zona roja: requiere coordinación previa"}
                </>
              ) : (
                <>Ese punto está fuera de las zonas del mapa; consúltanos la tarifa.</>
              )}
            </div>
          )}
          <div className="h-[60vh] min-h-[380px] overflow-hidden rounded-lg border">
            <MapContainer center={[LIMA_CENTER.lat, LIMA_CENTER.lng]} zoom={11} className="h-full w-full" scrollWheelZoom>
              <TileLayer attribution="&copy; OpenStreetMap" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              {ZONES_SORTED.map((z, i) => (
                <Polygon key={`${z.name}-${i}`} positions={z.ring} pathOptions={zoneStyle(z)}>
                  <Tooltip sticky>
                    {z.kind === "flag" ? (z.flag === "zona_roja" ? "Zona roja: requiere coordinación" : "Sin cobertura") : `${z.name} · S/ ${z.amount}`}
                  </Tooltip>
                </Polygon>
              ))}
              {point && <Marker position={[point.lat, point.lng]} icon={pinIcon} />}
              <ClickToCheck onPick={setPoint} />
              <FlyTo target={fly} />
            </MapContainer>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
            {(["T1", "T2", "T3", "T4"] as const).map((t) => (
              <span key={t} className="flex items-center gap-1">
                <span className="h-3 w-3 rounded-sm" style={{ background: TARIFF_COLORS[t], opacity: 0.6 }} /> S/ {TARIFF_AMOUNTS[t]}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border-2 border-dashed border-red-600" /> Zona roja (coordinar)
            </span>
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-gray-900/60" /> Sin cobertura
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Tarifas por distrito</CardTitle>
            <CardDescription>Cuando un distrito tiene varios precios, depende de la zona del mapa.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
            {districts.map((d) => (
              <div key={d.name} className="flex justify-between gap-2 border-b py-1 last:border-0">
                <span>{d.name}</span>
                <span className="whitespace-nowrap text-muted-foreground">{priceText(d)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Agencias (envíos a provincia)</CardTitle>
            </CardHeader>
            <CardContent className="space-y-1 text-sm">
              {agencies.map((d) => (
                <div key={d.name} className="flex justify-between gap-2 border-b py-1 last:border-0">
                  <span>{d.name}</span>
                  <span className="whitespace-nowrap text-muted-foreground">{priceText(d)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Condiciones</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
                <li>Precio por envío, sin IGV.</li>
                <li>Paquetes grandes pueden llevar recargo (ej. R2 = S/ 2 adicionales).</li>
                <li>Si el destinatario paga con tarjeta (Izipay), el servicio suma el {Math.round(IZIPAY_RATE * 100)}% del monto cobrado.</li>
                <li>Zona roja: se coordina antes de programar.</li>
              </ul>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );

  if (!standalone) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Tarifario y mapa de cobertura</h1>
        {content}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="rounded-full bg-primary/10 p-3">
            <Truck className="h-9 w-9 text-primary" />
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-gray-900">Tarifario y mapa de cobertura</h1>
          <p className="text-sm text-gray-600">
            Relámpago Courier ·{" "}
            <Link to="/pedido-express" className="text-primary underline">
              Registrar un pedido
            </Link>
          </p>
        </div>
        {content}
      </div>
    </div>
  );
}
