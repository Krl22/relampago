// Búsqueda de direcciones con Nominatim (OpenStreetMap), acotada a Lima y Callao.
// Política de uso: máx. 1 consulta por segundo y nada de autocompletar tecla a tecla.
import type { LatLng } from "./geo";

export const LIMA_VIEWBOX = "-77.25,-11.75,-76.65,-12.55";
export const NOMINATIM_URL = "https://nominatim.openstreetmap.org";

export type NominatimResult = { lat: string; lon: string; display_name: string };

export async function nominatimSearch(params: Record<string, string>, signal?: AbortSignal): Promise<NominatimResult[]> {
  const p = new URLSearchParams({ format: "jsonv2", countrycodes: "pe", viewbox: LIMA_VIEWBOX, bounded: "1", limit: "6", "accept-language": "es", ...params });
  const res = await fetch(`${NOMINATIM_URL}/search?${p.toString()}`, { signal });
  if (!res.ok) throw new Error(String(res.status));
  return (await res.json()) as NominatimResult[];
}

const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

// Cómo aparece cada distrito en OpenStreetMap cuando el nombre corto no coincide
const OSM_DISTRICT: Record<string, string> = {
  surco: "santiago de surco",
  cercado: "lima",
};

/**
 * Ubicación aproximada (a nivel de calle) de la dirección del destinatario, para ordenar la
 * ruta y mostrar el pedido en el mapa. Devuelve null si no la encuentra o si cae fuera del
 * distrito elegido (mejor sin punto que con un punto equivocado).
 */
export async function geocodeApprox(address: string, district: string, signal?: AbortSignal): Promise<LatLng | null> {
  const districtShort = district.split(" (")[0].trim();
  if (!districtShort || /agencia/i.test(districtShort)) return null;
  // Solo la calle y el número: las referencias ("dpto 401, frente al parque") confunden al buscador
  const street = address.split(/[,\n]| - |\bdpto\b|\bdep\b|\bint\b|\bpiso\b|\bref\b|\bfrente\b/i)[0].trim();
  if (street.length < 4) return null;
  const want = norm(OSM_DISTRICT[norm(districtShort)] ?? districtShort);
  const inDistrict = (r: NominatimResult) => norm(r.display_name).includes(want);

  const tries: Record<string, string>[] = [{ q: `${street}, ${districtShort}, Lima`, limit: "3" }];
  const m = street.match(/^(.*?)[\s,#]+(\d{1,5})\s*$/);
  if (m) tries.push({ q: `${m[1]}, ${districtShort}, Lima`, limit: "3" });
  for (const params of tries) {
    const found = (await nominatimSearch(params, signal)).find(inDistrict);
    if (found) return { lat: Number(found.lat), lng: Number(found.lon) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sugerencias mientras se escribe (Photon: geocodificador de OpenStreetMap pensado para
// autocompletar; Nominatim no lo permite). Encuentra negocios, parques, calles y, cuando
// OpenStreetMap la tiene, la numeración.
// ---------------------------------------------------------------------------
const PHOTON_URL = "https://photon.komoot.io/api/";

export type Suggestion = { id: string; title: string; subtitle: string; lat: number; lng: number };

type PhotonFeature = {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | number | undefined>;
};

export async function photonSuggest(q: string, bias: LatLng | null, signal?: AbortSignal): Promise<Suggestion[]> {
  const [minLng, maxLat, maxLng, minLat] = LIMA_VIEWBOX.split(",");
  // lang=default: nombres tal como están en OpenStreetMap (en español), no según el idioma del navegador
  const p = new URLSearchParams({ q, limit: "8", lang: "default", bbox: [minLng, minLat, maxLng, maxLat].join(",") });
  if (bias) {
    p.set("lat", bias.lat.toFixed(5));
    p.set("lon", bias.lng.toFixed(5));
  }
  const res = await fetch(`${PHOTON_URL}?${p.toString()}`, { signal });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { features?: PhotonFeature[] };
  // Si escribió un número busca una dirección: se muestra primero la calle y número (no el negocio que está ahí)
  const wantsAddress = /\d/.test(q);
  const seen = new Set<string>();
  const out: Suggestion[] = [];
  for (const f of data.features ?? []) {
    const pr = f.properties;
    const str = (k: string) => (pr[k] != null ? String(pr[k]) : null);
    const street = str("street") ? `${str("street")}${str("housenumber") ? ` ${str("housenumber")}` : ""}` : null;
    const area = str("district") ?? str("locality");
    const byAddress = wantsAddress && !!street && !!str("housenumber");
    const title = byAddress ? street! : (str("name") ?? street ?? area ?? "Lugar sin nombre");
    const subtitle = [byAddress ? null : str("name") ? street : null, area, str("city") && str("city") !== area ? str("city") : null].filter(Boolean).join(" · ");
    const key = `${title}|${subtitle}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ id: `${str("osm_type") ?? ""}${str("osm_id") ?? out.length}`, title, subtitle, lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
  }
  return out.slice(0, 6);
}

/** Lo que devuelve la dirección inversa de un punto (para autocompletar formularios). */
export type ReverseInfo = { display: string; street: string | null; houseNumber: string | null; places: string[] };

export async function reverseGeocode(p: LatLng, signal?: AbortSignal): Promise<ReverseInfo | null> {
  const res = await fetch(`${NOMINATIM_URL}/reverse?format=jsonv2&addressdetails=1&lat=${p.lat}&lon=${p.lng}&zoom=18&accept-language=es`, { signal });
  if (!res.ok) throw new Error(String(res.status));
  const data = (await res.json()) as { display_name?: string; address?: Record<string, string> };
  if (!data.display_name) return null;
  const a = data.address ?? {};
  // Del más específico al más general: el distrito suele venir en city_district o suburb
  const places = ["city_district", "suburb", "borough", "town", "village", "city", "county"].map((k) => a[k]).filter((v): v is string => !!v);
  return { display: data.display_name, street: a.road ?? a.pedestrian ?? a.footway ?? null, houseNumber: a.house_number ?? null, places };
}
