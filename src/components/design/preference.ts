import type { DesignMode } from "./DesignContext";

const STORAGE_KEY = "relampago.design.v2";
const CHANGE_EVENT = "relampago-design-change";
let memoryMode: DesignMode = "classic";
let storageBlocked = false;

export function readDesignMode(): DesignMode {
  if (storageBlocked) return memoryMode;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved === "classic" || saved === "lightning" ? saved : memoryMode;
  } catch {
    return memoryMode;
  }
}
export function writeDesignMode(mode: DesignMode) {
  memoryMode = mode;
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    storageBlocked = true;
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}
export function subscribeDesign(listener: () => void) {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
export function requestedDesign(value: string | null): DesignMode | null {
  return value === "clasica"
    ? "classic"
    : value === "lightning"
      ? "lightning"
      : null;
}
export function designParams(current: URLSearchParams, mode: DesignMode) {
  const next = new URLSearchParams(current);
  next.set("vista", mode === "classic" ? "clasica" : "lightning");
  return next;
}

// Tema de Lightning (claro / oscuro / según el sistema). Solo afecta a la vista Lightning.
export type ThemeChoice = "light" | "dark" | "system";
const THEME_KEY = "relampago.theme.v1";
const THEME_EVENT = "relampago-theme-change";
let memoryTheme: ThemeChoice = "system";

export function readTheme(): ThemeChoice {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === "light" || saved === "dark" || saved === "system" ? saved : memoryTheme;
  } catch {
    return memoryTheme;
  }
}
export function writeTheme(choice: ThemeChoice) {
  memoryTheme = choice;
  try {
    localStorage.setItem(THEME_KEY, choice);
  } catch {
    /* sin almacenamiento: se recuerda solo en esta sesión */
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}
export function subscribeTheme(listener: () => void) {
  const media = window.matchMedia?.("(prefers-color-scheme: dark)");
  window.addEventListener(THEME_EVENT, listener);
  window.addEventListener("storage", listener);
  media?.addEventListener?.("change", listener);
  return () => {
    window.removeEventListener(THEME_EVENT, listener);
    window.removeEventListener("storage", listener);
    media?.removeEventListener?.("change", listener);
  };
}
export function systemPrefersDark() {
  return !!window.matchMedia?.("(prefers-color-scheme: dark)").matches;
}
export function resolveTheme(choice: ThemeChoice, prefersDark: boolean): "light" | "dark" {
  return choice === "system" ? (prefersDark ? "dark" : "light") : choice;
}
