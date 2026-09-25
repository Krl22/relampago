import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "../lib/supabase";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Card, CardContent } from "./ui/card";
import { Loader2, CheckCircle2, Warehouse, PackageOpen, Building2, CalendarClock, MapPin } from "lucide-react";
import { Link } from "react-router-dom";
import { isAgencyDistrict } from "../lib/orderMeta";
import { hasPriceRange, useDistricts } from "../lib/districts";
import { DistrictSelect } from "./DistrictSelect";
import { MapPickerDialog } from "./MapPickerDialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import type { LatLng } from "../lib/geo";
import { geocodeApprox } from "../lib/nominatim";
import { CUTOFFS, scheduleFor, scheduleLabel } from "../lib/cutoff";
import { cn } from "@/lib/utils";

type SavedAddress = {
  id: string;
  label: string | null;
  address: string;
  district: string | null;
  contact_name: string | null;
  contact_phone: string | null;
};
type IntakeContext = { company: { id: string; name: string; skip_cutoff?: boolean }; addresses: SavedAddress[] };
/** Producto del stock del comercio en el almacén (disponible = en almacén - comprometido en pedidos). */
type StockItem = { id: string; product_name: string; unit: string | null; available: number };
type PickedItem = { stock_id: string; quantity: number };

const selectClass =
  "flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

const formSchema = z
  .object({
    sender_name: z.string().trim().min(2, "El nombre del negocio es requerido"),
    recipient_name: z.string().trim().min(2, "El nombre del destinatario es requerido"),
    recipient_phone: z.string().trim().regex(/^\d{6,15}$/, "Solo números, de 6 a 15 dígitos"),
    district: z.string().min(1, "Selecciona un distrito"),
    delivery_address: z.string().trim().min(5, "La dirección es requerida"),
    product_details: z.string().trim().optional(),
    packages_count: z.coerce.number().int().min(1, "Debe ser al menos 1 paquete").max(500, "¿Seguro? Máximo 500"),
    amount_to_collect: z.coerce.number().min(0, "No puede ser negativo").max(20000, "Monto demasiado alto; revisa que no sea un teléfono"),
    service_type: z.enum(["delivery", "exchange", "return", "agency"]),
    agency_name: z.string().trim().optional(),
    agency_destination: z.string().trim().optional(),
    recipient_dni: z.string().trim().optional(),
    origin_type: z.enum(["warehouse", "pickup"]),
    pickup_address_id: z.string().optional(),
    pickup_address: z.string().trim().optional(),
    pickup_district: z.string().optional(),
    pickup_contact_name: z.string().trim().optional(),
    pickup_contact_phone: z.string().trim().optional(),
    pickup_after: z.string().optional(),
    pickup_before: z.string().optional(),
    pickup_notes: z.string().trim().optional(),
    comments: z.string().trim().optional(),
  })
  .superRefine((v, ctx) => {
    const usesSavedAddress = !!v.pickup_address_id && v.pickup_address_id !== "other";
    if (v.origin_type === "pickup" && !usesSavedAddress && (v.pickup_address ?? "").length < 5) {
      ctx.addIssue({ code: "custom", path: ["pickup_address"], message: "Indica dónde recoger el paquete" });
    }
    if (v.service_type === "agency") {
      if (!v.agency_name) ctx.addIssue({ code: "custom", path: ["agency_name"], message: "¿Qué agencia?" });
      if (!v.agency_destination) ctx.addIssue({ code: "custom", path: ["agency_destination"], message: "¿A qué ciudad va?" });
    }
  });

type FormInput = z.input<typeof formSchema>;
type FormValues = z.output<typeof formSchema>;

interface OrderFormProps {
  /** Token del link propio de la empresa (?c=...). Fija el remitente y habilita sus direcciones guardadas. */
  intakeToken?: string | null;
  onSuccess?: () => void;
  /** Portal del comercio: recoge solo en sus direcciones registradas (las agrega Relámpago). */
  portal?: boolean;
}

type Result = { order_number: number; pickup_id: string | null; scheduled_date: string | null; tariff: string | null };

export function OrderForm({ intakeToken, onSuccess, portal = false }: OrderFormProps) {
  const [result, setResult] = useState<Result | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [context, setContext] = useState<IntakeContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [nameAddresses, setNameAddresses] = useState<SavedAddress[]>([]);
  const districts = useDistricts();
  // Punto exacto de una dirección de recojo nueva (se guarda con la dirección)
  const [pickupPoint, setPickupPoint] = useState<LatLng | null>(null);
  const [pickupMapOpen, setPickupMapOpen] = useState(false);
  const [pickupSuggest, setPickupSuggest] = useState<LatLng | null>(null);
  // Productos elegidos del stock (solo si el paquete sale del almacén)
  const [stock, setStock] = useState<StockItem[]>([]);
  const [items, setItems] = useState<PickedItem[]>([]);
  const [stockError, setStockError] = useState<string | null>(null);
  const [stockReload, setStockReload] = useState(0);
  // Paso de confirmación: el pedido se revisa antes de enviarlo
  const [review, setReview] = useState<FormValues | null>(null);
  const [sending, setSending] = useState(false);
  const addressTimer = useRef<number | null>(null);
  // Ubicación aproximada del destino (se calcula en segundo plano a partir de la dirección)
  const geoRef = useRef<{ key: string; promise: Promise<LatLng | null> } | null>(null);

  const savedAddresses: SavedAddress[] = context ? context.addresses : nameAddresses;
  const searchTimer = useRef<number | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    setError,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<FormInput, unknown, FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      packages_count: 1,
      amount_to_collect: 0,
      service_type: "delivery",
      origin_type: "warehouse",
    },
  });

  const senderName = watch("sender_name");
  const district = watch("district");
  const originType = watch("origin_type");
  const serviceType = watch("service_type");
  const pickupAddressId = watch("pickup_address_id");
  const deliveryAddress = watch("delivery_address");
  const schedule = scheduleFor(originType, !!context?.company.skip_cutoff);

  // Link propio: nombre de la empresa + direcciones guardadas
  useEffect(() => {
    if (!intakeToken) return;
    supabase.rpc("intake_context", { p_token: intakeToken }).then(({ data, error }) => {
      if (error || !data) {
        setContextError("Este link de pedidos no es válido. Escribe el nombre de tu negocio.");
        return;
      }
      const ctx = data as unknown as IntakeContext;
      setContext(ctx);
      setValue("sender_name", ctx.company.name);
      const def = ctx.addresses[0];
      if (def) setValue("pickup_address_id", def.id);
    });
  }, [intakeToken, setValue]);

  // Stock del comercio en el almacén (solo en el portal, con su sesión)
  const companyId = context?.company.id ?? null;
  useEffect(() => {
    if (!portal || !companyId) return;
    let alive = true;
    supabase
      .from("stock_availability")
      .select("id, product_name, unit, available")
      .eq("company_id", companyId)
      .order("product_name")
      .then(({ data }) => {
        if (alive) setStock((data ?? []).filter((s): s is StockItem => !!s.id && !!s.product_name).map((s) => ({ ...s, available: Number(s.available ?? 0) })));
      });
    return () => {
      alive = false;
    };
  }, [portal, companyId, stockReload]);

  // Autocompletado del negocio (solo nombres, desde 3 letras)
  useEffect(() => {
    if (context) return;
    if (searchTimer.current) window.clearTimeout(searchTimer.current);
    const q = (senderName ?? "").trim();
    if (q.length < 3) {
      setSuggestions([]);
      return;
    }
    searchTimer.current = window.setTimeout(async () => {
      const { data } = await supabase.rpc("search_company_names", { p_q: q });
      const names = (data ?? []) as string[];
      setSuggestions(names.filter((n) => n.toLowerCase() !== q.toLowerCase()));
    }, 300);
  }, [senderName, context]);

  // Sin link propio: las direcciones guardadas del negocio escrito (solo dirección, sin contactos)
  useEffect(() => {
    if (context) return;
    if (addressTimer.current) window.clearTimeout(addressTimer.current);
    const name = (senderName ?? "").trim();
    if (name.length < 2) {
      setNameAddresses([]);
      return;
    }
    addressTimer.current = window.setTimeout(async () => {
      const { data } = await supabase.rpc("company_addresses_by_name", { p_name: name });
      const list = ((data ?? []) as unknown as SavedAddress[]).map((a) => ({ ...a, contact_name: null, contact_phone: null }));
      setNameAddresses(list);
      setValue("pickup_address_id", list[0]?.id ?? "other");
    }, 400);
  }, [senderName, context, setValue]);

  const geoKey = (address: string, d: string) => `${address.trim().toLowerCase()}|${d}`;
  const startGeocode = (address: string, d: string) => {
    const key = geoKey(address, d);
    if (geoRef.current?.key === key) return geoRef.current.promise;
    const promise = geocodeApprox(address, d).catch(() => null);
    geoRef.current = { key, promise };
    return promise;
  };
  useEffect(() => {
    if (!district || (deliveryAddress ?? "").trim().length < 6) return;
    const t = window.setTimeout(() => void startGeocode(deliveryAddress ?? "", district), 1500);
    return () => window.clearTimeout(t);
  }, [deliveryAddress, district]); // eslint-disable-line react-hooks/exhaustive-deps

  // El tipo de servicio no se pregunta: todo es entrega, salvo destino "Agencia ..." que
  // se marca solo y pide agencia / ciudad / DNI.
  useEffect(() => {
    if (isAgencyDistrict(district)) {
      setValue("service_type", "agency");
      const m = district.match(/^Agencia\s+([^(]+)/i);
      if (m) setValue("agency_name", m[1].trim());
    } else {
      setValue("service_type", "delivery");
    }
  }, [district, setValue]);

  const send = async (v: FormValues) => {
    setServerError(null);
    try {
      const usingSaved = v.origin_type === "pickup" && !!v.pickup_address_id && v.pickup_address_id !== "other";
      // Punto aproximado: si no está listo en ~2.5 s, el pedido se registra sin él
      const point = await Promise.race([
        startGeocode(v.delivery_address, v.district),
        new Promise<null>((r) => window.setTimeout(() => r(null), 2500)),
      ]);
      const payload = {
        intake_token: intakeToken ?? null,
        sender_name: v.sender_name,
        sender_email: null,
        recipient_name: v.recipient_name,
        recipient_phone: v.recipient_phone,
        destination_district: v.district,
        destination_address: v.delivery_address,
        product_details: v.product_details || null,
        items: v.origin_type === "warehouse" ? items : [],
        packages_count: String(v.packages_count),
        amount_to_collect: String(v.amount_to_collect),
        service_type: v.service_type,
        agency_name: v.service_type === "agency" ? v.agency_name : null,
        agency_destination: v.service_type === "agency" ? v.agency_destination : null,
        recipient_dni: v.service_type === "agency" ? v.recipient_dni : null,
        comments: v.comments || null,
        destination_lat: point?.lat ?? null,
        destination_lng: point?.lng ?? null,
        destination_approx: !!point,
        origin_type: v.origin_type,
        pickup:
          v.origin_type === "pickup"
            ? {
                address_id: usingSaved ? v.pickup_address_id : null,
                address: usingSaved ? null : v.pickup_address,
                district: usingSaved ? null : v.pickup_district || null,
                lat: usingSaved ? null : (pickupPoint?.lat ?? null),
                lng: usingSaved ? null : (pickupPoint?.lng ?? null),
                contact_name: v.pickup_contact_name || null,
                contact_phone: v.pickup_contact_phone || null,
                after: v.pickup_after || null,
                before: v.pickup_before || null,
                notes: v.pickup_notes || null,
              }
            : null,
      };

      const { data, error } = await supabase.rpc("submit_order", { p: payload });
      if (error) throw error;

      const r = data as unknown as Result;
      setResult(r);
      setItems([]);
      setStockReload((k) => k + 1);
      setPickupPoint(null);
      setPickupSuggest(null);
      reset({
        sender_name: context?.company.name ?? "",
        packages_count: 1,
        amount_to_collect: 0,
        service_type: "delivery",
        origin_type: "warehouse",
        pickup_address_id: context?.addresses[0]?.id,
      });
      setReview(null);
      onSuccess?.();
    } catch (error) {
      console.error("Error creating order:", error);
      setServerError((error as Error).message || "Error al crear el pedido. Inténtalo de nuevo.");
    }
  };

  const confirmSend = async () => {
    if (!review) return;
    setSending(true);
    await send(review);
    setSending(false);
  };

  if (result) {
    return (
      <div className="flex flex-col items-center justify-center space-y-4 p-8 text-center">
        <div className="rounded-full bg-green-100 p-3">
          <CheckCircle2 className="h-12 w-12 text-green-600" />
        </div>
        <h2 className="text-2xl font-bold text-gray-900">¡Pedido #{result.order_number} registrado!</h2>
        <p className="text-gray-600">
          Tu pedido ha sido enviado a Relámpago Courier.
          {result.pickup_id && " El recojo quedó programado."}
        </p>
        {result.scheduled_date && (
          <p className="rounded-md bg-primary/5 px-3 py-2 text-sm">
            Se atiende <b>{scheduleLabel(result.scheduled_date)}</b>.
            {!result.tariff && " La tarifa de ese distrito depende de la zona: te la confirmamos."}
          </p>
        )}
        <Button onClick={() => setResult(null)} className="mt-4">
          Registrar otro pedido
        </Button>
      </div>
    );
  }

  const fieldError = (msg?: string) => msg && <span className="text-sm text-destructive">{msg}</span>;

  return (
    <Card className="mx-auto w-full max-w-2xl">
      <CardContent className="pt-6">
        <form
          onSubmit={handleSubmit((v) => {
            setServerError(null);
            const useStock = v.origin_type === "warehouse" && items.length > 0;
            const over = useStock ? items.find((it) => it.quantity < 1 || it.quantity > (stock.find((s) => s.id === it.stock_id)?.available ?? 0)) : null;
            if (over) {
              setStockError("Revisa las cantidades: no pueden superar lo disponible.");
              return;
            }
            if (!useStock && (v.product_details ?? "").trim().length < 2) {
              setError("product_details", { message: "Detalla los productos" });
              return;
            }
            setStockError(null);
            setReview(v);
          })}
          className="space-y-6"
        >
          {serverError && <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{serverError}</div>}
          {contextError && <div className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">{contextError}</div>}

          {/* Remitente */}
          {context ? (
            <div className="flex items-center gap-3 rounded-lg border bg-primary/5 p-3">
              <Building2 className="h-5 w-5 text-primary" />
              <div>
                <div className="text-xs text-muted-foreground">Pedido para</div>
                <div className="font-semibold">{context.company.name}</div>
              </div>
            </div>
          ) : (
            <div className="relative space-y-2">
              <Label htmlFor="sender_name">Nombre de su negocio (remitente)</Label>
              <Input
                id="sender_name"
                {...register("sender_name")}
                placeholder="Ej. Tienda Express"
                autoComplete="off"
                onFocus={() => setShowSuggestions(true)}
                onBlur={() => setTimeout(() => setShowSuggestions(false), 200)}
              />
              {showSuggestions && suggestions.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-gray-200 bg-white shadow-lg">
                  {suggestions.map((name) => (
                    <li
                      key={name}
                      className="cursor-pointer px-4 py-2 text-sm hover:bg-gray-100"
                      onMouseDown={() => {
                        setValue("sender_name", name);
                        setShowSuggestions(false);
                      }}
                    >
                      {name}
                    </li>
                  ))}
                </ul>
              )}
              {fieldError(errors.sender_name?.message)}
            </div>
          )}

          {/* Origen */}
          <div className="space-y-2">
            <Label>¿De dónde sale el paquete?</Label>
            <div className="grid gap-2 sm:grid-cols-2">
              <OriginOption
                active={originType === "warehouse"}
                icon={<Warehouse className="h-5 w-5" />}
                title="Almacén de Relámpago"
                hint="Ya lo dejé / está en stock"
                onClick={() => setValue("origin_type", "warehouse")}
              />
              <OriginOption
                active={originType === "pickup"}
                icon={<PackageOpen className="h-5 w-5" />}
                title="Hay que recogerlo"
                hint={portal ? (savedAddresses.length ? "En mi dirección registrada" : "No tienes dirección de recojo registrada") : "En mi negocio u otra dirección"}
                disabled={portal && savedAddresses.length === 0}
                onClick={() => setValue("origin_type", "pickup")}
              />
            </div>
            <div
              className={cn(
                "flex items-start gap-2 rounded-md px-3 py-2 text-xs",
                schedule.sameDay ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-900",
              )}
            >
              <CalendarClock className="mt-0.5 h-4 w-4 shrink-0" />
              {schedule.sameDay ? (
                <span>
                  Si lo registras ahora, se atiende <b>hoy</b>
                  {!context?.company.skip_cutoff && <> (corte {CUTOFFS[originType].label})</>}.
                </span>
              ) : schedule.afterCutoff ? (
                <span>
                  Ya pasó el corte de las {CUTOFFS[originType].label}: se programa para <b>{scheduleLabel(schedule.date)}</b>. Si lo necesitas hoy,
                  coordínalo antes con nosotros.
                </span>
              ) : (
                <span>
                  Hoy no hay reparto: se programa para <b>{scheduleLabel(schedule.date)}</b>.
                </span>
              )}
            </div>
          </div>

          {portal && savedAddresses.length === 0 && (
            <p className="text-xs text-muted-foreground">¿Necesitas que recojamos tus paquetes? Pídele a Relámpago Courier que registre tu dirección de recojo.</p>
          )}

          {originType === "pickup" && portal && savedAddresses.length > 0 && (
            <div className="space-y-2 rounded-lg border border-purple-200 bg-purple-50/50 p-4">
              {savedAddresses.length === 1 ? (
                <div className="text-sm">
                  <div className="text-xs text-purple-800">Recogemos en</div>
                  <div className="font-medium">
                    {savedAddresses[0].label ? `${savedAddresses[0].label} · ` : ""}
                    {savedAddresses[0].address}
                    {savedAddresses[0].district ? ` (${savedAddresses[0].district})` : ""}
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="pickup_address_id">Recoger en</Label>
                  <select id="pickup_address_id" {...register("pickup_address_id")} className={selectClass}>
                    {savedAddresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label ? `${a.label} · ` : ""}
                        {a.address}
                        {a.district ? ` (${a.district})` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <p className="text-xs text-purple-800">¿Otra dirección de recojo? Pídela a Relámpago Courier y la agregamos a tu comercio.</p>
            </div>
          )}

          {originType === "pickup" && !portal && (
            <div className="space-y-4 rounded-lg border border-purple-200 bg-purple-50/50 p-4">
              {savedAddresses.length > 0 && (
                <div className="space-y-2">
                  <Label htmlFor="pickup_address_id">Recoger en</Label>
                  <select id="pickup_address_id" {...register("pickup_address_id")} className={selectClass}>
                    {savedAddresses.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label ? `${a.label} · ` : ""}
                        {a.address}
                        {a.district ? ` (${a.district})` : ""}
                      </option>
                    ))}
                    <option value="other">Otra dirección…</option>
                  </select>
                </div>
              )}

              {(savedAddresses.length === 0 || pickupAddressId === "other") && (
                <>
                  {savedAddresses.length === 0 && (senderName ?? "").trim().length >= 2 && (
                    <p className="text-xs text-purple-800">Esta dirección quedará guardada para tu negocio y la próxima vez solo tendrás que elegirla.</p>
                  )}
                  <div className="space-y-2">
                    <Label htmlFor="pickup_address">Dirección de recojo (con referencias)</Label>
                    <Textarea id="pickup_address" {...register("pickup_address")} placeholder="Ej. Av. Nicolás Arriola 985, oficina 3, preguntar por Marion" />
                    {fieldError(errors.pickup_address?.message)}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="pickup_district">Distrito de recojo</Label>
                    <DistrictSelect id="pickup_district" {...register("pickup_district")} placeholder="Seleccionar…" />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      variant={pickupPoint ? "outline" : "secondary"}
                      size="sm"
                      onClick={() => {
                        // El mapa arranca en la dirección escrita (aproximada) si la hay
                        const addr = watch("pickup_address") ?? "";
                        const dist = watch("pickup_district") ?? "";
                        if (!pickupPoint && addr.trim().length >= 6 && dist) void geocodeApprox(addr, dist).then(setPickupSuggest).catch(() => undefined);
                        setPickupMapOpen(true);
                      }}
                    >
                      <MapPin className="mr-1 h-4 w-4" /> {pickupPoint ? "Cambiar el punto en el mapa" : "Marcar el punto en el mapa (recomendado)"}
                    </Button>
                    {pickupPoint && (
                      <span className="inline-flex items-center gap-1 text-xs text-green-700">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Punto marcado: se guarda con la dirección
                      </span>
                    )}
                  </div>
                  <MapPickerDialog
                    open={pickupMapOpen}
                    onOpenChange={setPickupMapOpen}
                    value={pickupPoint}
                    onConfirm={setPickupPoint}
                    title="Ubica el punto de recojo"
                    hint="Mueve el mapa hasta dejar el pin en la puerta del local"
                    suggestedCenter={pickupSuggest}
                  />
                </>
              )}

              {savedAddresses.length > 0 && pickupAddressId !== "other" && (
                <p className="text-xs text-purple-800">Usaremos el contacto y horario que tenemos registrados para esa dirección. Si algo cambia, indícalo en comentarios.</p>
              )}
            </div>
          )}

          {/* Destinatario */}
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="recipient_name">Nombre del destinatario</Label>
              <Input id="recipient_name" {...register("recipient_name")} placeholder="Ej. Juan Pérez" />
              {fieldError(errors.recipient_name?.message)}
            </div>
            <div className="space-y-2">
              <Label htmlFor="recipient_phone">Teléfono del destinatario</Label>
              <Input
                id="recipient_phone"
                {...register("recipient_phone", { setValueAs: (v) => String(v ?? "").replace(/\D/g, "") })}
                onInput={(e) => {
                  e.currentTarget.value = e.currentTarget.value.replace(/\D/g, "");
                }}
                placeholder="Ej. 999999999"
                type="tel"
                inputMode="numeric"
                maxLength={15}
              />
              {fieldError(errors.recipient_phone?.message)}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="district">Distrito del destinatario (o agencia)</Label>
            <DistrictSelect id="district" {...register("district")} includeAgencies withPrices />
            {fieldError(errors.district?.message)}
            {district && hasPriceRange(districts.find((d) => d.name === district)) && (
              <p className="text-xs text-muted-foreground">
                En este distrito la tarifa depende de la zona; te la confirmamos.{" "}
                <Link to="/cobertura" target="_blank" className="text-primary underline">
                  Ver mapa de cobertura
                </Link>
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="delivery_address">Dirección del destinatario (con referencias)</Label>
            <Textarea id="delivery_address" {...register("delivery_address")} placeholder="Ej. Av. Larco 123, dpto 401, frente al parque…" />
            {fieldError(errors.delivery_address?.message)}
          </div>

          {serviceType === "agency" && (
            <div className="grid gap-4 rounded-lg border border-indigo-200 bg-indigo-50/50 p-4 sm:grid-cols-3">
              <p className="col-span-full text-xs text-indigo-900">Envío a agencia para provincia: indica a qué agencia, la ciudad de destino y el DNI de quien recoge.</p>
              <div className="space-y-2">
                <Label htmlFor="agency_name">Agencia</Label>
                <Input id="agency_name" {...register("agency_name")} placeholder="Shalom, Olva…" />
                {fieldError(errors.agency_name?.message)}
              </div>
              <div className="space-y-2">
                <Label htmlFor="agency_destination">Ciudad de destino</Label>
                <Input id="agency_destination" {...register("agency_destination")} placeholder="Ej. Trujillo" />
                {fieldError(errors.agency_destination?.message)}
              </div>
              <div className="space-y-2">
                <Label htmlFor="recipient_dni">DNI del destinatario</Label>
                <Input id="recipient_dni" {...register("recipient_dni")} placeholder="8 dígitos" />
              </div>
            </div>
          )}

          {/* Productos y cobro */}
          {portal && originType === "warehouse" && stock.length > 0 && (
            <StockPicker stock={stock} items={items} onChange={(next) => { setItems(next); setStockError(null); }} error={stockError} />
          )}
          <div className="space-y-2">
            <Label htmlFor="product_details">
              {portal && originType === "warehouse" && items.length > 0 ? "Detalle adicional (opcional)" : "Detalle los productos"}
            </Label>
            <Textarea id="product_details" {...register("product_details")} placeholder="Ej. 2 Polos talla M, 1 Zapatilla…" />
            {fieldError(errors.product_details?.message)}
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <Label htmlFor="packages_count">Cantidad de paquetes</Label>
              <Input id="packages_count" type="number" min="1" {...register("packages_count")} />
              {fieldError(errors.packages_count?.message)}
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount_to_collect">Monto a cobrar (S/.)</Label>
              <Input id="amount_to_collect" type="number" min="0" step="0.01" inputMode="decimal" {...register("amount_to_collect")} />
              <p className="text-xs text-muted-foreground">Si no hay cobro, dejar en 0.</p>
              {fieldError(errors.amount_to_collect?.message)}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="comments">Comentarios adicionales</Label>
            <Textarea id="comments" {...register("comments")} placeholder="Instrucciones especiales para el motorizado…" />
          </div>

          <Button type="submit" className="w-full" size="lg" disabled={isSubmitting || sending}>
            Revisar pedido
          </Button>
        </form>

        <Dialog open={!!review} onOpenChange={(o) => !o && !sending && setReview(null)}>
          <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Confirma tu pedido</DialogTitle>
              <DialogDescription>Revisa que todo esté bien antes de enviarlo a Relámpago Courier.</DialogDescription>
            </DialogHeader>
            {review && (
              <OrderSummary
                v={review}
                senderName={context?.company.name ?? review.sender_name}
                addresses={savedAddresses}
                skipCutoff={!!context?.company.skip_cutoff}
                stockLines={review.origin_type === "warehouse" ? items.map((it) => `${it.quantity} × ${stock.find((s) => s.id === it.stock_id)?.product_name ?? "producto"}`) : []}
              />
            )}
            {serverError && <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{serverError}</div>}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button type="button" variant="outline" onClick={() => setReview(null)} disabled={sending}>
                Corregir
              </Button>
              <Button type="button" onClick={() => void confirmSend()} disabled={sending}>
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Enviando…
                  </>
                ) : (
                  "Confirmar y enviar"
                )}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** Productos del stock del comercio: se eligen de la lista y la cantidad no puede pasar lo disponible. */
function StockPicker({ stock, items, onChange, error }: { stock: StockItem[]; items: PickedItem[]; onChange: (items: PickedItem[]) => void; error: string | null }) {
  const byId = new Map(stock.map((s) => [s.id, s]));
  const add = (id: string) => {
    if (!id || items.some((it) => it.stock_id === id)) return;
    onChange([...items, { stock_id: id, quantity: 1 }]);
  };
  const setQty = (id: string, q: number) => onChange(items.map((it) => (it.stock_id === id ? { ...it, quantity: q } : it)));
  return (
    <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/50 p-3">
      <Label>Productos de tu stock en el almacén</Label>
      {items.map((it) => {
        const s = byId.get(it.stock_id);
        const max = s?.available ?? 0;
        const over = it.quantity > max || it.quantity < 1;
        return (
          <div key={it.stock_id} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 flex-1 truncate">{s?.product_name ?? "Producto"}</span>
            <span className={cn("shrink-0 text-xs", over ? "text-destructive" : "text-muted-foreground")}>disponible {max}</span>
            <Input
              type="number"
              min={1}
              max={max}
              value={it.quantity}
              onChange={(e) => setQty(it.stock_id, Math.floor(Number(e.target.value) || 0))}
              className={cn("h-8 w-20", over && "border-destructive")}
            />
            <Button type="button" size="sm" variant="ghost" className="h-8 px-2 text-red-600" onClick={() => onChange(items.filter((x) => x.stock_id !== it.stock_id))}>
              Quitar
            </Button>
          </div>
        );
      })}
      <select value="" onChange={(e) => add(e.target.value)} className={selectClass}>
        <option value="">{items.length ? "Agregar otro producto…" : "Elige un producto…"}</option>
        {stock.map((s) => (
          <option key={s.id} value={s.id} disabled={s.available <= 0 || items.some((it) => it.stock_id === s.id)}>
            {s.product_name} — disponible {s.available}
            {s.unit ? ` ${s.unit}` : ""}
          </option>
        ))}
      </select>
      <p className="text-xs text-muted-foreground">Se descuentan de tu stock cuando el pedido se entrega. Si no es de tu stock, deja la lista vacía y descríbelo abajo.</p>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Resumen del pedido en el paso de confirmación. */
function OrderSummary({
  v,
  senderName,
  addresses,
  skipCutoff,
  stockLines,
}: {
  v: FormValues;
  senderName: string;
  addresses: SavedAddress[];
  skipCutoff: boolean;
  stockLines: string[];
}) {
  const schedule = scheduleFor(v.origin_type, skipCutoff);
  const pickup = v.origin_type === "pickup" ? (addresses.find((a) => a.id === v.pickup_address_id) ?? null) : null;
  const amount = Number(v.amount_to_collect ?? 0);
  const row = (label: string, value: React.ReactNode) => (
    <div className="grid grid-cols-[110px_1fr] gap-2 border-b py-1.5 last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
  return (
    <div className="rounded-md border px-3 text-sm">
      {row("Comercio", senderName)}
      {row("Destinatario", `${v.recipient_name} · ${v.recipient_phone}`)}
      {row("Entregar en", <>{v.delivery_address} — <b>{v.district}</b></>)}
      {v.service_type === "agency" && row("Agencia", [v.agency_name, v.agency_destination && `→ ${v.agency_destination}`, v.recipient_dni && `DNI ${v.recipient_dni}`].filter(Boolean).join(" "))}
      {stockLines.length > 0 && row("De tu stock", stockLines.join(", "))}
      {v.product_details && row(stockLines.length ? "Detalle" : "Producto", v.product_details)}
      {row("Paquetes", String(v.packages_count))}
      {row("Cobrar", amount > 0 ? <b>S/ {amount.toFixed(2)}</b> : "Sin cobro")}
      {row(
        "Sale de",
        v.origin_type === "warehouse"
          ? "Almacén de Relámpago"
          : pickup
            ? `Recojo en ${pickup.label ? `${pickup.label} · ` : ""}${pickup.address}`
            : `Recojo en ${v.pickup_address ?? ""}`,
      )}
      {row("Se atiende", <b>{scheduleLabel(schedule.date)}</b>)}
      {v.comments && row("Comentarios", v.comments)}
    </div>
  );
}

function OriginOption({
  active,
  icon,
  title,
  hint,
  onClick,
  disabled = false,
}: {
  disabled?: boolean;
  active: boolean;
  icon: React.ReactNode;
  title: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center gap-3 rounded-lg border p-3 text-left transition-colors",
        active ? "border-primary bg-primary/5 ring-2 ring-primary/30" : "bg-background hover:bg-muted",
        disabled && "cursor-not-allowed opacity-50 hover:bg-background",
      )}
    >
      <span className={cn("rounded-full p-2", active ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>{icon}</span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="block text-xs text-muted-foreground">{hint}</span>
      </span>
    </button>
  );
}
