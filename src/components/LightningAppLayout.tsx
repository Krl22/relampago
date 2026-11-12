import { Suspense, useEffect, useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, LogOut, Menu, Zap } from "lucide-react";
import { useAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";
import { ROLE_LABELS } from "../lib/profiles";
import { cn } from "../lib/utils";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { TrackingBadge } from "./TrackingBadge";
import { MerchantAnnouncement } from "./Announcements";
import { ChatReminder } from "./chat/ChatReminder";
import { DesignSwitch } from "./design/DesignSwitch";
import { ThemeSwitch } from "./design/ThemeSwitch";
import {
  navigationActive,
  navigationFor,
  type NavigationCounts,
} from "./design/navigation";
import { useDesign } from "./design/DesignContext";
import { ClassicNavigation } from "./design/ClassicNavigation";
import { PageLoading } from "./design/PageLoading";
import { PageBoundary } from "./design/PageBoundary";

export default function LightningAppLayout() {
  const { mode } = useDesign();
  const classic = mode === "classic";
  const { profile, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [drawer, setDrawer] = useState(false);
  const [counts, setCounts] = useState<NavigationCounts>({
    orders: 0,
    companies: 0,
    couriers: 0,
    stock: 0,
    supervisors: 0,
  });
  const role = profile?.role;
  const items = navigationFor(role);
  const current = items.find((item) =>
    navigationActive(item.href, location.pathname),
  );
  const sections = [...new Set(items.map((item) => item.section))];

  useEffect(() => {
    if (role !== "admin" && role !== "staff") return;
    let active = true;
    Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }),
      supabase.from("companies").select("id", { count: "exact", head: true }),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "courier"),
      supabase.from("stock").select("id", { count: "exact", head: true }),
      supabase
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("role", "staff"),
    ])
      .then(([orders, companies, couriers, stock, supervisors]) => {
        if (active)
          setCounts({
            orders: orders.count ?? 0,
            companies: companies.count ?? 0,
            couriers: couriers.count ?? 0,
            stock: stock.count ?? 0,
            supervisors: supervisors.count ?? 0,
          });
      })
      .catch(() => {
        /* Counts are supplementary; navigation remains usable if a request fails. */
      });
    return () => {
      active = false;
    };
  }, [role, location.pathname]);

  const sidebar = (
    <>
      <div className="lx-brand flex h-[72px] shrink-0 items-center gap-3 border-b px-5">
        <span className="lx-logo flex h-9 w-9 items-center justify-center rounded-lg">
          <Zap className="h-5 w-5 fill-current" aria-hidden="true" />
        </span>
        <div>
          <span className="text-lg font-semibold tracking-tight text-foreground">
            Relámpago
          </span>
          <p className="text-[11px] text-muted-foreground">
            Courier · {role ? ROLE_LABELS[role] : "Mi cuenta"}
          </p>
        </div>
      </div>
      <nav
        aria-label="Navegación principal"
        className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-5"
      >
        {sections.map((section) => (
          <div key={section}>
            <p className="lx-nav-section mb-2 px-3 text-[11px] font-semibold uppercase tracking-wider">
              {section}
            </p>
            <ul className="space-y-1">
              {items
                .filter((item) => item.section === section)
                .map((item) => {
                  const selected = navigationActive(
                    item.href,
                    location.pathname,
                  );
                  return (
                    <li key={item.href}>
                      <Link
                        to={item.href}
                        aria-current={selected ? "page" : undefined}
                        onClick={() => setDrawer(false)}
                        className={cn(
                          "lx-nav-link flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm",
                          selected && "font-semibold",
                        )}
                      >
                        <item.icon
                          className="h-[18px] w-[18px] shrink-0"
                          aria-hidden="true"
                        />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        {item.count && (
                          <span className="lx-nav-count rounded-full px-2 py-0.5 text-[11px] tabular-nums">
                            {counts[item.count]}
                          </span>
                        )}
                      </Link>
                    </li>
                  );
                })}
            </ul>
          </div>
        ))}
      </nav>
      <div className="lx-sidebar-footer shrink-0 space-y-3 border-t p-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="lx-avatar flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
            {profile?.full_name?.[0] || "U"}
          </span>
          <div className="min-w-0">
            <p
              title={profile?.full_name ?? undefined}
              className="truncate text-sm font-medium text-foreground"
            >
              {profile?.full_name || "Mi cuenta"}
            </p>
            <p className="text-xs text-muted-foreground">
              {role ? ROLE_LABELS[role] : ""}
            </p>
          </div>
        </div>
        <TrackingBadge className="w-full justify-center" />
        <Button
          variant="ghost"
          className="min-h-11 w-full justify-start gap-2 text-muted-foreground"
          onClick={() => void signOut().then(() => navigate("/login"))}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Cerrar sesión
        </Button>
      </div>
    </>
  );

  return (
    <div
      className={
        classic
          ? "flex h-screen min-h-0 overflow-hidden bg-gray-100 print:h-auto print:bg-white"
          : "lightning-shell flex h-dvh min-h-0 overflow-hidden bg-background print:h-auto print:overflow-visible print:bg-white"
      }
    >
      <a
        href="#workspace-content"
        className="sr-only z-[1200] focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:rounded focus:bg-white focus:p-3"
      >
        Saltar al contenido
      </a>
      <aside
        className={
          classic
            ? "hidden w-64 shrink-0 flex-col bg-primary text-primary-foreground shadow-xl lg:flex print:hidden"
            : "lx-sidebar hidden w-60 shrink-0 flex-col border-r lg:flex print:hidden"
        }
      >
        {classic ? (
          <ClassicNavigation
            counts={counts}
            close={() => setDrawer(false)}
            onSignOut={() => void signOut().then(() => navigate("/login"))}
          />
        ) : (
          sidebar
        )}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header
          className={
            classic
              ? "flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 bg-white px-3 py-2 shadow-sm lg:hidden print:hidden"
              : "lx-topbar flex min-h-[72px] shrink-0 items-center justify-between gap-2 border-b px-3 py-2 sm:px-5 print:hidden"
          }
        >
          <div className="flex min-w-0 items-center gap-2">
            <Dialog open={drawer} onOpenChange={setDrawer}>
              <DialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-11 w-11 lg:hidden"
                  aria-label="Abrir menú de navegación"
                >
                  <Menu className="h-5 w-5" />
                </Button>
              </DialogTrigger>
              <DialogContent className="lightning-drawer inset-y-0 left-0 top-0 flex h-dvh max-h-none w-[min(20rem,calc(100vw-2rem))] max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:rounded-none">
                <DialogHeader className="sr-only">
                  <DialogTitle>Menú de Relámpago</DialogTitle>
                  <DialogDescription>
                    Accede a las pantallas disponibles para tu cuenta.
                  </DialogDescription>
                </DialogHeader>
                {classic ? (
                  <div className="flex min-h-0 flex-1 flex-col bg-primary text-primary-foreground">
                    <ClassicNavigation
                      counts={counts}
                      close={() => setDrawer(false)}
                      onSignOut={() =>
                        void signOut().then(() => navigate("/login"))
                      }
                    />
                  </div>
                ) : (
                  sidebar
                )}
              </DialogContent>
            </Dialog>
            <div className="min-w-0">
              <p className="truncate text-[11px] text-muted-foreground">
                Relámpago{" "}
                <ChevronRight className="inline h-3 w-3" aria-hidden="true" />{" "}
                {current?.section ?? "Mi cuenta"}
              </p>
              <p className="truncate text-sm font-semibold text-foreground">
                {current?.label ?? "Mi espacio"}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeSwitch />
            <DesignSwitch />
          </div>
        </header>
        <main
          id="workspace-content"
          tabIndex={-1}
          className={
            classic
              ? "min-h-0 min-w-0 flex-1 overflow-y-auto p-6 outline-none print:overflow-visible print:p-0"
              : "lightning-workspace min-h-0 min-w-0 flex-1 overflow-y-auto p-3 outline-none sm:p-5 xl:p-6 print:overflow-visible print:p-0"
          }
        >
          <ChatReminder />
          {role === "client" && <MerchantAnnouncement />}
          <PageBoundary key={location.pathname}>
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </PageBoundary>
        </main>
      </div>
    </div>
  );
}
