import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

export type EditorType = "text" | "number" | "select" | "time" | "date" | "checkbox";
export type CellValue = string | number | boolean | null;
export type Option = { value: string; label: string };

interface EditableCellProps {
  value: CellValue;
  type: EditorType;
  options?: Option[];
  /** Cómo se ve la celda cuando no se está editando. */
  display: React.ReactNode;
  editing: boolean;
  onStartEdit: () => void;
  onCancel: () => void;
  /** Guarda y cierra. `move` indica si el usuario pulsó Tab (para saltar a la siguiente celda). */
  onSave: (value: CellValue, move?: "next" | "prev") => void;
  className?: string;
  step?: string;
}

/**
 * Celda editable tipo hoja de cálculo: un clic la abre; Enter/Tab/blur guardan, Esc cancela.
 * Selects y checkboxes guardan al cambiar.
 */
export function EditableCell({ value, type, options, display, editing, onStartEdit, onCancel, onSave, className, step }: EditableCellProps) {
  if (type === "checkbox") {
    return (
      <td className={cn("px-2 py-1 text-center align-middle", className)}>
        <input type="checkbox" checked={!!value} onChange={(e) => onSave(e.target.checked)} className="h-4 w-4 cursor-pointer accent-primary" />
      </td>
    );
  }

  if (!editing) {
    return (
      <td className={cn("cursor-text px-2 py-1 align-middle hover:bg-amber-50", className)} onClick={onStartEdit} title="Clic para editar">
        {display}
      </td>
    );
  }

  return (
    <td className={cn("bg-amber-50 px-1 py-0.5 align-middle", className)}>
      <CellEditor value={value} type={type} options={options} step={step} onCancel={onCancel} onSave={onSave} />
    </td>
  );
}

const inputClass = "h-8 w-full min-w-[90px] rounded border border-primary bg-white px-1 text-xs shadow-sm focus:outline-none focus:ring-2 focus:ring-primary/40";

/** Se monta solo mientras la celda está en edición, así el borrador arranca del valor actual. */
function CellEditor({
  value,
  type,
  options,
  step,
  onCancel,
  onSave,
}: Pick<EditableCellProps, "value" | "type" | "options" | "step" | "onCancel" | "onSave">) {
  const [draft, setDraft] = useState(value == null ? "" : String(value));
  const committedRef = useRef(false);

  const commit = (v: string, move?: "next" | "prev") => {
    if (committedRef.current) return;
    committedRef.current = true;
    if (type === "number") onSave(v.trim() === "" ? null : Number(v), move);
    else onSave(v === "" ? null : v, move);
  };
  const cancel = () => {
    if (committedRef.current) return;
    committedRef.current = true;
    onCancel();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit(draft);
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    } else if (e.key === "Tab") {
      e.preventDefault();
      commit(draft, e.shiftKey ? "prev" : "next");
    }
  };

  if (type === "select") {
    return (
      <select
        autoFocus
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          commit(e.target.value);
        }}
        onBlur={cancel}
        onKeyDown={(e) => {
          if (e.key === "Escape") cancel();
          else if (e.key === "Tab") {
            e.preventDefault();
            commit(draft, e.shiftKey ? "prev" : "next");
          }
        }}
        className={inputClass}
      >
        {options?.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    );
  }

  return (
    <input
      autoFocus
      ref={(el) => el?.select()}
      type={type === "number" ? "number" : type === "time" ? "time" : type === "date" ? "date" : "text"}
      step={step}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={onKeyDown}
      onBlur={() => commit(draft)}
      className={inputClass}
    />
  );
}
