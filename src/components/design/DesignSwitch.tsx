import { ArrowLeftRight } from "lucide-react";
import { Button } from "../ui/button";
import { useDesign } from "./DesignContext";
import { cn } from "../../lib/utils";

export function DesignSwitch({ className }: { className?: string }) {
  const { mode, toggle } = useDesign();
  return (
    <Button
      type="button"
      variant="outline"
      onClick={toggle}
      className={cn(
        "min-h-11 shrink-0 gap-2 bg-white text-xs text-slate-700",
        className,
      )}
      title="Cambiar el diseño de toda la aplicación. Se recuerda en este navegador."
    >
      <ArrowLeftRight className="h-4 w-4" aria-hidden="true" />
      {mode === "lightning" ? "Vista anterior" : "Vista Lightning"}
    </Button>
  );
}
