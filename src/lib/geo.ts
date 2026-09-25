import { formatDistanceToNowStrict, differenceInMinutes } from "date-fns";
import { es } from "date-fns/locale";

export type LatLng = { lat: number; lng: number };

/** Centro de Lima: vista inicial del mapa cuando aún no hay motorizados. */
export const LIMA_CENTER: LatLng = { lat: -12.0464, lng: -77.0428 };

/** Minutos sin reportar a partir de los cuales un motorizado se considera sin señal. */
export const OFFLINE_AFTER_MIN = 5;

/** Velocidad mínima (m/s) para considerar que el motorizado está en movimiento (~4 km/h). */
export const MOVING_SPEED_MS = 1.1;

/** Distancia en metros entre dos coordenadas (haversine). */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export type CourierPresence = "moving" | "idle" | "offline";

export function presenceFor(
  recordedAt: string | null | undefined,
  speed: number | null | undefined,
  now: Date = new Date(),
): CourierPresence {
  if (!recordedAt) return "offline";
  if (differenceInMinutes(now, new Date(recordedAt)) >= OFFLINE_AFTER_MIN) return "offline";
  if ((speed ?? 0) >= MOVING_SPEED_MS) return "moving";
  return "idle";
}

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  return `hace ${formatDistanceToNowStrict(new Date(iso), { locale: es })}`;
}

export function kmh(speed: number | null | undefined): string {
  if (speed == null || speed < 0) return "—";
  return `${Math.round(speed * 3.6)} km/h`;
}
