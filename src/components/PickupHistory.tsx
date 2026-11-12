import { useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { History, RefreshCw } from "lucide-react";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { districtName } from "../lib/orderMeta";

type Receipt = Pick<Database["public"]["Tables"]["pickup_assignments"]["Row"],
  "pickup_id" | "packages_count" | "picked_up_at"> & {
  pickups: (Pick<Database["public"]["Tables"]["pickups"]["Row"],
    "pickup_number" | "address" | "district" | "scheduled_date" | "received_packages"> & {
    companies: { name: string } | null;
  }) | null;
};

const PAGE_SIZE = 10;
const receiptDate = (value: string) => new Intl.DateTimeFormat("es-PE", {
  timeZone: "America/Lima", dateStyle: "short", timeStyle: "short",
}).format(new Date(value));

/** Read-only history. A pickup does not need linked orders to appear here. */
export function PickupHistory({ courierId, refreshToken }: { courierId: string; refreshToken: number }) {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(0);
  const [reload, setReload] = useState(0);
  const [result, setResult] = useState<{ key: string; receipts: Receipt[]; total: number; error: string | null } | null>(null);
  const key = JSON.stringify([courierId, from, to, page, refreshToken, reload]);
  const invalidRange = !!from && !!to && from > to;
  const loading = !invalidRange && result?.key !== key;
  const current = result?.key === key ? result : null;
  const total = current?.total ?? 0;

  useEffect(() => {
    if (invalidRange) return;
    let cancelled = false;
    let query = supabase.from("pickup_assignments")
      .select("pickup_id, packages_count, picked_up_at, pickups!inner(pickup_number, address, district, scheduled_date, received_packages, companies(name))", { count: "exact" })
      .eq("courier_id", courierId)
      .eq("pickups.status", "picked_up")
      .order("picked_up_at", { ascending: false, nullsFirst: false })
      .order("pickup_id", { ascending: false })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (from) query = query.gte("pickups.scheduled_date", from);
    if (to) query = query.lte("pickups.scheduled_date", to);
    query.then(({ data, error, count }) => {
      if (!cancelled) setResult({ key, receipts: (data ?? []) as unknown as Receipt[], total: count ?? 0, error: error?.message ?? null });
    });
    return () => { cancelled = true; };
  }, [courierId, from, to, page, key, invalidRange]);

  return (
    <section id="pickup-history" aria-labelledby="pickup-history-title" className="scroll-mt-20 space-y-3">
      <h2 id="pickup-history-title" className="flex items-center gap-2 text-lg font-semibold">
        <History className="h-5 w-5 text-green-700" /> Historial de recojos
      </h2>
      <p className="text-xs text-gray-600">Los recojos completados se conservan aquí, tengan o no pedidos asociados. Solo ves los asignados a ti.</p>
      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label htmlFor="pickup-history-from">Fecha programada desde</Label>
          <Input id="pickup-history-from" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(0); }} className="h-9 w-auto" />
        </div>
        <div className="space-y-1">
          <Label htmlFor="pickup-history-to">Hasta</Label>
          <Input id="pickup-history-to" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(0); }} className="h-9 w-auto" />
        </div>
        <Button variant="outline" size="sm" onClick={() => { setPage(0); setReload((n) => n + 1); }} disabled={loading}>
          <RefreshCw className="mr-1 h-4 w-4" /> Actualizar historial
        </Button>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); setPage(0); }}>Todas las fechas</Button>}
      </div>
      {invalidRange ? <p role="alert" className="text-sm text-red-700">La fecha desde no puede ser posterior a la fecha hasta.</p>
        : loading ? <p role="status" className="text-sm text-gray-500">Cargando historial…</p>
        : current?.error ? <p role="alert" className="text-sm text-red-700">No se pudo cargar el historial: {current.error}</p>
        : <>
          {current?.receipts.length === 0 && <p className="py-3 text-sm text-gray-500">No tienes recojos completados con estos filtros.</p>}
          {current?.receipts.map((a) => a.pickups && (
            <Card key={a.pickup_id} className="border-green-200">
              <CardContent className="space-y-1 p-4 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold">Recojo #{a.pickups.pickup_number} · {a.pickups.companies?.name ?? "—"}</h3>
                  <span className="rounded-full bg-green-100 px-2 py-1 text-xs text-green-800">Recogido</span>
                </div>
                <p>{a.pickups.address}{a.pickups.district ? ` · ${districtName(a.pickups.district)}` : ""}</p>
                <p className="text-xs text-gray-600">Programado: {format(parseISO(a.pickups.scheduled_date), "dd/MM/yyyy")} · Tu confirmación: {a.picked_up_at ? receiptDate(a.picked_up_at) : "Sin registrar"}</p>
                <p>Tú recibiste: <b>{a.packages_count ?? "Sin registrar"}</b> · Total del recojo: <b>{a.pickups.received_packages || "Sin registrar"}</b> paquetes</p>
              </CardContent>
            </Card>
          ))}
          {total > 0 && <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-600">{page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} de {total} recojos</p>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage((n) => n - 1)}>Anterior</Button>
              <Button variant="outline" size="sm" disabled={(page + 1) * PAGE_SIZE >= total} onClick={() => setPage((n) => n + 1)}>Siguiente</Button>
            </div>
          </div>}
        </>}
    </section>
  );
}
