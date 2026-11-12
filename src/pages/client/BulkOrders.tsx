import { Fragment, memo, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import type { Database } from "../../types/database";
import { useMyCompany } from "../../hooks/useMyCompany";
import { useDistricts, type District } from "../../lib/districts";
import { BULK_COLUMNS, MAX_BULK_ROWS, checkRow, downloadTemplate, matrixToRows, parseDelimited, parseXlsx, rowPayload, type BulkKey, type BulkRow, type RowCheck } from "../../lib/bulkOrders";
import { scheduleFor, scheduleLabel } from "../../lib/cutoff";
import { stockMatcher, type PickedItem, type StockOption } from "../../lib/stockMatch";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Label } from "../../components/ui/label";
import { Textarea } from "../../components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../components/ui/dialog";
import { AlertCircle, ArrowLeft, CheckCircle2, Download, FileSpreadsheet, Loader2, PackageOpen, Trash2, Upload, Warehouse } from "lucide-react";
import { cn } from "@/lib/utils";

type Address = Pick<Database["public"]["Tables"]["company_addresses"]["Row"], "id" | "label" | "address" | "district">;
type Created = { order_number: number };
/** Productos del stock de una fila: reconocidos del detalle (auto) o elegidos a mano. */
type RowStock = { items: PickedItem[]; auto: boolean; error: string | null };

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
  const [stock, setStock] = useState<StockOption[]>([]);

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

  // Stock del comercio en el almacén (disponible = en almacén - comprometido en pedidos sin entregar)
  useEffect(() => {
    if (!company) return;
    let alive = true;
    supabase
      .from("stock_availability")
      .select("id, product_name, available")
      .eq("company_id", company.id)
      .order("product_name")
      .then(({ data }) => {
        if (!alive) return;
        setStock(
          (data ?? []).flatMap((s) => (s.id && s.product_name ? [{ id: s.id, product_name: s.product_name, available: Number(s.available ?? 0) }] : [])),
        );
      });
    return () => {
      alive = false;
    };
  }, [company]);

  const stockMode = origin === "warehouse" && stock.length > 0;
  const matcher = useMemo(() => stockMatcher(stock), [stock]);
  const checks = useMemo(() => new Map(rows.map((r) => [r.id, checkRow(r, catalog)])), [rows, catalog]);
  // Productos del stock por fila; lo pedido en toda la carga no puede pasar lo disponible
  const rowStock = useMemo(() => {
    const out = new Map<number, RowStock>();
    if (!stockMode) return out;
    const byId = new Map(stock.map((s) => [s.id, s]));
    const used = new Map<string, number>();
    for (const r of rows) {
      const auto = r.items === undefined;
      const match = auto ? matcher(r.values.product_details) : null;
      const items = r.items ?? match?.items ?? [];
      let error: string | null = null;
      if (items.length === 0 && match) {
        error = match.ambiguous.length ? "¿Cuál de tus productos? Elígelo" : "No lo encontré en tu stock: elígelo o marca que no es de tu stock";
      }
      for (const it of items) {
        const s = byId.get(it.stock_id);
        const total = (used.get(it.stock_id) ?? 0) + it.quantity;
        used.set(it.stock_id, total);
        if (!error && it.quantity < 1) error = "Cantidad inválida";
        if (!error && s && total > s.available) error = `Stock insuficiente de ${s.product_name}: disponible ${Math.max(s.available, 0)} para toda la carga`;
      }
      out.set(r.id, { items, auto, error });
    }
    return out;
  }, [rows, stock, stockMode, matcher]);
  const withErrors = rows.filter((r) => Object.keys(checks.get(r.id)?.errors ?? {}).length > 0 || !!rowStock.get(r.id)?.error).length;
  const stockUnits = [...rowStock.values()].reduce((sum, r) => sum + r.items.reduce((a, it) => a + it.quantity, 0), 0);
  const rowsWithoutStock = stockMode ? rows.filter((r) => (rowStock.get(r.id)?.items.length ?? 0) === 0).length : 0;
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
  const setRowItems = (id: number, items: PickedItem[]) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, items } : r)));

  const send = async () => {
    if (!company) return;
    setSending(true);
    setSendError(null);
    const items = rows.map((r) =>
      rowPayload(r, checks.get(r.id)!, { type: origin, addressId: origin === "pickup" ? addressId : null }, stockMode ? (rowStock.get(r.id)?.items ?? []) : []),
    );
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
      <div data-page="bulk-orders" className="mx-auto max-w-xl space-y-4 py-10 text-center">
        <CheckCircle2 className="mx-auto h-14 w-14 text-green-600" />
        <div data-page-header="true"><h1 className="text-2xl font-bold">¡{created.length} pedidos registrados!</h1></div>
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
    <div data-page="bulk-orders" className="space-y-6">
      <div data-page-header="true" className="flex items-center gap-3">
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
                await downloadTemplate(catalog, stock.map((s) => s.product_name)).catch((e) => alert("No se pudo generar la plantilla: " + (e as Error).message));
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
            <div role="region" aria-label="Pedidos de la carga masiva, desplázate para ver todas las columnas" tabIndex={0} className="max-h-[60vh] overflow-auto">
              <table className={cn("w-full text-xs", stockMode ? "min-w-[1480px]" : "min-w-[1200px]")}>
                <thead className="sticky top-0 z-10 bg-muted">
                  <tr>
                    <th className="px-2 py-2 text-left font-medium">#</th>
                    {BULK_COLUMNS.map((c) => (
                      <Fragment key={c.key}>
                        <th className="px-2 py-2 text-left font-medium">
                          {c.header}
                          {c.required && " *"}
                        </th>
                        {stockMode && c.key === "product_details" && <th className="px-2 py-2 text-left font-medium">De tu stock (se descuenta al entregar)</th>}
                      </Fragment>
                    ))}
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <BulkRowView
                      key={r.id}
                      n={i + 1}
                      row={r}
                      check={checks.get(r.id)!}
                      catalog={catalog}
                      stock={stockMode ? stock : null}
                      rowStock={rowStock.get(r.id) ?? null}
                      onChange={updateCell}
                      onItems={setRowItems}
                      onRemove={removeRow}
                    />
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
            {stockMode && (
              <div>
                De tu stock: <b>{stockUnits} unidades</b> (se descuentan al entregarse)
                {rowsWithoutStock > 0 && (
                  <div className="text-xs text-muted-foreground">
                    {rowsWithoutStock} pedido{rowsWithoutStock === 1 ? "" : "s"} sin productos de tu stock.
                  </div>
                )}
              </div>
            )}
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
  stock,
  rowStock,
  onChange,
  onItems,
  onRemove,
}: {
  n: number;
  row: BulkRow;
  check: RowCheck;
  catalog: District[];
  stock: StockOption[] | null;
  rowStock: RowStock | null;
  onChange: (id: number, key: BulkKey, value: string) => void;
  onItems: (id: number, items: PickedItem[]) => void;
  onRemove: (id: number) => void;
}) {
  const bad = Object.keys(check.errors).length > 0 || !!rowStock?.error;
  return (
    <tr className={cn("border-t align-top", bad && "bg-red-50/60")}>
      <td className="px-2 py-1.5 text-muted-foreground" title={`Fila ${row.line} del archivo`}>
        {n}
      </td>
      {BULK_COLUMNS.map((c) => {
        const err = check.errors[c.key];
        return (
          <Fragment key={c.key}>
          <td className="px-1 py-1">
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
          {stock && rowStock && c.key === "product_details" && (
            <td className="px-1 py-1">
              <StockCell stock={stock} value={rowStock} onChange={(items) => onItems(row.id, items)} />
            </td>
          )}
          </Fragment>
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

/** Productos del stock de una fila: lo reconocido del detalle se corrige aquí mismo. */
function StockCell({ stock, value, onChange }: { stock: StockOption[]; value: RowStock; onChange: (items: PickedItem[]) => void }) {
  const byId = new Map(stock.map((s) => [s.id, s]));
  const { items, auto, error } = value;
  const add = (id: string) => {
    if (id === "__none__") return onChange([]);
    if (!id || items.some((it) => it.stock_id === id)) return;
    onChange([...items, { stock_id: id, quantity: 1 }]);
  };
  return (
    <div className="w-[260px] space-y-1">
      {items.map((it) => {
        const name = byId.get(it.stock_id)?.product_name ?? "Producto";
        return (
          <div key={it.stock_id} className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              value={it.quantity}
              onChange={(e) => onChange(items.map((x) => (x.stock_id === it.stock_id ? { ...x, quantity: Math.floor(Number(e.target.value) || 0) } : x)))}
              className={cn(cellInput, "w-12 min-w-0 shrink-0")}
              aria-label={`Cantidad de ${name}`}
            />
            <span className="min-w-0 flex-1 truncate" title={name}>
              {name}
            </span>
            <button type="button" className="shrink-0 px-1 text-base leading-none text-red-600 hover:text-red-800" title="Quitar producto" onClick={() => onChange(items.filter((x) => x.stock_id !== it.stock_id))}>
              ×
            </button>
          </div>
        );
      })}
      {items.length === 0 && !auto && <div className="text-[11px] text-muted-foreground">No es de tu stock (no se descuenta)</div>}
      <select value="" onChange={(e) => add(e.target.value)} className={cn(cellInput, error && items.length === 0 && "border-destructive")} aria-label="Agregar producto de tu stock">
        <option value="">{items.length ? "+ Agregar producto…" : "Elegir producto…"}</option>
        {items.length === 0 && auto && <option value="__none__">— No es de mi stock —</option>}
        {stock.map((s) => (
          <option key={s.id} value={s.id} disabled={items.some((it) => it.stock_id === s.id)}>
            {s.product_name} — disp. {Math.max(s.available, 0)}
          </option>
        ))}
      </select>
      {error && <div className="text-[10px] leading-tight text-destructive">{error}</div>}
    </div>
  );
}
