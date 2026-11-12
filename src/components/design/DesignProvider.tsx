import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { DesignContext } from "./DesignContext";
import {
  designParams,
  readDesignMode,
  readTheme,
  requestedDesign,
  resolveTheme,
  subscribeDesign,
  subscribeTheme,
  systemPrefersDark,
  writeDesignMode,
  writeTheme,
} from "./preference";

// Color de la barra del navegador / PWA según la vista y el tema
const BAR_COLOR = { classic: "#0f48c4", light: "#edf5f1", dark: "#0b1614" } as const;

/** Appearance only: accounts, permissions and business data are unchanged. */
export function DesignProvider({ children }: { children: ReactNode }) {
  const stored = useSyncExternalStore(
    subscribeDesign,
    readDesignMode,
    () => "classic" as const,
  );
  const theme = useSyncExternalStore(subscribeTheme, readTheme, () => "system" as const);
  const prefersDark = useSyncExternalStore(subscribeTheme, systemPrefersDark, () => false);
  const resolvedTheme = resolveTheme(theme, prefersDark);
  const location = useLocation();
  const navigate = useNavigate();
  const params = new URLSearchParams(location.search);
  const requested = requestedDesign(params.get("vista"));
  const mode = requested ?? stored;
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.dataset.design = mode;
    // El tema oscuro existe solo en Lightning; la vista clásica queda exactamente como antes.
    // Durante el cambio se pausan las transiciones para que todo cambie a la vez, sin mezclas.
    const changing = root.dataset.theme !== undefined && root.dataset.theme !== resolvedTheme;
    if (changing) root.dataset.themeSwitching = "";
    if (mode === "lightning") root.dataset.theme = resolvedTheme;
    else delete root.dataset.theme;
    if (changing) requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", mode === "lightning" ? BAR_COLOR[resolvedTheme] : BAR_COLOR.classic);
  }, [mode, resolvedTheme]);
  useLayoutEffect(() => {
    // Persist an explicit URL once; storage events must not create cross-tab write loops.
    if (requested) writeDesignMode(requested);
  }, [requested]);
  const toggle = () => {
    const next = mode === "lightning" ? "classic" : "lightning";
    writeDesignMode(next);
    navigate(
      {
        pathname: location.pathname,
        search: designParams(params, next).toString(),
        hash: location.hash,
      },
      { replace: true },
    );
  };
  return (
    <DesignContext.Provider value={{ mode, toggle, theme, resolvedTheme, setTheme: writeTheme }}>
      {children}
    </DesignContext.Provider>
  );
}
