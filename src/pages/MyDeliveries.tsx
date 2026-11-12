import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import {
  Truck,
  MapPin,
  MessageCircle,
  User,
  Camera,
  Check,
  Image as ImageIcon,
  Sun,
  Route as RouteIcon,
  ExternalLink,
  XCircle,
  PackageCheck,
  History,
  RefreshCw,
} from "lucide-react";
import { useAuth } from "../components/AuthProvider";
import { useCourierTracking } from "../components/CourierTrackingProvider";
import { LocationPermissionCard } from "../components/LocationPermissionCard";
import { OrderHistory } from "../components/OrderHistory";
import { OrderBadges, StatusBadge } from "../components/OrderBadges";
import { useWakeLock } from "../hooks/useWakeLock";
import { ACTIVE_STATUSES, STATUS_META, districtName } from "../lib/orderMeta";
import { googleMapsUrl } from "../lib/mapIcons";
import { whatsappHref } from "../lib/phone";
import { cn } from "@/lib/utils";
import { computeFee, TARIFF_AMOUNTS, TARIFF_CODES } from "../lib/tariff";
import { isReadyForRoute } from "../lib/fulfillment";

type Order = Database["public"]["Tables"]["orders"]["Row"] & {
  pickups: { pickup_number: number; status: string } | null;
  companies: { invoice_igv: boolean; t1_rate: number | null } | null;
};

export default function MyDeliveries() {
  const { user } = useAuth();
  const { flush } = useCourierTracking();
  const wakeLock = useWakeLock();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [collect, setCollect] = useState({ amount: "", method: "" });
  const [tariffError, setTariffError] = useState<{ id: string; message: string } | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

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
      const ordersRes = await supabase
          .from("orders")
          .select("*, pickups(pickup_number, status), companies(invoice_igv, t1_rate)")
          .eq("assigned_courier", user.id)
          .in("status", ACTIVE_STATUSES)
          .order("created_at", { ascending: true });
      if (ordersRes.error) throw ordersRes.error;
      setOrders((ordersRes.data ?? []) as Order[]);
      setHistoryVersion((n) => n + 1);
    } catch (error) {
      console.error("Error cargando envíos:", error);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const setOrderStatus = async (order: Order, status: "picked_up" | "in_transit" | "failed", notes?: string) => {
    if (!user || busyId) return;
    setBusyId(order.id);
    try {
      await flush(); // la coordenada del momento queda en order_events
      const { data, error } = await supabase
        .from("orders")
        .update(notes ? { status, delivery_notes: notes } : { status })
        .eq("id", order.id).eq("assigned_courier", user.id).eq("status", order.status)
        .select("id").single();
      if (error) throw error;
      if (!data) throw new Error("El pedido cambió o ya no está asignado a ti. Actualiza la página.");
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
    void setOrderStatus(order, "failed", reason.trim() || "No se pudo entregar");
  };

  const confirmWarehouseWithdrawal = (order: Order) => {
    const count = order.packages_count ?? 1;
    if (window.confirm(`¿Ya recibiste los ${count} paquete(s) del pedido #${order.order_number} en el almacén de Relámpago?\n\nConfirma solo después de revisar los paquetes. El retiro quedará registrado a tu nombre.`)) {
      void setOrderStatus(order, "picked_up");
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

  const handleTariffChange = async (order: Order, tariff: string) => {
    if (!user || busyId || !TARIFF_CODES.includes(tariff)) return;
    setTariffError(null);
    if (order.company_id && !order.companies) {
      setTariffError({ id: order.id, message: "No se pudo leer la tarifa pactada del comercio. Recarga antes de cambiar la tarifa." });
      return;
    }
    const total = computeFee({
      tariff, surcharge: order.surcharge, company: order.companies,
      paymentMethod: order.payment_method,
      amountCollected: order.amount_collected ?? order.amount_to_collect ?? 0,
    });
    if (total == null) return;
    setBusyId(order.id);
    try {
      const { data, error } = await supabase.from("orders")
        .update({ tariff, total_amount: total })
        .eq("id", order.id).eq("assigned_courier", user.id).in("status", ACTIVE_STATUSES)
        .select("tariff, total_amount").single();
      if (error || !data) throw error ?? new Error("El pedido ya no está activo o asignado a ti.");
      setOrders((prev) => prev.map((o) => o.id === order.id ? { ...o, ...data } : o));
    } catch (error) {
      setTariffError({ id: order.id, message: "No se pudo guardar la tarifa: " + (error as Error).message });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div data-page="deliveries" className="mx-auto max-w-md space-y-6">
      <div data-page-header="true" className="flex items-center justify-between gap-2">
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

      {orders.length > 0 && (
        <div className="grid grid-cols-2 gap-2">
          <Button asChild variant="outline" className="w-full">
            <Link to="/mi-ruta">
              <RouteIcon className="mr-2 h-4 w-4" /> Mi ruta
            </Link>
          </Button>
          <Button asChild variant="outline" className="w-full">
            <a href="#order-history">
              <History className="mr-2 h-4 w-4" /> Historial
            </a>
          </Button>
        </div>
      )}

      {loading ? (
        <div role="status" className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
          <RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" /> Cargando tus envíos…
        </div>
      ) : (
        <>
          {/* Entregas */}
          <section className="space-y-3">
            {orders.length === 0 ? (
              <div className="rounded-xl border border-dashed bg-card px-6 py-9 text-center">
                <span className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Truck className="h-8 w-8" aria-hidden="true" />
                </span>
                <h2 className="text-lg font-semibold">Todo al día</h2>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
                  No tienes envíos pendientes. Cuando Relámpago te asigne pedidos, aparecerán aquí.
                </p>
                <Button variant="outline" size="sm" className="mt-5" onClick={() => void refresh()} disabled={refreshing}>
                  <RefreshCw className={cn("mr-2 h-4 w-4", refreshing && "animate-spin")} aria-hidden="true" />
                  {refreshing ? "Buscando…" : "Buscar envíos nuevos"}
                </Button>
                <details className="group mx-auto mt-6 max-w-xs border-t pt-4 text-left text-sm">
                  <summary className="cursor-pointer list-none text-center font-medium text-primary [&::-webkit-details-marker]:hidden">
                    ¿Cómo funciona?
                  </summary>
                  <ol className="mt-3 space-y-2.5">
                    {[
                      "Relámpago te asigna pedidos y te llegan a esta pantalla.",
                      "En «Mi ruta» ves tus paradas en el mapa.",
                      "Al entregar, tomas la foto y registras el cobro.",
                    ].map((step, i) => (
                      <li key={step} className="flex gap-3 text-muted-foreground">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                          {i + 1}
                        </span>
                        <span className="pt-0.5">{step}</span>
                      </li>
                    ))}
                  </ol>
                </details>
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
                      <MessageCircle className="mt-0.5 h-4 w-4 text-gray-500" />
                      <a href={whatsappHref(order.recipient_phone)} target="_blank" rel="noreferrer" title="Abrir chat de WhatsApp" className="text-blue-600 underline">
                        {order.recipient_phone}
                      </a>
                    </div>
                    {order.product_details && <p className="text-xs text-gray-600">{order.product_details}</p>}
                    {order.comments && <p className="rounded bg-gray-50 p-2 text-xs text-gray-700">{order.comments}</p>}
                    {order.origin_type === "warehouse" && order.status === "pending" && (
                      <p className="rounded bg-amber-50 p-2 text-xs text-amber-900">
                        Primero retira {order.packages_count ?? 1} paquete(s) del almacén de Relámpago. Después podrás iniciar la ruta de entrega.
                      </p>
                    )}
                    {order.origin_type === "pickup" && order.status === "pending" && !isReadyForRoute(order) && (
                      <p className="rounded bg-purple-50 p-2 text-xs text-purple-800">
                        Primero completa el recojo{order.pickups ? ` #${order.pickups.pickup_number}` : " del comercio"} en «Mis recojos».
                      </p>
                    )}

                    <div className="mt-2 border-t pt-2 space-y-2">
                      <div>
                        <label htmlFor={`tariff-${order.id}`} className="mb-1 block text-xs font-medium text-gray-500">Tarifa</label>
                        <select id={`tariff-${order.id}`} className="w-full rounded border bg-white p-1 text-sm"
                          value={order.tariff ?? ""} disabled={!!busyId || uploading}
                          onChange={(e) => void handleTariffChange(order, e.target.value)}>
                          <option value="" disabled>Seleccionar tarifa...</option>
                          {TARIFF_CODES.map((code) => <option key={code} value={code}>{code} · S/ {TARIFF_AMOUNTS[code].toFixed(2)} base</option>)}
                        </select>
                        <p className="mt-1 text-xs text-gray-500" role="status">
                          {busyId === order.id ? "Guardando…" : `Monto del servicio: ${order.total_amount == null ? "sin tarifa" : `S/ ${Number(order.total_amount).toFixed(2)}`}`}
                        </p>
                        {tariffError?.id === order.id && <p role="alert" className="mt-1 text-xs text-red-600">{tariffError.message}</p>}
                      </div>
                      <label className="mb-1 block text-xs font-medium text-gray-500">Método de Pago</label>
                      <select
                        className="w-full rounded border bg-white p-1 text-sm"
                        value={order.payment_method || ""}
                        disabled={!!busyId || uploading}
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
                    {order.status === "pending" && order.origin_type === "warehouse" && (
                      <Button className="w-full" onClick={() => confirmWarehouseWithdrawal(order)} disabled={!!busyId}>
                        <PackageCheck className="mr-2 h-4 w-4" /> Confirmar retiro del almacén
                      </Button>
                    )}
                    {order.status === "pending" && order.origin_type === "pickup" && !isReadyForRoute(order) && (
                      <Button asChild variant="outline" className="w-full"><Link to="/my-pickups">Ir a mis recojos</Link></Button>
                    )}
                    {order.status !== "in_transit" && isReadyForRoute(order) && (
                      <Button className="w-full" onClick={() => void setOrderStatus(order, "in_transit")} disabled={!!busyId}>
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

      {user && <OrderHistory courierId={user.id} refreshToken={historyVersion} />}

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
