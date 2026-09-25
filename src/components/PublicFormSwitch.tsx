import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "./AuthProvider";
import { Card, CardContent } from "./ui/card";
import { Button } from "./ui/button";
import { ExternalLink, Loader2, Lock, LockOpen } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Interruptor del formulario público de pedidos. Se cierra cuando los comercios activos ya
 * tienen su cuenta: desde ahí solo se pide iniciando sesión en el portal.
 */
export function PublicFormSwitch() {
  const { user } = useAuth();
  const [open, setOpen] = useState<boolean | null>(null);
  const [pendingAccounts, setPendingAccounts] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.rpc("public_form_open").then(({ data }) => setOpen(data !== false));
    // Comercios que pidieron en los últimos 30 días y aún no tienen cuenta
    supabase.rpc("company_activity").then(({ data }) => setPendingAccounts((data ?? []).filter((r) => r.accounts === 0 && r.orders_30d > 0).length));
  }, []);

  const toggle = async () => {
    if (open == null) return;
    const next = !open;
    if (
      !next &&
      !globalThis.confirm(
        `¿Cerrar el formulario público? Desde ahora solo se podrá pedir con cuenta.${pendingAccounts ? `\n\nOjo: ${pendingAccounts} comercios que pidieron este mes todavía no tienen cuenta.` : ""}`,
      )
    )
      return;
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .upsert({ key: "public_form_open", value: next, updated_at: new Date().toISOString(), updated_by: user?.id ?? null });
    setSaving(false);
    if (error) alert("No se pudo cambiar: " + error.message);
    else setOpen(next);
  };

  return (
    <Card className={cn(open === false ? "border-gray-200 bg-gray-50" : "border-primary/20 bg-primary/5")}>
      <CardContent className="flex flex-wrap items-center gap-4 p-4">
        <div className="text-sm">
          <p className="flex items-center gap-1 font-medium">
            {open === false ? <Lock className="h-4 w-4" /> : <LockOpen className="h-4 w-4 text-primary" />}
            Formulario público: {open == null ? "…" : open ? "abierto" : "cerrado"}
          </p>
          <p className="text-xs text-muted-foreground">
            {open === false ? (
              "Los comercios piden con su cuenta."
            ) : pendingAccounts ? (
              <>
                <Link to="/comercios" className="text-primary underline">
                  {pendingAccounts} comercios activos
                </Link>{" "}
                aún no tienen cuenta
              </>
            ) : (
              "Todos los comercios activos ya tienen cuenta."
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant={open ? "outline" : "default"} onClick={() => void toggle()} disabled={saving || open == null}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {open ? "Cerrar formulario" : "Reabrir"}
          </Button>
          <Link to="/pedido-express" target="_blank">
            <Button size="icon" variant="ghost" title="Ver el formulario público">
              <ExternalLink className="h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
