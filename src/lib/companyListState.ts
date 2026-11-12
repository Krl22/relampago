export type CompanyFilters = {
  name: string;
  ruc: string;
  phone: string;
  district: string;
  address: string;
  date: string;
  yape: string;
  portal: "" | "none" | "none_active" | "has";
};
export type CompanySort = { key: string; direction: "asc" | "desc" };
const fields = [
  "name",
  "ruc",
  "phone",
  "district",
  "address",
  "date",
  "yape",
] as const;
/** Router state is display-only; accept known values and never turn it into an API filter. */
export function savedCompanyList(
  state: unknown,
): { filters: CompanyFilters; sortConfig: CompanySort } | null {
  if (!state || typeof state !== "object" || !("companyList" in state))
    return null;
  const saved = state.companyList;
  if (
    !saved ||
    typeof saved !== "object" ||
    !("filters" in saved) ||
    !("sortConfig" in saved)
  )
    return null;
  const filters = saved.filters;
  const sort = saved.sortConfig;
  if (
    !filters ||
    typeof filters !== "object" ||
    !sort ||
    typeof sort !== "object"
  )
    return null;
  const values = filters as Record<string, unknown>;
  if (
    fields.some((field) => typeof values[field] !== "string") ||
    !["", "none", "none_active", "has"].includes(String(values.portal))
  )
    return null;
  const sorting = sort as Record<string, unknown>;
  if (
    typeof sorting.key !== "string" ||
    !["asc", "desc"].includes(String(sorting.direction))
  )
    return null;
  return {
    filters: Object.fromEntries(
      [...fields, "portal"].map((field) => [field, values[field]]),
    ) as CompanyFilters,
    sortConfig: {
      key: sorting.key,
      direction: sorting.direction as CompanySort["direction"],
    },
  };
}
