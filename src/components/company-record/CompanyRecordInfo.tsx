import { useEffect, useState } from "react";
import { ExternalLink, Loader2, MapPin } from "lucide-react";
import { supabase } from "../../lib/supabase";
import { callAdminUsers } from "../../lib/adminUsers";
import type { Database } from "../../types/database";
import { recordDate, type CompanyRecord } from "../../lib/companyRecord";
import { STATUS_META, districtName } from "../../lib/orderMeta";
import { money } from "../../lib/settlement";
import { RecordField } from "./CompanyRelatedList";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";

export function CompanyRecordDetails({ company }: { company: CompanyRecord }) {
  return (
    <div className="grid items-start gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Datos del comercio</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <RecordField label="Nombre">{company.name}</RecordField>
            <RecordField label="RUC">{company.ruc}</RecordField>
            <RecordField label="Contacto">{company.contact_name}</RecordField>
            <RecordField label="Teléfono">{company.phone}</RecordField>
            <RecordField label="Correo">{company.email}</RecordField>
            <RecordField label="Distrito">
              {districtName(company.district)}
            </RecordField>
            <RecordField label="Dirección principal">
              {company.address}
            </RecordField>
            <RecordField label="Registrado">
              {recordDate(company.created_at)}
            </RecordField>
          </dl>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Condiciones y pagos</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-4 sm:grid-cols-2">
            <RecordField label="Tarifa T1 pactada">
              {company.t1_rate !== null
                ? money(Number(company.t1_rate))
                : "Tarifa general"}
            </RecordField>
            <RecordField label="IGV en facturación">
              {company.invoice_igv ? "Sí" : "No"}
            </RecordField>
            <RecordField label="Número Yape">{company.yape_number}</RecordField>
            <RecordField label="Titular Yape">
              {company.yape_holder}
            </RecordField>
            <RecordField label="Prioridad">
              {company.skip_cutoff
                ? "Automática por inventario registrado"
                : "Atención regular"}
            </RecordField>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}

type Address = Database["public"]["Tables"]["company_addresses"]["Row"];
type Access = {
  id: string;
  full_name: string | null;
  email: string;
  created_at: string | null;
  company_id: string | null;
  access_status: "active" | "pending_email" | "pending_password" | "unverified";
};
type Activity = {
  id: number;
  created_at: string;
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  order: { order_number: number; company_id: string | null };
  actor: { full_name: string | null } | null;
};
const accessLabels = {
  active: "Activo",
  pending_email: "Pendiente de verificar correo",
  pending_password: "Falta completar activación",
  unverified: "Correo no verificado",
};

function InformationState({
  loading,
  error,
  empty,
}: {
  loading: boolean;
  error: string | null;
  empty: boolean;
}) {
  if (loading)
    return (
      <p
        role="status"
        className="flex items-center gap-2 p-5 text-sm text-muted-foreground"
      >
        <Loader2 className="h-4 w-4 animate-spin" />
        Cargando…
      </p>
    );
  if (error)
    return (
      <p
        role="alert"
        className="rounded border border-red-200 bg-red-50 p-4 text-sm text-red-700"
      >
        {error}
      </p>
    );
  if (empty)
    return (
      <p className="rounded-md border bg-white p-5 text-sm text-muted-foreground">
        Todavía no hay registros en esta sección.
      </p>
    );
  return null;
}

export function CompanyRecordAddresses({
  companyId,
  refresh,
}: {
  companyId: string;
  refresh: number;
}) {
  const [result, setResult] = useState<{
    key: string;
    rows: Address[];
    error: string | null;
  } | null>(null);
  const key = `${companyId}:${refresh}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    let alive = true;
    Promise.resolve(
      supabase
        .from("company_addresses")
        .select("*")
        .eq("company_id", companyId)
        .order("is_default", { ascending: false })
        .order("created_at"),
    )
      .then(({ data, error }) => {
        if (alive)
          setResult({ key, rows: data ?? [], error: error?.message ?? null });
      })
      .catch((error: unknown) => {
        if (alive)
          setResult({
            key,
            rows: [],
            error:
              error instanceof Error
                ? error.message
                : "No se pudieron cargar las direcciones.",
          });
      });
    return () => {
      alive = false;
    };
  }, [companyId, refresh, key]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Direcciones de recojo</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Se utilizan cuando el motorizado recoge en el local del comercio.
        </p>
      </div>
      <InformationState
        loading={!current}
        error={current?.error ?? null}
        empty={current?.rows.length === 0}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        {current?.rows.map((address) => (
          <Card key={address.id}>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                <MapPin className="h-4 w-4 text-primary" />
                {address.label || "Dirección de recojo"}
                {address.is_default && (
                  <span className="rounded bg-blue-50 px-2 py-1 text-xs text-primary">
                    Principal
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="break-words text-sm">
                {address.address} · {districtName(address.district)}
              </p>
              <p className="break-words text-xs text-muted-foreground">
                {address.contact_name} {address.contact_phone}
              </p>
              {address.notes && (
                <p className="break-words text-xs text-muted-foreground">
                  {address.notes}
                </p>
              )}
              <a
                className="inline-flex min-h-11 items-center gap-1 text-xs font-medium text-primary underline"
                href={
                  address.lat !== null && address.lng !== null
                    ? `https://www.google.com/maps/search/?api=1&query=${address.lat},${address.lng}`
                    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${address.address}, ${address.district ?? ""}, Lima`)}`
                }
                target="_blank"
                rel="noreferrer"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                Abrir mapa
              </a>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function CompanyRecordAccesses({
  companyId,
  refresh,
}: {
  companyId: string;
  refresh: number;
}) {
  const [result, setResult] = useState<{
    key: string;
    rows: Access[];
    error: string | null;
  } | null>(null);
  const key = `${companyId}:${refresh}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    let alive = true;
    callAdminUsers<{ users: Access[] }>({
      action: "list",
      company_id: companyId,
    })
      .then(({ users }) => {
        if (alive) setResult({ key, rows: users, error: null });
      })
      .catch((error) => {
        if (alive)
          setResult({
            key,
            rows: [],
            error:
              error instanceof Error
                ? error.message
                : "No se pudieron cargar los accesos.",
          });
      });
    return () => {
      alive = false;
    };
  }, [companyId, refresh, key]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Cuentas del portal</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          No necesitas entrar como estas personas para consultar la operación
          del comercio.
        </p>
      </div>
      <InformationState
        loading={!current}
        error={current?.error ?? null}
        empty={current?.rows.length === 0}
      />
      <ul className="space-y-3">
        {current?.rows.map((account) => (
          <li
            key={account.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-white p-4"
          >
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">
                {account.full_name || account.email}
              </p>
              <p className="break-all text-xs text-muted-foreground">
                {account.email}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Creada: {recordDate(account.created_at)}
              </p>
            </div>
            <span className="rounded bg-slate-100 px-2 py-1 text-xs">
              {accessLabels[account.access_status]}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const eventLabels: Record<string, string> = {
  created: "Pedido creado",
  status_change: "Cambio de estado",
  assigned: "Cambio de motorizado",
};
const statusLabel = (value: string | null) =>
  value && value in STATUS_META
    ? STATUS_META[value as keyof typeof STATUS_META].label
    : value;
export function CompanyRecordActivity({
  companyId,
  refresh,
}: {
  companyId: string;
  refresh: number;
}) {
  const [result, setResult] = useState<{
    key: string;
    rows: Activity[];
    error: string | null;
  } | null>(null);
  const key = `${companyId}:${refresh}`;
  const current = result?.key === key ? result : null;
  useEffect(() => {
    let alive = true;
    Promise.resolve(
      supabase
        .from("order_events")
        .select(
          "id,created_at,event_type,from_status,to_status,order:orders!inner(order_number,company_id),actor:profiles!order_events_actor_id_fkey(full_name)",
        )
        .eq("order.company_id", companyId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(50),
    )
      .then(({ data, error }) => {
        if (alive)
          setResult({
            key,
            rows: (data ?? []) as unknown as Activity[],
            error: error?.message ?? null,
          });
      })
      .catch((error: unknown) => {
        if (alive)
          setResult({
            key,
            rows: [],
            error:
              error instanceof Error
                ? error.message
                : "No se pudo cargar la actividad.",
          });
      });
    return () => {
      alive = false;
    };
  }, [companyId, refresh, key]);
  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-semibold">Actividad de pedidos</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Últimos 50 eventos registrados. Este historial no incluye cambios del
          perfil del comercio.
        </p>
      </div>
      <InformationState
        loading={!current}
        error={current?.error ?? null}
        empty={current?.rows.length === 0}
      />
      <ol className="divide-y rounded-lg border bg-white">
        {current?.rows.map((event) => (
          <li key={event.id} className="space-y-1 p-4">
            <div className="flex flex-wrap justify-between gap-2 text-sm">
              <p className="font-medium">
                {eventLabels[event.event_type] ?? event.event_type} · pedido #
                {event.order.order_number}
              </p>
              <time
                dateTime={event.created_at}
                className="text-xs text-muted-foreground"
              >
                {new Intl.DateTimeFormat("es-PE", {
                  timeZone: "America/Lima",
                  dateStyle: "short",
                  timeStyle: "short",
                }).format(new Date(event.created_at))}
              </time>
            </div>
            <p className="text-xs text-muted-foreground">
              {event.actor?.full_name || "Sistema / usuario no disponible"}
              {event.to_status
                ? ` · ${event.from_status ? `${statusLabel(event.from_status)} → ` : ""}${statusLabel(event.to_status)}`
                : ""}
            </p>
          </li>
        ))}
      </ol>
    </div>
  );
}
