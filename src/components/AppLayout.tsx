import { useState, useEffect } from "react";
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./AuthProvider";
import { supabase } from "../lib/supabase";
import {
  LayoutDashboard,
  Package,
  Truck,
  Boxes,
  LogOut,
  Menu,
  X,
  Building2,
  Users,
  Zap,
} from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "@/lib/utils";

export default function AppLayout() {
  const { profile, signOut } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [counts, setCounts] = useState({
    orders: 0,
    companies: 0,
    couriers: 0,
    stock: 0,
  });
  const location = useLocation();
  const navigate = useNavigate();

  const fetchCounts = async () => {
    try {
      const [ordersRes, companiesRes, couriersRes, stockRes] =
        await Promise.all([
          supabase.from("orders").select("*", { count: "exact", head: true }),
          supabase
            .from("companies")
            .select("*", { count: "exact", head: true }),
          supabase
            .from("profiles")
            .select("*", { count: "exact", head: true })
            .eq("role", "courier"),
          supabase.from("stock").select("*", { count: "exact", head: true }),
        ]);

      setCounts({
        orders: ordersRes.count || 0,
        companies: companiesRes.count || 0,
        couriers: couriersRes.count || 0,
        stock: stockRes.count || 0,
      });
    } catch (error) {
      console.error("Error fetching counts:", error);
    }
  };

  useEffect(() => {
    if (profile?.role === "admin" || profile?.role === "staff") {
      fetchCounts();
    }
  }, [profile, location.pathname]); // Re-fetch on navigation to keep updated

  const handleSignOut = async () => {
    await signOut();
    navigate("/login");
  };

  const role = profile?.role;

  const navItems = [
    {
      label: "Dashboard",
      href: "/",
      icon: LayoutDashboard,
      roles: ["admin", "staff"],
    },
    {
      label: "Pedidos",
      href: "/orders",
      icon: Package,
      roles: ["admin", "staff"],
      count: counts.orders,
    },
    {
      label: "Empresas",
      href: "/companies",
      icon: Building2,
      roles: ["admin", "staff"],
      count: counts.companies,
    },
    {
      label: "Motorizados",
      href: "/couriers",
      icon: Users,
      roles: ["admin", "staff"],
      count: counts.couriers,
    },
    {
      label: "Mis Envíos",
      href: "/my-deliveries",
      icon: Truck,
      roles: ["courier"],
    },
    {
      label: "Mi Stock",
      href: "/my-stock",
      icon: Boxes,
      roles: ["client"],
    },
    {
      label: "Inventario Global",
      href: "/stock",
      icon: Boxes,
      roles: ["admin"],
      count: counts.stock,
    },
  ];

  const filteredNavItems = navItems.filter((item) =>
    item.roles.includes(role || ""),
  );

  return (
    <div className="flex h-screen bg-gray-100">
      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-64 shadow-xl transition-transform duration-200 ease-in-out transform bg-primary text-primary-foreground lg:static lg:translate-x-0",
          sidebarOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex items-center px-6 h-20 border-b border-white/10">
          <div className="flex gap-2 items-center">
            <div className="p-2 rounded-full bg-white/10">
              <Zap className="w-6 h-6 text-accent fill-accent" />
            </div>
            <span className="text-xl font-bold tracking-tight">Relámpago</span>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden text-white/80 hover:text-white"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        <nav className="px-4 mt-6 space-y-2">
          {filteredNavItems.map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl px-4 py-3 text-sm font-medium transition-all duration-200",
                location.pathname === item.href
                  ? "bg-white text-primary shadow-md translate-x-1"
                  : "text-white/80 hover:bg-white/10 hover:text-white hover:translate-x-1",
              )}
              onClick={() => setSidebarOpen(false)}
            >
              <div className="flex gap-3 items-center">
                <item.icon
                  className={cn(
                    "h-5 w-5",
                    location.pathname === item.href
                      ? "text-primary"
                      : "text-white/70",
                  )}
                />
                {item.label}
              </div>
              {item.count !== undefined && (
                <span
                  className={cn(
                    "text-xs px-2 py-0.5 rounded-full font-bold",
                    location.pathname === item.href
                      ? "bg-primary/10 text-primary"
                      : "bg-white/20 text-white",
                  )}
                >
                  {item.count}
                </span>
              )}
            </Link>
          ))}
        </nav>

        <div className="absolute bottom-0 p-4 w-full border-t border-white/10 bg-black/5">
          <div className="flex gap-3 items-center px-2 mb-4">
            <div className="flex justify-center items-center w-10 h-10 rounded-full border-2 bg-accent/20 border-accent">
              <span className="text-lg font-bold text-accent">
                {profile?.full_name?.[0] || "U"}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-white">
                {profile?.full_name || "Usuario"}
              </span>
              <span className="text-xs capitalize text-white/60">{role}</span>
            </div>
          </div>
          <Button
            variant="ghost"
            className="gap-2 justify-start w-full text-white/80 hover:text-white hover:bg-white/10"
            onClick={handleSignOut}
          >
            <LogOut className="w-4 h-4" />
            Cerrar Sesión
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex overflow-hidden flex-col flex-1">
        {/* Top Header (Mobile only mostly) */}
        <header className="flex justify-between items-center px-6 h-16 bg-white shadow-sm lg:hidden">
          <button onClick={() => setSidebarOpen(true)}>
            <Menu className="w-6 h-6" />
          </button>
          <span className="font-semibold">Relámpago Courier</span>
          <div className="w-6" /> {/* Spacer */}
        </header>

        <main className="overflow-y-auto flex-1 p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
