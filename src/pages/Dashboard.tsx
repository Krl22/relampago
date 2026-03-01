import { useAuth } from "../components/AuthProvider";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Truck,
  CheckCircle,
  Clock,
  Copy,
  ExternalLink,
  Loader2,
  Filter,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import { format, subDays, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import type { Database } from "../types/database";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];
type Company = Database["public"]["Tables"]["companies"]["Row"];

export default function Dashboard() {
  const { profile } = useAuth();
  const [copied, setCopied] = useState(false);
  const [stats, setStats] = useState({
    pending: 0,
    in_transit: 0,
    delivered: 0,
    courier_pending: 0,
  });
  const [loading, setLoading] = useState(true);
  const [chartData, setChartData] = useState<
    { name: string; value: number; color: string }[]
  >([]);
  const [revenueData, setRevenueData] = useState<
    { name: string; total: number }[]
  >([]);

  // Filters State
  const [filterDate, setFilterDate] = useState("");
  const [selectedCourier, setSelectedCourier] = useState("");
  const [selectedCompany, setSelectedCompany] = useState("");
  const [selectedDistrict, setSelectedDistrict] = useState("");
  const [couriers, setCouriers] = useState<Profile[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);

  useEffect(() => {
    fetchFiltersData();
  }, []);

  useEffect(() => {
    fetchStats();
  }, [profile, filterDate, selectedCourier, selectedCompany, selectedDistrict]);

  const fetchFiltersData = async () => {
    const { data: couriersData } = await supabase
      .from("profiles")
      .select("*")
      .eq("role", "courier");

    const { data: companiesData } = await supabase
      .from("companies")
      .select("*");

    if (couriersData) setCouriers(couriersData);
    if (companiesData) setCompanies(companiesData);
  };

  const fetchStats = async () => {
    setLoading(true);
    try {
      if (profile?.role === "courier") {
        // ... (courier logic remains mostly the same but could apply filters if needed)
        const { count } = await supabase
          .from("orders")
          .select("*", { count: "exact", head: true })
          .eq("assigned_courier", profile.id)
          .in("status", ["pending", "in_transit"]);

        setStats((prev) => ({ ...prev, courier_pending: count || 0 }));
      } else {
        // Admin/Staff Stats with Filters
        const query = supabase.from("orders").select(`
            *,
            companies (name),
            assigned_courier_profile:profiles!assigned_courier (full_name)
          `);

        // Apply filters directly in query where possible or filter in memory
        // Note: For complex filtering (like date ranges on created_at),
        // it might be better to filter in memory for this scale, or construct precise queries.

        const { data } = await query;

        if (data) {
          let filteredData = data;

          // Date Filter
          if (filterDate) {
            filteredData = filteredData.filter((order) => {
              const orderDate = format(
                parseISO(order.created_at),
                "yyyy-MM-dd",
              );
              return orderDate === filterDate;
            });
          }

          // Courier Filter
          if (selectedCourier) {
            filteredData = filteredData.filter(
              (order) => order.assigned_courier === selectedCourier,
            );
          }

          // Company Filter
          if (selectedCompany) {
            filteredData = filteredData.filter(
              (order) => order.company_id === selectedCompany,
            );
          }

          // District Filter
          if (selectedDistrict) {
            filteredData = filteredData.filter((order) =>
              (order.destination_district || "")
                .toLowerCase()
                .includes(selectedDistrict.toLowerCase()),
            );
          }

          const pending = filteredData.filter(
            (o) => o.status === "pending",
          ).length;
          const in_transit = filteredData.filter(
            (o) => o.status === "in_transit",
          ).length;
          const delivered = filteredData.filter((o) => {
            // Si hay filtro de fecha, usamos ese. Si no, hoy.
            const targetDate = filterDate || format(new Date(), "yyyy-MM-dd");
            const orderDate = format(parseISO(o.created_at), "yyyy-MM-dd");
            return o.status === "delivered" && orderDate === targetDate;
          }).length;
          setStats({ pending, in_transit, delivered, courier_pending: 0 });

          // Prepare Pie Chart Data
          // For charts, we want the global statuses of the filtered data,
          // NOT limited to "today" like the delivered card.
          // Re-calculate delivered for the whole filtered set
          const totalDelivered = filteredData.filter(
            (o) => o.status === "delivered",
          ).length;

          setChartData([
            { name: "Pendiente", value: pending, color: "#f97316" },
            { name: "En Ruta", value: in_transit, color: "#3b82f6" },
            { name: "Entregado", value: totalDelivered, color: "#22c55e" },
          ]);

          // Prepare Bar Chart Data (Last 7 Days or Selected Date)
          let dateLabels: string[] = [];

          if (filterDate) {
            // If a single date is selected, maybe show hours? Or just show that day.
            // For simplicity, let's keep showing the bar for that day, or maybe a small range around it?
            // User asked for "date filter", implying specific day.
            // Let's just show that specific day in the chart to be consistent.
            dateLabels = [format(parseISO(filterDate), "dd/MM")];
          } else {
            dateLabels = Array.from({ length: 7 }, (_, i) => {
              const d = subDays(new Date(), i);
              return format(d, "dd/MM", { locale: es });
            }).reverse();
          }

          const revenueMap = new Map<string, number>();
          dateLabels.forEach((day) => revenueMap.set(day, 0));

          filteredData.forEach((order) => {
            const orderDate = format(parseISO(order.created_at), "dd/MM", {
              locale: es,
            });
            // Only count if it's in our labels
            if (revenueMap.has(orderDate)) {
              revenueMap.set(orderDate, (revenueMap.get(orderDate) || 0) + 1);
            }
          });

          const finalRevenueData = Array.from(revenueMap.entries()).map(
            ([name, total]) => ({
              name,
              total,
            }),
          );

          setRevenueData(finalRevenueData);
        }
      }
    } catch (error) {
      console.error("Error fetching stats:", error);
    } finally {
      setLoading(false);
    }
  };

  const copyPublicLink = () => {
    const url = `${window.location.origin}/pedido-express`;
    navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (profile?.role === "courier") {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Bienvenido, {profile.full_name}</h1>
        <p className="text-gray-500">Aquí están tus tareas para hoy.</p>

        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="flex flex-row justify-between items-center pb-2 space-y-0">
              <CardTitle className="text-sm font-medium">
                Envíos Pendientes
              </CardTitle>
              <Truck className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {loading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  stats.courier_pending
                )}
              </div>
              <p className="text-xs text-muted-foreground">Asignados a ti</p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  if (profile?.role === "client") {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl font-bold">Bienvenido</h1>
        <p>Gestiona tu stock desde el menú.</p>
      </div>
    );
  }

  // Admin and Staff
  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 justify-between md:flex-row md:items-center">
        <h1 className="text-3xl font-bold">Dashboard</h1>

        <Card className="bg-primary/5 border-primary/20">
          <CardContent className="flex gap-4 items-center p-4">
            <div className="text-sm">
              <p className="font-medium">Formulario Público de Pedidos</p>
              <p className="text-xs text-muted-foreground">
                Comparte este link con tus clientes
              </p>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={copyPublicLink}>
                {copied ? (
                  <CheckCircle className="mr-2 w-4 h-4" />
                ) : (
                  <Copy className="mr-2 w-4 h-4" />
                )}
                {copied ? "Copiado" : "Copiar Link"}
              </Button>
              <Link to="/pedido-express" target="_blank">
                <Button size="icon" variant="ghost">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex gap-2 items-center text-base">
            <Filter className="w-4 h-4" /> Filtros
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <Label>Fecha</Label>
              <Input
                type="date"
                value={filterDate}
                onChange={(e) => setFilterDate(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Motorizado</Label>
              <select
                className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={selectedCourier}
                onChange={(e) => setSelectedCourier(e.target.value)}
              >
                <option value="">Todos</option>
                {couriers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.full_name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Empresa (Cliente)</Label>
              <select
                className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={selectedCompany}
                onChange={(e) => setSelectedCompany(e.target.value)}
              >
                <option value="">Todas</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label>Distrito</Label>
              <Input
                placeholder="Ej. Miraflores"
                value={selectedDistrict}
                onChange={(e) => setSelectedDistrict(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end mt-4">
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setFilterDate("");
                setSelectedCourier("");
                setSelectedCompany("");
                setSelectedDistrict("");
              }}
            >
              Limpiar Filtros
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row justify-between items-center pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">
              Pedidos Pendientes
            </CardTitle>
            <Clock className="w-4 h-4 text-orange-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                stats.pending
              )}
            </div>
            <p className="text-xs text-muted-foreground">Por procesar</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row justify-between items-center pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">En Ruta</CardTitle>
            <Truck className="w-4 h-4 text-blue-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                stats.in_transit
              )}
            </div>
            <p className="text-xs text-muted-foreground">En camino a entrega</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row justify-between items-center pb-2 space-y-0">
            <CardTitle className="text-sm font-medium">
              Entregados{" "}
              {filterDate
                ? `(${format(parseISO(filterDate), "dd/MM")})`
                : "(Hoy)"}
            </CardTitle>
            <CheckCircle className="w-4 h-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {loading ? (
                <Loader2 className="w-6 h-6 animate-spin" />
              ) : (
                stats.delivered
              )}
            </div>
            <p className="text-xs text-muted-foreground">Misión cumplida</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Pedidos - Últimos 7 Días</CardTitle>
          </CardHeader>
          <CardContent className="pl-2">
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={revenueData}>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#888888"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}`}
                  />
                  <Tooltip
                    cursor={{ fill: "transparent" }}
                    contentStyle={{
                      borderRadius: "8px",
                      border: "none",
                      boxShadow: "0 4px 6px -1px rgb(0 0 0 / 0.1)",
                    }}
                  />
                  <Bar dataKey="total" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        <Card className="col-span-3">
          <CardHeader>
            <CardTitle>Distribución de Estados</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip />
                  <Legend verticalAlign="bottom" height={36} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
