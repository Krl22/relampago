import { memo, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/database";
import { useMyCompany } from "../../hooks/useMyCompany";
import { useDistricts, type District } from "../../lib/districts";
import { BULK_COLUMNS, MAX_BULK_ROWS, checkRow, downloadTemplate, matrixToRows, parseDelimited, parseXlsx, rowPayload, type BulkKey, type BulkRow, type RowCheck } from "../../lib/bulkOrders";
import { scheduleFor, scheduleLabel } from "../../lib/cutoff";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AlertCircle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, PackageOpen, Trash2, Upload, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";

type Address = Pick<Database["public"]["Tables"]["company_addresses"]["Row"], "id" | "label" | "address" | "district">;
type Created = { order_number: number };

const cellInput = "h-8 w-full min-w-[80px] rounded border bg-white px-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/40";

/** Carga masiva: el comercio sube un Excel / CSV (o pega filas), revisa y registra todos juntos. */
export default function BulkOrders() {
  const { company } = useMyCompany();
  const catalog = useDistricts();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [origin, setOrigin] = useState<"warehouse" | "pickup">("warehouse");
  const [addressId, setAddressId] = useState<string>("");
  const [rows, setRows] = useState<BulkRow[]>([]);
  const [paste, setPaste] = useState("");
  const [reading, setReading] = useState(false);
  const [readError, setReadError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [created, setCreated] = useState<Created[] | null>(null);

  useEffect(() => {
    if (!company) return;
    supabase
      .from("company_addresses")
      .select("id, label, address, district")
      .eq("company_id", company.id)
      .order("is_default", { ascending: false })
      .then(({ data }) => {
        setAddresses(data ?? []);
        if (data?.[0]) setAddressId(data[0].id);
      });
  }, [company]);

  const checks = useMemo(() => new Map(rows.map((r) => [r.id, checkRow(r, catalog)])), [rows, catalog]);
  const withErrors = rows.filter((r) => Object.keys(checks.get(r.id)?.errors ?? {}).length > 0).length;
  const totalAmount = rows.reduce((s, r) => s + (checks.get(r.id)?.amount || 0), 0);
  const schedule = scheduleFor(origin, !!company?.skip_cutoff);

  const load = (matrix: string[][]) => {
    const parsed = matrixToRows(matrix);
    if (parsed.length === 0) {
      setReadError("No encontré pedidos en el archivo. Usa la plantilla o pega las filas con sus encabezados.");
      return;
    }
    if (parsed.length > MAX_BULK_ROWS) {
      setReadError(`El archivo tiene ${parsed.length} pedidos; el máximo por carga es ${MAX_BULK_ROWS}. Divídelo en partes.`);
      return;
    }
    setReadError(null);
    setSendError(null);
    setCreated(null);
    setRows(parsed);
  };

  const onFile = async (file: File) => {
    setReading(true);
    setReadError(null);
    try {
      const isXlsx = /\.xlsx$/i.test(file.name);
      load(isXlsx ? await parseXlsx(await file.arrayBuffer()) : parseDelimited(await file.text()));
    } catch (e) {
      console.error(e);
      setReadError("No pude leer ese archivo. Usa la plantilla (.xlsx) o un .csv.");
    } finally {
      setReading(false);
    }
  };

  const updateCell = (id: number, key: BulkKey, value: string) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, values: { ...r.values, [key]: value } } : r)));
  const removeRow = (id: number) => setRows((prev) => prev.filter((r) => r.id !== id));

  const send = async () => {
    if (!company) return;
    setSending(true);
    setSendError(null);
    const items = rows.map((r) => rowPayload(r, checks.get(r.id)!, { type: origin, addressId: origin === "pickup" ? addressId : null }));
    const { data, error } = await supabase.rpc("submit_orders_bulk", { p_items: items });
    setSending(false);
    setConfirming(false);
    if (error) {
      setSendError(error.message);
      return;
    }
    setCreated(((data ?? []) as unknown as Created[]).map((d) => ({ order_number: Number(d.order_number) })));
    setRows([]);
    setPaste("");
  };

  if (created) {
    const nums = created.map((c) => c.order_number).sort((a, b) => a - b);
    return (
      <div className="mx-auto max-w-xl space-y-4 py-10 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" />
        <h1 className="text-2xl font-bold">¡{created.length} pedidos registrados!</h1>
        <p className="text-muted-foreground">
          Números #{nums[0]}
          {nums.length > 1 && ` al #${nums[nums.length - 1]}`}. Se atienden <b>{scheduleLabel(schedule.date)}</b>.
        </p>
        <div className="flex justify-center gap-2">
          <Button asChild>
            <Link to="/mis-pedidos">Ver mis pedidos</Link>
          </Button>
          <Button variant="outline" onClick={() => setCreated(null)}>
            Cargar otro archivo
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/mis-pedidos" title="Volver a mis pedidos">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">Carga masiva</h1>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">1. Descarga la plantilla</CardTitle>
            <CardDescription>Un pedido por fila. El distrito se elige de una lista.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button
              variant="outline"
              disabled={downloading || catalog.length === 0}
              onClick={async () => {
                setDownloading(true);
                await downloadTemplate(catalog).catch((e) => alert("No se pudo generar la plantilla: " + (e as Error).message));
                setDownloading(false);
              }}
            >
              {downloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Plantilla Excel
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">2. ¿De dónde salen los paquetes?</CardTitle>
            <CardDescription>Aplica a todos los pedidos de esta carga.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <OriginButton active={origin === "warehouse"} onClick={() => setOrigin("warehouse")} icon={<Warehouse className="h-4 w-4" />} label="Almacén" />
              <OriginButton
                active={origin === "pickup"}
                onClick={() => setOrigin("pickup")}
                icon={<PackageOpen className="h-4 w-4" />}
                label="Recojo"
                disabled={addresses.length === 0}
              />
            </div>
            {origin === "pickup" && addresses.length > 1 && (
              <select value={addressId} onChange={(e) => setAddressId(e.target.value)} className="h-9 w-full rounded-md border bg-background px-2 text-sm">
                {addresses.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label ? `${a.label} · ` : ""}
                    {a.address}
                  </option>
                ))}
              </select>
            )}
            {origin === "pickup" && addresses.length === 1 && <p className="text-xs text-muted-foreground">Recogemos en {addresses[0].address}</p>}
            {addresses.length === 0 && <p className="text-xs text-muted-foreground">Sin dirección de recojo registrada: pídela a Relámpago.</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">3. Sube el archivo</CardTitle>
            <CardDescription>Excel (.xlsx) o CSV. También puedes pegar filas abajo.</CardDescription>
          </CardHeader>
          <CardContent>
            <label className={cn("inline-flex cursor-pointer items-center rounded-md border bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90", reading && "opacity-60")}>
              {reading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
              Elegir archivo
              <input
                type="file"
                accept=".xlsx,.csv,.txt"
                className="hidden"
                disabled={reading}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onFile(f);
                }}
              />
            </label>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <Label className="text-sm">…o pega aquí las filas copiadas de tu Excel / Google Sheets (con la fila de títulos)</Label>
          <Textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={3} placeholder={BULK_COLUMNS.slice(0, 5).map((c) => c.header).join("\t")} className="font-mono text-xs" />
          <Button size="sm" variant="outline" disabled={!paste.trim()} onClick={() => load(parseDelimited(paste))}>
            <FileSpreadsheet className="mr-2 h-4 w-4" /> Leer filas pegadas
          </Button>
        </CardContent>
      </Card>

      {readError && (
        <div className="flex items-start gap-2 rounded-md bg-destructive/15 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {readError}
        </div>
      )}

      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 pb-3">
            <div>
              <CardTitle className="text-base">
                {rows.length} pedido{rows.length === 1 ? "" : "s"} leído{rows.length === 1 ? "" : "s"}
              </CardTitle>
              <CardDescription>
                {withErrors > 0 ? (
                  <span className="text-destructive">{withErrors} con datos por corregir: arréglalos aquí mismo o quítalos.</span>
                ) : (
                  "Todo listo para enviar."
                )}
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setRows([])}>
                Descartar
              </Button>
              <Button disabled={withErrors > 0 || (origin === "pickup" && !addressId)} onClick={() => setConfirming(true)}>
                Revisar y enviar ({rows.length})
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {sendError && <div className="mx-4 mb-3 rounded-md bg-destructive/15 p-3 text-sm text-destructive">No se registró ningún pedido. {sendError}</div>}
            <div className="max-h-[60vh] overflow-auto">
              <table className="w-full min-w-[1200px] text-xs">
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">#</th>
                    {BULK_COLUMNS.map((c) => (
                      <th key={c.key} className="px-2 py-2 text-left font-medium">
                        {c.header}
                        {c.required && " *"}
                      </th>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <BulkRowView key={r.id} n={i + 1} row={r} check={checks.get(r.id)!} catalog={catalog} onChange={updateCell} onRemove={removeRow} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={confirming} onOpenChange={(o) => !sending && setConfirming(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Enviar {rows.length} pedidos?</DialogTitle>
            <DialogDescription>Se registran todos juntos: si alguno tiene un problema no se registra ninguno y te decimos cuál.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1 rounded-md border p-3 text-sm">
            <div>
              Pedidos: <b>{rows.length}</b>
            </div>
            <div>
              Salen de:{" "}
              <b>{origin === "warehouse" ? "Almacén de Relámpago" : `Recojo en ${addresses.find((a) => a.id === addressId)?.address ?? ""}`}</b>
            </div>
            <div>
              Se atienden: <b>{scheduleLabel(schedule.date)}</b>
            </div>
            <div>
              Total a cobrar a destinatarios: <b>S/ {totalAmount.toFixed(2)}</b>
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={sending}>
              Corregir
            </Button>
            <Button onClick={() => void send()} disabled={sending}>
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
    </div>
  );
}

function OriginButton({ active, onClick, icon, label, disabled = false }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex items-center justify-center gap-2 rounded-md border px-3 py-2 text-sm",
        active ? "border-primary bg-primary/5 font-medium ring-2 ring-primary/30" : "hover:bg-muted",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      {icon} {label}
    </button>
  );
}

/** Una fila editable: cada celda se corrige en su sitio; el distrito se elige de la lista. */
const BulkRowView = memo(function BulkRowView({
  n,
  row,
  check,
  catalog,
  onChange,
  onRemove,
}: {
  n: number;
  row: BulkRow;
  check: RowCheck;
  catalog: District[];
  onChange: (id: number, key: BulkKey, value: string) => void;
  onRemove: (id: number) => void;
}) {
  const bad = Object.keys(check.errors).length > 0;
  return (
    <tr className={cn("border-t align-top", bad && "bg-red-50/60")}>
      <td className="px-2 py-1.5 text-muted-foreground" title={`Fila ${row.line} del archivo`}>
        {n}
      </td>
      {BULK_COLUMNS.map((c) => {
        const err = check.errors[c.key];
        return (
          <td key={c.key} className="px-1 py-1">
            {c.key === "district" ? (
              <select
                value={check.district?.name ?? ""}
                onChange={(e) => onChange(row.id, "district", e.target.value)}
                className={cn(cellInput, err && "border-destructive")}
              >
                <option value="">{row.values.district ? `¿${row.values.district}?` : "Elegir…"}</option>
                {catalog.map((d) => (
                  <option key={d.name} value={d.name}>
                    {d.name}
                  </option>
                ))}
              </select>
            ) : (
              <input value={row.values[c.key]} onChange={(e) => onChange(row.id, c.key, e.target.value)} className={cn(cellInput, err && "border-destructive")} />
            )}
            {err && <div className="mt-0.5 text-[10px] leading-tight text-destructive">{err}</div>}
          </td>
        );
      })}
      <td className="px-1 py-1">
        <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600" title="Quitar fila" onClick={() => onRemove(row.id)}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </td>
    </tr>
  );
});
