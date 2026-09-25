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
  MapPin,
  KeyRound,
} from "lucide-react";
import { CompanyAddressesDialog } from "../components/CompanyAddressesDialog";
import { CompanyAccessDialog } from "../components/CompanyAccessDialog";
import { DistrictSelect } from "../components/DistrictSelect";
import { Checkbox } from "../components/ui/checkbox";
import { format } from "date-fns";
import { es } from "date-fns/locale";

type Company = Database["public"]["Tables"]["companies"]["Row"];

const companySchema = z.object({
  name: z.string().min(2, "El nombre es requerido"),
  ruc: z.string().optional(),
  address: z.string().optional(),
  district: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().trim().email("Correo inválido").or(z.literal("")).optional(),
  contact_name: z.string().optional(),
  yape_number: z.string().optional(),
  yape_holder: z.string().optional(),
  invoice_igv: z.boolean().optional(),
  t1_rate: z.string().optional(),
  skip_cutoff: z.boolean().optional(),
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
  yape: string;
  portal: "" | "none" | "none_active" | "has";
};

type Activity = { accounts: number; orders_30d: number; last_order_at: string | null };

export default function Companies() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingCompany, setEditingCompany] = useState<Company | null>(null);
  const [addressesFor, setAddressesFor] = useState<Company | null>(null);
  const [accessFor, setAccessFor] = useState<Company | null>(null);
  const [accessPrefill, setAccessPrefill] = useState<{ email: string | null; fullName: string | null } | null>(null);
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
    yape_number: string | null;
    yape_holder: string | null;
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
    yape: "",
    portal: "",
  });
  // Cuentas en el portal y pedidos de los últimos 30 días por comercio
  const [activity, setActivity] = useState<Map<string, Activity>>(new Map());
  const loadActivity = async () => {
    const { data, error } = await supabase.rpc("company_activity");
    if (error) console.error("Error cargando actividad:", error);
    setActivity(new Map((data ?? []).map((r) => [r.company_id, r])));
  };

  const {
    register,
    handleSubmit,
    reset,
    setValue,
    formState: { errors, isSubmitting },
    watch,
  } = useForm<CompanyFormValues>({
    resolver: zodResolver(companySchema),
  });
  const invoiceIgv = watch("invoice_igv");
  const skipCutoff = watch("skip_cutoff");

  useEffect(() => {
    fetchCompanies();
    void loadActivity();
  }, []);

  useEffect(() => {
    if (editingCompany) {
      setValue("name", editingCompany.name);
      setValue("ruc", editingCompany.ruc || "");
      setValue("address", editingCompany.address || "");
      setValue("district", editingCompany.district || "");
      setValue("phone", editingCompany.phone || "");
      setValue("email", editingCompany.email || "");
      setValue("contact_name", editingCompany.contact_name || "");
      setValue("yape_number", editingCompany.yape_number || "");
      setValue("yape_holder", editingCompany.yape_holder || "");
      setValue("invoice_igv", editingCompany.invoice_igv);
      setValue("t1_rate", editingCompany.t1_rate != null ? String(editingCompany.t1_rate) : "");
      setValue("skip_cutoff", editingCompany.skip_cutoff);
    } else {
      reset({ name: "", ruc: "", address: "", district: "", phone: "", email: "", contact_name: "", yape_number: "", yape_holder: "", invoice_igv: false, t1_rate: "", skip_cutoff: false });
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

  const onSubmit = async (values: CompanyFormValues) => {
    const data = {
      ...values,
      email: values.email || null,
      district: values.district || null,
      contact_name: values.contact_name || null,
      yape_number: values.yape_number || null,
      yape_holder: values.yape_holder || null,
      invoice_igv: !!values.invoice_igv,
      skip_cutoff: !!values.skip_cutoff,
      t1_rate: values.t1_rate && Number.isFinite(Number(values.t1_rate)) ? Number(values.t1_rate) : null,
    };
    try {
      if (editingCompany) {
        const { error } = await supabase
          .from("companies")
          .update(data)
          .eq("id", editingCompany.id);
        if (error) throw error;
      } else {
        const { data: created, error } = await supabase.from("companies").insert(data).select().single();
        if (error) throw error;
        // Comercio nuevo (alta por teléfono): siguiente paso, crearle su cuenta del portal
        setAccessPrefill({ email: created.email, fullName: created.contact_name });
        setAccessFor(created);
      }

      setIsDialogOpen(false);
      setEditingCompany(null);
      fetchCompanies();
    } catch (error) {
      console.error("Error saving company:", error);
      alert("No se pudo guardar el comercio: " + ((error as { message?: string }).message ?? String(error)));
    }
  };

  const openNewDialog = () => {
    setEditingCompany(null);
    setIsDialogOpen(true);
  };



  // Eliminar con confirmación propia: muestra cuántos pedidos/direcciones tiene antes de borrar.
  const [deleteTarget, setDeleteTarget] = useState<Company | null>(null);
  const [deleteInfo, setDeleteInfo] = useState<{ orders: number; addresses: number } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (id: string) => {
    const company = companies.find((c) => c.id === id);
    if (!company) return;
    setDeleteTarget(company);
    setDeleteInfo(null);
    const [o, a] = await Promise.all([
      supabase.from("orders").select("id", { count: "exact", head: true }).eq("company_id", id),
      supabase.from("company_addresses").select("id", { count: "exact", head: true }).eq("company_id", id),
    ]);
    setDeleteInfo({ orders: o.count ?? 0, addresses: a.count ?? 0 });
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    const { data, error } = await supabase.from("companies").delete().eq("id", deleteTarget.id).select("id");
    setDeleting(false);
    if (error || !data || data.length === 0) {
      alert("No se pudo eliminar: " + (error?.message ?? "sin permiso"));
      return;
    }
    setCompanies((prev) => prev.filter((c) => c.id !== deleteTarget.id));
    setDeleteTarget(null);
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

      const companyDate = format(new Date(company.created_at ?? 0), "dd/MM/yyyy", {
        locale: es,
      });
      const matchDate =
        filters.date === "" || companyDate.includes(filters.date);
      const matchYape =
        filters.yape === "" ||
        `${company.yape_number ?? ""} ${company.yape_holder ?? ""}`.toLowerCase().includes(filters.yape.toLowerCase());

      const act = activity.get(company.id);
      const matchPortal =
        filters.portal === "" ||
        (filters.portal === "has" && (act?.accounts ?? 0) > 0) ||
        (filters.portal === "none" && (act?.accounts ?? 0) === 0) ||
        (filters.portal === "none_active" && (act?.accounts ?? 0) === 0 && (act?.orders_30d ?? 0) > 0);

      return (
        matchPortal &&
        matchName &&
        matchRuc &&
        matchPhone &&
        matchDistrict &&
        matchAddress &&
        matchDate &&
        matchYape
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
          aValue = new Date(a.created_at ?? 0).getTime();
          bValue = new Date(b.created_at ?? 0).getTime();
          break;
        case "portal":
          aValue = activity.get(a.id)?.orders_30d ?? 0;
          bValue = activity.get(b.id)?.orders_30d ?? 0;
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [companies, filters, sortConfig, activity]);

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
        <h1 className="text-3xl font-bold">Comercios</h1>
        <Button onClick={openNewDialog}>
          <Plus className="mr-2 w-4 h-4" />
          Nuevo comercio
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
                          yape_number: rowEdit.yape_number || null,
                          yape_holder: rowEdit.yape_holder || null,
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
            Utiliza los filtros en la cabecera de la tabla para buscar comercios
            específicas.
          </p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-4 text-center">Cargando comercios...</div>
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
                    <TableHead className="whitespace-nowrap">Yape</TableHead>
                    <TableHead className="whitespace-nowrap cursor-pointer" onClick={() => handleSort("portal")} title="Cuentas en el portal · pedidos de los últimos 30 días">
                      <div className="flex items-center">
                        Portal <SortIcon columnKey="portal" />
                      </div>
                    </TableHead>
                    <TableHead className="whitespace-nowrap">Acciones</TableHead>
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
                    <TableCell className="p-2">
                      <Input
                        placeholder="Filtrar Yape..."
                        value={filters.yape}
                        onChange={(e) => setFilters((prev) => ({ ...prev, yape: e.target.value }))}
                        className="h-8 text-xs min-w-[120px]"
                      />
                    </TableCell>
                    <TableCell className="p-2">
                      <select
                        value={filters.portal}
                        onChange={(e) => setFilters((prev) => ({ ...prev, portal: e.target.value as FilterConfig["portal"] }))}
                        className="h-8 min-w-[150px] rounded-md border bg-background px-1 text-xs"
                      >
                        <option value="">Todos</option>
                        <option value="none_active">Sin cuenta y pidiendo</option>
                        <option value="none">Sin cuenta</option>
                        <option value="has">Con cuenta</option>
                      </select>
                    </TableCell>
                    <TableCell className="p-2"></TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedCompanies.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={10}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No se encontraron comercios con los filtros
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
                            <>
                              {company.name}
                              {company.skip_cutoff && (
                                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-amber-800" title="Sin horario de corte: sus pedidos entran para el mismo día">
                                  Prioritario
                                </span>
                              )}
                              {company.registered_by && (
                                <span
                                  className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-800"
                                  title="Se registró solo desde el portal: revisa que no sea un comercio ya existente con otro nombre"
                                >
                                  Nuevo · portal
                                </span>
                              )}
                            </>
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
                            <DistrictSelect
                              value={rowEdit.district || ""}
                              onChange={(e) => setRowEdit((prev) => (prev ? { ...prev, district: e.target.value || null } : prev))}
                              placeholder="—"
                              className="h-8 min-w-[140px] px-2 py-1 text-xs"
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
                          {format(new Date(company.created_at ?? 0), "dd/MM/yyyy", {
                            locale: es,
                          })}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {editingRowId === company.id && rowEdit ? (
                            <div className="flex gap-1">
                              <Input
                                value={rowEdit.yape_number || ""}
                                placeholder="Número"
                                onChange={(e) => setRowEdit((prev) => (prev ? { ...prev, yape_number: e.target.value || null } : prev))}
                                className="h-8 w-28 text-xs"
                              />
                              <Input
                                value={rowEdit.yape_holder || ""}
                                placeholder="Titular"
                                onChange={(e) => setRowEdit((prev) => (prev ? { ...prev, yape_holder: e.target.value || null } : prev))}
                                className="h-8 w-36 text-xs"
                              />
                            </div>
                          ) : company.yape_number ? (
                            <span title={company.yape_holder ?? undefined}>
                              <span className="font-medium">{company.yape_number}</span>
                              {company.yape_holder && <span className="text-muted-foreground"> · {company.yape_holder}</span>}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs">
                          {(() => {
                            const act = activity.get(company.id);
                            const accounts = act?.accounts ?? 0;
                            return (
                              <div>
                                {accounts > 0 ? (
                                  <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800">
                                    ✓ {accounts} cuenta{accounts === 1 ? "" : "s"}
                                  </span>
                                ) : (
                                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-gray-600">Sin cuenta</span>
                                )}
                                <div className="mt-1 text-muted-foreground" title={act?.last_order_at ? `Último pedido: ${format(new Date(act.last_order_at), "dd/MM/yyyy")}` : undefined}>
                                  {act?.orders_30d ?? 0} pedidos (30 días)
                                </div>
                              </div>
                            );
                          })()}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="flex gap-1">
                            <Button size="sm" variant="outline" onClick={() => setAddressesFor(company)} title="Direcciones de recojo">
                              <MapPin className="mr-1 h-3.5 w-3.5" /> Direcciones
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => setAccessFor(company)} title="Cuentas del comercio en el portal">
                              <KeyRound className="mr-1 h-3.5 w-3.5" /> Accesos
                            </Button>
                          </div>
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
                    yape_number: rowEdit.yape_number || null,
                    yape_holder: rowEdit.yape_holder || null,
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
                  yape_number: contextMenu.company!.yape_number,
                  yape_holder: contextMenu.company!.yape_holder,
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
              {editingCompany ? "Editar comercio" : "Nuevo comercio"}
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
                <DistrictSelect id="district" {...register("district")} placeholder="—" />
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

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="email">Correo</Label>
                <Input id="email" type="email" {...register("email")} placeholder="ventas@negocio.com" />
                {errors.email && <span className="text-sm text-destructive">{errors.email.message}</span>}
              </div>
              <div className="space-y-2">
                <Label htmlFor="contact_name">Persona de contacto</Label>
                <Input id="contact_name" {...register("contact_name")} placeholder="Nombre" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
              <div className="space-y-2">
                <Label htmlFor="yape_number">Yape (número)</Label>
                <Input id="yape_number" {...register("yape_number")} placeholder="999 999 999" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="yape_holder">Titular del Yape</Label>
                <Input id="yape_holder" {...register("yape_holder")} placeholder="Nombre que aparece en Yape" />
              </div>
              <p className="col-span-2 text-xs text-emerald-800">A esta cuenta se le paga lo cobrado en sus entregas.</p>
            </div>

            <div className="grid grid-cols-2 gap-4 rounded-lg border p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm">
                <Checkbox checked={!!invoiceIgv} onCheckedChange={(v) => setValue("invoice_igv", !!v)} />
                Factura con IGV (tarifa × 1.18)
              </label>
              <div className="space-y-2">
                <Label htmlFor="t1_rate">Tarifa T1 pactada (S/.)</Label>
                <Input id="t1_rate" type="number" step="0.5" min="0" {...register("t1_rate")} placeholder="Vacío = 10" />
              </div>
              <label className="col-span-2 flex cursor-pointer items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={!!skipCutoff} onCheckedChange={(v) => setValue("skip_cutoff", !!v)} />
                <span>
                  Comercio prioritario: sin horario de corte
                  <span className="block text-xs text-muted-foreground">Sus pedidos entran para el mismo día aunque lleguen después de las 8:00 / 11:59.</span>
                </span>
              </label>
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting && (
                  <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                )}
                {editingCompany ? "Guardar Cambios" : "Crear comercio"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!deleteTarget} onOpenChange={(o) => !o && !deleting && setDeleteTarget(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>¿Eliminar el comercio "{deleteTarget?.name}"?</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            {deleteInfo ? (
              <p>
                Tiene <b>{deleteInfo.orders}</b> pedidos y <b>{deleteInfo.addresses}</b> direcciones de recojo.
              </p>
            ) : (
              <p className="text-muted-foreground">Contando pedidos…</p>
            )}
            <p className="text-muted-foreground">
              Los pedidos se conservan como historial (con el nombre del remitente) pero quedan sin comercio; se borran sus direcciones, stock y liquidaciones. No se puede deshacer.
            </p>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setDeleteTarget(null)} disabled={deleting}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={deleting || !deleteInfo}>
              {deleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Sí, eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <CompanyAddressesDialog
        company={addressesFor}
        open={!!addressesFor}
        onOpenChange={(o) => {
          if (!o) setAddressesFor(null);
        }}
      />
      <CompanyAccessDialog
        company={accessFor}
        open={!!accessFor}
        prefill={accessPrefill}
        onOpenChange={(o) => {
          if (!o) {
            setAccessFor(null);
            setAccessPrefill(null);
            void loadActivity();
          }
        }}
      />
    </div>
  );
}
