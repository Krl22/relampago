import { useState, useEffect, useMemo } from "react";
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
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type Company = Database["public"]["Tables"]["companies"]["Row"];

const companySchema = z.object({
  name: z.string().min(2, "El nombre es requerido"),
  ruc: z.string().optional(),
  address: z.string().optional(),
  district: z.string().optional(),
  phone: z.string().optional(),
});

type CompanyFormValues = z.infer<typeof companySchema>;

type SortConfig = {
  key: string;
  direction: "asc" | "desc";
};

type FilterConfig = {
  name: string;
  ruc: string;
  phone: string;
  district: string;
  address: string;
  date: string;
};

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    company: Company | null;
  } | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowEdit, setRowEdit] = useState<{
    name: string;
    ruc: string | null;
    phone: string | null;
    district: string | null;
    address: string | null;
  } | null>(null);

  // Filtering and Sorting State
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "created_at",
    direction: "desc",
  });
  const [filters, setFilters] = useState<FilterConfig>({
    name: "",
    ruc: "",
    phone: "",
    district: "",
    address: "",
    date: "",
  });

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
  });

  useEffect(() => {
    fetchCompanies();
  }, []);

  useEffect(() => {
    if (editingCompany) {
      setValue("name", editingCompany.name);
      setValue("ruc", editingCompany.ruc || "");
      setValue("address", editingCompany.address || "");
      setValue("district", editingCompany.district || "");
      setValue("phone", editingCompany.phone || "");
    } else {
      reset({ name: "", ruc: "", address: "", district: "", phone: "" });
    }
  }, [editingCompany, setValue, reset]);

  const fetchCompanies = async () => {
    try {
      const { data, error } = await supabase
        .from("companies")
        .select("*")
        .order("created_at", { ascending: false });

      if (error) throw error;
      setCompanies(data || []);
    } catch (error) {
      console.error("Error fetching companies:", error);
    } finally {
      setLoading(false);
    }
  };

  const onSubmit = async (data: CompanyFormValues) => {
    try {
      if (editingCompany) {
        const { error } = await supabase
          .from("companies")
          .update(data)
          .eq("id", editingCompany.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("companies").insert(data);
        if (error) throw error;
      }

      setIsDialogOpen(false);
      setEditingCompany(null);
      fetchCompanies();
    } catch (error) {
      console.error("Error saving company:", error);
    }
  };

  const openNewDialog = () => {
    setEditingCompany(null);
    setIsDialogOpen(true);
  };



  const handleDelete = async (id: string) => {
    if (!window.confirm("¿Estás seguro de que deseas eliminar esta empresa?"))
      return;

    try {
      const { error } = await supabase.from("companies").delete().eq("id", id);

      if (error) throw error;

      setCompanies((prev) => prev.filter((c) => c.id !== id));
    } catch (error) {
      console.error("Error deleting company:", error);
      alert(
        "Error al eliminar la empresa. Verifica que no tenga pedidos asociados.",
      );
    }
  };

  const handleSort = (key: string) => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const filteredAndSortedCompanies = useMemo(() => {
    let result = [...companies];

    // Filtering
    result = result.filter((company) => {
      const matchName = company.name
        .toLowerCase()
        .includes(filters.name.toLowerCase());
      const matchRuc = (company.ruc || "").includes(filters.ruc);
      const matchPhone = (company.phone || "").includes(filters.phone);
      const matchDistrict = (company.district || "")
        .toLowerCase()
        .includes(filters.district.toLowerCase());
      const matchAddress = (company.address || "")
        .toLowerCase()
        .includes(filters.address.toLowerCase());

      const companyDate = format(new Date(company.created_at), "dd/MM/yyyy", {
        locale: es,
      });
      const matchDate =
        filters.date === "" || companyDate.includes(filters.date);

      return (
        matchName &&
        matchRuc &&
        matchPhone &&
        matchDistrict &&
        matchAddress &&
        matchDate
      );
    });

    // Sorting
    result.sort((a, b) => {
      let aValue: string | number = "";
      let bValue: string | number = "";

      switch (sortConfig.key) {
        case "name":
          aValue = a.name;
          bValue = b.name;
          break;
        case "ruc":
          aValue = a.ruc || "";
          bValue = b.ruc || "";
          break;
        case "phone":
          aValue = a.phone || "";
          bValue = b.phone || "";
          break;
        case "district":
          aValue = a.district || "";
          bValue = b.district || "";
          break;
        case "address":
          aValue = a.address || "";
          bValue = b.address || "";
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
  }, [companies, filters, sortConfig]);

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
        <h1 className="text-3xl font-bold">Gestión de Empresas</h1>
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 w-4 h-4" />
          Nueva Empresa
        </Button>
      </div>

      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Listado de Clientes</CardTitle>
            {editingRowId && rowEdit && (
              <div className="flex gap-2 items-center">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    setEditingRowId(null);
                    setRowEdit(null);
                  }}
                >
                  Cancelar
                </Button>
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!editingRowId || !rowEdit) return;
                    try {
                      const { error } = await supabase
                        .from("companies")
                        .update({
                          name: rowEdit.name,
                          ruc: rowEdit.ruc,
                          phone: rowEdit.phone,
                          district: rowEdit.district,
                          address: rowEdit.address,
                        })
                        .eq("id", editingRowId);
                      if (error) throw error;
                      setEditingRowId(null);
                      setRowEdit(null);
                      fetchCompanies();
                    } catch (err) {
                      console.error("Error saving company inline:", err);
                      alert("Error al guardar cambios.");
                    }
                  }}
                >
                  Guardar Cambios
                </Button>
              </div>
            )}
          </div>
          <p className="text-sm text-muted-foreground">
            Utiliza los filtros en la cabecera de la tabla para buscar empresas
            específicas.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-4 text-center">Cargando empresas...</div>
          ) : (
            <div className="overflow-x-auto rounded-md border">
              <Table className="min-w-[1000px]">
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("name")}
                    >
                      <div className="flex items-center">
                        Nombre <SortIcon columnKey="name" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("ruc")}
                    >
                      <div className="flex items-center">
                        RUC <SortIcon columnKey="ruc" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("phone")}
                    >
                      <div className="flex items-center">
                        Teléfono <SortIcon columnKey="phone" />
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
                      onClick={() => handleSort("address")}
                    >
                      <div className="flex items-center">
                        Dirección <SortIcon columnKey="address" />
                      </div>
                    </TableHead>
                    <TableHead
                      className="whitespace-nowrap cursor-pointer"
                      onClick={() => handleSort("created_at")}
                    >
                      <div className="flex items-center">
                        Fecha Registro <SortIcon columnKey="created_at" />
                      </div>
                    </TableHead>
                  </TableRow>
                  {/* Filter Row */}
                  <TableRow className="bg-muted/50 hover:bg-muted/50">
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Nombre..."
                        value={filters.name}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            name: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[120px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar RUC..."
                        value={filters.ruc}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            ruc: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[100px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Tel..."
                        value={filters.phone}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            phone: e.target.value,
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
                      <Input
                        placeholder="Filtrar Dirección..."
                        value={filters.address}
                        onChange={(e) =>
                          setFilters((prev) => ({
                            ...prev,
                            address: e.target.value,
                          }))
                        }
                        className="h-8 text-xs min-w-[150px]"
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
                  {filteredAndSortedCompanies.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={7}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No se encontraron empresas con los filtros
                        seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedCompanies.map((company) => (
                      <TableRow
                        key={company.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            company,
                          });
                        }}
                      >
                        <TableCell className="font-medium whitespace-nowrap">
                          {editingRowId === company.id && rowEdit ? (
                            <Input
                              value={rowEdit.name}
                              onChange={(e) =>
                                setRowEdit((prev) =>
                                  prev
                                    ? { ...prev, name: e.target.value }
                                    : prev,
                                )
                              }
                              className="h-8 text-xs"
                            />
                          ) : (
                            company.name
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {editingRowId === company.id && rowEdit ? (
                            <Input
                              value={rowEdit.ruc || ""}
                              onChange={(e) =>
                                setRowEdit((prev) =>
                                  prev
                                    ? { ...prev, ruc: e.target.value || null }
                                    : prev,
                                )
                              }
                              className="h-8 text-xs"
                            />
                          ) : (
                            company.ruc || "-"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {editingRowId === company.id && rowEdit ? (
                            <Input
                              value={rowEdit.phone || ""}
                              onChange={(e) =>
                                setRowEdit((prev) =>
                                  prev
                                    ? { ...prev, phone: e.target.value || null }
                                    : prev,
                                )
                              }
                              className="h-8 text-xs"
                            />
                          ) : (
                            company.phone || "-"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {editingRowId === company.id && rowEdit ? (
                            <Input
                              value={rowEdit.district || ""}
                              onChange={(e) =>
                                setRowEdit((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        district: e.target.value || null,
                                      }
                                    : prev,
                                )
                              }
                              className="h-8 text-xs"
                            />
                          ) : (
                            company.district || "-"
                          )}
                        </TableCell>
                        <TableCell
                          className="max-w-[200px] truncate"
                          title={company.address || ""}
                        >
                          {editingRowId === company.id && rowEdit ? (
                            <Input
                              value={rowEdit.address || ""}
                              onChange={(e) =>
                                setRowEdit((prev) =>
                                  prev
                                    ? {
                                        ...prev,
                                        address: e.target.value || null,
                                      }
                                    : prev,
                                )
                              }
                              className="h-8 text-xs"
                            />
                          ) : (
                            company.address || "-"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {format(new Date(company.created_at), "dd/MM/yyyy", {
                            locale: es,
                          })}
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

      {editingRowId && rowEdit && (
        <div className="flex gap-4 justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setEditingRowId(null);
              setRowEdit(null);
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={async () => {
              if (!editingRowId || !rowEdit) return;
              try {
                const { error } = await supabase
                  .from("companies")
                  .update({
                    name: rowEdit.name,
                    ruc: rowEdit.ruc,
                    phone: rowEdit.phone,
                    district: rowEdit.district,
                    address: rowEdit.address,
                  })
                  .eq("id", editingRowId);
                if (error) throw error;
                setEditingRowId(null);
                setRowEdit(null);
                fetchCompanies();
              } catch (err) {
                console.error("Error saving company inline:", err);
                alert("Error al guardar cambios.");
              }
            }}
          >
            Guardar Cambios
          </Button>
        </div>
      )}

      {contextMenu && contextMenu.company && (
        <div
          className="fixed inset-0 z-50"
          onClick={() => setContextMenu(null)}
          onContextMenu={(e) => {
            e.preventDefault();
            setContextMenu(null);
          }}
        >
          <div
            className="fixed z-50 min-w-[12rem] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: contextMenu.x, top: contextMenu.y }}
          >
            <div
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground"
              onClick={() => {
                setEditingRowId(contextMenu.company!.id);
                setRowEdit({
                  name: contextMenu.company!.name,
                  ruc: contextMenu.company!.ruc,
                  phone: contextMenu.company!.phone,
                  district: contextMenu.company!.district,
                  address: contextMenu.company!.address,
                });
                setContextMenu(null);
              }}
            >
              <Edit className="mr-2 w-4 h-4" /> Editar
            </div>
            <div className="-mx-1 my-1 h-px bg-muted" />
            <div
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-red-600"
              onClick={() => {
                handleDelete(contextMenu.company!.id);
                setContextMenu(null);
              }}
            >
              <Trash2 className="mr-2 w-4 h-4" /> Eliminar
            </div>
          </div>
        </div>
      )}

      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editingCompany ? "Editar Empresa" : "Nueva Empresa"}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nombre Comercial</Label>
              <Input
                id="name"
                {...register("name")}
                placeholder="Ej. Tienda Express"
              />
              {errors.name && (
                <span className="text-sm text-destructive">
                  {errors.name.message}
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ruc">RUC (Opcional)</Label>
                <Input id="ruc" {...register("ruc")} placeholder="20..." />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Teléfono</Label>
                <Input id="phone" {...register("phone")} placeholder="999..." />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="district">Distrito</Label>
                <Input
                  id="district"
                  {...register("district")}
                  placeholder="Ej. Miraflores"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="address">Dirección</Label>
                <Input
                  id="address"
                  {...register("address")}
                  placeholder="Ej. Av. Larco 123"
                />
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                )}
                {editingCompany ? "Guardar Cambios" : "Crear Empresa"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
