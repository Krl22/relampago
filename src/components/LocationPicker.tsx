import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap, useMapEvents } from "react-leaflet";
import type { Map as LeafletMap } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Check, Crosshair, Loader2, MapPin, Maximize2, Search } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { LIMA_CENTER, type LatLng } from "../lib/geo";
import { nominatimSearch, photonSuggest, reverseGeocode, type NominatimResult, type ReverseInfo, type Suggestion } from "../lib/nominatim";
import { cn } from "@/lib/utils";

/**
 * Selector de punto en el mapa estilo Uber: el pin está fijo al centro y el usuario mueve el
 * mapa debajo. `value` cambia al soltar el mapa, al elegir una sugerencia, con "Fijar aquí" o con
 * la ubicación del dispositivo. Mientras no haya punto, `suggestedCenter` (p. ej. la dirección
 * escrita en el formulario) solo centra el mapa: el punto no se fija hasta que el usuario lo confirma.
 */
interface LocationPickerProps {
  value: LatLng | null;
  onChange: (value: LatLng) => void;
  className?: string;
  /** Altura del mapa (clase Tailwind). */
  heightClass?: string;
  /** Indicación sobre el mapa. */
  hint?: string;
  /** Texto cuando todavía no hay punto. */
  emptyText?: string;
  /** Centro sugerido mientras no haya punto (ubicación aproximada de la dirección escrita). */
  suggestedCenter?: LatLng | null;
  /** Dirección inversa del punto elegido (para autocompletar calle / distrito). */
  onReverse?: (info: ReverseInfo) => void;
  /** Muestra el botón de pantalla completa. */
  onExpand?: () => void;
}

/**
 * Solo cuenta como "el usuario eligió un punto" si arrastró o hizo zoom: un cambio de tamaño
 * del contenedor (barra del navegador en móvil, rotar el teléfono) también dispara moveend
 * y no debe marcar nada.
 */
function CenterTracker({ onMove, onDragging }: { onMove: (c: LatLng, byUser: boolean) => void; onDragging: (d: boolean) => void }) {
  const interacted = useRef(false);
  const map = useMapEvents({
    dragstart: () => {
      interacted.current = true;
      onDragging(true);
    },
    zoomstart: () => {
      interacted.current = true;
    },
    dragend: () => onDragging(false),
    moveend: () => {
      if (!interacted.current) return;
      interacted.current = false;
      const c = map.getCenter();
      onMove({ lat: c.lat, lng: c.lng }, true);
    },
  });
  return null;
}

/** Deja la instancia del mapa a mano del componente (centro actual, volar a un punto). */
function MapHandle({ mapRef }: { mapRef: React.MutableRefObject<LeafletMap | null> }) {
  const map = useMap();
  useEffect(() => {
    mapRef.current = map;
    // Dentro de diálogos/animaciones Leaflet mide mal el contenedor: recalcular al montar.
    // pan:false para no disparar moveend (marcaría un punto sin que el usuario haya movido nada)
    const t = window.setTimeout(() => map.invalidateSize({ pan: false }), 300);
    return () => {
      window.clearTimeout(t);
      mapRef.current = null;
    };
  }, [map, mapRef]);
  return null;
}

const shortLabel = (display: string) => display.split(",").slice(0, 2).join(",").trim();

export function LocationPicker({
  value,
  onChange,
  className,
  heightClass = "h-72",
  hint = "Mueve el mapa hasta dejar el pin en el punto de entrega",
  emptyText = "Aún no has ubicado el punto.",
  suggestedCenter = null,
  onReverse,
  onExpand,
}: LocationPickerProps) {
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [results, setResults] = useState<NominatimResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [locating, setLocating] = useState(false);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const mapRef = useRef<LeafletMap | null>(null);
  const typedRef = useRef(false); // el texto del buscador lo escribió el usuario (no el mapa)
  const searchFocused = useRef(false);
  const suppressNextMove = useRef(false);
  const emittedRef = useRef<LatLng | null>(value); // último punto que eligió el usuario en este mapa
  const onReverseRef = useRef(onReverse);
  useEffect(() => {
    onReverseRef.current = onReverse;
  });

  const initialCenter = value ?? suggestedCenter ?? LIMA_CENTER;
  const initialZoom = value || suggestedCenter ? 17 : 12;

  // El movimiento que provoca un flyTo no es una elección del usuario. Si el mapa no llega a
  // moverse (ya estaba ahí) no hay moveend: la marca se limpia sola.
  const suppressMove = () => {
    suppressNextMove.current = true;
    window.setTimeout(() => {
      suppressNextMove.current = false;
    }, 1500);
  };

  const flyTo = (p: LatLng, zoom = 18) => {
    suppressMove();
    mapRef.current?.flyTo([p.lat, p.lng], zoom, { duration: 0.6 });
  };

  const emit = (p: LatLng) => {
    emittedRef.current = p;
    onChange(p);
  };

  const goTo = (p: LatLng, zoom = 18) => {
    emit(p);
    flyTo(p, zoom);
  };

  // El punto cambió desde afuera (p. ej. se confirmó en pantalla completa): llevar el mapa ahí
  useEffect(() => {
    const e = emittedRef.current;
    if (!value || (e && e.lat === value.lat && e.lng === value.lng)) return;
    emittedRef.current = value;
    suppressMove();
    mapRef.current?.flyTo([value.lat, value.lng], Math.max(mapRef.current.getZoom(), 17), { duration: 0.6 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value?.lat, value?.lng]);

  // Sin punto todavía: el mapa va a la ubicación aproximada de la dirección escrita (sin fijarla)
  useEffect(() => {
    if (value || !suggestedCenter) return;
    suppressMove();
    mapRef.current?.flyTo([suggestedCenter.lat, suggestedCenter.lng], 17, { duration: 0.6 });
    // Solo cuando cambia la sugerencia; `value` se consulta en el momento
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestedCenter?.lat, suggestedCenter?.lng]);

  // Dirección del punto elegido (1 consulta por movimiento, con pausa)
  useEffect(() => {
    if (!value) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const info = await reverseGeocode(value, ctrl.signal);
        setLabel(info?.display ?? null);
        if (info) {
          // el buscador refleja el punto elegido (calle y zona)
          if (!searchFocused.current) {
            typedRef.current = false;
            setQuery(shortLabel(info.display));
          }
          onReverseRef.current?.(info);
        }
      } catch {
        if (!ctrl.signal.aborted) setLabel(null);
      }
    }, 700);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [value]);

  // Sugerencias mientras se escribe
  useEffect(() => {
    if (!typedRef.current) return;
    const q = query.trim();
    if (q.length < 3) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      try {
        const c = mapRef.current?.getCenter();
        setSuggestions(await photonSuggest(q, c ? { lat: c.lat, lng: c.lng } : null, ctrl.signal));
      } catch {
        // cancelada o sin red: se queda la lista anterior
      }
    }, 350);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [query]);

  const handleMove = (c: LatLng, byUser: boolean) => {
    // Un flyTo programático también dispara moveend; ese no es una elección del usuario.
    if (suppressNextMove.current) {
      suppressNextMove.current = false;
      return;
    }
    if (byUser) {
      setAccuracy(null);
      emit(c);
    }
  };

  const pickSuggestion = (s: Suggestion) => {
    typedRef.current = false;
    setQuery(s.subtitle ? `${s.title}, ${s.subtitle.split(" · ")[0]}` : s.title);
    setSuggestions([]);
    setResults([]);
    setNotFound(false);
    goTo({ lat: s.lat, lng: s.lng });
  };

  // Enter / lupa: la primera sugerencia; si no hay, búsqueda completa en OpenStreetMap
  const search = async () => {
    if (suggestions.length > 0) {
      pickSuggestion(suggestions[0]);
      return;
    }
    const q = query.trim();
    if (!q) return;
    setSearching(true);
    setResults([]);
    setNotFound(false);
    try {
      let found = await nominatimSearch({ q });
      // "Marsano 125" / "Av. Marsano 125": consulta estructurada (número + calle)
      const m = q.match(/^(.*?)[\s,]+(\d{1,5})\s*$/) ?? q.match(/^(\d{1,5})\s+(.*)$/);
      if (found.length === 0 && m) {
        const [street, number] = /^\d/.test(m[1]) ? [m[2], m[1]] : [m[1], m[2]];
        found = await nominatimSearch({ street: `${number} ${street}`, city: "Lima" });
        if (found.length === 0) found = await nominatimSearch({ q: street });
      }
      if (found.length === 1) goTo({ lat: parseFloat(found[0].lat), lng: parseFloat(found[0].lon) });
      else setResults(found);
      setNotFound(found.length === 0);
    } catch (e) {
      console.error("Error buscando dirección:", e);
    } finally {
      setSearching(false);
    }
  };

  const useMyLocation = () => {
    if (!("geolocation" in navigator)) return;
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setAccuracy(pos.coords.accuracy);
        goTo({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 18);
      },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 0 },
    );
  };

  const pinHere = () => {
    const c = mapRef.current?.getCenter();
    if (c) emit({ lat: c.lat, lng: c.lng });
  };

  const approx = !value && !!suggestedCenter;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="relative">
        <div className="flex gap-2">
          <Input
            value={query}
            onChange={(e) => {
              typedRef.current = true;
              setQuery(e.target.value);
              setNotFound(false);
              if (e.target.value.trim().length < 3) setSuggestions([]);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.keyCode === 13) {
                e.preventDefault();
                void search();
              } else if (e.key === "Escape") setSuggestions([]);
            }}
            onFocus={() => {
              searchFocused.current = true;
            }}
            onBlur={() => {
              searchFocused.current = false;
              // deja tiempo para tocar una sugerencia
              window.setTimeout(() => setSuggestions([]), 200);
            }}
            placeholder="Busca la dirección, negocio o lugar"
            enterKeyHint="search"
            autoComplete="off"
          />
          <Button type="button" variant="outline" onClick={() => void search()} disabled={searching} title="Buscar">
            {searching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          </Button>
          <Button type="button" variant="outline" onClick={useMyLocation} disabled={locating} title="Usar mi ubicación actual">
            {locating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Crosshair className="h-4 w-4" />}
          </Button>
        </div>

        {(suggestions.length > 0 || results.length > 0) && (
          <ul className="absolute left-0 right-0 top-11 z-[1200] max-h-64 overflow-auto rounded-md border bg-white text-sm shadow-lg">
            {suggestions.map((s) => (
              <li key={s.id}>
                <button type="button" className="flex w-full items-start gap-2 px-3 py-2 text-left hover:bg-gray-100" onMouseDown={(e) => e.preventDefault()} onClick={() => pickSuggestion(s)}>
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{s.title}</span>
                    {s.subtitle && <span className="block truncate text-xs text-muted-foreground">{s.subtitle}</span>}
                  </span>
                </button>
              </li>
            ))}
            {results.map((r) => (
              <li key={`${r.lat},${r.lon}`}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-gray-100"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setResults([]);
                    typedRef.current = false;
                    setQuery(shortLabel(r.display_name));
                    goTo({ lat: parseFloat(r.lat), lng: parseFloat(r.lon) });
                  }}
                >
                  {r.display_name}
                </button>
              </li>
            ))}
            <li className="border-t px-3 py-1 text-[10px] text-muted-foreground">Sugerencias: Photon / Nominatim · © OpenStreetMap</li>
          </ul>
        )}
      </div>
      {notFound && <p className="text-xs text-amber-700">No encontré esa dirección. Busca la calle o un lugar cercano y mueve el mapa hasta el punto exacto.</p>}

      <div className={cn("relative isolate z-0 overflow-hidden rounded-md border", heightClass)}>
        <MapContainer center={[initialCenter.lat, initialCenter.lng]} zoom={initialZoom} maxZoom={19} className="h-full w-full" scrollWheelZoom>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
          <MapHandle mapRef={mapRef} />
          <CenterTracker onMove={handleMove} onDragging={setDragging} />
        </MapContainer>

        {/* Pin fijo al centro: la punta cae exactamente en el centro; se levanta mientras se arrastra */}
        <div className="pointer-events-none absolute left-1/2 top-1/2 z-[500] -translate-x-1/2 -translate-y-full">
          <MapPin
            className={cn(
              "h-10 w-10 drop-shadow-lg transition-transform duration-150",
              dragging && "-translate-y-3 scale-110",
              value ? "fill-red-500 text-red-700" : "fill-amber-400 text-amber-700",
            )}
          />
        </div>
        <div
          className={cn(
            "pointer-events-none absolute left-1/2 top-1/2 z-[499] h-1.5 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/40 transition-opacity",
            dragging ? "opacity-100" : "opacity-0",
          )}
        />

        <div className="pointer-events-none absolute left-1/2 top-2 z-[500] max-w-[85%] -translate-x-1/2 rounded-full bg-white/90 px-3 py-1 text-center text-xs font-medium shadow">
          {approx ? "Ubicación aproximada: mueve el mapa hasta el punto exacto" : hint}
        </div>

        {onExpand && (
          <button
            type="button"
            onClick={onExpand}
            className="absolute right-2 top-2 z-[500] rounded-md bg-white/95 p-1.5 shadow hover:bg-white"
            title="Pantalla completa"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
        )}

        {approx && (
          <button
            type="button"
            onClick={pinHere}
            className="absolute bottom-3 left-1/2 z-[500] -translate-x-1/2 rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-lg hover:bg-primary/90"
          >
            <Check className="mr-1 inline h-3.5 w-3.5" /> Fijar el punto aquí
          </button>
        )}
      </div>

      <p className="min-h-[1.25rem] text-xs text-muted-foreground">
        {value ? (
          <>
            <span className="font-medium text-foreground">Punto elegido:</span> {label ?? `${value.lat.toFixed(5)}, ${value.lng.toFixed(5)}`}
            {accuracy != null && (
              <span className={cn("ml-1", accuracy > 60 && "text-amber-700")}>
                (GPS ±{Math.round(accuracy)} m{accuracy > 60 ? ": revisa y ajusta el pin" : ""})
              </span>
            )}
          </>
        ) : approx ? (
          "Centramos el mapa en la dirección escrita. Ajusta el pin y toca «Fijar el punto aquí» o mueve el mapa."
        ) : (
          emptyText
        )}
      </p>
    </div>
  );
}
