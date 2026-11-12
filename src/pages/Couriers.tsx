import { useState, useEffect, useMemo } from "react";
import { callAdminUsers } from "../lib/adminUsers";
import { RowActions, RowActionsButton, TableActionsHint } from "../components/RowActions";
import { useAuth } from "../components/AuthProvider";
import { getImpersonation, startImpersonation } from "../lib/impersonation";
import { Eye } from "lucide-react";
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../components/ui/dialog";

import { Label } from "../components/ui/label";
import {
  Loader2,
  Plus,
  UserPlus,
  ShieldAlert,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Edit,
  Trash2,
  FileText,
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { useDesign } from "../components/design/DesignContext";
import { savedList } from "../lib/recordNavigation";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];

type SortConfig = {
  key: string;
  direction: "asc" | "desc";
};

type FilterConfig = {
  name: string;
  date: string;
};

export default function Couriers() {
  const { mode } = useDesign();
  const location = useLocation();
  const navigate = useNavigate();
  const memory = savedList(location.state, "courierList", {name:"",date:""});
  const { profile, user } = useAuth();
  const isAdmin = profile?.role === "admin";
  const [couriers, setCouriers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [editingCourier, setEditingCourier] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  // Filtering and Sorting State
  const [sortConfig, setSortConfig] = useState<SortConfig>(memory?.sortConfig ?? {
    key: "created_at",
    direction: "desc",
  });
  const [filters, setFilters] = useState<FilterConfig>(memory?.filters ?? {
    name: "",
    date: "",
  });

  // Form State
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");

  useEffect(() => {
    fetchCouriers();
  }, []);

  const fetchCouriers = async () => {
    try {
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("role", "courier")
        .order("created_at", { ascending: false });

      if (error) {
        console.error("Error fetching couriers:", error);
      } else {
        setCouriers(data || []);
      }
    } catch (error) {
      console.error("Unexpected error:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateCourier = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    try {
      await callAdminUsers({ action: "create_courier", email: email.trim(), password, full_name: fullName.trim() });
      setCreateSuccess("Motorizado creado exitosamente.");
      setEmail("");
      setPassword("");
      setFullName("");
      fetchCouriers();

      // Close dialog after a delay
      setTimeout(() => {
        setIsDialogOpen(false);
        setCreateSuccess(null);
      }, 2000);
    } catch (error) {
      console.error("Error creating courier:", error);
      setCreateError(
        (error as Error).message || "Error al crear el motorizado.",
      );
    } finally {
      setIsCreating(false);
    }
  };

  const handleDeleteCourier = async (id: string) => {
    if (
      !confirm(
        "¿Estás seguro de eliminar este motorizado? Esta acción no se puede deshacer.",
      )
    )
      return;

    try {
      // Delete from profiles (auth user deletion requires admin API which is not available in client)
      // We can only delete the profile data for now
      const { error } = await supabase.from("profiles").delete().eq("id", id);

      if (error) throw error;

      setCouriers((prev) => prev.filter((c) => c.id !== id));
    } catch (error) {
      console.error("Error deleting courier:", error);
      alert("Error al eliminar: " + (error as Error).message);
    }
  };

  const handleUpdateCourier = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCourier) return;

    try {
      const { error } = await supabase
        .from("profiles")
        .update({ full_name: editName })
        .eq("id", editingCourier.id);

      if (error) throw error;

      setCouriers((prev) =>
        prev.map((c) =>
          c.id === editingCourier.id ? { ...c, full_name: editName } : c,
        ),
      );
      setIsEditDialogOpen(false);
      setEditingCourier(null);
    } catch (error) {
      console.error("Error updating courier:", error);
      alert("Error al actualizar: " + (error as Error).message);
    }
  };

  const handleSort = (key: string) => {
    setSortConfig((current) => ({
      key,
      direction:
        current.key === key && current.direction === "asc" ? "desc" : "asc",
    }));
  };

  const filteredAndSortedCouriers = useMemo(() => {
    let result = [...couriers];

    // Filtering
    result = result.filter((courier) => {
      const matchName = (courier.full_name || "")
        .toLowerCase()
        .includes(filters.name.toLowerCase());

      const courierDate = format(new Date(courier.created_at ?? 0), "dd/MM/yyyy", {
        locale: es,
      });
      const matchDate =
        filters.date === "" || courierDate.includes(filters.date);

      return matchName && matchDate;
    });

    // Sorting
    result.sort((a, b) => {
      let aValue: string | number = "";
      let bValue: string | number = "";

      switch (sortConfig.key) {
        case "name":
          aValue = a.full_name || "";
          bValue = b.full_name || "";
          break;
        case "created_at":
          aValue = new Date(a.created_at ?? 0).getTime();
          bValue = new Date(b.created_at ?? 0).getTime();
          break;
        default:
          return 0;
      }

      if (aValue < bValue) return sortConfig.direction === "asc" ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === "asc" ? 1 : -1;
      return 0;
    });

    return result;
  }, [couriers, filters, sortConfig]);

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
    <div data-page="couriers" className="space-y-6">
      <div data-page-header="true" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Motorizados</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          {isAdmin && (
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 w-4 h-4" />
                Nuevo Motorizado
              </Button>
            </DialogTrigger>
          )}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar cuenta de motorizado</DialogTitle>
              <p className="text-sm text-muted-foreground">Usa un correo distinto al de la cuenta administrativa. Esta cuenta solo tendrá permisos de motorizado.</p>
            </DialogHeader>

            {createError && (
              <div className="flex gap-2 items-center p-3 text-sm rounded-md bg-destructive/15 text-destructive">
                <ShieldAlert className="w-4 h-4" />
                {createError}
              </div>
            )}

            {createSuccess && (
              <div className="flex gap-2 items-center p-3 text-sm text-green-700 bg-green-100 rounded-md">
                <UserPlus className="w-4 h-4" />
                {createSuccess}
              </div>
            )}

            <form onSubmit={handleCreateCourier} className="py-4 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nombre Completo</Label>
                <Input
                  id="fullName"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="Ej. Juan Pérez"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Correo Electrónico</Label>
                <Input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="motorizado@ejemplo.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Contraseña</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  required
                  minLength={8}
                />
              </div>

              <div className="flex justify-end pt-4">
                <Button type="submit" disabled={isCreating}>
                  {isCreating ? (
                    <>
                      <Loader2 className="mr-2 w-4 h-4 animate-spin" />
                      Creando...
                    </>
                  ) : (
                    "Crear Cuenta"
                  )}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Gestión de Motorizados</CardTitle>
          <TableActionsHint />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="py-4 text-center">Cargando motorizados...</div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead
                      className="cursor-pointer"
                      onClick={() => handleSort("name")}
                    >
                      <div className="flex items-center">
                        Nombre <SortIcon columnKey="name" />
                      </div>
                    </TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead
                      className="cursor-pointer"
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
                        className="h-8 text-xs"
                      />
                    </TableCell>
                    <TableCell />
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
                        className="h-8 text-xs"
                      />
                    </TableCell>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSortedCouriers.length === 0 ? (
                    <TableRow>
                      <TableCell
                        colSpan={3}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No hay motorizados registrados con los filtros
                        seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedCouriers.map((courier) => (
                      <RowActions key={courier.id} label={courier.full_name || "Motorizado"} actions={[
                        ...(profile?.role === "admin" && mode === "lightning" ? [{label:"Abrir ficha del motorizado",icon:FileText,onSelect:()=>navigate(`/couriers/${courier.id}`,{state:{courierList:{filters,sortConfig}}})}] : []),
                        ...(isAdmin ? [{ label: "Editar motorizado", icon: Edit, onSelect: () => { setEditingCourier(courier); setEditName(courier.full_name || ""); setIsEditDialogOpen(true); } }] : []),
                        ...(profile?.role === "admin" && courier.id !== user?.id && !getImpersonation() ? [{ label: "Ver como motorizado", icon: Eye, onSelect: () => {
                          if (!globalThis.confirm(`Vas a entrar como ${courier.full_name || "este motorizado"}. Las acciones son reales y quedan registradas. Usa Volver a mi cuenta para salir.`)) return;
                          void startImpersonation({ id: courier.id, name: courier.full_name }, profile.full_name).catch((error: Error) => alert(error.message));
                        } }] : []),
                        ...(isAdmin ? [{ label: "Eliminar motorizado", icon: Trash2, destructive: true, onSelect: () => { void handleDeleteCourier(courier.id); } }] : []),
                      ]}>
                      <TableRow>
                        <TableCell className="font-medium"><RowActionsButton />{profile?.role === "admin" && mode === "lightning" ? <Link to={`/couriers/${courier.id}`} state={{courierList:{filters,sortConfig}}} className="text-primary hover:underline" title={`Abrir ficha de ${courier.full_name || "motorizado"}`}>{courier.full_name || "Sin nombre"}</Link> : courier.full_name || "Sin nombre"}</TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                            Motorizado
                          </span>
                        </TableCell>
                        <TableCell>
                          {courier.created_at
                            ? format(
                                new Date(courier.created_at ?? 0),
                                "dd/MM/yyyy",
                                {
                                  locale: es,
                                },
                              )
                            : "-"}
                        </TableCell>
                      </TableRow>
                      </RowActions>
                    ))
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="rounded-lg border bg-muted/30 p-4 text-sm">
        <p className="font-medium">Cuentas separadas para administrar y repartir</p>
        <p className="mt-1 text-muted-foreground">Si un administrador sale a repartir, registra su cuenta secundaria con Nuevo motorizado y otro correo. Los pedidos, recojos y ubicaciones se asignan a esa cuenta.</p>
      </div>

      <Dialog open={isEditDialogOpen} onOpenChange={setIsEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Editar Motorizado</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateCourier} className="py-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="editFullName">Nombre Completo</Label>
              <Input
                id="editFullName"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                placeholder="Ej. Juan Pérez"
                required
              />
            </div>

            <div className="flex justify-end pt-4">
              <Button type="submit">Guardar Cambios</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
