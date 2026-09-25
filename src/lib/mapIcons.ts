import L from "leaflet";
import type { CourierPresence } from "./geo";

export const PRESENCE: Record<CourierPresence, { label: string; color: string; dot: string }> = {
  moving: { label: "En movimiento", color: "#16a34a", dot: "bg-green-500" },
  idle: { label: "Detenido", color: "#f59e0b", dot: "bg-amber-500" },
  offline: { label: "Sin señal", color: "#9ca3af", dot: "bg-gray-400" },
};

/** Colores para distinguir el recorrido de cada persona en el mapa. */
export const TRAIL_COLORS = [
  "#2563eb", "#db2777", "#7c3aed", "#0891b2", "#ea580c", "#65a30d", "#0f766e", "#b45309",
];

export const trailColorFor = (index: number) => TRAIL_COLORS[index % TRAIL_COLORS.length];

const MOTO_SVG = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="5.5" cy="17" r="3"/><circle cx="18.5" cy="17" r="3"/><path d="M5.5 17l3.5-6h4l3 6"/><path d="M9 11h-2"/><path d="M13 11l2-4h3"/><path d="M15 7l3.5 10"/><path d="M11 11l-1.5 3.5h5"/></svg>`;

const STAR_BADGE = `<span class="absolute -right-1.5 -top-1.5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-yellow-400"><svg width="10" height="10" viewBox="0 0 24 24" fill="#713f12"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/></svg></span>`;

/**
 * Marcador de una persona que reparte.
 *  - color  = estado (movimiento / detenido / sin señal)
 *  - forma  = rol: círculo = motorizado, cuadrado redondeado + estrella = admin/staff
 */
export function courierMarkerIcon(presence: CourierPresence, isStaff: boolean, selected: boolean) {
  const color = PRESENCE[presence].color;
  const ring =
    presence === "moving"
      ? `<span class="absolute inset-0 animate-ping ${isStaff ? "rounded-xl" : "rounded-full"}" style="background:${color};opacity:.35"></span>`
      : "";
  const shape = isStaff ? "rounded-xl" : "rounded-full";
  const border = selected ? "#111827" : "#ffffff";
  return L.divIcon({
    className: "",
    html: `<div class="relative h-10 w-10">${ring}<div class="absolute inset-0.5 flex items-center justify-center ${shape} shadow-md" style="background:${color};border:3px solid ${border}">${MOTO_SVG}</div>${isStaff ? STAR_BADGE : ""}</div>`,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  });
}

/** Punto donde se marcó una entrega. */
export function deliveryMarkerIcon(color: string) {
  return L.divIcon({
    className: "",
    html: `<div class="flex h-5 w-5 items-center justify-center rounded-full border-2 border-white shadow" style="background:${color}"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
    popupAnchor: [0, -10],
  });
}

/** Link oficial de Google Maps a una coordenada (abre la app en Android/iOS). */
export const googleMapsUrl = (lat: number, lng: number) =>
  `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
