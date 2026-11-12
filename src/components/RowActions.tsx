import { createContext, useContext, type ReactElement } from "react";
import * as ContextMenu from "@radix-ui/react-context-menu";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { MoreHorizontal, type LucideIcon } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

export type RowAction = { label: string; icon: LucideIcon; onSelect: () => void; disabled?: boolean; destructive?: boolean };
const RowActionsContext = createContext<{ label: string; actions: RowAction[] } | null>(null);
const menuClass = "z-[70] min-w-52 max-w-[calc(100vw-1rem)] max-h-[var(--radix-popper-available-height)] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg";
const itemClass = "flex cursor-default select-none items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-40";
const dangerClass = "text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive";

/** Both entry points share the available actions and their permission checks. */
export function RowActions({ label, actions, children }: { label: string; actions: RowAction[]; children: ReactElement }) {
  return <RowActionsContext.Provider value={{ label, actions }}>
    <ContextMenu.Root>
      <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content className={menuClass} collisionPadding={8} aria-label={`Opciones de ${label}`}>
          <ContextMenu.Label className="max-w-72 truncate px-3 py-2 text-xs font-medium text-muted-foreground">{label}</ContextMenu.Label>
          {actions.map(({ icon: Icon, ...action }) => <ContextMenu.Item key={action.label} disabled={action.disabled}
            className={cn(itemClass, action.destructive && dangerClass)} onSelect={() => { window.setTimeout(action.onSelect, 0); }}>
            <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />{action.label}
          </ContextMenu.Item>)}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  </RowActionsContext.Provider>;
}

export function RowActionsButton() {
  const context = useContext(RowActionsContext);
  if (!context) throw new Error("RowActionsButton requiere RowActions");
  return <DropdownMenu.Root>
    <DropdownMenu.Trigger asChild>
      <Button type="button" variant="ghost" size="icon" className="mr-1 h-8 w-8 shrink-0"
        aria-label={`Opciones de ${context.label}`} title="Opciones (también con clic derecho)" onClick={(event) => event.stopPropagation()}>
        <MoreHorizontal className="h-4 w-4" />
      </Button>
    </DropdownMenu.Trigger>
    <DropdownMenu.Portal>
      <DropdownMenu.Content className={menuClass} sideOffset={4} collisionPadding={8} align="start">
        <DropdownMenu.Label className="max-w-72 truncate px-3 py-2 text-xs font-medium text-muted-foreground">{context.label}</DropdownMenu.Label>
        {context.actions.map(({ icon: Icon, ...action }) => <DropdownMenu.Item key={action.label} disabled={action.disabled}
          className={cn(itemClass, action.destructive && dangerClass)} onSelect={() => { window.setTimeout(action.onSelect, 0); }}>
          <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />{action.label}
        </DropdownMenu.Item>)}
      </DropdownMenu.Content>
    </DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export function TableActionsHint() {
  return <p className="text-sm text-muted-foreground"><span className="table-hint-desktop">Haz clic derecho en una fila o abre sus tres puntos para ver las opciones.</span><span className="table-hint-mobile hidden">Toca los tres puntos de una fila para ver sus opciones.</span></p>;
}
