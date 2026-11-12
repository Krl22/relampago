import { Loader2 } from "lucide-react";

export function PageLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex min-h-48 items-center justify-center gap-3 p-6 text-sm text-muted-foreground"
    >
      <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
      Cargando pantalla…
    </div>
  );
}
