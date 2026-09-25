import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import { useAuth } from "../components/AuthProvider";

export type MyCompany = Database["public"]["Tables"]["companies"]["Row"];

/** La empresa del comercio logueado (la RLS solo le deja leer la suya). */
export function useMyCompany(reloadToken = 0) {
  const { profile } = useAuth();
  const companyId = profile?.company_id ?? null;
  const [company, setCompany] = useState<MyCompany | null>(null);
  const [loading, setLoading] = useState(!!companyId);

  useEffect(() => {
    if (!companyId) return;
    let cancelled = false;
    supabase
      .from("companies")
      .select("*")
      .eq("id", companyId)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) console.error("Error cargando la empresa:", error);
        setCompany(data ?? null);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, reloadToken]);

  return { company, companyId, loading };
}
