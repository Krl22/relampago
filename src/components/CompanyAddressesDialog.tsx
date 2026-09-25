import { useEffect, useRef, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Checkbox } from "./ui/checkbox";
import { LocationPicker } from "./LocationPicker";
import { MapPickerDialog } from "./MapPickerDialog";
import { DistrictSelect } from "./DistrictSelect";
import { googleMapsUrl } from "../lib/mapIcons";
import { geocodeApprox, type ReverseInfo } from "../lib/nominatim";
import { matchDistrict, useDistricts } from "../lib/districts";
import type { LatLng } from "../lib/geo";
import { CheckCircle2, Edit, ExternalLink, Loader2, MapPin, Plus, Star, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Address = Database["public"]["Tables"]["company_addresses"]["Row"];

/** Diálogo del admin: el editor de direcciones de un comercio. */
export function CompanyAddressesDialog({
  company,
  open,
  onOpenChange,
}: {
  company: { id: string; name: string } | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Direcciones de {company?.name}</DialogTitle>
        </DialogHeader>
        {company && <CompanyAddressesEditor companyId={company.id} active={open} />}
      </DialogContent>
    </Dialog>
  );
}

/**
 * Direcciones de recojo de un comercio: lista + alta/edición con el punto exacto en el mapa.
 * La dirección "principal" es la que se preselecciona en el formulario de pedidos.
 * Lo usan el admin (diálogo en Comercios) y, solo para ver, el comercio (Mi comercio): las
 * direcciones de recojo las registra Relámpago.
 */
export function CompanyAddressesEditor({ companyId, active = true, readOnly = false }: { companyId: string; active?: boolean; readOnly?: boolean }) {
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Address | "new" | null>(null);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = () => setReloadKey((k) => k + 1);

  // El diálogo del admin monta el editor al abrirse; el portal lo monta con la página.
  // Las recargas (tras guardar o borrar) mantienen la lista a la vista mientras llegan los datos.
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    supabase
      .from("company_addresses")
      .select("*")
      .eq("company_id", companyId)
      .order("is_default", { ascending: false })
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Error cargando direcciones:", error);
        setAddresses(data ?? []);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [active, companyId, reloadKey]);

  const remove = async (a: Address) => {
    if (!globalThis.confirm("¿Eliminar esta dirección?")) return;
    const { error } = await supabase.from("company_addresses").delete().eq("id", a.id);
    if (error) {
      alert("No se pudo eliminar: " + error.message);
      return;
    }
    reload();
  };

  if (editing && !readOnly) {
    return (
      <AddressForm
        key={editing === "new" ? "new" : editing.id}
        companyId={companyId}
        address={editing === "new" ? null : editing}
        isFirst={addresses.length === 0}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          reload();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      {loading ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : addresses.length === 0 ? (
        <div className="py-6 text-center text-sm text-muted-foreground">Este comercio aún no tiene direcciones de recojo.</div>
      ) : (
        addresses.map((a) => (
          <div key={a.id} className={cn("flex items-start gap-3 rounded-lg border p-3", a.is_default && "border-primary/40 bg-primary/5")}>
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex items-center gap-2 font-medium">
                {a.is_default && <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-500" />}
                {a.label || "Dirección"}
                {a.district && <span className="text-xs font-normal text-muted-foreground">· {a.district}</span>}
              </div>
              <div className="text-muted-foreground">{a.address}</div>
              {(a.contact_name || a.contact_phone) && (
                <div className="text-xs text-muted-foreground">
                  {a.contact_name} {a.contact_phone && `· ${a.contact_phone}`}
                </div>
              )}
              {a.notes && <div className="text-xs text-muted-foreground">{a.notes}</div>}
              {a.lat != null && a.lng != null ? (
                <a href={googleMapsUrl(a.lat, a.lng)} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700 underline">
                  <MapPin className="h-3 w-3" /> punto en el mapa <ExternalLink className="h-3 w-3" />
                </a>
              ) : readOnly ? null : (
                <button type="button" onClick={() => setEditing(a)} className="mt-1 inline-flex items-center gap-1 text-xs text-amber-700 underline">
                  <MapPin className="h-3 w-3" /> Sin punto en el mapa: márcalo
                </button>
              )}
            </div>
            {!readOnly && (
              <div className="flex shrink-0 gap-1">
                <Button size="icon" variant="ghost" onClick={() => setEditing(a)} title="Editar">
                  <Edit className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="text-red-600" onClick={() => void remove(a)} title="Eliminar">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </div>
        ))
      )}
      {!readOnly && (
        <Button variant="outline" className="w-full" onClick={() => setEditing("new")}>
          <Plus className="mr-2 h-4 w-4" /> Agregar dirección
        </Button>
      )}
    </div>
  );
}

/**
 * Alta / edición de una dirección. Primero el mapa (como en Uber): al fijar el punto se
 * completan solas la calle y el distrito si están vacíos; si se escribe primero la dirección,
 * el mapa se centra en ella para ajustar el pin.
 */
function AddressForm({
  companyId,
  address,
  isFirst,
  onCancel,
  onSaved,
}: {
  companyId: string;
  address: Address | null;
  isFirst: boolean;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const districts = useDistricts();
  const [form, setForm] = useState({
    label: address?.label ?? "",
    address: address?.address ?? "",
    district: address?.district ?? "",
    contact_name: address?.contact_name ?? "",
    contact_phone: address?.contact_phone ?? "",
    notes: address?.notes ?? "",
    is_default: address?.is_default ?? isFirst,
  });
  const [coords, setCoords] = useState<LatLng | null>(address?.lat != null && address?.lng != null ? { lat: address.lat, lng: address.lng } : null);
  const [suggested, setSuggested] = useState<LatLng | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const districtsRef = useRef(districts);
  useEffect(() => {
    districtsRef.current = districts;
  });

  // Dirección escrita y sin punto todavía: centrar el mapa en su ubicación aproximada
  useEffect(() => {
    if (coords || !form.district || form.address.trim().length < 6) return;
    const ctrl = new AbortController();
    const t = window.setTimeout(async () => {
      const p = await geocodeApprox(form.address, form.district, ctrl.signal).catch(() => null);
      if (p && !ctrl.signal.aborted) setSuggested(p);
    }, 1200);
    return () => {
      window.clearTimeout(t);
      ctrl.abort();
    };
  }, [form.address, form.district, coords]);

  // Al fijar el punto: completar calle y distrito si todavía están vacíos
  const onReverse = (info: ReverseInfo) => {
    setForm((f) => {
      const next = { ...f };
      if (!f.address.trim() && info.street) next.address = info.houseNumber ? `${info.street} ${info.houseNumber}` : info.street;
      if (!f.district) {
        const match = info.places.map((p) => matchDistrict(p, districtsRef.current)).find((d) => d && d.kind === "district");
        if (match) next.district = match.name;
      }
      return next;
    });
  };

  const save = async () => {
    if (form.address.trim().length < 5) {
      setError("Escribe la dirección (calle, número y referencias).");
      return;
    }
    if (!form.district) {
      setError("Elige el distrito.");
      return;
    }
    if (!coords && !globalThis.confirm("Aún no marcaste el punto en el mapa. El motorizado lo necesita para llegar sin llamar.\n\n¿Guardar la dirección sin punto?"))
      return;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        company_id: companyId,
        label: form.label.trim() || null,
        address: form.address.trim(),
        district: form.district,
        contact_name: form.contact_name.trim() || null,
        contact_phone: form.contact_phone.trim() || null,
        notes: form.notes.trim() || null,
        is_default: form.is_default,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
      };
      if (form.is_default) {
        // Solo una principal por comercio
        await supabase.from("company_addresses").update({ is_default: false }).eq("company_id", companyId);
      }
      const res = address ? await supabase.from("company_addresses").update(payload).eq("id", address.id) : await supabase.from("company_addresses").insert(payload);
      if (res.error) throw res.error;
      onSaved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const hint = "Mueve el mapa hasta dejar el pin en la puerta del local";

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Nombre de la dirección</Label>
        <Input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Tienda, Almacén, Casa…" />
      </div>

      <div className="space-y-2">
        <Label className="flex items-center gap-2">
          <MapPin className="h-4 w-4 text-primary" /> Punto exacto de recojo
          {coords && (
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[11px] font-medium text-green-800">
              <CheckCircle2 className="h-3 w-3" /> marcado
            </span>
          )}
        </Label>
        <LocationPicker
          value={coords}
          onChange={setCoords}
          hint={hint}
          emptyText="Busca tu local o usa tu ubicación; luego mueve el mapa hasta la puerta."
          suggestedCenter={suggested}
          onReverse={onReverse}
          onExpand={() => setFullscreen(true)}
          heightClass="h-64"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-2 sm:col-span-2">
          <Label>Dirección (calle, número y referencias)</Label>
          <Textarea
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
            placeholder="Av. Nicolás Arriola 985, oficina 3, portón negro"
            rows={2}
          />
        </div>
        <div className="space-y-2">
          <Label>Distrito</Label>
          <DistrictSelect value={form.district} onChange={(e) => setForm({ ...form, district: e.target.value })} />
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label>Contacto</Label>
          <Input value={form.contact_name} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} />
        </div>
        <div className="space-y-2">
          <Label>Teléfono del contacto</Label>
          <Input value={form.contact_phone} onChange={(e) => setForm({ ...form, contact_phone: e.target.value })} inputMode="tel" />
        </div>
      </div>
      <div className="space-y-2">
        <Label>Notas (horario de atención, cómo llegar)</Label>
        <Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="Abre 10am, tocar timbre 2" />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <Checkbox checked={form.is_default} onCheckedChange={(v) => setForm({ ...form, is_default: !!v })} />
        Dirección principal (se preselecciona al hacer un pedido)
      </label>

      {error && <div className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{error}</div>}

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancelar
        </Button>
        <Button onClick={() => void save()} disabled={saving}>
          {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar
        </Button>
      </div>

      <MapPickerDialog
        open={fullscreen}
        onOpenChange={setFullscreen}
        value={coords}
        onConfirm={setCoords}
        title="Ubica la puerta del local"
        hint={hint}
        suggestedCenter={suggested}
        onReverse={onReverse}
      />
    </div>
  );
}
