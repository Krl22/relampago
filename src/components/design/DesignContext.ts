import { createContext, useContext } from "react";
import type { ThemeChoice } from "./preference";

export type DesignMode = "lightning" | "classic";
export const DesignContext = createContext<{
  mode: DesignMode;
  toggle: () => void;
  /** Elección guardada (claro / oscuro / sistema) y el tema que se ve ahora. Solo aplica en Lightning. */
  theme: ThemeChoice;
  resolvedTheme: "light" | "dark";
  setTheme: (choice: ThemeChoice) => void;
}>({ mode: "classic", toggle: () => {}, theme: "system", resolvedTheme: "light", setTheme: () => {} });
export const useDesign = () => useContext(DesignContext);
