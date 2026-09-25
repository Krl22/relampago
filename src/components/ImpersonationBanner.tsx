import { useState } from "react";
import { Eye, Loader2, Undo2 } from "lucide-react";
import { getImpersonation, stopImpersonation } from "../lib/impersonation";
import { ROLE_LABELS } from "../lib/profiles";

/** Barra fija mientras un admin usa "Ver como": recuerda que todo es real y permite volver. */
export function ImpersonationBanner() {
  const info = getImpersonation();
  const [leaving, setLeaving] = useState(false);
  if (!info) return null;
  return (
    <div className="fixed left-1/2 top-2 z-[1100] flex max-w-[calc(100vw-16px)] -translate-x-1/2 items-center gap-2 rounded-full border border-amber-300 bg-amber-100 py-1 pl-3 pr-1 text-xs text-amber-950 shadow-lg print:hidden">
      <Eye className="h-4 w-4 shrink-0" />
      <span className="truncate">
        Viendo como <b>{info.target.name ?? "usuario"}</b> ({ROLE_LABELS[info.target.role]}) · lo que hagas aquí es real
      </span>
      <button
        type="button"
        onClick={() => {
          setLeaving(true);
          void stopImpersonation();
        }}
        disabled={leaving}
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-950 px-3 py-1 font-medium text-amber-50 hover:bg-amber-900 disabled:opacity-60"
      >
        {leaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
        Volver a mi cuenta
      </button>
    </div>
  );
}
