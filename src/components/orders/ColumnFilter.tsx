import { useEffect, useMemo, useRef, useState } from "react";
import { Filter, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Option } from "./EditableCell";

/** Valor de un filtro de columna según su tipo. */
export type FilterValue = string | string[] | { from?: string; to?: string };

export type ColumnFilterKind =
  | { kind: "text" }
  | { kind: "values"; options: Option[] }
  | { kind: "date" };

export const isFilterActive = (v: FilterValue | undefined): boolean => {
  if (v == null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return !!(v.from || v.to);
};

/**
 * Filtro de columna estilo hoja de cálculo: embudo en la cabecera que abre un panel con
 *  - texto: "contiene…"
 *  - valores: lista con casillas (varias a la vez) y buscador
 *  - fecha: desde / hasta
 */
export function ColumnFilter({
  def,
  value,
  onChange,
  label,
}: {
  def: ColumnFilterKind;
  value: FilterValue | undefined;
  onChange: (v: FilterValue | undefined) => void;
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const active = isFilterActive(value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ left: Math.max(8, Math.min(r.left, window.innerWidth - 280)), top: r.bottom + 4 });
    }
    setOpen((o) => !o);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          toggle();
        }}
        className={cn("ml-1 rounded p-0.5 hover:bg-muted", active ? "text-primary" : "text-muted-foreground/60")}
        title={active ? "Filtro activo" : "Filtrar"}
      >
        <Filter className={cn("h-3.5 w-3.5", active && "fill-primary/20")} />
      </button>
      {open && pos && (
        <div
          ref={panelRef}
          className="fixed z-50 w-64 rounded-md border bg-popover p-2 text-sm text-popover-foreground shadow-lg"
          style={{ left: pos.left, top: pos.top }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">{label}</span>
            {active && (
              <button type="button" className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline" onClick={() => onChange(undefined)}>
                <X className="h-3 w-3" /> Quitar
              </button>
            )}
          </div>
          {def.kind === "text" && (
            <input
              autoFocus
              value={typeof value === "string" ? value : ""}
              onChange={(e) => onChange(e.target.value || undefined)}
              onKeyDown={(e) => e.key === "Enter" && setOpen(false)}
              placeholder="Contiene…"
              className="h-8 w-full rounded border bg-background px-2 text-xs"
            />
          )}
          {def.kind === "date" && (
            <DateRange value={typeof value === "object" && !Array.isArray(value) ? value : {}} onChange={onChange} />
          )}
          {def.kind === "values" && <ValueList options={def.options} value={Array.isArray(value) ? value : []} onChange={onChange} />}
        </div>
      )}
    </>
  );
}

function DateRange({ value, onChange }: { value: { from?: string; to?: string }; onChange: (v: FilterValue | undefined) => void }) {
  const set = (patch: { from?: string; to?: string }) => {
    const next = { ...value, ...patch };
    onChange(next.from || next.to ? next : undefined);
  };
  return (
    <div className="space-y-2">
      <label className="block text-xs">
        Desde
        <input type="date" value={value.from ?? ""} onChange={(e) => set({ from: e.target.value })} className="mt-0.5 h-8 w-full rounded border bg-background px-2 text-xs" />
      </label>
      <label className="block text-xs">
        Hasta
        <input type="date" value={value.to ?? ""} onChange={(e) => set({ to: e.target.value })} className="mt-0.5 h-8 w-full rounded border bg-background px-2 text-xs" />
      </label>
    </div>
  );
}

function ValueList({ options, value, onChange }: { options: Option[]; value: string[]; onChange: (v: FilterValue | undefined) => void }) {
  const [q, setQ] = useState("");
  const visible = useMemo(() => {
    const s = q.trim().toLowerCase();
    return s ? options.filter((o) => o.label.toLowerCase().includes(s)) : options;
  }, [options, q]);
  const selected = new Set(value);
  const setAll = (on: boolean) => {
    const next = new Set(selected);
    for (const o of visible) {
      if (on) next.add(o.value);
      else next.delete(o.value);
    }
    onChange(next.size ? [...next] : undefined);
  };
  const toggleOne = (v: string) => {
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    onChange(next.size ? [...next] : undefined);
  };
  return (
    <div className="space-y-1">
      {options.length > 8 && (
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="mb-1 h-8 w-full rounded border bg-background px-2 text-xs" />
      )}
      <div className="flex gap-3 px-1 text-[11px]">
        <button type="button" className="text-primary hover:underline" onClick={() => setAll(true)}>
          Seleccionar {q ? "visibles" : "todo"}
        </button>
        <button type="button" className="text-muted-foreground hover:underline" onClick={() => setAll(false)}>
          Ninguno
        </button>
      </div>
      <div className="max-h-56 overflow-y-auto">
        {visible.length === 0 && <div className="px-1 py-2 text-xs text-muted-foreground">Sin coincidencias</div>}
        {visible.map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 hover:bg-muted">
            <input type="checkbox" checked={selected.has(o.value)} onChange={() => toggleOne(o.value)} className="h-3.5 w-3.5 accent-primary" />
            <span className="truncate text-xs">{o.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
