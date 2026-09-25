import zonesData from "../data/tariffZones.json";
import type { LatLng } from "./geo";

export type Zone = {
  name: string;
  kind: "tariff" | "flag" | "coverage";
  tariff: "T1" | "T2" | "T3" | "T4" | null;
  amount: number | null;
  flag: "zona_roja" | "sin_acceso" | null;
  ring: [number, number][]; // [lat, lng]
};

const ZONES = (zonesData as unknown as { zones: Zone[] }).zones;
/** Polígonos del mapa de cobertura (para dibujarlos en el tarifario). */
export const TARIFF_ZONES: readonly Zone[] = ZONES;

/** Tarifas base por zona (soles). T5 existe en la operación pero no está dibujada en el mapa. */
export const TARIFF_AMOUNTS: Record<string, number> = { T1: 10, T2: 13, T3: 16, T4: 19, T5: 22 };
export const TARIFF_CODES = Object.keys(TARIFF_AMOUNTS);

function pointInRing(p: LatLng, ring: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [yi, xi] = ring[i];
    const [yj, xj] = ring[j];
    const intersect = yi > p.lat !== yj > p.lat && p.lng < ((xj - xi) * (p.lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export type TariffResult = {
  tariff: string | null;
  amount: number | null;
  zones: string[];
  flags: ("zona_roja" | "sin_acceso")[];
  covered: boolean;
};

/**
 * Tarifa según el mapa de cobertura. Si el punto cae en varias zonas (p. ej. un cerro s/13
 * dibujado dentro de un distrito s/10) gana la más cara; las banderas se acumulan.
 */
export function tariffFor(p: LatLng): TariffResult {
  const hits = ZONES.filter((z) => pointInRing(p, z.ring));
  const tariffZones = hits.filter((z) => z.kind === "tariff");
  const best = tariffZones.reduce<Zone | null>((acc, z) => (!acc || (z.amount ?? 0) > (acc.amount ?? 0) ? z : acc), null);
  return {
    tariff: best?.tariff ?? null,
    amount: best?.amount ?? null,
    zones: tariffZones.map((z) => z.name),
    flags: hits.filter((z) => z.kind === "flag").map((z) => z.flag!) ,
    covered: hits.some((z) => z.kind === "coverage") || tariffZones.length > 0,
  };
}

/** Comisión que se traslada al comercio cuando el destinatario paga con tarjeta (Izipay). */
export const IZIPAY_RATE = 0.05;
/** Métodos de pago en los que el dinero cobrado queda en manos de Relámpago (entra en "Recaudado"). */
export const RELAMPAGO_HELD_METHODS = ["Motorizado", "Relampago Courier", "Izipay"];

/**
 * Monto del servicio para un pedido: tarifa base (con la T1 pactada de la empresa si la tiene)
 * + recarga + 5% del monto cobrado si pagó con Izipay, y x1.18 si la empresa factura con IGV.
 * Redondeado a 2 decimales.
 */
export function computeFee(input: {
  tariff: string | null | undefined;
  surcharge?: number | null;
  company?: { invoice_igv?: boolean | null; t1_rate?: number | null } | null;
  paymentMethod?: string | null;
  amountCollected?: number | null;
}): number | null {
  if (!input.tariff) return null;
  let base = TARIFF_AMOUNTS[input.tariff];
  if (base == null) return null;
  if (input.tariff === "T1" && input.company?.t1_rate != null) base = Number(input.company.t1_rate);
  let subtotal = base + Number(input.surcharge ?? 0);
  if (input.paymentMethod === "Izipay") subtotal += Number(input.amountCollected ?? 0) * IZIPAY_RATE;
  const total = input.company?.invoice_igv ? subtotal * 1.18 : subtotal;
  return Math.round(total * 100) / 100;
}
