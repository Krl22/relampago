import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Truck,
  MapPin,
  Phone,
  User,
  Camera,
  Check,
  Image as ImageIcon,
  Sun,
  Route as RouteIcon,
  PackageOpen,
  ExternalLink,
  Clock,
  XCircle,
  Package,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { useCourierTracking } from "../components/CourierTrackingProvider";
import { LocationPermissionCard } from "../components/LocationPermissionCard";
import { OrderBadges, StatusBadge } from "../components/OrderBadges";
import { useWakeLock } from "../hooks/useWakeLock";
import { ACTIVE_STATUSES, STATUS_META, districtName, formatTimeWindow } from "../lib/orderMeta";
import { googleMapsUrl } from "../lib/mapIcons";
import { cn } from "@/lib/utils";

type Order = Database["public"]["Tables"]["orders"]["Row"] & {
  pickups: { pickup_number: number; status: string } | null;
};
type Pickup = Database["public"]["Tables"]["pickups"]["Row"] & {
  companies: { name: string } | null;
  orders: { id: string; recipient_name: string | null; destination_district: string | null }[];
};
type Assignment = Database["public"]["Tables"]["pickup_assignments"]["Row"] & { pickups: Pickup | null };

export default function MyDeliveries() {
  const { user } = useAuth();
  const { flush } = useCourierTracking();
  const wakeLock = useWakeLock();
  const [orders, setOrders] = useState<Order[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [collect, setCollect] = useState({ amount: "", method: "" });

  const openConfirm = (order: Order) => {
    setCollect({
      amount: order.amount_to_collect != null ? String(order.amount_to_collect) : "0",
      method: order.payment_method ?? "",
    });
    setSelectedOrder(order);
  };
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const galleryInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    if (!user) return;
    try {
      const [ordersRes, pickupsRes] = await Promise.all([
        supabase
          .from("orders")
          .select("*, pickups(pickup_number, status)")
          .eq("assigned_courier", user.id)
          .in("status", ACTIVE_STATUSES)
          .order("created_at", { ascending: true }),
        supabase
          .from("pickup_assignments")
          .select("*, pickups(*, companies(name), orders(id, recipient_name, destination_district))")
          .eq("courier_id", user.id)
          .is("picked_up_at", null)
          .order("assigned_at", { ascending: true }),
      ]);
      if (ordersRes.error) throw ordersRes.error;
      if (pickupsRes.error) throw pickupsRes.error;
      setOrders((ordersRes.data ?? []) as Order[]);
      setAssignments(
        ((pickupsRes.data ?? []) as Assignment[]).filter(
          (a) => a.pickups && !["failed", "cancelled", "picked_up"].includes(a.pickups.status),
        ),
      );
    } catch (error) {
      console.error("Error cargando envíos:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const setOrderStatus = async (orderId: string, status: "in_transit" | "failed", notes?: string) => {
    setBusyId(orderId);
    try {
      await flush(); // la coordenada del momento queda en order_events
      const { error } = await supabase
        .from("orders")
        .update(notes ? { status, delivery_notes: notes } : { status })
        .eq("id", orderId);
      if (error) throw error;
      await load();
    } catch (error) {
      console.error("Error actualizando estado:", error);
      alert("No se pudo actualizar el pedido: " + (error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const markFailed = (order: Order) => {
    const reason = window.prompt("¿Por qué no se pudo entregar? (nadie recibe, dirección errada, etc.)");
    if (reason === null) return;
    void setOrderStatus(order.id, "failed", reason.trim() || "No se pudo entregar");
  };

  const markPickedUp = async (a: Assignment) => {
    if (!user) return;
    setBusyId(a.pickup_id);
    try {
      await flush();
      const { error } = await supabase
        .from("pickup_assignments")
        .update({ picked_up_at: new Date().toISOString() })
        .eq("pickup_id", a.pickup_id)
        .eq("courier_id", user.id);
      if (error) throw error;
      await load();
    } catch (error) {
      console.error("Error marcando recojo:", error);
      alert("No se pudo marcar el recojo: " + (error as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    if (!event.target.files || event.target.files.length === 0 || !selectedOrder || !user) return;

    const file = event.target.files[0];
    const fileExt = file.name.split(".").pop();
    const filePath = `${selectedOrder.id}-${Date.now()}.${fileExt}`;

    setUploading(true);
    try {
      const { error: uploadError } = await supabase.storage.from("proofs").upload(filePath, file);
      if (uploadError) throw uploadError;

      const {
        data: { publicUrl },
      } = supabase.storage.from("proofs").getPublicUrl(filePath);

      const { error: deliveryError } = await supabase.from("deliveries").insert({
        order_id: selectedOrder.id,
        courier_id: user.id,
        proof_image_url: publicUrl,
        delivered_at: new Date().toISOString(),
      });
      if (deliveryError) throw deliveryError;

      await flush();
      const amountCollected = Number(collect.amount);
      const { error: updateError } = await supabase
        .from("orders")
        .update({
          status: "delivered",
          amount_collected: Number.isFinite(amountCollected) ? amountCollected : null,
          payment_method: collect.method || null,
        })
        .eq("id", selectedOrder.id);
      if (updateError) throw updateError;

      setSelectedOrder(null);
      await load();
    } catch (error) {
      console.error("Error uploading proof:", error);
      alert('Error al subir la prueba de entrega. Asegúrate de que el bucket "proofs" exista y tengas permisos.');
    } finally {
      setUploading(false);
    }
  };

  const handlePaymentMethodChange = async (orderId: string, method: string) => {
    const { error } = await supabase.from("orders").update({ payment_method: method }).eq("id", orderId);
    if (error) {
      console.error("Error updating payment method:", error);
      return;
    }
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, payment_method: method } : o)));
  };

  return (
    <div className="mx-auto max-w-md space-y-6">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Mis Envíos</h1>
        {wakeLock.supported && (
          <Button
            type="button"
            size="sm"
            variant={wakeLock.active ? "default" : "outline"}
            onClick={() => void wakeLock.toggle()}
            title="Evita que la pantalla se apague mientras estás en ruta"
          >
            <Sun className="mr-1.5 h-4 w-4" />
            {wakeLock.active ? "Pantalla activa" : "Mantener pantalla"}
          </Button>
        )}
      </div>

      <LocationPermissionCard />

      {(orders.length > 0 || assignments.length > 0) && (
        <Button asChild variant="outline" className="w-full">
          <Link to="/mi-ruta">
            <RouteIcon className="mr-2 h-4 w-4" /> Ver mi ruta en el mapa
          </Link>
        </Button>
      )}

      {loading ? (
        <div className="text-center">Cargando...</div>
      ) : (
        <>
          {/* Recojos */}
          {assignments.length > 0 && (
            <section className="space-y-3">
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <PackageOpen className="h-5 w-5 text-purple-600" /> Recojos ({assignments.length})
              </h2>
              {assignments.map((a) => {
                const p = a.pickups!;
                const window = formatTimeWindow(p.pickup_after, p.pickup_before);
                return (
                  <Card key={a.pickup_id} className="overflow-hidden">
                    <div className="h-2 w-full bg-purple-500" />
                    <CardHeader className="pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <CardTitle className="text-lg">
                          Recojo #{p.pickup_number} · {p.companies?.name ?? "—"}
                        </CardTitle>
                        {p.packages_count != null && (
                          <span className="shrink-0 rounded-full bg-purple-100 px-2 py-1 text-xs font-bold text-purple-800">
                            {p.packages_count} pqt
                          </span>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                      <div className="flex items-start gap-2">
                        <MapPin className="mt-0.5 h-4 w-4 text-gray-500" />
                        <span>
                          {p.address}
                          {p.district ? ` · ${districtName(p.district)}` : ""}
                          {p.lat != null && p.lng != null && (
                            <a
                              href={googleMapsUrl(p.lat, p.lng)}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-2 inline-flex items-center gap-1 text-blue-600 underline"
                            >
                              <ExternalLink className="h-3 w-3" /> mapa
                            </a>
                          )}
                        </span>
                      </div>
                      {(p.contact_name || p.contact_phone) && (
                        <div className="flex items-start gap-2">
                          <User className="mt-0.5 h-4 w-4 text-gray-500" />
                          <span>
                            {p.contact_name}
                            {p.contact_phone && (
                              <a href={`tel:${p.contact_phone}`} className="ml-2 text-blue-600 underline">
                                {p.contact_phone}
                              </a>
                            )}
                          </span>
                        </div>
                      )}
                      {window && (
                        <div className="flex items-center gap-2 text-amber-800">
                          <Clock className="h-4 w-4" /> {window}
                        </div>
                      )}
                      {p.notes && <p className="rounded bg-gray-50 p-2 text-xs text-gray-700">{p.notes}</p>}
                      {p.orders.length > 0 && (
                        <div className="flex items-start gap-2 text-xs text-gray-600">
                          <Package className="mt-0.5 h-4 w-4 shrink-0" />
                          <span>
                            {p.orders.length} pedido{p.orders.length === 1 ? "" : "s"}:{" "}
                            {p.orders.map((o) => `${o.recipient_name ?? "—"} (${districtName(o.destination_district)})`).join(", ")}
                          </span>
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="bg-gray-50 p-4">
                      <Button
                        className="w-full bg-purple-600 hover:bg-purple-700"
                        onClick={() => void markPickedUp(a)}
                        disabled={busyId === a.pickup_id}
                      >
                        <Check className="mr-2 h-4 w-4" /> Marcar recogido
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </section>
          )}

          {/* Entregas */}
          <section className="space-y-3">
            {assignments.length > 0 && (
              <h2 className="flex items-center gap-2 text-lg font-semibold">
                <Truck className="h-5 w-5 text-blue-600" /> Entregas ({orders.length})
              </h2>
            )}
            {orders.length === 0 ? (
              <div className="py-10 text-center text-gray-500">
                <Truck className="mx-auto mb-4 h-12 w-12 opacity-50" />
                <p>No tienes envíos pendientes.</p>
              </div>
            ) : (
              orders.map((order) => (
                <Card key={order.id} className="overflow-hidden">
                  <div className={cn("h-2 w-full", STATUS_META[order.status].dot)} />
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-lg">#{order.order_number}</CardTitle>
                      <StatusBadge status={order.status} />
                    </div>
                    <OrderBadges order={{ ...order, pickup_number: order.pickups?.pickup_number ?? null }} className="pt-1" />
                  </CardHeader>
                  <CardContent className="space-y-3 text-sm">
                    <div className="flex items-start gap-2">
                      <User className="mt-0.5 h-4 w-4 text-gray-500" />
                      <span className="font-medium">{order.recipient_name}</span>
                    </div>
                    <div className="flex items-start gap-2">
                      <MapPin className="mt-0.5 h-4 w-4 text-gray-500" />
                      <span>
                        {order.destination_address}
                        {order.destination_district ? ` · ${districtName(order.destination_district)}` : ""}
                        {order.destination_lat != null && order.destination_lng != null && (
                          <a
                            href={googleMapsUrl(order.destination_lat, order.destination_lng)}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 inline-flex items-center gap-1 text-blue-600 underline"
                          >
                            <ExternalLink className="h-3 w-3" /> mapa
                          </a>
                        )}
                      </span>
                    </div>
                    <div className="flex items-start gap-2">
                      <Phone className="mt-0.5 h-4 w-4 text-gray-500" />
                      <a href={`tel:${order.recipient_phone}`} className="text-blue-600 underline">
                        {order.recipient_phone}
                      </a>
                    </div>
                    {order.product_details && <p className="text-xs text-gray-600">{order.product_details}</p>}
                    {order.comments && <p className="rounded bg-gray-50 p-2 text-xs text-gray-700">{order.comments}</p>}
                    {order.origin_type === "pickup" && order.status === "pending" && (
                      <p className="rounded bg-purple-50 p-2 text-xs text-purple-800">
                        Este paquete aún no se ha recogido (recojo #{order.pickups?.pickup_number}).
                      </p>
                    )}

                    <div className="mt-2 border-t pt-2">
                      <label className="mb-1 block text-xs font-medium text-gray-500">Método de Pago</label>
                      <select
                        className="w-full rounded border bg-white p-1 text-sm"
                        value={order.payment_method || ""}
                        onChange={(e) => handlePaymentMethodChange(order.id, e.target.value)}
                      >
                        <option value="">Seleccionar...</option>
                        <option value="Motorizado">Motorizado (efectivo)</option>
                        <option value="Directo a comercio">Directo a comercio</option>
                        <option value="Relampago Courier">Relampago Courier</option>
                        <option value="Izipay">Izipay (tarjeta)</option>
                      </select>
                    </div>
                  </CardContent>
                  <CardFooter className="flex gap-2 bg-gray-50 p-4">
                    {(order.status === "pending" || order.status === "picked_up") && (
                      <Button className="w-full" onClick={() => void setOrderStatus(order.id, "in_transit")} disabled={busyId === order.id}>
                        <Truck className="mr-2 h-4 w-4" /> Iniciar Ruta
                      </Button>
                    )}
                    {order.status === "in_transit" && (
                      <>
                        <Button
                          variant="outline"
                          className="shrink-0 border-red-200 text-red-700 hover:bg-red-50"
                          onClick={() => markFailed(order)}
                          disabled={busyId === order.id}
                          title="No se pudo entregar"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                        <Button className="w-full bg-green-600 hover:bg-green-700" onClick={() => openConfirm(order)} disabled={busyId === order.id}>
                          <Check className="mr-2 h-4 w-4" /> Confirmar Entrega
                        </Button>
                      </>
                    )}
                  </CardFooter>
                </Card>
              ))
            )}
          </section>
        </>
      )}

      {selectedOrder && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <Card className="w-full max-w-sm">
            <CardHeader>
              <CardTitle>Confirmar Entrega · #{selectedOrder.order_number}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {(selectedOrder.amount_to_collect ?? 0) > 0 && (
                <div className="grid grid-cols-2 gap-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                  <div className="col-span-2 text-xs text-emerald-900">
                    Cobro previsto: <b>S/ {Number(selectedOrder.amount_to_collect).toFixed(2)}</b>
                  </div>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-600">¿Cuánto cobraste?</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.01"
                      min="0"
                      value={collect.amount}
                      onChange={(e) => setCollect((c) => ({ ...c, amount: e.target.value }))}
                      className="w-full rounded border bg-white p-2"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="text-xs font-medium text-gray-600">¿A dónde fue el dinero?</span>
                    <select
                      value={collect.method}
                      onChange={(e) => setCollect((c) => ({ ...c, method: e.target.value }))}
                      className="w-full rounded border bg-white p-2"
                    >
                      <option value="">Seleccionar…</option>
                      <option value="Motorizado">Efectivo (motorizado)</option>
                      <option value="Directo a comercio">Yape/Plin al comercio</option>
                      <option value="Relampago Courier">Yape a Relámpago</option>
                      <option value="Izipay">Tarjeta (Izipay)</option>
                    </select>
                  </label>
                </div>
              )}
              <p className="text-center text-sm text-gray-500">Selecciona una opción para subir la prueba de entrega.</p>

              {uploading ? (
                <div className="flex justify-center py-8">
                  <div className="h-12 w-12 animate-spin rounded-full border-b-2 border-primary"></div>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <div
                    className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-blue-200 bg-blue-50 p-6 transition-colors hover:bg-blue-100"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="h-8 w-8 text-blue-600" />
                    <span className="text-center text-sm font-medium text-blue-800">Tomar Foto</span>
                  </div>
                  <div
                    className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-gray-200 bg-gray-50 p-6 transition-colors hover:bg-gray-100"
                    onClick={() => galleryInputRef.current?.click()}
                  >
                    <ImageIcon className="h-8 w-8 text-gray-600" />
                    <span className="text-center text-sm font-medium text-gray-800">Subir de Galería</span>
                  </div>
                </div>
              )}

              <input type="file" ref={cameraInputRef} className="hidden" accept="image/*" capture="environment" onChange={handleFileUpload} disabled={uploading} />
              <input type="file" ref={galleryInputRef} className="hidden" accept="image/*" onChange={handleFileUpload} disabled={uploading} />
            </CardContent>
            <CardFooter>
              <Button variant="outline" className="w-full" onClick={() => setSelectedOrder(null)} disabled={uploading}>
                Cancelar
              </Button>
            </CardFooter>
          </Card>
        </div>
      )}
    </div>
  );
}
