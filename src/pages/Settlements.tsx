import { useEffect, useMemo, useState } from "react";
import { addDays, format, parseISO, startOfWeek, subDays } from "date-fns";
import { es } from "date-fns/locale";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { useAuth } from "../components/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Checkbox } from "../components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { BUSINESS } from "../lib/business";
import { STATUS_META, districtName } from "../lib/orderMeta";
import { chargesService, collectedOf, computeSettlement, heldByRelampago, money, type SettlementOrder } from "../lib/settlement";
import { SettlementReport } from "../components/SettlementReport";
import { Check, Copy, FileCheck2, Loader2, Printer } from "lucide-react";
import { cn } from "@/lib/utils";

type Company = Pick<Database["public"]["Tables"]["companies"]["Row"], "id" | "name" | "yape_number" | "yape_holder" | "email">;
type Settlement = Database["public"]["Tables"]["settlements"]["Row"];

const ORDER_COLUMNS =
  "id, order_number, recipient_name, destination_district, product_details, packages_count, amount_to_collect, amount_collected, status, payment_method, total_amount, surcharge, delivery_notes, comments, created_at, settlement_id";

const selectClass =
  "flex h-9 w-full items-center rounded-md border border-input bg-background px-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring";

export default function Settlements() {
  const { user } = useAuth();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [companyFilter, setCompanyFilter] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [from, setFrom] = useState(() => format(subDays(new Date(), 6), "yyyy-MM-dd"));
  const [to, setTo] = useState(() => format(new Date(), "yyyy-MM-dd"));
  const [onlyUnsettled, setOnlyUnsettled] = useState(true);
  const [orders, setOrders] = useState<SettlementOrder[]>([]);
  const [history, setHistory] = useState<Settlement[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    supabase
      .from("companies")
      .select("id, name, yape_number, yape_holder, email")
      .order("name")
      .then(({ data }) => setCompanies(data ?? []));
  }, []);

  const company = companies.find((c) => c.id === companyId) ?? null;
  const filteredCompanies = useMemo(() => {
    const q = companyFilter.trim().toLowerCase();
    return q ? companies.filter((c) => c.name.toLowerCase().includes(q)) : companies;
  }, [companies, companyFilter]);

  useEffect(() => {
    if (!companyId) {
      setOrders([]);
      setHistory([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const fromIso = new Date(`${from}T00:00:00-05:00`).toISOString();
    const toIso = addDays(new Date(`${to}T00:00:00-05:00`), 1).toISOString();
    let q = supabase
      .from("orders")
      .select(ORDER_COLUMNS)
      .eq("company_id", companyId)
      .gte("created_at", fromIso)
      .lt("created_at", toIso)
      .order("created_at", { ascending: true })
      .limit(2000);
    if (onlyUnsettled) q = q.is("settlement_id", null);
    Promise.all([q, supabase.from("settlements").select("*").eq("company_id", companyId).order("created_at", { ascending: false }).limit(20)]).then(([o, h]) => {
      if (cancelled) return;
      if (o.error) console.error(o.error);
      setOrders((o.data ?? []) as SettlementOrder[]);
      setHistory(h.data ?? []);
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [companyId, from, to, onlyUnsettled, reloadToken]);

  const totals = useMemo(() => computeSettlement(orders), [orders]);
  const lastSettlement = history[0] ?? null;

  const preset = (kind: "today" | "week" | "7d" | "sinceLast") => {
    const today = new Date();
    if (kind === "today") {
      setFrom(format(today, "yyyy-MM-dd"));
      setTo(format(today, "yyyy-MM-dd"));
    } else if (kind === "week") {
      setFrom(format(startOfWeek(today, { weekStartsOn: 1 }), "yyyy-MM-dd"));
      setTo(format(today, "yyyy-MM-dd"));
    } else if (kind === "7d") {
      setFrom(format(subDays(today, 6), "yyyy-MM-dd"));
      setTo(format(today, "yyyy-MM-dd"));
    } else if (lastSettlement) {
      setFrom(format(addDays(parseISO(lastSettlement.period_to), 1), "yyyy-MM-dd"));
      setTo(format(today, "yyyy-MM-dd"));
    }
  };

  const summaryText = () => {
    const sign = totals.balance >= 0 ? `${BUSINESS.name} le abona` : "Saldo a favor de Relámpago";
    const lines = [
      `*${BUSINESS.name}* · Liquidación ${company?.name ?? ""}`,
      `Período: ${format(parseISO(from), "d MMM", { locale: es })} – ${format(parseISO(to), "d MMM yyyy", { locale: es })}`,
      `Recaudado: ${money(totals.collected)}`,
      `Servicio: ${money(totals.service)}`,
      `*Saldo: ${money(Math.abs(totals.balance))}* (${sign})`,
      "",
      ...orders
        .filter((o) => chargesService(o) || heldByRelampago(o))
        .map(
          (o) =>
            `#${o.order_number} ${o.recipient_name ?? ""} · ${districtName(o.destination_district)} · ${STATUS_META[o.status].label} · ${o.payment_method ?? "—"} · cobro ${money(collectedOf(o))} · servicio ${money(Number(o.total_amount ?? 0))}`,
        ),
    ];
    return lines.join("\n");
  };

  const copySummary = async () => {
    try {
      await navigator.clipboard.writeText(summaryText());
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copia el resumen:", summaryText());
    }
  };

  const registerSettlement = async () => {
    if (!company) return;
    const included = orders.filter((o) => chargesService(o) || heldByRelampago(o));
    if (included.length === 0) {
      alert("No hay pedidos entregados en este período.");
      return;
    }
    if (
      !window.confirm(
        `Registrar liquidación de ${company.name}: ${included.length} pedidos, saldo ${money(totals.balance)}. Los pedidos quedarán marcados como liquidados.`,
      )
    )
      return;
    setSaving(true);
    try {
      const { data: s, error } = await supabase
        .from("settlements")
        .insert({
          company_id: company.id,
          period_from: from,
          period_to: to,
          collected: totals.collected,
          service: totals.service,
          balance: totals.balance,
          orders_count: included.length,
          created_by: user?.id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      const { error: e2 } = await supabase
        .from("orders")
        .update({ settlement_id: s.id })
        .in(
          "id",
          included.map((o) => o.id),
        );
      if (e2) throw e2;
      setReloadToken((t) => t + 1);
    } catch (e) {
      alert("No se pudo registrar: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const markPaid = async (s: Settlement) => {
    const ref = window.prompt("Referencia del pago (nro. de operación Yape, etc.):", s.paid_reference ?? "");
    if (ref === null) return;
    const { error } = await supabase
      .from("settlements")
      .update({
        paid_at: new Date().toISOString(),
        paid_reference: ref || null,
      })
      .eq("id", s.id);
    if (error) alert(error.message);
    else setReloadToken((t) => t + 1);
  };

  return (
    <div className="space-y-6">
      {/* Controles (no se imprimen) */}
      <div className="space-y-4 print:hidden">
        <h1 className="text-3xl font-bold">Liquidaciones</h1>
        <Card>
          <CardContent className="grid gap-4 p-4 md:grid-cols-4">
            <div className="space-y-2 md:col-span-2">
              <Label>Comercio</Label>
              <div className="flex gap-2">
                <Input placeholder="Buscar…" value={companyFilter} onChange={(e) => setCompanyFilter(e.target.value)} className="h-9 w-32" />
                <select value={companyId} onChange={(e) => setCompanyId(e.target.value)} className={selectClass}>
                  <option value="">Seleccionar comercio…</option>
                  {filteredCompanies.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Desde</Label>
              <Input type="date" value={from} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-9" />
            </div>
            <div className="space-y-2">
              <Label>Hasta</Label>
              <Input type="date" value={to} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-9" />
            </div>
            <div className="flex flex-wrap items-center gap-2 md:col-span-4">
              <Button size="sm" variant="outline" onClick={() => preset("today")}>
                Hoy
              </Button>
              <Button size="sm" variant="outline" onClick={() => preset("week")}>
                Esta semana
              </Button>
              <Button size="sm" variant="outline" onClick={() => preset("7d")}>
                Últimos 7 días
              </Button>
              <Button size="sm" variant="outline" onClick={() => preset("sinceLast")} disabled={!lastSettlement}>
                Desde la última liquidación
              </Button>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={onlyUnsettled} onCheckedChange={(v) => setOnlyUnsettled(!!v)} /> Solo pedidos sin liquidar
              </label>
            </div>
          </CardContent>
        </Card>

        {company && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => window.print()} disabled={orders.length === 0}>
              <Printer className="mr-2 h-4 w-4" /> Imprimir / PDF
            </Button>
            <Button variant="outline" onClick={() => void copySummary()} disabled={orders.length === 0}>
              {copied ? <Check className="mr-2 h-4 w-4 text-green-600" /> : <Copy className="mr-2 h-4 w-4" />}
              {copied ? "Copiado" : "Copiar resumen (WhatsApp)"}
            </Button>
            <Button
              onClick={() => void registerSettlement()}
              disabled={saving || totals.counted === 0 || !onlyUnsettled}
              title={!onlyUnsettled ? "Activa 'Solo pedidos sin liquidar' para registrar" : undefined}
            >
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FileCheck2 className="mr-2 h-4 w-4" />}
              Registrar liquidación
            </Button>
          </div>
        )}
      </div>

      {!company ? (
        <div className="py-10 text-center text-sm text-muted-foreground print:hidden">Elige un comercio para ver su liquidación.</div>
      ) : (
        <>
          {/* Reporte */}
          <SettlementReport company={company} from={from} to={to} orders={orders} totals={totals} loading={loading} />

          {/* Historial */}
          {history.length > 0 && (
            <Card className="print:hidden">
              <CardHeader>
                <CardTitle className="text-base">Liquidaciones anteriores de {company.name}</CardTitle>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>#</TableHead>
                      <TableHead>Período</TableHead>
                      <TableHead className="text-right">Recaudado</TableHead>
                      <TableHead className="text-right">Servicio</TableHead>
                      <TableHead className="text-right">Saldo</TableHead>
                      <TableHead>Pedidos</TableHead>
                      <TableHead>Pago</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {history.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-mono text-xs">{s.settlement_number}</TableCell>
                        <TableCell className="text-xs">
                          {format(parseISO(s.period_from), "d MMM", {
                            locale: es,
                          })}{" "}
                          –{" "}
                          {format(parseISO(s.period_to), "d MMM yyyy", {
                            locale: es,
                          })}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{money(Number(s.collected))}</TableCell>
                        <TableCell className="text-right tabular-nums">{money(Number(s.service))}</TableCell>
                        <TableCell className={cn("text-right font-semibold tabular-nums", Number(s.balance) >= 0 ? "text-green-700" : "text-red-700")}>
                          {money(Number(s.balance))}
                        </TableCell>
                        <TableCell>{s.orders_count}</TableCell>
                        <TableCell>
                          {s.paid_at ? (
                            <span className="text-xs text-green-700">
                              Pagado {format(parseISO(s.paid_at), "d/MM HH:mm")}
                              {s.paid_reference && ` · ${s.paid_reference}`}
                            </span>
                          ) : (
                            <Button size="sm" variant="outline" className="h-7" onClick={() => void markPaid(s)}>
                              Marcar pagado
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
