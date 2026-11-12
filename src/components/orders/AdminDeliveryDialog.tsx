import { useRef, useState } from "react";
import { Camera, Image as ImageIcon, Loader2 } from "lucide-react";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/database";
import { Button } from "../ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

type Order = Database["public"]["Tables"]["orders"]["Row"];
export type DeliveryResult = { proofUrl: string; status: Order["status"]; amount_collected: number | null; payment_method: string | null };

// Mismas opciones que usa el motorizado al cobrar
const PAYMENT_METHODS = [
  { value: "Motorizado", label: "Motorizado (efectivo)" },
  { value: "Directo a comercio", label: "Directo a comercio" },
  { value: "Relampago Courier", label: "Relampago Courier" },
  { value: "Izipay", label: "Izipay (tarjeta)" },
];

/**
 * La central sube la foto de entrega en nombre del motorizado y, si el pedido aún no estaba
 * entregado, lo completa con lo cobrado. La entrega queda a nombre del motorizado asignado.
 */
export function AdminDeliveryDialog({ order, onClose, onDone }: { order: Order; onClose: () => void; onDone: (r: DeliveryResult) => void }) {
  const completing = order.status !== "delivered";
  const [amount, setAmount] = useState(String(order.amount_collected ?? order.amount_to_collect ?? 0));
  const [method, setMethod] = useState(order.payment_method ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const pick = (f: File | undefined) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("El archivo debe ser una imagen.");
    setError(null);
    setFile(f);
    setPreview(URL.createObjectURL(f));
  };

  const save = async () => {
    if (!file) return setError("Elige la foto de entrega.");
    const collected = Number(amount.replace(",", "."));
    if (completing && (!Number.isFinite(collected) || collected < 0)) return setError("Monto cobrado inválido.");
    setSaving(true);
    setError(null);
    try {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const path = `${order.id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("proofs").upload(path, file);
      if (upErr) throw upErr;
      const { data } = supabase.storage.from("proofs").getPublicUrl(path);
      const { error: delErr } = await supabase.from("deliveries").insert({
        order_id: order.id,
        courier_id: order.assigned_courier,
        proof_image_url: data.publicUrl,
        delivered_at: new Date().toISOString(),
      });
      if (delErr) throw delErr;
      const update = completing
        ? { status: "delivered" as const, amount_collected: collected, payment_method: method || null }
        : {};
      if (completing) {
        const { error: updErr } = await supabase.from("orders").update(update).eq("id", order.id);
        if (updErr) throw updErr;
      }
      onDone({
        proofUrl: data.publicUrl,
        status: completing ? "delivered" : order.status,
        amount_collected: completing ? collected : order.amount_collected,
        payment_method: completing ? method || null : order.payment_method,
      });
    } catch (e) {
      const msg = (e as { message?: string }).message ?? String(e);
      setError(/row-level security|permission/i.test(msg) ? "No tienes permiso para registrar entregas. Pide que se habilite el permiso en la base de datos." : `No se pudo guardar: ${msg}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{completing ? "Completar entrega" : "Subir foto de entrega"} · #{order.order_number}</DialogTitle>
          <DialogDescription>
            {order.recipient_name} · {order.destination_address}
            {completing ? ". El pedido quedará como Entregado." : ". Ya está entregado: solo se agrega la foto."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Foto de entrega</Label>
            {preview ? (
              <img src={preview} alt="Vista previa de la foto de entrega" className="max-h-56 w-full rounded-md border object-contain" />
            ) : (
              <div className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Aún no elegiste una foto.</div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()} disabled={saving}>
                <Camera className="mr-2 h-4 w-4" /> Tomar foto
              </Button>
              <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()} disabled={saving}>
                <ImageIcon className="mr-2 h-4 w-4" /> Galería
              </Button>
            </div>
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
            <input ref={galleryRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pick(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
          {completing && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label htmlFor="admin-collected">Monto cobrado (S/)</Label>
                <Input id="admin-collected" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="admin-method">Método de pago</Label>
                <select id="admin-method" value={method} onChange={(e) => setMethod(e.target.value)} disabled={saving}
                  className="h-10 w-full rounded-md border border-input bg-background px-2 text-sm">
                  <option value="">Sin cobro / no aplica</option>
                  {PAYMENT_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </div>
            </div>
          )}
          {!order.assigned_courier && completing && (
            <p className="text-xs text-muted-foreground">El pedido no tiene motorizado asignado: la entrega quedará registrada por la central.</p>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={() => void save()} disabled={saving || !file}>
            {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Guardando…</> : completing ? "Completar entrega" : "Guardar foto"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
