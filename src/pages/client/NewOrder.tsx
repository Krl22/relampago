import { Link } from "react-router-dom";
import { OrderForm } from "../../components/OrderForm";
import { CutoffNotice } from "../../components/CutoffNotice";
import { useMyCompany } from "../../hooks/useMyCompany";
import { Button } from "../../components/ui/button";
import { ArrowLeft } from "lucide-react";

/** El mismo formulario de pedidos, ya fijado al comercio logueado (usa su link propio). */
export default function NewOrder() {
  const { company, loading } = useMyCompany();
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button asChild variant="ghost" size="icon">
          <Link to="/mis-pedidos" title="Volver a mis pedidos">
            <ArrowLeft className="h-5 w-5" />
          </Link>
        </Button>
        <h1 className="text-3xl font-bold">Nuevo pedido</h1>
      </div>
      <CutoffNotice className="mx-auto max-w-2xl" coverageHref="/tarifario" />
      {loading ? (
        <div className="py-10 text-center text-sm text-muted-foreground">Cargando…</div>
      ) : company ? (
        <OrderForm intakeToken={company.intake_token} portal />
      ) : (
        <div className="py-10 text-center text-sm text-destructive">No se encontró tu comercio.</div>
      )}
    </div>
  );
}
