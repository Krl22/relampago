import { RecordHeader } from "../design/RecordHeader";
import { MetricStrip } from "../design/MetricStrip";
import { RecordLayout } from "../design/RecordLayout";
import {
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  Boxes,
  History,
  Info,
  Loader2,
  PackagePlus,
  RefreshCw,
  Warehouse,
} from "lucide-react";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";
import { number, useMerchantStock } from "./data";
import { StockInventory } from "./StockInventory";
import { RecentStockMovements, StockMovements } from "./StockMovements";

type Tab = "inventory" | "movements";
const tabs = [
  { id: "inventory", label: "Inventario", icon: Boxes },
  { id: "movements", label: "Movimientos", icon: History },
] as const;

function PanelMessage({
  children,
  error = false,
}: {
  children: ReactNode;
  error?: boolean;
}) {
  return (
    <div
      role={error ? "alert" : "status"}
      className={cn(
        "flex items-start justify-center gap-2 px-5 py-12 text-sm",
        error ? "text-red-700" : "text-slate-500",
      )}
    >
      {error ? (
        <AlertCircle className="h-5 w-5 shrink-0" />
      ) : (
        <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
      )}
      <span>{children}</span>
    </div>
  );
}

/** Object-page layout: page header, workspace tabs and related activity panel. */
export function MerchantStockWorkspace({
  companyId,
  comparisonAction,
  heading = "Mi stock",
  showNewOrder = true,
  nestedInRecord = false,
}: {
  companyId: string;
  comparisonAction?: ReactNode;
  heading?: string;
  showNewOrder?: boolean;
  nestedInRecord?: boolean;
}) {
  const {
    items,
    moves,
    loading,
    stockError,
    movementError,
    updatedAt,
    refresh,
  } = useMerchantStock(companyId);
  const [tab, setTab] = useState<Tab>("inventory");
  const id = useId();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const workspaceRef = useRef<HTMLDivElement>(null);
  const totals = items.reduce(
    (total, item) => ({
      quantity: total.quantity + item.quantity,
      reserved: total.reserved + item.reserved,
      available: total.available + item.available,
    }),
    { quantity: 0, reserved: 0, available: 0 },
  );
  const emptyCount = items.filter((item) => item.available <= 0).length;
  const lowCount = items.filter(
    (item) => item.available > 0 && item.available <= 5,
  ).length;
  const keyboardTab = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next: number;
    if (event.key === "ArrowRight" || event.key === "ArrowLeft")
      next = 1 - index;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = 1;
    else return;
    event.preventDefault();
    setTab(tabs[next].id);
    tabRefs.current[next]?.focus();
  };
  const showMovements = () => {
    setTab("movements");
    tabRefs.current[1]?.focus();
    workspaceRef.current?.scrollIntoView({ block: "start" });
  };
  const metrics = [
    {
      label: "Productos",
      value: items.length,
      detail: "Registrados",
      color: "text-slate-900",
    },
    {
      label: "En almacén",
      value: totals.quantity,
      detail: "Unidades físicas",
      color: "text-slate-900",
    },
    {
      label: "Comprometido",
      value: totals.reserved,
      detail: "En pedidos pendientes",
      color: "text-amber-800",
    },
    {
      label: "Disponible",
      value: totals.available,
      detail: "Unidades para pedir",
      color: "text-emerald-700",
    },
  ];

  return (
    <div className="min-w-0 space-y-4 text-slate-800">
      <RecordHeader
        title={heading}
        subtitle="Almacén de Relámpago"
        icon={Warehouse}
        utility={comparisonAction}
        actions={
          <>
            <Button
              variant="outline"
              className="h-11 flex-1 border-slate-300 bg-white sm:flex-none"
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw
                aria-hidden="true"
                className={cn("mr-2 h-4 w-4", loading && "animate-spin")}
              />
              {loading ? "Actualizando…" : "Actualizar"}
            </Button>
            {showNewOrder && (
              <Button
                asChild
                className="h-11 flex-1 sm:flex-none"
              >
                <Link to="/nuevo-pedido">
                  <PackagePlus aria-hidden="true" className="mr-2 h-4 w-4" />
                  Nuevo pedido
                </Link>
              </Button>
            )}
          </>
        }
      >
        <MetricStrip
          items={metrics.map((metric) => ({
            label: metric.label,
            value: loading || stockError ? "—" : number.format(metric.value),
            description: metric.detail,
            valueClassName: metric.color,
          }))}
        />
      </RecordHeader>

      <RecordLayout
        compact
        hideAsideOnSmall
        asideLabel="Actividad y ayuda de stock"
        aside={
          <>
            <section className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-200 p-4">
                <History
                  className="h-4 w-4 text-primary"
                  aria-hidden="true"
                />
                <h2 className="text-sm font-semibold">Actividad reciente</h2>
              </div>
              {loading ? (
                <PanelMessage>Cargando…</PanelMessage>
              ) : movementError ? (
                <p role="alert" className="p-4 text-xs text-red-700">
                  {movementError}
                </p>
              ) : moves.length ? (
                <RecentStockMovements moves={moves} />
              ) : (
                <p className="p-4 text-sm text-slate-500">
                  Aún no hay movimientos registrados.
                </p>
              )}
              <div className="border-t border-slate-200 p-2">
                <Button
                  variant="ghost"
                  className="min-h-11 w-full text-primary"
                  onClick={showMovements}
                >
                  Ver movimientos
                </Button>
              </div>
            </section>
            <section className="rounded-lg border border-slate-300 bg-white p-4 text-xs leading-relaxed text-slate-500">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-800">
                <Info className="h-4 w-4 text-primary" aria-hidden="true" />
                Cómo se calcula
              </h2>
              <p>
                El stock comprometido está reservado en pedidos pendientes. Se
                descuenta del almacén cuando se confirma la entrega.
              </p>
              <p className="mt-2">Disponible = en almacén − comprometido.</p>
              {!loading && !stockError && (emptyCount > 0 || lowCount > 0) && (
                <p className="mt-3 border-t border-slate-100 pt-3 text-amber-800">
                  {emptyCount} producto(s) sin disponible y {lowCount} con 5
                  unidades o menos.
                </p>
              )}
            </section>
          </>
        }
      >
        <section
          ref={workspaceRef}
          aria-label="Consulta de inventario y movimientos"
          className="min-w-0 scroll-mt-4 overflow-clip rounded-lg border border-slate-300 bg-white shadow-sm"
        >
          <div
            role="tablist"
            aria-label="Contenido de mi stock"
            className={cn(
              "sticky z-10 flex border-b border-slate-300 bg-white px-2 sm:px-3",
              nestedInRecord ? "top-12" : "top-0",
            )}
          >
            {tabs.map((option, index) => (
              <button
                key={option.id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                id={`${id}-tab-${option.id}`}
                role="tab"
                aria-selected={tab === option.id}
                aria-controls={`${id}-panel-${option.id}`}
                tabIndex={tab === option.id ? 0 : -1}
                onClick={() => setTab(option.id)}
                onKeyDown={(event) => keyboardTab(event, index)}
                className={cn(
                  "flex min-h-12 min-w-0 flex-1 items-center justify-center gap-2 border-b-[3px] px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 sm:flex-none sm:px-5",
                  tab === option.id
                    ? "border-primary text-primary"
                    : "border-transparent text-slate-500 hover:bg-slate-50 hover:text-slate-800",
                )}
              >
                <option.icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                {option.label}
              </button>
            ))}
          </div>
          <div
            id={`${id}-panel-inventory`}
            role="tabpanel"
            tabIndex={0}
            aria-labelledby={`${id}-tab-inventory`}
            hidden={tab !== "inventory"}
            className="focus-visible:outline-blue-600"
          >
            {loading ? (
              <PanelMessage>Cargando inventario…</PanelMessage>
            ) : stockError ? (
              <PanelMessage error>{stockError}</PanelMessage>
            ) : (
              <StockInventory items={items} />
            )}
          </div>
          <div
            id={`${id}-panel-movements`}
            role="tabpanel"
            tabIndex={0}
            aria-labelledby={`${id}-tab-movements`}
            hidden={tab !== "movements"}
            className="focus-visible:outline-blue-600"
          >
            {loading ? (
              <PanelMessage>Cargando movimientos…</PanelMessage>
            ) : movementError ? (
              <PanelMessage error>{movementError}</PanelMessage>
            ) : (
              <StockMovements moves={moves} />
            )}
          </div>
        </section>
      </RecordLayout>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-1">
        <p className="text-xs text-slate-500">
          {updatedAt
            ? `Consultado a las ${new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(updatedAt))} · hora de Lima`
            : "Consulta de inventario"}
        </p>
      </div>
      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500 xl:hidden">
        <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          Comprometido: unidades reservadas en pedidos pendientes. Se descuentan
          del almacén al entregar. Disponible = en almacén − comprometido.
        </span>
      </p>
    </div>
  );
}
