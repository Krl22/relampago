import { useEffect, useState, useMemo } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { supabase } from "../lib/supabase";
import type { Database } from "../types/database";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../components/ui/table";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Button } from "../components/ui/button";
import { Checkbox } from "../components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import {
  Edit,
  Loader2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Settings,
  Trash2,
  CheckSquare,
  Camera,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type Order = Database["public"]["Tables"]["orders"]["Row"] & {
  companies: { name: string } | null;
  assigned_courier_profile: { full_name: string | null } | null;
  deliveries: { proof_image_url: string | null }[];
};

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

const orderSchema = z.object({
  assigned_courier: z.string().nullable(),
  status: z.enum(["pending", "in_transit", "delivered"]),
  payment_method: z.string().optional(),
  tariff: z.string().optional(),
  total_amount: z.coerce.number().min(0).optional(),
  delivery_notes: z.string().optional(),
});

type OrderFormValues = z.infer<typeof orderSchema>;

type SortConfig = {
  key: string;
  direction: "asc" | "desc";
};

type FilterConfig = {
  id: string;
  company: string;
  recipient: string;
  address: string;
  district: string;
  status: string;
  courier: string;
  tariff: string;
  payment_method: string;
  total_amount: string;
  delivery_notes: string;
  date: string;
};

export default function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [couriers, setCouriers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);

  // Bulk Actions State
  const [selectedOrders, setSelectedOrders] = useState<string[]>([]);
  const [isSelectionMode, setIsSelectionMode] = useState(false);
  const [isBulkDialogOpen, setIsBulkDialogOpen] = useState(false);
  const [bulkCourier, setBulkCourier] = useState<string>("");
  const [isBulkSubmitting, setIsBulkSubmitting] = useState(false);

  // Filtering and Sorting State
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "created_at",
    direction: "desc",
  });
  const [filters, setFilters] = useState<FilterConfig>({
    id: "",
    company: "",
    recipient: "",
    address: "",
    district: "",
    status: "all",
    courier: "",
    tariff: "",
    payment_method: "",
    total_amount: "",
    delivery_notes: "",
    date: "",
  });

  const {
    register,
    handleSubmit,
    setValue,
    formState: { isSubmitting },
  } = useForm<OrderFormValues>({
    resolver: zodResolver(orderSchema) as any,
  });

  useEffect(() => {
    fetchOrders();
    fetchCouriers();
  }, []);

  useEffect(() => {
    if (editingOrder) {
      setValue("assigned_courier", editingOrder.assigned_courier || "");
      setValue("status", editingOrder.status);
      setValue("payment_method", editingOrder.payment_method || "");
      setValue("tariff", editingOrder.tariff || "");
      setValue("total_amount", editingOrder.total_amount || 0);
      setValue("delivery_notes", editingOrder.delivery_notes || "");
      setUpdateError(null);
    }
  }, [editingOrder, setValue]);

  const fetchCouriers = async () => {
    const { data } = await supabase
      .from("profiles")
      .select("*")
      .eq("role", "courier");
    if (data) setCouriers(data);
  };

  const fetchOrders = async () => {
    try {
      const { data, error } = await supabase
        .from("orders")
        .select(
          `
          *,
          companies (name),
          assigned_courier_profile:profiles!assigned_courier (full_name),
          deliveries (proof_image_url)
        `,
        )
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching orders:", error);
      } else {
        setOrders(data || []);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
    } finally {
      setLoading(false);
    }
  };

  const onUpdateOrder = async (data: OrderFormValues) => {
    if (!editingOrder) return;
    setUpdateError(null);

    console.log("Attempting to update order:", editingOrder.id);
    console.log("Update data:", data);

    try {
      const { data: updatedData, error } = await supabase
        .from("orders")
        .update({
          assigned_courier: data.assigned_courier || null,
          status: data.status,
          payment_method: data.payment_method || null,
          tariff: data.tariff || null,
          total_amount: data.total_amount ?? null,
          delivery_notes: data.delivery_notes || null,
        })
        .eq("id", editingOrder.id)
        .select();

      if (error) {
        console.error("Supabase update error:", error);
        throw error;
      }

      console.log("Update result data:", updatedData);

      if (!updatedData || updatedData.length === 0) {
        console.warn(
          "No rows updated. Check RLS policies or if the record exists.",
        );
        throw new Error(
          "No se actualizó ningún registro. Verifica permisos o si el pedido existe.",
        );
      }

      setIsDialogOpen(false);
      setEditingOrder(null);
      fetchOrders();
    } catch (error) {
      console.error("Error updating order:", error);
      setUpdateError(
        (error as Error).message ||
          "Error al guardar los cambios. Inténtalo de nuevo.",
      );
    }
  };

  const openEditDialog = (order: Order) => {
    setEditingOrder(order);
    setIsDialogOpen(true);
  };

  const handleDeleteOrder = async (id: string) => {
    if (!window.confirm("¿Estás seguro de que deseas eliminar este pedido?"))
      return;

    try {
      const { error } = await supabase.from("orders").delete().eq("id", id);

      if (error) throw error;

      setOrders((prev) => prev.filter((o) => o.id !== id));
      if (selectedOrders.includes(id)) {
        setSelectedOrders((prev) => prev.filter((oId) => oId !== id));
      }
    } catch (error) {
      console.error("Error deleting order:", error);
      alert("Error al eliminar el pedido.");
    }
  };

  const handleSort = (key: string) => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const filteredAndSortedOrders = useMemo(() => {
    let result = [...orders];

    // Filtering
    result = result.filter((order) => {
      const matchCompany = (order.companies?.name || "")
        .toLowerCase()
        .includes(filters.company.toLowerCase());
      const matchRecipient = order.recipient_name
        .toLowerCase()
        .includes(filters.recipient.toLowerCase());
      const matchAddress = order.destination_address
        .toLowerCase()
        .includes(filters.address.toLowerCase());
      const matchDistrict = (order.destination_district || "")
        .toLowerCase()
        .includes(filters.district.toLowerCase());
      const matchStatus =
        filters.status === "all" || order.status === filters.status;
      const matchCourier = (order.assigned_courier_profile?.full_name || "")
        .toLowerCase()
        .includes(filters.courier.toLowerCase());
      const matchTariff = (order.tariff || "")
        .toLowerCase()
        .includes(filters.tariff.toLowerCase());
      const matchPaymentMethod = (order.payment_method || "")
        .toLowerCase()
        .includes(filters.payment_method.toLowerCase());
      const matchTotalAmount =
        filters.total_amount === "" ||
        (order.total_amount?.toString() || "").includes(filters.total_amount);
      const matchDeliveryNotes = (order.delivery_notes || "")
        .toLowerCase()
        .includes(filters.delivery_notes.toLowerCase());

      const orderDate = format(new Date(order.created_at), "dd/MM/yyyy", {
        locale: es,
      });
      const matchDate = filters.date === "" || orderDate.includes(filters.date);

      return (
        matchCompany &&
        matchRecipient &&
        matchAddress &&
        matchDistrict &&
        matchStatus &&
        matchCourier &&
        matchTariff &&
        matchDate &&
        matchPaymentMethod &&
        matchTotalAmount &&
        matchDeliveryNotes
      );
    });

    // Sorting
    result.sort((a, b) => {
      let aValue: string | number = "";
      let bValue: string | number = "";

      switch (sortConfig.key) {
        case "company":
          aValue = a.companies?.name || "";
          bValue = b.companies?.name || "";
          break;
        case "recipient":
          aValue = a.recipient_name;
          bValue = b.recipient_name;
          break;
        case "address":
          aValue = a.destination_address;
          bValue = b.destination_address;
          break;
        case "district":
          aValue = a.destination_district || "";
          bValue = b.destination_district || "";
          break;
        case "status":
          aValue = a.status;
          bValue = b.status;
          break;
        case "courier":
          aValue = a.assigned_courier_profile?.full_name || "";
          bValue = b.assigned_courier_profile?.full_name || "";
          break;
        case "tariff":
          aValue = a.tariff || "";
          bValue = b.tariff || "";
          break;
        case "payment_method":
          aValue = a.payment_method || "";
          bValue = b.payment_method || "";
          break;
        case "total_amount":
          aValue = a.total_amount || 0;
          bValue = b.total_amount || 0;
          break;
        case "delivery_notes":
          aValue = a.delivery_notes || "";
          bValue = b.delivery_notes || "";
          break;
        case "created_at":
          aValue = new Date(a.created_at).getTime();
          bValue = new Date(b.created_at).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [orders, filters, sortConfig]);

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey)
      return <ArrowUpDown className="ml-2 w-4 h-4 text-muted-foreground/50" />;
    return sortConfig.direction === "asc" ? (
      <ArrowUp className="ml-2 w-4 h-4" />
    ) : (
      <ArrowDown className="ml-2 w-4 h-4" />
    );
  };

  const toggleSelectAll = (checked: boolean) => {
    if (checked) {
      setSelectedOrders(filteredAndSortedOrders.map((o) => o.id));
    } else {
      setSelectedOrders([]);
    }
  };

  const toggleSelectOrder = (orderId: string, checked: boolean) => {
    if (checked) {
      setSelectedOrders((prev) => [...prev, orderId]);
    } else {
      setSelectedOrders((prev) => prev.filter((id) => id !== orderId));
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkCourier || selectedOrders.length === 0) return;
    setIsBulkSubmitting(true);
    try {
      const { error } = await supabase
        .from("orders")
        .update({
          assigned_courier: bulkCourier,
        })
        .in("id", selectedOrders);

      if (error) throw error;

      setSelectedOrders([]);
      setIsBulkDialogOpen(false);
      setBulkCourier("");
      fetchOrders();
    } catch (error) {
      console.error("Error assigning orders:", error);
      alert("Error al asignar motorizado. Inténtalo de nuevo.");
    } finally {
      setIsBulkSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Pedidos</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gestión de Pedidos</CardTitle>
          <p className="text-sm text-muted-foreground">
            Utiliza los filtros en la cabecera de la tabla para buscar pedidos
            específicos.
          </p>
        </CardHeader>
        <CardContent>
          {selectedOrders.length > 0 && (
            <div className="flex gap-4 items-center p-2 mb-4 rounded-lg border bg-muted/40">
              <span className="text-sm font-medium">
                {selectedOrders.length} seleccionados
              </span>
              <Button size="sm" onClick={() => setIsBulkDialogOpen(true)}>
                Asignar Motorizado
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectedOrders([]);
                  setIsSelectionMode(false);
                }}
                className="ml-auto text-muted-foreground hover:text-foreground"
              >
                Cancelar
              </Button>
            </div>
          )}
          {loading ? (
            <div className="py-4 text-center">Cargando pedidos...</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[1200px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[50px] text-center">
                      <Settings className="mx-auto w-4 h-4" />
                    </TableHead>
                    {isSelectionMode && (
                      <TableHead className="w-[40px] px-4">
                        <Checkbox
                          checked={
                            filteredAndSortedOrders.length > 0 &&
                            selectedOrders.length ===
                              filteredAndSortedOrders.length
                          }
                          onCheckedChange={(checked) =>
                            toggleSelectAll(!!checked)
                          }
                          aria-label="Select all"
                        />
                      </TableHead>
                    )}
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("company")}
                    >
                      <div className="flex items-center">
                        Empresa <SortIcon columnKey="company" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("recipient")}
                    >
                      <div className="flex items-center">
                        Destinatario <SortIcon columnKey="recipient" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("address")}
                    >
                      <div className="flex items-center">
                        Dirección <SortIcon columnKey="address" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("district")}
                    >
                      <div className="flex items-center">
                        Distrito <SortIcon columnKey="district" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("status")}
                    >
                      <div className="flex items-center">
                        Estado <SortIcon columnKey="status" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("courier")}
                    >
                      <div className="flex items-center">
                        Motorizado <SortIcon columnKey="courier" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("tariff")}
                    >
                      <div className="flex items-center">
                        Tarifa <SortIcon columnKey="tariff" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("total_amount")}
                    >
                      <div className="flex items-center">
                        Monto Total <SortIcon columnKey="total_amount" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("payment_method")}
                    >
                      <div className="flex items-center">
                        Método Pago <SortIcon columnKey="payment_method" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("delivery_notes")}
                    >
                      <div className="flex items-center">
                        Notas Logística <SortIcon columnKey="delivery_notes" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("created_at")}
                    >
                      <div className="flex items-center">
                        Fecha <SortIcon columnKey="created_at" />
                      </div>
                    </TableHead>
                  </TableRow>
                  {/* Filter Row */}
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell className="p-2 w-[50px]"></TableCell>
                    {isSelectionMode && (
                      <TableCell className="p-2 w-[40px]"></TableCell>
                    )}
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Empresa..."
                        value={filters.company}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            company: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Destinatario..."
                        value={filters.recipient}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            recipient: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Dirección..."
                        value={filters.address}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            address: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Distrito..."
                        value={filters.district}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            district: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <select
                        className="flex h-8 w-full items-center justify-between rounded-md border border-input bg-background px-2 py-1 text-xs min-w-[100px]"
                        value={filters.status}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            status: e.target.value,
                          }))
                        }
                      >
                        <option value="all">Todos</option>
                        <option value="pending">Pendiente</option>
                        <option value="in_transit">En Ruta</option>
                        <option value="delivered">Entregado</option>
                      </select>
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Motorizado..."
                        value={filters.courier}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            courier: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Tarifa..."
                        value={filters.tariff}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            tariff: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[80px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Monto..."
                        value={filters.total_amount}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            total_amount: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[80px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Método..."
                        value={filters.payment_method}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            payment_method: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Notas..."
                        value={filters.delivery_notes}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            delivery_notes: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[120px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="dd/mm/yyyy"
                        value={filters.date}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            date: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedOrders.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={12}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No se encontraron pedidos con los filtros seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedOrders.map((order) => (
                      <TableRow key={order.id}>
                        <TableCell className="w-[50px] text-center">
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="w-8 h-8"
                              >
                                <Settings className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                              <DropdownMenuLabel>Acciones</DropdownMenuLabel>
                              <DropdownMenuItem
                                onClick={() => openEditDialog(order)}
                              >
                                <Edit className="mr-2 w-4 h-4" /> Editar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                onClick={() => {
                                  setIsSelectionMode(true);
                                  setSelectedOrders([order.id]);
                                }}
                              >
                                <CheckSquare className="mr-2 w-4 h-4" />{" "}
                                Seleccionar
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={
                                  !order.deliveries ||
                                  order.deliveries.length === 0 ||
                                  !order.deliveries[0].proof_image_url
                                }
                                onClick={() =>
                                  setPreviewImage(
                                    order.deliveries[0].proof_image_url!,
                                  )
                                }
                              >
                                <Camera className="mr-2 w-4 h-4" /> Foto
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() => handleDeleteOrder(order.id)}
                                className="text-red-600"
                              >
                                <Trash2 className="mr-2 w-4 h-4" /> Eliminar
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                        {isSelectionMode && (
                          <TableCell className="px-4 w-[40px]">
                            <Checkbox
                              checked={selectedOrders.includes(order.id)}
                              onCheckedChange={(checked) =>
                                toggleSelectOrder(order.id, !!checked)
                              }
                              aria-label={`Select order ${order.id}`}
                            />
                          </TableCell>
                        )}
                        <TableCell className="whitespace-nowrap">
                          {order.companies?.name || "N/A"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {order.recipient_name}
                        </TableCell>
                        <TableCell
                          className="max-w-[200px] truncate"
                          title={order.destination_address}
                        >
                          {order.destination_address}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {order.destination_district || "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${
                              order.status === "delivered"
                                ? "bg-green-100 text-green-800"
                                : order.status === "in_transit"
                                  ? "bg-blue-100 text-blue-800"
                                  : "bg-yellow-100 text-yellow-800"
                            }`}
                          >
                            {order.status === "delivered"
                              ? "Entregado"
                              : order.status === "in_transit"
                                ? "En Ruta"
                                : "Pendiente"}
                          </span>
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {order.assigned_courier_profile?.full_name ||
                            "Sin asignar"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {order.tariff || "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {order.total_amount
                            ? `S/ ${order.total_amount.toFixed(2)}`
                            : "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {order.payment_method || "-"}
                        </TableCell>
                        <TableCell
                          className="max-w-[200px] truncate"
                          title={order.delivery_notes || ""}
                        >
                          {order.delivery_notes || "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {format(
                            new Date(order.created_at),
                            "dd/MM/yyyy HH:mm",
                            { locale: es },
                          )}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              Gestionar Pedido #{editingOrder?.id.slice(0, 8)}
            </DialogTitle>
          </DialogHeader>

          {updateError && (
            <div className="p-3 text-sm text-red-600 bg-red-50 rounded-md border border-red-200">
              {updateError}
            </div>
          )}

          <form
            onSubmit={handleSubmit(onUpdateOrder, (errors) =>
              console.error("Form validation errors:", errors),
            )}
            className="space-y-6"
          >
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="assigned_courier">Asignar Motorizado</Label>
                <select
                  id="assigned_courier"
                  {...register("assigned_courier")}
                  className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Sin asignar</option>
                  {couriers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Estado del Pedido</Label>
                <select
                  id="status"
                  {...register("status")}
                  className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="pending">Pendiente</option>
                  <option value="in_transit">En Ruta</option>
                  <option value="delivered">Entregado</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="tariff">Tarifa</Label>
                <select
                  id="tariff"
                  {...register("tariff")}
                  className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Seleccionar...</option>
                  <option value="T1">Tarifa 1 (T1)</option>
                  <option value="T2">Tarifa 2 (T2)</option>
                  <option value="T3">Tarifa 3 (T3)</option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="total_amount">Monto Total (Servicio)</Label>
                <Input
                  id="total_amount"
                  type="number"
                  step="0.01"
                  {...register("total_amount")}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="payment_method">Método de Pago</Label>
                <select
                  id="payment_method"
                  {...register("payment_method")}
                  className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="">Seleccionar...</option>
                  <option value="Motorizado">Motorizado</option>
                  <option value="Directo a comercio">Directo a comercio</option>
                  <option value="Relampago Courier">Relampago Courier</option>
                </select>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="delivery_notes">Notas de Logística</Label>
              <Textarea
                id="delivery_notes"
                {...register("delivery_notes")}
                placeholder="Instrucciones internas, observaciones de entrega..."
              />
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                )}
                Guardar Cambios
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Bulk Assignment Dialog */}
      <Dialog open={isBulkDialogOpen} onOpenChange={setIsBulkDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>
              Asignar Motorizado a {selectedOrders.length} Pedidos
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="bulk-courier">Seleccionar Motorizado</Label>
              <select
                id="bulk-courier"
                className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                value={bulkCourier}
                onChange={(e) => setBulkCourier(e.target.value)}
              >
                <option value="">Seleccionar...</option>
                {couriers.map((courier) => (
                  <option key={courier.id} value={courier.id}>
                    {courier.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              onClick={() => setIsBulkDialogOpen(false)}
            >
              Cancelar
            </Button>
            <Button
              onClick={handleBulkAssign}
              disabled={!bulkCourier || isBulkSubmitting}
            >
              {isBulkSubmitting && (
                <Loader2 className="mr-2 w-4 h-4 animate-spin" />
              )}
              Asignar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Image Preview Dialog */}
      <Dialog open={!!previewImage} onOpenChange={() => setPreviewImage(null)}>
        <DialogContent className="overflow-hidden p-0 max-w-2xl bg-transparent border-0 shadow-none">
          {previewImage && (
            <div className="relative">
              <img
                src={previewImage}
                alt="Prueba de entrega"
                className="w-full h-auto rounded-lg shadow-2xl"
              />
              <Button
                className="absolute top-2 right-2 p-2 w-8 h-8 text-white rounded-full bg-black/50 hover:bg-black/70"
                onClick={() => setPreviewImage(null)}
              >
                ×
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
