import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../lib/supabase";
import type { Database, PickupStatus } from "../types/database";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { Checkbox } from "../components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { PICKUP_STATUS_META, districtName, formatTimeWindow } from "../lib/orderMeta";
import { DistrictSelect } from "../components/DistrictSelect";
import { googleMapsUrl } from "../lib/mapIcons";
import { useAuth } from "../components/AuthProvider";
import { Check, ExternalLink, Loader2, Plus, RefreshCw, UserPlus, Wifi, WifiOff, XCircle, Ban, PackageOpen } from "lucide-react";
import { cn } from "@/lib/utils";

type Pickup = Database["public"]["Tables"]["pickups"]["Row"] & {
  companies: { name: string } | null;
  pickup_assignments: { courier_id: string; picked_up_at: string | null; profiles: { full_name: string | null } | null }[];
  orders: { id: string; order_number: number; recipient_name: string | null; destination_district: string | null; status: string }[];
};
type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Company = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name">;
type Address = Database["public"]["Tables"]["company_addresses"]["Row"];

const selectClass =
  "flex h-9 items-center rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring";

const PICKUP_SELECT =
  "*, companies(name), pickup_assignments(courier_id, picked_up_at, profiles(full_name)), orders(id, order_number, recipient_name, destination_district, status)";

export default function Pickups() {
  const { user } = useAuth();
  const [day, setDay] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [statusFilter, setStatusFilter] = useState<"open" | "all" | PickupStatus>("open");
  const [pickups, setPickups] = useState<Pickup[]>([]);
  const [couriers, setCouriers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [realtime, setRealtime] = useState(false);
  const [assigning, setAssigning] = useState<Pickup | null>(null);
  const [creating, setCreating] = useState(false);

  const [reloadToken, setReloadToken] = useState(0);
  const load = useCallback(async () => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    let q = supabase
      .from("pickups")
      .select(PICKUP_SELECT)
      .eq("scheduled_date", day)
      .order("created_at", { ascending: true });
    if (statusFilter === "open") q = q.in("status", ["pending", "assigned"]);
    else if (statusFilter !== "all") q = q.eq("status", statusFilter);
    q.then(({ data, error }) => {
      if (cancelled) return;
      if (error) console.error("Error cargando recojos:", error);
      setPickups((data ?? []) as unknown as Pickup[]);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [day, statusFilter, reloadToken]);

  useEffect(() => {
    supabase
      .from("profiles")
      .select("*")
      .eq("is_courier", true)
      .order("full_name")
      .then(({ data }) => setCouriers(data ?? []));
  }, []);

  useEffect(() => {
    const channel = supabase
      .channel("pickups-admin")
      .on("postgres_changes", { event: "*", schema: "public", table: "pickups" }, () => void load())
      .subscribe((s) => setRealtime(s === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  const setStatus = async (p: Pickup, status: PickupStatus) => {
    if (status === "picked_up" && p.pickup_assignments.length > 0) {
      // Marcar todas las asignaciones: el trigger deja el recojo en picked_up y los pedidos en "recogido"
      const { error } = await supabase
        .from("pickup_assignments")
        .update({ picked_up_at: new Date().toISOString() })
        .eq("pickup_id", p.id)
        .is("picked_up_at", null);
      if (error) alert(error.message);
    } else {
      const { error } = await supabase.from("pickups").update({ status }).eq("id", p.id);
      if (error) alert(error.message);
    }
    await load();
  };

  const moveToDay = async (p: Pickup, date: string) => {
    if (!date || date === p.scheduled_date) return;
    const { error } = await supabase.from("pickups").update({ scheduled_date: date }).eq("id", p.id);
    if (error) alert(error.message);
    await load();
  };

  const stats = useMemo(
    () => ({
      total: pickups.length,
      pending: pickups.filter((p) => p.status === "pending").length,
      assigned: pickups.filter((p) => p.status === "assigned").length,
      done: pickups.filter((p) => p.status === "picked_up").length,
      packages: pickups.reduce((n, p) => n + (p.packages_count ?? 0), 0),
    }),
    [pickups],
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">Recojos</h1>
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
              realtime ? "bg-green-100 text-green-800" : "bg-gray-100 text-gray-600",
            )}
          >
            {realtime ? <Wifi className="h-3 w-3" /> : <WifiOff className="h-3 w-3" />}
            {realtime ? "En vivo" : "Sin realtime"}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input type="date" value={day} onChange={(e) => e.target.value && setDay(e.target.value)} className="h-9 w-auto" />
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className={selectClass}>
            <option value="open">Abiertos</option>
            <option value="all">Todos</option>
            {(Object.keys(PICKUP_STATUS_META) as PickupStatus[]).map((s) => (
              <option key={s} value={s}>
                {PICKUP_STATUS_META[s].label}
              </option>
            ))}
          </select>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setLoading(true);
              void load();
            }}
          >
            <RefreshCw className={cn("mr-2 h-4 w-4", loading && "animate-spin")} /> Actualizar
          </Button>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus className="mr-2 h-4 w-4" /> Nuevo recojo
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Recojos del día" value={stats.total} />
        <Stat label="Sin asignar" value={stats.pending} className="text-yellow-700" />
        <Stat label="Asignados" value={stats.assigned} className="text-blue-700" />
        <Stat label="Recogidos" value={stats.done} className="text-green-700" />
        <Stat label="Paquetes" value={stats.packages} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {format(new Date(`${day}T12:00:00`), "EEEE d 'de' MMMM", { locale: es })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-6 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : pickups.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              <PackageOpen className="mx-auto mb-3 h-10 w-10 opacity-40" />
              No hay recojos para este día con ese filtro.
            </div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[1100px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Comercio</TableHead>
                    <TableHead>Dirección</TableHead>
                    <TableHead>Contacto</TableHead>
                    <TableHead>Horario</TableHead>
                    <TableHead>Pqt</TableHead>
                    <TableHead>Pedidos</TableHead>
                    <TableHead>Motorizados</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pickups.map((p) => {
                    const window = formatTimeWindow(p.pickup_after, p.pickup_before);
                    const open = p.status === "pending" || p.status === "assigned";
                    return (
                      <TableRow key={p.id}>
                        <TableCell className="font-mono text-xs text-muted-foreground">#{p.pickup_number}</TableCell>
                        <TableCell className="whitespace-nowrap font-medium">{p.companies?.name ?? "—"}</TableCell>
                        <TableCell className="max-w-[280px]">
                          <div className="truncate" title={p.address}>
                            {p.address}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {districtName(p.district)}
                            {p.lat != null && p.lng != null && (
                              <a href={googleMapsUrl(p.lat, p.lng)} target="_blank" rel="noreferrer" className="ml-2 inline-flex items-center gap-1 text-blue-700 underline">
                                <ExternalLink className="h-3 w-3" /> mapa
                              </a>
                            )}
                          </div>
                          {p.notes && <div className="text-xs text-muted-foreground italic">{p.notes}</div>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {p.contact_name}
                          {p.contact_phone && <div className="text-muted-foreground">{p.contact_phone}</div>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">{window ?? "—"}</TableCell>
                        <TableCell>{p.packages_count ?? "—"}</TableCell>
                        <TableCell className="text-xs">
                          {p.orders.length === 0 ? (
                            <span className="text-muted-foreground">—</span>
                          ) : (
                            <span title={p.orders.map((o) => `#${o.order_number} ${o.recipient_name} (${districtName(o.destination_district)})`).join("\n")}>
                              {p.orders.length} pedido{p.orders.length === 1 ? "" : "s"}
                            </span>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex flex-wrap items-center gap-1">
                            {p.pickup_assignments.map((a) => (
                              <span
                                key={a.courier_id}
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs",
                                  a.picked_up_at ? "bg-green-100 text-green-800" : "bg-blue-100 text-blue-800",
                                )}
                              >
                                {a.picked_up_at && <Check className="h-3 w-3" />}
                                {a.profiles?.full_name ?? "—"}
                              </span>
                            ))}
                            {open && (
                              <Button size="sm" variant="ghost" className="h-7 px-2" onClick={() => setAssigning(p)}>
                                <UserPlus className="mr-1 h-3.5 w-3.5" /> {p.pickup_assignments.length ? "Cambiar" : "Asignar"}
                              </Button>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", PICKUP_STATUS_META[p.status].badge)}>
                            {PICKUP_STATUS_META[p.status].label}
                          </span>
                        </TableCell>
                        <TableCell>
                          {open ? (
                            <div className="flex gap-1">
                              <Button size="sm" variant="outline" className="h-7 px-2 text-green-700" onClick={() => void setStatus(p, "picked_up")} title="Marcar recogido">
                                <Check className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-red-700" onClick={() => void setStatus(p, "failed")} title="No se pudo recoger">
                                <XCircle className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="sm" variant="outline" className="h-7 px-2 text-gray-600" onClick={() => globalThis.confirm("¿Anular este recojo?") && void setStatus(p, "cancelled")} title="Anular">
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                              <input
                                type="date"
                                value={p.scheduled_date}
                                onChange={(e) => void moveToDay(p, e.target.value)}
                                className="h-7 w-[118px] rounded-md border px-1 text-xs"
                                title="Mover a otro día (sus pedidos pendientes se mueven también)"
                              />
                            </div>
                          ) : (
                            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => void setStatus(p, p.pickup_assignments.length ? "assigned" : "pending")}>
                              Reabrir
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <AssignDialog pickup={assigning} couriers={couriers} onClose={() => setAssigning(null)} onSaved={load} />
      <NewPickupDialog open={creating} onClose={() => setCreating(false)} onSaved={load} defaultDate={day} createdBy={user?.id ?? null} />
    </div>
  );
}

function Stat({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn("text-2xl font-bold", className)}>{value}</p>
      </CardContent>
    </Card>
  );
}

/** Uno o varios motorizados por recojo. */
function AssignDialog({
  pickup,
  couriers,
  onClose,
  onSaved,
}: {
  pickup: Pickup | null;
  couriers: Profile[];
  onClose: () => void;
  onSaved: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (pickup) setSelected(new Set(pickup.pickup_assignments.map((a) => a.courier_id)));
  }, [pickup]);

  const save = async () => {
    if (!pickup) return;
    setSaving(true);
    try {
      const current = new Set(pickup.pickup_assignments.map((a) => a.courier_id));
      const toAdd = [...selected].filter((id) => !current.has(id));
      const toRemove = pickup.pickup_assignments.filter((a) => !selected.has(a.courier_id) && !a.picked_up_at).map((a) => a.courier_id);
      if (toAdd.length) {
        const { error } = await supabase.from("pickup_assignments").insert(toAdd.map((courier_id) => ({ pickup_id: pickup.id, courier_id })));
        if (error) throw error;
      }
      if (toRemove.length) {
        const { error } = await supabase.from("pickup_assignments").delete().eq("pickup_id", pickup.id).in("courier_id", toRemove);
        if (error) throw error;
      }
      await onSaved();
      onClose();
    } catch (e) {
      alert("No se pudo guardar: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!pickup} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Asignar recojo #{pickup?.pickup_number} · {pickup?.companies?.name}
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">Puedes marcar a más de uno si el recojo se reparte entre varios motorizados.</p>
        <div className="max-h-80 space-y-1 overflow-y-auto">
          {couriers.map((c) => {
            const done = pickup?.pickup_assignments.find((a) => a.courier_id === c.id)?.picked_up_at;
            return (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 rounded-md border p-2 hover:bg-muted/50">
                <Checkbox
                  checked={selected.has(c.id)}
                  disabled={!!done}
                  onCheckedChange={(v) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (v) next.add(c.id);
                      else next.delete(c.id);
                      return next;
                    })
                  }
                />
                <span className="flex-1 text-sm">{c.full_name}</span>
                {c.role !== "courier" && <span className="rounded bg-yellow-100 px-1.5 text-[10px] uppercase text-yellow-800">{c.role}</span>}
                {done && <Check className="h-4 w-4 text-green-600" />}
              </label>
            );
          })}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Alta manual (cuando el cliente llama en vez de usar el formulario). */
function NewPickupDialog({
  open,
  onClose,
  onSaved,
  defaultDate,
  createdBy,
}: {
  open: boolean;
  onClose: () => void;
  onSaved: () => Promise<void>;
  defaultDate: string;
  createdBy: string | null;
}) {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [addressId, setAddressId] = useState("");
  const [form, setForm] = useState({
    address: "",
    district: "",
    contact_name: "",
    contact_phone: "",
    scheduled_date: defaultDate,
    pickup_after: "",
    pickup_before: "",
    packages_count: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm((f) => ({ ...f, scheduled_date: defaultDate }));
    supabase
      .from("companies")
      .select("id, name")
      .order("name")
      .then(({ data }) => setCompanies(data ?? []));
  }, [open, defaultDate]);

  useEffect(() => {
    if (!companyId) {
      setAddresses([]);
      setAddressId("");
      return;
    }
    supabase
      .from("company_addresses")
      .select("*")
      .eq("company_id", companyId)
      .order("is_default", { ascending: false })
      .then(({ data }) => {
        setAddresses(data ?? []);
        setAddressId(data?.[0]?.id ?? "");
      });
  }, [companyId]);

  const saved = addresses.find((a) => a.id === addressId) ?? null;

  const save = async () => {
    const address = saved ? saved.address : form.address.trim();
    if (!companyId || address.length < 5) {
      alert("Elige el comercio e indica la dirección de recojo.");
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.from("pickups").insert({
        company_id: companyId,
        company_address_id: saved?.id ?? null,
        address,
        district: saved?.district ?? (form.district || null),
        lat: saved?.lat ?? null,
        lng: saved?.lng ?? null,
        contact_name: form.contact_name || saved?.contact_name || null,
        contact_phone: form.contact_phone || saved?.contact_phone || null,
        scheduled_date: form.scheduled_date,
        pickup_after: form.pickup_after || null,
        pickup_before: form.pickup_before || null,
        packages_count: form.packages_count ? Number(form.packages_count) : null,
        notes: form.notes || null,
        created_by: createdBy,
      });
      if (error) throw error;
      await onSaved();
      onClose();
      setCompanyId("");
      setForm({ address: "", district: "", contact_name: "", contact_phone: "", scheduled_date: defaultDate, pickup_after: "", pickup_before: "", packages_count: "", notes: "" });
    } catch (e) {
      alert("No se pudo crear: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92dvh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Nuevo recojo</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Comercio</Label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={cn(selectClass, "w-full")}>
              <option value="">Seleccionar…</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          {addresses.length > 0 && (
            <div className="space-y-2">
              <Label>Dirección guardada</Label>
              <select value={addressId} onChange={(e) => setAddressId(e.target.value)} className={cn(selectClass, "w-full")}>
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label ? `${a.label} · ` : ""}
                    {a.address}
                  </option>
                ))}
                <option value="">Otra dirección…</option>
              </select>
            </div>
          )}
          {!saved && (
            <>
              <div className="space-y-2">
                <Label>Dirección</Label>
                <Textarea value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Distrito</Label>
                <DistrictSelect value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} placeholder="Seleccionar…" />
              </div>
            </>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Contacto</Label>
              <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} placeholder={saved?.contact_name ?? ""} />
            </div>
            <div className="space-y-2">
              <Label>Teléfono</Label>
              <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} placeholder={saved?.contact_phone ?? ""} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input type="date" value={form.scheduled_date} onChange={(e) => setForm({ ...form, scheduled_date: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Desde</Label>
              <Input type="time" value={form.pickup_after} onChange={(e) => setForm({ ...form, pickup_after: e.target.value })} />
            </div>
            <div className="space-y-2">
              <Label>Hasta</Label>
              <Input type="time" value={form.pickup_before} onChange={(e) => setForm({ ...form, pickup_before: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Paquetes</Label>
              <Input type="number" min="1" value={form.packages_count} onChange={(e) => setForm({ ...form, packages_count: e.target.value })} />
            </div>
            <div className="col-span-2 space-y-2">
              <Label>Notas</Label>
              <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>
              Cancelar
            </Button>
            <Button onClick={() => void save()} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Crear recojo
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
