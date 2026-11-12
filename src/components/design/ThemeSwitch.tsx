import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "../../lib/utils";
import { useDesign } from "./DesignContext";
import type { ThemeChoice } from "./preference";

const OPTIONS: { value: ThemeChoice; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Oscuro", icon: Moon },
  { value: "system", label: "Según tu equipo", icon: Monitor },
];

/**
 * Tema de la vista Lightning. Se recuerda en este navegador.
 * En pantallas anchas: los tres modos a la vista. En celular: un solo botón que los rota.
 */
export function ThemeSwitch({ className }: { className?: string }) {
  const { mode, theme, setTheme } = useDesign();
  if (mode !== "lightning") return null;
  const index = OPTIONS.findIndex((o) => o.value === theme);
  const current = OPTIONS[index] ?? OPTIONS[2];
  const next = OPTIONS[(index + 1) % OPTIONS.length];
  const CurrentIcon = current.icon;
  return (
    <>
      <div role="radiogroup" aria-label="Tema de colores" className={cn("theme-switch hidden sm:inline-flex", className)}>
        {OPTIONS.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={theme === value}
            aria-label={label}
            title={label}
            onClick={() => setTheme(value)}
            className="theme-switch-option"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setTheme(next.value)}
        aria-label={`Tema: ${current.label}. Cambiar a ${next.label.toLowerCase()}`}
        title={`Tema: ${current.label}`}
        className={cn("theme-switch-single sm:hidden", className)}
      >
        <CurrentIcon className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
    </>
  );
}
