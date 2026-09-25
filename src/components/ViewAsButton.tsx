import { useState } from "react";
import { Eye, Loader2 } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { Button } from "./ui/button";
import { getImpersonation, startImpersonation } from "../lib/impersonation";
import { ROLE_LABELS } from "../lib/profiles";
import type { UserRole } from "../types/database";
import { cn } from "@/lib/utils";

/** "Ver como" (solo admins, nunca como otro admin): entra al sistema con la sesión de ese usuario. */
export function ViewAsButton({
  target,
  className,
  compact = false,
}: {
  target: { id: string; full_name: string | null; role: UserRole };
  className?: string;
  compact?: boolean;
}) {
  const { user, profile } = useAuth();
  const [busy, setBusy] = useState(false);
  if (profile?.role !== "admin" || target.role === "admin" || target.id === user?.id || getImpersonation()) return null;

  const go = async () => {
    const name = target.full_name ?? "este usuario";
    if (
      !globalThis.confirm(
        `Vas a entrar como ${name} (${ROLE_LABELS[target.role]}).\n\nVerás el sistema exactamente como esa persona. Lo que hagas es real y queda a su nombre (con registro de que fuiste tú). Para salir usa "Volver a mi cuenta".`,
      )
    )
      return;
    setBusy(true);
    try {
      await startImpersonation({ id: target.id, name: target.full_name }, profile.full_name);
    } catch (e) {
      alert("No se pudo entrar: " + (e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Button
      type="button"
      size={compact ? "icon" : "sm"}
      variant="ghost"
      className={cn(compact ? "h-8 w-8" : "h-7 px-2", className)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        void go();
      }}
      disabled={busy}
      title={`Ver el sistema como ${target.full_name ?? "este usuario"}`}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}
      {!compact && <span className="ml-1">Ver como</span>}
    </Button>
  );
}
