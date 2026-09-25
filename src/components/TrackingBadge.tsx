import { MapPin, MapPinOff, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCourierTracking } from "./CourierTrackingProvider";
import { timeAgo } from "../lib/geo";

/** Chip compacto con el estado del envío de ubicación del motorizado. */
export function TrackingBadge({ className }: { className?: string }) {
  const { status, lastSentAt, error, requestPermission } = useCourierTracking();

  if (status === "off") return null;

  const base =
    "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap";

  if (status === "prompt") {
    return (
      <button
        type="button"
        onClick={() => void requestPermission()}
        className={cn(base, "bg-amber-400 text-amber-950 hover:bg-amber-300", className)}
      >
        <MapPin className="h-3.5 w-3.5" />
        Activar ubicación
      </button>
    );
  }

  const variants: Record<
    Exclude<typeof status, "off" | "prompt">,
    { label: string; icon: React.ReactNode; classes: string }
  > = {
    requesting: {
      label: "Buscando GPS…",
      icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />,
      classes: "bg-amber-100 text-amber-800",
    },
    active: {
      label: lastSentAt ? `Ubicación ${timeAgo(lastSentAt.toISOString())}` : "Ubicación activa",
      icon: <MapPin className="h-3.5 w-3.5" />,
      classes: "bg-green-100 text-green-800",
    },
    denied: {
      label: "Ubicación bloqueada",
      icon: <MapPinOff className="h-3.5 w-3.5" />,
      classes: "bg-red-100 text-red-800",
    },
    unavailable: {
      label: "Sin GPS",
      icon: <MapPinOff className="h-3.5 w-3.5" />,
      classes: "bg-gray-100 text-gray-700",
    },
    error: {
      label: "Sin señal GPS",
      icon: <MapPinOff className="h-3.5 w-3.5" />,
      classes: "bg-red-100 text-red-800",
    },
  };

  const v = variants[status];

  return (
    <span
      title={
        status === "denied"
          ? "Desbloquea la ubicación para este sitio en los ajustes del navegador."
          : (error ?? undefined)
      }
      className={cn(base, v.classes, className)}
    >
      {v.icon}
      {v.label}
    </span>
  );
}
