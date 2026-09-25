import { distanceMeters, type LatLng } from "./geo";

export type Stop<T = unknown> = LatLng & { data: T };

/**
 * Orden de paradas partiendo de `origin` (posición del motorizado):
 * vecino más cercano y luego mejora 2-opt. Para ≤ 30 paradas es instantáneo y
 * queda a pocos % del óptimo; suficiente para una jornada de reparto.
 */
export function orderStops<T>(origin: LatLng, stops: Stop<T>[]): Stop<T>[] {
  if (stops.length <= 1) return [...stops];

  // Vecino más cercano
  const remaining = [...stops];
  const route: Stop<T>[] = [];
  let current: LatLng = origin;
  while (remaining.length) {
    let best = 0;
    let bestD = Infinity;
    remaining.forEach((s, i) => {
      const d = distanceMeters(current, s);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    const [next] = remaining.splice(best, 1);
    route.push(next);
    current = next;
  }

  // 2-opt (ruta abierta: no vuelve al origen)
  const cost = (r: Stop<T>[]) => {
    let total = distanceMeters(origin, r[0]);
    for (let i = 0; i < r.length - 1; i++) total += distanceMeters(r[i], r[i + 1]);
    return total;
  };
  let improved = true;
  let bestRoute = route;
  let bestCost = cost(route);
  while (improved) {
    improved = false;
    for (let i = 0; i < bestRoute.length - 1; i++) {
      for (let j = i + 1; j < bestRoute.length; j++) {
        const candidate = [
          ...bestRoute.slice(0, i),
          ...bestRoute.slice(i, j + 1).reverse(),
          ...bestRoute.slice(j + 1),
        ];
        const c = cost(candidate);
        if (c < bestCost - 1) {
          bestRoute = candidate;
          bestCost = c;
          improved = true;
        }
      }
    }
  }
  return bestRoute;
}

/** Distancia total en metros de origen → paradas en orden (línea recta). */
export function routeLength(origin: LatLng, stops: LatLng[]): number {
  let total = 0;
  let prev = origin;
  for (const s of stops) {
    total += distanceMeters(prev, s);
    prev = s;
  }
  return total;
}

/** Navegación en Google Maps hacia un destino (abre la app en el celular). */
export const googleMapsDirectionsUrl = (dest: LatLng, origin?: LatLng | null) => {
  const p = new URLSearchParams({
    api: "1",
    destination: `${dest.lat.toFixed(6)},${dest.lng.toFixed(6)}`,
    travelmode: "driving",
  });
  if (origin) p.set("origin", `${origin.lat.toFixed(6)},${origin.lng.toFixed(6)}`);
  return `https://www.google.com/maps/dir/?${p.toString()}`;
};

/**
 * Ruta completa en Google Maps con paradas intermedias en el orden dado.
 * Google acepta hasta 9 waypoints en la URL; si hay más, se envían las primeras 9 + destino.
 */
export const googleMapsMultiStopUrl = (origin: LatLng | null, stops: LatLng[]) => {
  if (stops.length === 0) return null;
  const fmt = (p: LatLng) => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const dest = stops[stops.length - 1];
  const waypoints = stops.slice(0, -1).slice(0, 9);
  const p = new URLSearchParams({ api: "1", destination: fmt(dest), travelmode: "driving" });
  if (origin) p.set("origin", fmt(origin));
  if (waypoints.length) p.set("waypoints", waypoints.map(fmt).join("|"));
  return `https://www.google.com/maps/dir/?${p.toString()}`;
};

export const formatKm = (meters: number) =>
  meters >= 1000 ? `${(meters / 1000).toFixed(1)} km` : `${Math.round(meters)} m`;
