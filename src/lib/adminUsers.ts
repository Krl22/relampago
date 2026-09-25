import { supabase } from "./supabase";

/** Llama a la Edge Function admin-users (accesos de comercios y "Ver como"). */
export async function callAdminUsers<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("admin-users", { body });
  if (error) {
    // La función devuelve el detalle en el cuerpo; el SDK solo trae un error genérico
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === "function") {
      const j = await ctx.json().catch(() => null);
      if (j?.error) throw new Error(j.error);
    }
    throw new Error(error.message);
  }
  if (data?.error) throw new Error(data.error);
  return data as T;
}
