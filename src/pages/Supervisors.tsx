import { useCallback, useEffect, useState } from "react";
import { format, parseISO } from "date-fns";
import { es } from "date-fns/locale";
import { KeyRound, Loader2, Plus, ShieldCheck, UserX } from "lucide-react";
import { callAdminUsers } from "../lib/adminUsers";
import { RowActions, RowActionsButton, TableActionsHint } from "../components/RowActions";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../components/ui/dialog";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";

type Supervisor = { id: string; full_name: string | null; email: string | null; created_at: string; last_sign_in_at: string | null };

const CAN = ["Ver todos los pedidos, recojos, comercios y motorizados", "Crear y editar pedidos, asignar motorizados", "Completar entregas con foto", "Registrar ingresos de stock y generar liquidaciones"];
const CANNOT = ["Eliminar pedidos, comercios, productos o liquidaciones", "Crear o modificar cuentas", "Cambiar tarifas, distritos o la configuración", "Marcar liquidaciones como pagadas"];

const date = (v: string | null) => (v ? format(parseISO(v), "d MMM yyyy, HH:mm", { locale: es }) : "Nunca");

/** Cuentas de Supervisor: operan el día a día sin poder borrar ni gestionar cuentas. Solo admin. */
export default function Supervisors() {
  const [users, setUsers] = useState<Supervisor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [resetFor, setResetFor] = useState<Supervisor | null>(null);
  const [removeFor, setRemoveFor] = useState<Supervisor | null>(null);

  const [reload, setReload] = useState(0);
  const load = useCallback(() => setReload((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    callAdminUsers<{ users: Supervisor[] }>({ action: "list_staff" })
      .then((d) => {
        if (!alive) return;
        setError(null);
        setUsers(d.users);
      })
      .catch((e: Error) => {
        if (!alive) return;
        setError(e.message);
        setUsers([]);
      });
    return () => {
      alive = false;
    };
  }, [reload]);

  return (
    <div data-page="supervisors" className="space-y-6">
      <div data-page-header="true" className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <h1 className="text-3xl font-bold">Supervisores</h1>
        <Button onClick={() => setCreating(true)}>
          <Plus className="mr-2 h-4 w-4" /> Nuevo supervisor
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Qué puede hacer un supervisor
          </CardTitle>
          <CardDescription>Opera el día a día sin poder borrar información ni gestionar cuentas. Las restricciones se aplican en la base de datos.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
          <ul className="space-y-1.5">
            {CAN.map((t) => <li key={t} className="flex gap-2"><span className="text-green-700" aria-hidden="true">✓</span>{t}</li>)}
          </ul>
          <ul className="space-y-1.5">
            {CANNOT.map((t) => <li key={t} className="flex gap-2 text-muted-foreground"><span className="text-red-600" aria-hidden="true">✕</span>{t}</li>)}
          </ul>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Cuentas de supervisor</CardTitle>
          <TableActionsHint />
        </CardHeader>
        <CardContent>
          {error && <p role="alert" className="mb-3 text-sm text-destructive">{error}</p>}
          {users === null ? (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Cargando…</p>
          ) : users.length === 0 ? (
            <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
              Todavía no hay supervisores. Crea uno con «Nuevo supervisor».
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Correo</TableHead>
                  <TableHead>Creado</TableHead>
                  <TableHead>Último ingreso</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <RowActions key={u.id} label={u.full_name || u.email || "Supervisor"} actions={[
                    { label: "Cambiar contraseña", icon: KeyRound, onSelect: () => setResetFor(u) },
                    { label: "Quitar acceso", icon: UserX, destructive: true, onSelect: () => setRemoveFor(u) },
                  ]}>
                    <TableRow>
                      <TableCell className="font-medium"><RowActionsButton />{u.full_name || "Sin nombre"}</TableCell>
                      <TableCell>{u.email}</TableCell>
                      <TableCell>{date(u.created_at)}</TableCell>
                      <TableCell>{date(u.last_sign_in_at)}</TableCell>
                    </TableRow>
                  </RowActions>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {creating && <CreateDialog onClose={() => setCreating(false)} onDone={() => { setCreating(false); load(); }} />}
      {resetFor && <ResetDialog user={resetFor} onClose={() => setResetFor(null)} />}
      {removeFor && <RemoveDialog user={removeFor} onClose={() => setRemoveFor(null)} onDone={() => { setRemoveFor(null); load(); }} />}
    </div>
  );
}

function CreateDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await callAdminUsers({ action: "create_staff", full_name: name, email, password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Nuevo supervisor</DialogTitle>
            <DialogDescription>La cuenta queda activa de inmediato. Entrégale la contraseña inicial en persona; puede usarla para ingresar al panel.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="sup-name">Nombre completo</Label>
            <Input id="sup-name" value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={150} autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-email">Correo</Label>
            <Input id="sup-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="off" />
          </div>
          <div className="space-y-1">
            <Label htmlFor="sup-pass">Contraseña inicial</Label>
            <Input id="sup-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
            <p className="text-xs text-muted-foreground">Mínimo 8 caracteres.</p>
          </div>
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
            <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Crear supervisor</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetDialog({ user, onClose }: { user: Supervisor; onClose: () => void }) {
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await callAdminUsers({ action: "reset_staff_password", user_id: user.id, password });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={(e) => void submit(e)} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Cambiar contraseña</DialogTitle>
            <DialogDescription>{user.full_name} · {user.email}</DialogDescription>
          </DialogHeader>
          {done ? (
            <p className="rounded-md bg-green-50 p-3 text-sm text-green-800">Contraseña actualizada. Entrégasela en persona.</p>
          ) : (
            <div className="space-y-1">
              <Label htmlFor="sup-new-pass">Nueva contraseña</Label>
              <Input id="sup-new-pass" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} maxLength={128} autoComplete="new-password" />
            </div>
          )}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>{done ? "Cerrar" : "Cancelar"}</Button>
            {!done && <Button type="submit" disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar</Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RemoveDialog({ user, onClose, onDone }: { user: Supervisor; onClose: () => void; onDone: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await callAdminUsers({ action: "delete_staff", user_id: user.id });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };
  return (
    <Dialog open onOpenChange={(o) => !o && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>¿Quitar el acceso de {user.full_name}?</DialogTitle>
          <DialogDescription>Se elimina su cuenta y ya no podrá entrar al panel. Los pedidos y registros que hizo se conservan.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button variant="destructive" onClick={() => void remove()} disabled={saving}>{saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Quitar acceso</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
