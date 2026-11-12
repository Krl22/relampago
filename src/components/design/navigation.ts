import {
  BadgeDollarSign,
  Bot,
  Boxes,
  Building2,
  ClipboardList,
  FileSpreadsheet,
  LayoutDashboard,
  Map,
  Package,
  PackageOpen,
  PlusCircle,
  Receipt,
  Route,
  Store,
  Users,
  Truck,
  type LucideIcon,
} from "lucide-react";
import type { UserRole } from "../../types/database";

type Counts = {
  orders: number;
  companies: number;
  couriers: number;
  stock: number;
};
export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  roles: UserRole[];
  section: string;
  count?: keyof Counts;
};
export const navigation: NavItem[] = [
  {
    label: "Dashboard",
    href: "/",
    icon: LayoutDashboard,
    roles: ["admin", "staff"],
    section: "Operación",
  },
  {
    label: "Pedidos",
    href: "/orders",
    icon: Package,
    roles: ["admin", "staff"],
    section: "Operación",
    count: "orders",
  },
  {
    label: "Recojos",
    href: "/recojos",
    icon: PackageOpen,
    roles: ["admin", "staff"],
    section: "Operación",
  },
  {
    label: "Liquidaciones",
    href: "/liquidaciones",
    icon: Receipt,
    roles: ["admin", "staff"],
    section: "Operación",
  },
  {
    label: "Mapa",
    href: "/mapa",
    icon: Map,
    roles: ["admin", "staff"],
    section: "Operación",
  },
  {
    label: "Comercios",
    href: "/comercios",
    icon: Building2,
    roles: ["admin", "staff"],
    section: "Administración",
    count: "companies",
  },
  {
    label: "Motorizados",
    href: "/couriers",
    icon: Users,
    roles: ["admin", "staff"],
    section: "Administración",
    count: "couriers",
  },
  {
    label: "Inventario global",
    href: "/stock",
    icon: Boxes,
    roles: ["admin"],
    section: "Administración",
    count: "stock",
  },
  {
    label: "Asistente IA",
    href: "/asistente",
    icon: Bot,
    roles: ["admin"],
    section: "Asistente",
  },
  {
    label: "Mis envíos",
    href: "/my-deliveries",
    icon: Truck,
    roles: ["courier"],
    section: "Reparto",
  },
  {
    label: "Mis recojos",
    href: "/my-pickups",
    icon: PackageOpen,
    roles: ["courier"],
    section: "Reparto",
  },
  {
    label: "Mi ruta",
    href: "/mi-ruta",
    icon: Route,
    roles: ["courier"],
    section: "Reparto",
  },
  {
    label: "Mis pedidos",
    href: "/mis-pedidos",
    icon: ClipboardList,
    roles: ["client"],
    section: "Mi comercio",
  },
  {
    label: "Nuevo pedido",
    href: "/nuevo-pedido",
    icon: PlusCircle,
    roles: ["client"],
    section: "Mi comercio",
  },
  {
    label: "Carga masiva",
    href: "/carga-masiva",
    icon: FileSpreadsheet,
    roles: ["client"],
    section: "Mi comercio",
  },
  {
    label: "Mi stock",
    href: "/my-stock",
    icon: Boxes,
    roles: ["client"],
    section: "Mi comercio",
  },
  {
    label: "Mis liquidaciones",
    href: "/mis-liquidaciones",
    icon: Receipt,
    roles: ["client"],
    section: "Mi comercio",
  },
  {
    label: "Mi comercio",
    href: "/mi-comercio",
    icon: Store,
    roles: ["client"],
    section: "Mi comercio",
  },
  {
    label: "Tarifario",
    href: "/tarifario",
    icon: BadgeDollarSign,
    roles: ["admin", "staff", "client"],
    section: "Consulta",
  },
];

export function navigationFor(role: UserRole | undefined) {
  return role ? navigation.filter((item) => item.roles.includes(role)) : [];
}
export function navigationActive(href: string, pathname: string) {
  return (
    href === pathname ||
    (href === "/comercios" && pathname.startsWith("/comercios/")) ||
    (href === "/couriers" && pathname.startsWith("/couriers/"))
  );
}
export type NavigationCounts = Counts;
