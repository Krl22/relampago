import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { callAdminUsers } from "../lib/adminUsers";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { ViewAsButton } from "./ViewAsButton";

type Access = {
  id: string;
  full_name: string | null;
  email: string;
  company_id: string | null;
  access_status: "active" | "pending_email" | "pending_password" | "unverified";
};

const statusLabels = {
  active: "Cuenta activa",
  pending_email: "Falta verificar el correo",
  pending_password: "Falta completar la activación",
  unverified: "Correo sin verificar",
};

/** Mount separately for each commerce so accounts from another commerce are never displayed. */
export function CompanyViewAsDialog({ company, onClose, onManageAccess }: {
  company: { id: string; name: string };
  onClose: () => void;
  onManageAccess: () => void;
}) {
  const [users, setUsers] = useState<Access[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let cancelled = false;
    callAdminUsers<{ users: Access[] }>({ action: "list", company_id: company.id })
      .then((data) => { if (!cancelled) setUsers(data.users); })
      .catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : "No se pudieron cargar los accesos."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [company.id, retry]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ver como · {company.name}</DialogTitle>
          <DialogDescription>Elige una cuenta activa para entrar a su portal. Las acciones son reales y quedan registradas. Regresa con «Volver a mi cuenta».</DialogDescription>
        </DialogHeader>
        {loading ? (
          <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando cuentas…</p>
        ) : error ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-red-700">{error}</p>
            <Button variant="outline" onClick={() => { setError(null); setLoading(true); setRetry((n) => n + 1); }}>Reintentar</Button>
          </div>
        ) : users.length === 0 ? (
          <p className="rounded-md bg-gray-50 p-3 text-sm">Este comercio todavía no tiene una cuenta para entrar al portal. Crea o vincula una en «Gestionar accesos».</p>
        ) : (
          <ul className="divide-y rounded-md border">
            {users.map((account) => {
              const eligible = account.access_status === "active" && account.company_id === company.id;
              return (
                <li key={account.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium">{account.full_name || account.email}</p>
                    <p className="break-all text-xs text-muted-foreground">{account.email}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{eligible ? statusLabels.active : account.access_status === "active" ? "Cuenta sin vinculación activa a este comercio" : statusLabels[account.access_status]}</p>
                  </div>
                  {eligible && <ViewAsButton target={{ id: account.id, full_name: account.full_name || account.email, role: "client", company_id: company.id }} className="h-9 shrink-0 border px-3" />}
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose}>Cerrar</Button>
          <Button onClick={onManageAccess}>Gestionar accesos</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
