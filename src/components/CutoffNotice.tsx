import { Link } from "react-router-dom";
import { Map as MapIcon, Zap } from "lucide-react";
import { CUTOFFS } from "../lib/cutoff";
import { cn } from "@/lib/utils";

/** Indicación general de los formularios de pedido: horarios de corte + link al tarifario. */
export function CutoffNotice({ className, coverageHref = "/cobertura" }: { className?: string; coverageHref?: string }) {
  return (
    <div className={cn("rounded-lg border border-amber-200 bg-amber-50 p-4 text-left text-sm text-amber-950", className)}>
      <p className="font-semibold">Horarios de corte de programación</p>
      <p className="text-xs text-amber-800">Fuera del rango indicado, sujeto a disponibilidad previa comunicación.</p>
      <ul className="mt-2 space-y-1">
        {Object.values(CUTOFFS).map((c) => (
          <li key={c.label} className="flex items-center gap-2">
            <Zap className="h-4 w-4 shrink-0 fill-amber-400 text-amber-500" />
            <span>
              <b>{c.label}</b> — {c.text}
            </span>
          </li>
        ))}
      </ul>
      <Link to={coverageHref} target="_blank" className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary underline">
        <MapIcon className="h-3.5 w-3.5" /> Ver tarifario y mapa de cobertura
      </Link>
    </div>
  );
}
