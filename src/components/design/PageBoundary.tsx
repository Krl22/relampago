import { Component, type ReactNode } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "../ui/button";

/** A failed route download keeps navigation available instead of leaving a blank screen. */
export class PageBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        role="alert"
        className="rounded-lg border bg-white p-6 text-center"
      >
        <AlertCircle className="mx-auto mb-3 h-7 w-7 text-amber-700" />
        <h1 className="text-lg font-semibold">
          No se pudo abrir esta pantalla
        </h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          Comprueba tu conexión y vuelve a cargar la página para continuar.
        </p>
        <Button className="mt-4" onClick={() => window.location.reload()}>
          <RefreshCw className="mr-2 h-4 w-4" />
          Volver a cargar
        </Button>
      </section>
    );
  }
}
