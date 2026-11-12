import { DesignSwitch } from "./DesignSwitch";
import { ThemeSwitch } from "./ThemeSwitch";

/** Public and fullscreen routes have the same comparison control as the main workspace. */
export function AppearanceBar() {
  return (
    <div className="appearance-bar flex items-center justify-end gap-2 border-b bg-white px-3 py-2 print:hidden">
      <ThemeSwitch />
      <DesignSwitch />
    </div>
  );
}
