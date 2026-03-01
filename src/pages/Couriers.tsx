import { useState, useEffect, useMemo } from "react";
import { createClient } from "@supabase/supabase-js";
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
} from "lucide-react";
import { format } from "date-fns";
import { es } from "date-fns/locale";

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
  const [couriers, setCouriers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);
  const [editingCourier, setEditingCourier] = useState<Profile | null>(null);
  const [editName, setEditName] = useState("");
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    courier: Profile | null;
  } | null>(null);
  const [editingRowId, setEditingRowId] = useState<string | null>(null);
  const [rowEditName, setRowEditName] = useState<string>("");

  // Filtering and Sorting State
  const [sortConfig, setSortConfig] = useState<SortConfig>({
    key: "created_at",
    direction: "desc",
  });
  const [filters, setFilters] = useState<FilterConfig>({
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

    // 1. Create a temporary Supabase client to avoid logging out the admin
    const tempClient = createClient(
      import.meta.env.VITE_SUPABASE_URL,
      import.meta.env.VITE_SUPABASE_ANON_KEY,
      {
        auth: {
          persistSession: false, // Don't save session to localStorage
          autoRefreshToken: false,
          detectSessionInUrl: false,
        },
      },
    );

    try {
      // 2. Sign up the new user
      const { data: authData, error: authError } = await tempClient.auth.signUp(
        {
          email,
          password,
          options: {
            data: {
              full_name: fullName,
              role: "courier", // Pass metadata directly during signup
            },
          },
        },
      );

      if (authError) throw authError;

      if (!authData.user) {
        throw new Error("No se pudo crear el usuario. Intenta de nuevo.");
      }

      const newUserId = authData.user.id;

      // 3. Force update the profile just in case trigger didn't catch it or if we want to ensure data
      // We use upsert to handle both cases (row exists or not)
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: newUserId,
        full_name: fullName,
        role: "courier",
        updated_at: new Date().toISOString(),
      });

      if (profileError) {
        // If profile creation fails, we might still have the user created in Auth
        console.error("Error creating/updating profile:", profileError);
        // Check if profile exists despite error (RLS might block update but insert worked via trigger?)
        const { data: checkProfile } = await supabase
          .from("profiles")
          .select("*")
          .eq("id", newUserId)
          .single();

        if (!checkProfile) {
          throw new Error(
            "Usuario creado, pero falló al asignar el rol de motorizado. Contacta soporte.",
          );
        }
      }

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

      const courierDate = format(new Date(courier.created_at), "dd/MM/yyyy", {
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
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Motorizados</h1>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="mr-2 w-4 h-4" />
              Nuevo Motorizado
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Registrar Nuevo Motorizado</DialogTitle>
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
                  placeholder="Mínimo 6 caracteres"
                  required
                  minLength={6}
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
          <p className="text-sm text-muted-foreground">
            Utiliza los filtros en la cabecera de la tabla para buscar
            motorizados específicos.
          </p>
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
                    <TableHead className="text-right">Acciones</TableHead>
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
                    <TableCell className="p-2"></TableCell>
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
                        colSpan={4}
                        className="py-8 text-center text-muted-foreground"
                      >
                        No hay motorizados registrados con los filtros
                        seleccionados.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredAndSortedCouriers.map((courier) => (
                      <TableRow
                        key={courier.id}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setContextMenu({
                            x: e.clientX,
                            y: e.clientY,
                            courier,
                          });
                        }}
                      >
                        <TableCell className="font-medium">
                          {editingRowId === courier.id ? (
                            <Input
                              value={rowEditName}
                              onChange={(e) => setRowEditName(e.target.value)}
                              className="h-8 text-xs"
                            />
                          ) : (
                            courier.full_name || "Sin nombre"
                          )}
                        </TableCell>
                        <TableCell>
                          <span className="inline-flex items-center rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-800">
                            Motorizado
                          </span>
                        </TableCell>
                        <TableCell>
                          {courier.created_at
                            ? format(
                                new Date(courier.created_at),
                                "dd/MM/yyyy",
                                {
                                  locale: es,
                                },
                              )
                            : "-"}
                        </TableCell>
                        <TableCell className="text-right">
                          {editingRowId === courier.id && (
                            <span className="text-xs text-muted-foreground">
                              Editando...
                            </span>
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

      {editingRowId && (
        <div className="flex gap-4 justify-end">
          <Button
            variant="outline"
            onClick={() => {
              setEditingRowId(null);
              setRowEditName("");
            }}
          >
            Cancelar
          </Button>
          <Button
            onClick={async () => {
              if (!editingRowId) return;
              try {
                const { error } = await supabase
                  .from("profiles")
                  .update({ full_name: rowEditName })
                  .eq("id", editingRowId);
                if (error) throw error;
                setEditingRowId(null);
                setRowEditName("");
                fetchCouriers();
              } catch (err) {
                console.error("Error saving courier inline:", err);
                alert("Error al guardar cambios.");
              }
            }}
          >
            Guardar Cambios
          </Button>
        </div>
      )}

      {contextMenu && contextMenu.courier && (
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
                setEditingRowId(contextMenu.courier!.id);
                setRowEditName(contextMenu.courier!.full_name || "");
                setContextMenu(null);
              }}
            >
              <Edit className="mr-2 w-4 h-4" /> Editar
            </div>
            <div className="-mx-1 my-1 h-px bg-muted" />
            <div
              className="relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors hover:bg-accent hover:text-accent-foreground text-red-600"
              onClick={() => {
                handleDeleteCourier(contextMenu.courier!.id);
                setContextMenu(null);
              }}
            >
              <Trash2 className="mr-2 w-4 h-4" /> Eliminar
            </div>
          </div>
        </div>
      )}

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
