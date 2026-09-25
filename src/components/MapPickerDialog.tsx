import { useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { LocationPicker } from "./LocationPicker";
import type { LatLng } from "../lib/geo";
import type { ReverseInfo } from "../lib/nominatim";
import { Check } from "lucide-react";

/**
 * Mapa a pantalla completa (en el celular ocupa toda la pantalla) para ubicar un punto con
 * precisión, como al pedir un Uber: se mueve el mapa, se revisa la dirección y se confirma.
 */
export function MapPickerDialog({
  open,
  onOpenChange,
  value,
  onConfirm,
  title = "Ubica el punto exacto",
  description = "Mueve el mapa hasta que el pin quede sobre la puerta. Puedes buscar la dirección o usar tu ubicación.",
  hint,
  suggestedCenter,
  onReverse,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: LatLng | null;
  onConfirm: (p: LatLng) => void;
  title?: string;
  description?: string;
  hint?: string;
  suggestedCenter?: LatLng | null;
  onReverse?: (info: ReverseInfo) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-screen max-w-none flex-col gap-3 rounded-none p-3 sm:h-[92vh] sm:max-w-4xl sm:rounded-lg sm:p-5">
        {/* key: cada vez que se abre, el borrador arranca del punto actual */}
        {open && <Body key={String(open)} {...{ value, onConfirm, onOpenChange, title, description, hint, suggestedCenter, onReverse }} />}
      </DialogContent>
    </Dialog>
  );
}

function Body({
  value,
  onConfirm,
  onOpenChange,
  title,
  description,
  hint,
  suggestedCenter,
  onReverse,
}: {
  value: LatLng | null;
  onConfirm: (p: LatLng) => void;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  hint?: string;
  suggestedCenter?: LatLng | null;
  onReverse?: (info: ReverseInfo) => void;
}) {
  const [draft, setDraft] = useState<LatLng | null>(value);
  return (
    <>
      <DialogHeader className="space-y-1 pr-8 text-left">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="text-xs">{description}</DialogDescription>
      </DialogHeader>
      <LocationPicker
        value={draft}
        onChange={setDraft}
        hint={hint}
        suggestedCenter={suggestedCenter}
        onReverse={onReverse}
        className="flex min-h-0 flex-1 flex-col"
        heightClass="min-h-[240px] flex-1"
      />
      <div className="flex gap-2">
        <Button type="button" variant="outline" className="flex-1 sm:flex-none" onClick={() => onOpenChange(false)}>
          Cancelar
        </Button>
        <Button
          type="button"
          className="flex-1"
          disabled={!draft}
          onClick={() => {
            if (!draft) return;
            onConfirm(draft);
            onOpenChange(false);
          }}
        >
          <Check className="mr-2 h-4 w-4" /> Confirmar ubicación
        </Button>
      </div>
    </>
  );
}
