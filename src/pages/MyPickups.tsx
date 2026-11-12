import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Check, Clock, ExternalLink, MapPin, Package, PackageOpen, Route as RouteIcon, Sun, User } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { useAuth } from "../components/AuthProvider";
import { useCourierTracking } from "../components/CourierTrackingProvider";
import { LocationPermissionCard } from "../components/LocationPermissionCard";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { useWakeLock } from "../hooks/useWakeLock";
import { districtName, formatTimeWindow } from "../lib/orderMeta";
import { googleMapsUrl } from "../lib/mapIcons";
import { whatsappHref } from "../lib/phone";
import { pickupCounts, receivedTotalError } from "../lib/pickupCounts";
import { cn } from "@/lib/utils";

type Pickup = Database["public"]["Tables"]["pickups"]["Row"] & {
  companies: { name: string } | null;
  orders: { id: string; recipient_name: string | null; destination_district: string | null }[];
};
type Assignment = Database["public"]["Tables"]["pickup_assignments"]["Row"] & { pickups: Pickup | null };

export default function MyPickups() {
  const { user } = useAuth();
  const { flush } = useCourierTracking();
  const wakeLock = useWakeLock();
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [receiving, setReceiving] = useState<Assignment | null>(null);
  const [receivedTotal, setReceivedTotal] = useState("");
  const [receiptError, setReceiptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setLoadError(null);
    try {
      const { data, error } = await supabase
        .from("pickup_assignments")
        .select("*, pickups!inner(*, companies(name), orders(id, recipient_name, destination_district))")
        .eq("courier_id", user.id)
        .in("pickups.status", ["pending", "assigned"])
        .order("assigned_at", { ascending: true });
      if (error) throw error;
      setAssignments((data ?? []) as Assignment[]);
    } catch (error) {
      setLoadError("No se pudieron cargar tus recojos: " + (error as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const openReceipt = (assignment: Assignment) => {
    setReceiving(assignment);
    setReceivedTotal(assignment.packages_count == null ? "" : String(assignment.packages_count));
    setReceiptError(null);
  };

  const markPickedUp = async (assignment: Assignment) => {
    if (!user || busyId) return;
    const validation = receivedTotalError(receivedTotal, assignment.packages_count ?? 0);
    if (validation) { setReceiptError(validation); return; }
    setBusyId(assignment.pickup_id);
    setReceiptError(null);
    try {
      await flush();
      const { error, data } = await supabase
        .from("pickup_assignments")
        .update({ packages_count: Number(receivedTotal), picked_up_at: new Date().toISOString() })
        .eq("pickup_id", assignment.pickup_id)
        .eq("courier_id", user.id)
        .select("pickup_id")
        .single();
      if (error) throw error;
      if (!data) throw new Error("La asignación ya no está disponible.");
      setReceiving(null);
      await load();
    } catch (error) {
      setReceiptError("No se pudo guardar: " + (error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-page="courier-pickups" className="mx-auto max-w-md space-y-6">
      <div data-page-header="true" className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Mis Recojos</h1>
        {wakeLock.supported && (
          <Button type="button" size="sm" variant={wakeLock.active ? "default" : "outline"}
            onClick={() => void wakeLock.toggle()} title="Evita que la pantalla se apague mientras estás en ruta">
            <Sun className="mr-1.5 h-4 w-4" />
            {wakeLock.active ? "Pantalla activa" : "Mantener pantalla"}
          </Button>
        )}
      </div>
      <LocationPermissionCard />
      {assignments.length > 0 && (
        <Button asChild variant="outline" className="w-full">
          <Link to="/mi-ruta"><RouteIcon className="mr-2 h-4 w-4" /> Ver mi ruta en el mapa</Link>
        </Button>
      )}

      {loading ? <p className="text-center">Cargando recojos…</p>
        : loadError ? <div className="space-y-2">
          <p role="alert" className="text-sm text-red-700">{loadError}</p>
          <Button variant="outline" onClick={() => void load()}>Reintentar</Button>
        </div>
        : <section className="space-y-3" aria-labelledby="active-pickups-title">
          <h2 id="active-pickups-title" className="flex items-center gap-2 text-lg font-semibold">
            <PackageOpen className="h-5 w-5 text-purple-600" /> Recojos pendientes ({assignments.length})
          </h2>
          {assignments.length === 0 && <p className="py-6 text-center text-gray-500">No tienes recojos pendientes.</p>}
          {assignments.map((assignment) => {
            const pickup = assignment.pickups;
            if (!pickup) return null;
            const timeWindow = formatTimeWindow(pickup.pickup_after, pickup.pickup_before);
            const counts = pickupCounts(pickup.packages_count, pickup.received_packages);
            return (
              <Card key={assignment.pickup_id} className="overflow-hidden">
                <div className="h-2 w-full bg-purple-500" />
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg">Recojo #{pickup.pickup_number} · {pickup.companies?.name ?? "—"}</CardTitle>
                    {pickup.packages_count != null && (
                      <span className="shrink-0 rounded-full bg-purple-100 px-2 py-1 text-xs font-bold text-purple-800">{pickup.packages_count} pqt</span>
                    )}
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 text-sm">
                  <div className={cn("rounded-md p-2 text-xs", counts.partial ? "bg-amber-50 text-amber-900" : "bg-purple-50 text-purple-900")}>
                    Esperados: <b>{counts.expected ?? "Sin indicar"}</b> · Recibidos: <b>{counts.received}</b>
                    {counts.remaining != null && <> · Pendientes: <b>{counts.remaining}</b></>}
                    {assignment.packages_count != null && <div>Tú has recibido {assignment.packages_count} paquetes en total.</div>}
                    {counts.partial && <div className="mt-1 font-medium">Recojo parcial: aún faltan paquetes.</div>}
                  </div>
                  <div className="flex items-start gap-2">
                    <MapPin className="mt-0.5 h-4 w-4 text-gray-500" />
                    <span>
                      {pickup.address}{pickup.district ? ` · ${districtName(pickup.district)}` : ""}
                      {pickup.lat != null && pickup.lng != null && <a href={googleMapsUrl(pickup.lat, pickup.lng)} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-blue-600 underline">
                        <ExternalLink className="h-3 w-3" /> mapa
                      </a>}
                    </span>
                  </div>
                  {(pickup.contact_name || pickup.contact_phone) && <div className="flex items-start gap-2">
                    <User className="mt-0.5 h-4 w-4 text-gray-500" />
                    <span>{pickup.contact_name}
                      {pickup.contact_phone && <a href={whatsappHref(pickup.contact_phone)} target="_blank" rel="noreferrer" title="Abrir chat de WhatsApp" className="ml-2 text-blue-600 underline">{pickup.contact_phone}</a>}
                    </span>
                  </div>}
                  {timeWindow && <div className="flex items-center gap-2 text-amber-800"><Clock className="h-4 w-4" /> {timeWindow}</div>}
                  {pickup.notes && <p className="rounded bg-gray-50 p-2 text-xs text-gray-700">{pickup.notes}</p>}
                  {pickup.orders.length > 0 && <div className="flex items-start gap-2 text-xs text-gray-600">
                    <Package className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{pickup.orders.length} pedido{pickup.orders.length === 1 ? "" : "s"}: {pickup.orders.map((order) => `${order.recipient_name ?? "—"} (${districtName(order.destination_district)})`).join(", ")}</span>
                  </div>}
                </CardContent>
                <CardFooter className="bg-gray-50 p-4">
                  <Button className="w-full bg-purple-600 hover:bg-purple-700" onClick={() => openReceipt(assignment)} disabled={busyId != null}>
                    <Check className="mr-2 h-4 w-4" /> {assignment.picked_up_at ? "Actualizar paquetes recibidos" : "Confirmar paquetes recibidos"}
                  </Button>
                </CardFooter>
              </Card>
            );
          })}
        </section>}

      <Dialog open={receiving != null} onOpenChange={(open) => {
        if (!open && busyId !== receiving?.pickup_id) setReceiving(null);
      }}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Confirmar recojo #{receiving?.pickups?.pickup_number}</DialogTitle></DialogHeader>
          {receiving?.pickups && <>
            <DialogDescription>{receiving.pickups.companies?.name} · {receiving.pickups.address}</DialogDescription>
            <p className="text-sm text-muted-foreground">Esperados: {receiving.pickups.packages_count ?? "Sin indicar"} · Recibidos por todos: {receiving.pickups.received_packages}</p>
            <div className="space-y-2">
              <Label htmlFor="received-packages">Total de paquetes que recibiste tú</Label>
              <Input id="received-packages" type="number" inputMode="numeric" min={receiving.packages_count ?? 0} max="10000" step="1"
                value={receivedTotal} onChange={(e) => setReceivedTotal(e.target.value)} disabled={busyId === receiving.pickup_id} autoFocus />
              <p className="text-xs text-muted-foreground">Indica tu total acumulado para este recojo. Si vuelves a recoger, incluye también los que ya registraste ({receiving.packages_count ?? 0}).</p>
            </div>
            {receiving.pickups.packages_count != null && /^\d+$/.test(receivedTotal) &&
              receiving.pickups.received_packages - (receiving.packages_count ?? 0) + Number(receivedTotal) < receiving.pickups.packages_count &&
              <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">Quedará un recojo parcial. Los pedidos del grupo siguen pendientes hasta completar todos los paquetes.</p>}
            {receiptError && <p role="alert" className="text-sm text-red-700">{receiptError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setReceiving(null)} disabled={busyId === receiving.pickup_id}>Cancelar</Button>
              <Button onClick={() => void markPickedUp(receiving)} disabled={busyId === receiving.pickup_id || receivedTotalError(receivedTotal, receiving.packages_count ?? 0) != null}>
                {busyId === receiving.pickup_id ? "Guardando…" : "Guardar cantidad"}
              </Button>
            </div>
          </>}
        </DialogContent>
      </Dialog>
    </div>
  );
}
