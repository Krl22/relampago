/** Visual list memory only; never used to construct a database query. */
export function savedList<T extends Record<string, string>>(
  state: unknown,
  key: string,
  defaults: T,
): {
  filters: T;
  sortConfig: { key: string; direction: "asc" | "desc" };
} | null {
  if (!state || typeof state !== "object") return null;
  const entry = (state as Record<string, unknown>)[key];
  if (!entry || typeof entry !== "object") return null;
  const { filters, sortConfig } = entry as Record<string, unknown>;
  if (
    !filters ||
    typeof filters !== "object" ||
    !sortConfig ||
    typeof sortConfig !== "object"
  )
    return null;
  const values = filters as Record<string, unknown>;
  const sort = sortConfig as Record<string, unknown>;
  if (
    Object.keys(defaults).some((name) => typeof values[name] !== "string") ||
    typeof sort.key !== "string" ||
    (sort.direction !== "asc" && sort.direction !== "desc")
  )
    return null;
  return {
    filters: Object.fromEntries(
      Object.keys(defaults).map((name) => [name, values[name]]),
    ) as T,
    sortConfig: { key: sort.key, direction: sort.direction },
  };
}

/** Limit back links to known internal record/list routes; reject external destinations. */
export function recordOrigin(
  state: unknown,
): { path: string; label: string } | null {
  if (!state || typeof state !== "object") return null;
  const origin = (state as { recordOrigin?: unknown }).recordOrigin;
  if (
    !origin ||
    typeof origin !== "object" ||
    !("path" in origin) ||
    typeof origin.path !== "string"
  )
    return null;
  try {
    const url = new URL(origin.path, "https://relampago.invalid");
    if (url.origin !== "https://relampago.invalid") return null;
    url.searchParams.delete("vista");
    if (url.pathname === "/stock")
      return {
        path: url.pathname + url.search + url.hash,
        label: "Inventario global",
      };
    if (/^\/couriers\/[0-9a-f-]{36}$/i.test(url.pathname))
      return {
        path: url.pathname + url.search + url.hash,
        label: "Ficha del motorizado",
      };
  } catch {
    /* Ignore malformed history state. */
  }
  return null;
}
