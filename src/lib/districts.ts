// Catálogo de distritos y agencias (tabla public.districts). Es la única fuente de la lista:
// los formularios la muestran como lista cerrada y la base rechaza cualquier otro valor.
import { useEffect, useState } from "react";
import { supabase } from "./supabase";

export type District = { name: string; prices: number[]; kind: "district" | "agency"; aliases: string[] };

let cache: District[] | null = null;
let pending: Promise<District[]> | null = null;

export function loadDistricts(): Promise<District[]> {
  if (cache) return Promise.resolve(cache);
  pending ??= Promise.resolve(
    supabase.from("districts").select("name, prices, kind, aliases").eq("active", true).order("sort_order"),
  ).then(({ data, error }) => {
    if (error) {
      pending = null;
      throw error;
    }
    cache = (data ?? []).map((d) => ({ ...d, prices: (d.prices ?? []).map(Number), kind: d.kind === "agency" ? "agency" : "district" }));
    return cache;
  });
  return pending;
}

/** Lista de distritos (se carga una sola vez por sesión del navegador). */
export function useDistricts(): District[] {
  const [list, setList] = useState<District[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    let alive = true;
    loadDistricts()
      .then((l) => alive && setList(l))
      .catch((e) => console.error("Error cargando distritos:", e));
    return () => {
      alive = false;
    };
  }, []);
  return list;
}

const money = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2));

/** Precio para mostrar: "S/ 10" o "S/ 10 – 16" si depende de la zona. */
export function priceText(d: District): string {
  if (d.prices.length === 0) return "";
  const min = Math.min(...d.prices);
  const max = Math.max(...d.prices);
  return min === max ? `S/ ${money(min)}` : `S/ ${money(min)} – ${money(max)}`;
}

export const hasPriceRange = (d: District | undefined) => !!d && new Set(d.prices).size > 1;

/** Clave de comparación (igual que public.district_key): sin precio, minúsculas, sin tildes. */
export const districtKey = (s: string) =>
  s
    .split(" (")[0]
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/** Nombre del catálogo para un texto cualquiera ("Santiago de Surco" -> "Surco"), o null. */
export function matchDistrict(text: string | null | undefined, list: District[]): District | null {
  if (!text) return null;
  const k = districtKey(text);
  return list.find((d) => districtKey(d.name) === k) ?? list.find((d) => d.aliases.includes(k)) ?? null;
}
