import { MapPin, MapPinOff, Loader2, RefreshCw } from "lucide-react";
import { Button } from "./ui/button";
import { useCourierTracking } from "./CourierTrackingProvider";

/**
 * Tarjeta para la pantalla del motorizado: pide el permiso de ubicación desde un
 * botón (gesto del usuario) y explica cómo desbloquearlo si ya fue denegado.
 */
export function LocationPermissionCard() {
  const { status, error, requestPermission } = useCourierTracking();

  if (status === "off" || status === "active") return null;

  if (status === "prompt" || status === "requesting") {
    const busy = status === "requesting";
    return (
      <div className="space-y-3 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div className="flex items-start gap-2">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">Comparte tu ubicación con la central</p>
            <p className="text-amber-800">
              Así el equipo puede verte en el mapa y saber dónde se hizo cada entrega. Solo
              se envía mientras tienes la app abierta.
            </p>
          </div>
        </div>
        <Button className="w-full" onClick={() => void requestPermission()} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Buscando GPS…
            </>
          ) : (
            <>
              <MapPin className="mr-2 h-4 w-4" /> Activar ubicación
            </>
          )}
        </Button>
      </div>
    );
  }

  if (status === "denied") {
    return (
      <div className="space-y-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
        <div className="flex items-start gap-2">
          <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-semibold">La ubicación está bloqueada para esta app</p>
            <p className="text-red-800">Actívala así y vuelve a intentar:</p>
          </div>
        </div>
        <ul className="list-disc space-y-1.5 pl-5 text-red-800">
          <li>
            <b>Chrome (Android):</b> toca el candado 🔒 junto a la dirección → <i>Permisos</i> →{" "}
            <i>Ubicación</i> → <i>Permitir</i>.
          </li>
          <li>
            <b>App instalada:</b> mantén presionado el ícono de Relámpago → <i>Información de la app</i>{" "}
            → <i>Permisos</i> → <i>Ubicación</i> → <i>Permitir solo mientras se usa</i>.
          </li>
          <li>
            Revisa que el <b>GPS del teléfono</b> esté encendido y que Chrome tenga permiso de
            ubicación en <i>Ajustes → Aplicaciones → Chrome → Permisos</i>.
          </li>
          <li>
            <b>iPhone:</b> <i>Ajustes → Safari → Ubicación → Permitir</i>.
          </li>
        </ul>
        <Button variant="outline" className="w-full" onClick={() => void requestPermission()}>
          <RefreshCw className="mr-2 h-4 w-4" /> Ya lo activé, reintentar
        </Button>
      </div>
    );
  }

  if (status === "unavailable") {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-700">
        <MapPinOff className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Este navegador no soporta ubicación. Usa Chrome o Safari actualizado.</span>
      </div>
    );
  }

  // status === "error": permiso concedido pero sin lectura GPS todavía
  return (
    <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
      <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
      <span>
        Sin señal GPS por ahora{error ? ` (${error})` : ""}. Revisa que la ubicación del teléfono
        esté encendida; se reintenta solo.
      </span>
    </div>
  );
}
