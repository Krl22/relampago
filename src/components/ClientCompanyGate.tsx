import { Outlet } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { Card, CardDescription, CardHeader, CardTitle } from "./ui/card";

/**
 * Las páginas del comercio necesitan una empresa vinculada. Las cuentas las crea Relámpago
 * (Empresas → Accesos); una cuenta sin empresa (p. ej. alguien que entró con Google) solo ve este aviso.
 */
export function ClientCompanyGate() {
  const { profile } = useAuth();
  if (profile?.company_id) return <Outlet />;
  return (
    <div className="mx-auto max-w-xl">
      <Card>
        <CardHeader>
          <CardTitle>Tu cuenta aún no está vinculada a un comercio</CardTitle>
          <CardDescription>
            Las cuentas del portal las crea Relámpago Courier. Si ya trabajas con nosotros, pídenos tu acceso por WhatsApp y te lo
            activamos.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
