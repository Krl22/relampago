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
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "../components/ui/dialog";
import {
  Edit,
  Plus,
  Loader2,
  Trash2,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type StockItem = Database["public"]["Tables"]["stock"]["Row"] & {
  companies: { name: string } | null;
};

type Company = Database["public"]["Tables"]["companies"]["Row"];

const stockSchema = z.object({
  company_id: z.string().min(1, "Selecciona una empresa"),
  product_name: z.string().min(2, "El nombre del producto es requerido"),
  quantity: z.coerce.number().min(0, "La cantidad debe ser mayor o igual a 0"),
  unit: z.string().optional(),
});

type StockFormValues = z.infer<typeof stockSchema>;

type SortConfig = {
  key: string;
  direction: "asc" | "desc";
};

type FilterConfig = {
  company: string;
  product_name: string;
  quantity: string;
  unit: string;
  date: string;
};

export default function Stock() {
  const [stock, setStock] = useState<StockItem[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<StockItem | null>(null);

  // Filtering and Sorting State
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "created_at",
    direction: "desc",
  });
  const [filters, setFilters] = useState<FilterConfig>({
    company: "",
    product_name: "",
    quantity: "",
    unit: "",
    date: "",
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<StockFormValues>({
    resolver: zodResolver(stockSchema) as any,
  });

  useEffect(() => {
    fetchStock();
    fetchCompanies();
  }, []);

  useEffect(() => {
    if (editingItem) {
      setValue("company_id", editingItem.company_id);
      setValue("product_name", editingItem.product_name);
      setValue("quantity", editingItem.quantity);
      setValue("unit", editingItem.unit || "");
    } else {
      reset({ company_id: "", product_name: "", quantity: 0, unit: "" });
    }
  }, [editingItem, setValue, reset]);

  const fetchStock = async () => {
    try {
      const { data, error } = await supabase
        .from("stock")
        .select(
          `
          *,
          companies (name)
        `,
        )
        .order("created_at", { ascending: false });

      if (error) throw error;
      // @ts-ignore
      setStock(data || []);
    } catch (error) {
      console.error("Error fetching stock:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchCompanies = async () => {
    const { data } = await supabase.from("companies").select("*").order("name");
    if (data) setCompanies(data);
  };

  const onSubmit = async (data: StockFormValues) => {
    try {
      if (editingItem) {
        const { error } = await supabase
          .from("stock")
          .update(data)
          .eq("id", editingItem.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("stock").insert(data);
        if (error) throw error;
      }

      setIsDialogOpen(false);
      setEditingItem(null);
      fetchStock();
    } catch (error) {
      console.error("Error saving stock:", error);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm("¿Estás seguro de eliminar este producto?")) return;

    try {
      const { error } = await supabase.from("stock").delete().eq("id", id);
      if (error) throw error;
      fetchStock();
    } catch (error) {
      console.error("Error deleting stock:", error);
    }
  };

  const openNewDialog = () => {
    setEditingItem(null);
    setIsDialogOpen(true);
  };

  const openEditDialog = (item: StockItem) => {
    setEditingItem(item);
    setIsDialogOpen(true);
  };

  const handleSort = (key: string) => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const filteredAndSortedStock = useMemo(() => {
    let result = [...stock];

    // Filtering
    result = result.filter((item) => {
      const matchCompany = (item.companies?.name || "")
        .toLowerCase()
        .includes(filters.company.toLowerCase());
      const matchProduct = item.product_name
        .toLowerCase()
        .includes(filters.product_name.toLowerCase());
      const matchQuantity =
        filters.quantity === "" ||
        item.quantity.toString().includes(filters.quantity);
      const matchUnit = (item.unit || "")
        .toLowerCase()
        .includes(filters.unit.toLowerCase());

      const itemDate = format(new Date(item.created_at), "dd/MM/yyyy", {
        locale: es,
      });
      const matchDate = filters.date === "" || itemDate.includes(filters.date);

      return (
        matchCompany && matchProduct && matchQuantity && matchUnit && matchDate
      );
    });

    // Sorting
    result.sort((a, b) => {
      let aValue: any = "";
      let bValue: any = "";

      switch (sortConfig.key) {
        case "company":
          aValue = a.companies?.name || "";
          bValue = b.companies?.name || "";
          break;
        case "product_name":
          aValue = a.product_name;
          bValue = b.product_name;
          break;
        case "quantity":
          aValue = a.quantity;
          bValue = b.quantity;
          break;
        case "unit":
          aValue = a.unit || "";
          bValue = b.unit || "";
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
  }, [stock, filters, sortConfig]);

  const SortIcon = ({ columnKey }: { columnKey: string }) => {
    if (sortConfig.key !== columnKey)
      return <ArrowUpDown className="ml-2 w-4 h-4 text-muted-foreground/50" />;
    return sortConfig.direction === "asc" ? (
      <ArrowUp className="ml-2 w-4 h-4" />
    ) : (
      <ArrowDown className="ml-2 w-4 h-4" />
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Inventario Global</h1>
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 w-4 h-4" />
          Nuevo Producto
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Listado de Productos</CardTitle>
          <p className="text-sm text-muted-foreground">
            Utiliza los filtros en la cabecera de la tabla para buscar productos
            específicos.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-4 text-center">Cargando inventario...</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[800px]">
                <TableHeader>
                  <TableRow>
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
                      onClick={() => handleSort("product_name")}
                    >
                      <div className="flex items-center">
                        Producto <SortIcon columnKey="product_name" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("quantity")}
                    >
                      <div className="flex items-center">
                        Cantidad <SortIcon columnKey="quantity" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("unit")}
                    >
                      <div className="flex items-center">
                        Unidad <SortIcon columnKey="unit" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("created_at")}
                    >
                      <div className="flex items-center">
                        Última Actualización <SortIcon columnKey="created_at" />
                      </div>
                    </TableHead>
                    <TableHead className="text-right whitespace-nowrap">
                      Acciones
                    </TableHead>
                  </TableRow>
                  {/* Filter Row */}
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
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
                        className="h-8 text-xs min-w-[120px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Producto..."
                        value={filters.product_name}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            product_name: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[120px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Cant..."
                        value={filters.quantity}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            quantity: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[60px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Unidad..."
                        value={filters.unit}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            unit: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[80px]"
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
                    <TableCell className="p-2"></TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedStock.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={6}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No se encontraron productos con los filtros
                        seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedStock.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell className="font-medium text-blue-600 whitespace-nowrap">
                          {item.companies?.name || "Sin asignar"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.product_name}
                        </TableCell>
                        <TableCell className="font-bold whitespace-nowrap">
                          {item.quantity}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {item.unit || "-"}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(item.created_at), "dd/MM/yyyy", {
                            locale: es,
                          })}
                        </TableCell>
                        <TableCell className="space-x-2 text-right whitespace-nowrap">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEditDialog(item)}
                          >
                            <Edit className="w-4 h-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="text-red-500 hover:text-red-600"
                            onClick={() => handleDelete(item.id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingItem ? "Editar Producto" : "Nuevo Producto"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="company_id">Empresa</Label>
              <select
                id="company_id"
                {...register("company_id")}
                className="flex justify-between items-center px-3 py-2 w-full h-10 text-sm rounded-md border border-input bg-background ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                disabled={!!editingItem}
              >
                <option value="">Seleccionar empresa...</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              {errors.company_id && (
                <span className="text-sm text-destructive">
                  {errors.company_id.message}
                </span>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="product_name">Nombre del Producto</Label>
              <Input
                id="product_name"
                {...register("product_name")}
                placeholder="Ej. Zapatillas Nike Talla 42"
              />
              {errors.product_name && (
                <span className="text-sm text-destructive">
                  {errors.product_name.message}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="quantity">Cantidad</Label>
                <Input id="quantity" type="number" {...register("quantity")} />
                {errors.quantity && (
                  <span className="text-sm text-destructive">
                    {errors.quantity.message}
                  </span>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="unit">Unidad (Opcional)</Label>
                <Input
                  id="unit"
                  {...register("unit")}
                  placeholder="Ej. cajas, unidades"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                )}
                {editingItem ? "Guardar Cambios" : "Agregar Stock"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
