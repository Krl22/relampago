// Horarios de corte de programación (mismas reglas que public.schedule_date_for en la base):
//   recojos hasta las 8:00, envíos desde almacén hasta las 11:59 (hora de Lima). Pasado el corte
//   el pedido entra para el siguiente día hábil (lunes a sábado). Los comercios prioritarios
//   (companies.skip_cutoff) entran para el mismo día. La base es la que decide; esto es para avisar.
import { addDays, format, parseISO } from "date-fns";
import { es } from "date-fns/locale";

export const CUTOFFS = {
  pickup: { label: "8:00 am", until: "08:00", text: "Envíos con recojo programado" },
  warehouse: { label: "11:59 am", until: "11:59", text: "Envíos desde almacén (fulfillment)" },
} as const;

export type Origin = keyof typeof CUTOFFS;

/** Fecha (yyyy-MM-dd) y hora (HH:mm) actuales en Lima. */
export function limaNow(now = new Date()): { date: string; time: string; weekday: number } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false, weekday: "short" })
      .formatToParts(now)
      .map((p) => [p.type, p.value]),
  );
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hour = parts.hour === "24" ? "00" : parts.hour;
  return { date, time: `${hour}:${parts.minute}`, weekday: parseISO(date).getDay() };
}

const nextBusinessDay = (date: string) => {
  const d = addDays(parseISO(date), 1);
  return format(d.getDay() === 0 ? addDays(d, 1) : d, "yyyy-MM-dd");
};

export type Schedule = { date: string; sameDay: boolean; afterCutoff: boolean };

/** Día en que se atiende un pedido registrado ahora. */
export function scheduleFor(origin: Origin, skipCutoff = false, now = new Date()): Schedule {
  const { date, time, weekday } = limaNow(now);
  // Domingo no se trabaja: todo pasa al lunes
  if (weekday === 0) return { date: format(addDays(parseISO(date), 1), "yyyy-MM-dd"), sameDay: false, afterCutoff: false };
  if (skipCutoff || time <= CUTOFFS[origin].until) return { date, sameDay: true, afterCutoff: false };
  return { date: nextBusinessDay(date), sameDay: false, afterCutoff: true };
}

/** "hoy", "mañana martes 24" o "lunes 28". */
export function scheduleLabel(date: string, now = new Date()): string {
  const today = limaNow(now).date;
  const d = parseISO(date);
  if (date === today) return "hoy";
  if (date === format(addDays(parseISO(today), 1), "yyyy-MM-dd")) return `mañana ${format(d, "EEEE d", { locale: es })}`;
  return format(d, "EEEE d 'de' MMMM", { locale: es });
}
