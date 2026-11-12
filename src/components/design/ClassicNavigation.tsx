import { Link, useLocation } from "react-router-dom";
import { LogOut, X, Zap } from "lucide-react";
import { useAuth } from "../AuthProvider";
import { TrackingBadge } from "../TrackingBadge";
import { Button } from "../ui/button";
import { DesignSwitch } from "./DesignSwitch";
import {
  navigationActive,
  navigationFor,
  type NavigationCounts,
} from "./navigation";
import { ROLE_LABELS } from "../../lib/profiles";
import { cn } from "../../lib/utils";

const order = [
  "/asistente",
  "/",
  "/orders",
  "/recojos",
  "/liquidaciones",
  "/comercios",
  "/couriers",
  "/mapa",
  "/my-deliveries",
  "/my-pickups",
  "/mi-ruta",
  "/mis-pedidos",
  "/nuevo-pedido",
  "/carga-masiva",
  "/my-stock",
  "/mis-liquidaciones",
  "/mi-comercio",
  "/tarifario",
  "/stock",
];
export function ClassicNavigation({
  counts,
  close,
  onSignOut,
}: {
  counts: NavigationCounts;
  close: () => void;
  onSignOut: () => void;
}) {
  const { profile } = useAuth();
  const location = useLocation();
  const role = profile?.role;
  return (
    <>
      <div className="flex h-20 shrink-0 items-center border-b border-white/10 px-6">
        <div className="flex items-center gap-2">
          <div className="rounded-full bg-white/10 p-2">
            <Zap className="h-6 w-6 fill-accent text-accent" />
          </div>
          <span className="text-xl font-bold tracking-tight">Relámpago</span>
        </div>
        <button
          aria-label="Cerrar menú"
          onClick={close}
          className="ml-auto text-white/80 lg:hidden"
        >
          <X className="h-6 w-6" />
        </button>
      </div>
      <nav
        aria-label="Navegación principal"
        className="mt-6 min-h-0 flex-1 space-y-2 overflow-y-auto px-4 pb-4"
      >
        {navigationFor(role)
          .sort((a, b) => order.indexOf(a.href) - order.indexOf(b.href))
          .map((item) => (
            <Link
              key={item.href}
              to={item.href}
              onClick={close}
              aria-current={
                navigationActive(item.href, location.pathname)
                  ? "page"
                  : undefined
              }
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200",
                navigationActive(item.href, location.pathname)
                  ? "translate-x-1 bg-white text-primary shadow-md"
                  : "text-white/80 hover:translate-x-1 hover:bg-white/10 hover:text-white",
              )}
            >
              <span className="flex items-center gap-3">
                <item.icon className="h-5 w-5" />
                {item.label}
              </span>
              {item.count && (
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-xs font-bold",
                    navigationActive(item.href, location.pathname)
                      ? "bg-primary/10 text-primary"
                      : "bg-white/20 text-white",
                  )}
                >
                  {counts[item.count]}
                </span>
              )}
            </Link>
          ))}
      </nav>
      <div className="w-full shrink-0 border-t border-white/10 bg-black/5 p-4">
        <div className="mb-4 flex items-center gap-3 px-2">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-accent bg-accent/20 text-lg font-bold text-accent">
            {profile?.full_name?.[0] || "U"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-white">
              {profile?.full_name || "Usuario"}
            </p>
            <p className="text-xs text-white/60">
              {role ? ROLE_LABELS[role] : ""}
            </p>
          </div>
        </div>
        <TrackingBadge className="mb-3 w-full justify-center" />
        <DesignSwitch className="mb-2 w-full" />
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 text-white/80 hover:bg-white/10 hover:text-white"
          onClick={onSignOut}
        >
          <LogOut className="h-4 w-4" />
          Cerrar sesión
        </Button>
      </div>
    </>
  );
}
