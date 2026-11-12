import { useCallback, useEffect, useState } from "react";
import type { Database } from "../types/database";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ViewAsButton } from "./ViewAsButton";
import { callAdminUsers } from "../lib/adminUsers";
import { Check, Copy, KeyRound, Link2, Loader2, Mail, Plus, Trash2, Unlink, UserRound } from "lucide-react";

type Profile = Pick<Database["public"]["Tables"]["profiles"]["Row"], "id" | "full_name" | "email" | "company_id" | "created_at">;
type Company = { id: string; name: string };
type Access = Profile & { access_status: "active" | "pending_email" | "pending_password" | "unverified"; last_sent_at: string | null };
const statusLabel: Record<Access["access_status"], string> = {
  active: "Activo · correo verificado",
  pending_email: "Pendiente de verificar correo",
  pending_password: "Correo verificado · falta elegir contraseña",
  unverified: "Correo no verificado",
};

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
/** Contraseña legible para dictar por WhatsApp: relampago-xxxxxx */
function generatePassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "relampago-" + Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

type Credentials = { email: string; password: string };


/**
 * Accesos de un comercio al portal: cuentas vinculadas, invitar por correo,
 * cambiar contraseña, quitar la cuenta o vincular una cuenta ya existente.
 */
export function CompanyAccessDialog({
  company,
  open,
  onOpenChange,
  prefill,
}: {
  company: Company | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  /** Empresa recién creada: abrir directo en "Nueva cuenta" con estos datos. */
  prefill?: { email?: string | null; fullName?: string | null } | null;
}) {
  const [users, setUsers] = useState<Access[]>([]);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<"list" | "create" | "link">("list");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  const [copied, setCopied] = useState(false);
  const [linkQuery, setLinkQuery] = useState("");
  const [linkResults, setLinkResults] = useState<Profile[]>([]);

  const load = useCallback(async () => {
    if (!company) return;
    setLoading(true);
    try {
      const data = await callAdminUsers<{ users: Access[] }>({ action: "list", company_id: company.id });
      setUsers(data.users);
    } catch (e) {
      setError((e as Error).message);
      setUsers([]);
    } finally {
      setLoading(false);
    }
  }, [company]);

  useEffect(() => {
    if (open) {
      void load();
      setCredentials(null);
      setError(null);
      setNotice(null);
      if (prefill) {
        setEmail(prefill.email ?? "");
        setFullName(prefill.fullName ?? "");
        setMode("create");
      } else setMode("list");
    }
  }, [open, load, prefill]);

  // Buscar cuentas de comercio por correo para vincularlas
  useEffect(() => {
    if (mode !== "link") return;
    const q = linkQuery.trim();
    if (q.length < 3) {
      setLinkResults([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const data = await callAdminUsers<{ users: Profile[] }>({ action: "search", query: q });
        if (!cancelled) setLinkResults(data.users);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    }, 300);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [linkQuery, mode]);

  const startCreate = () => {
    setEmail("");
    setFullName("");
    setError(null);
    setNotice(null);
    setMode("create");
  };

  const create = async () => {
    if (!company) return;
    setBusy(true);
    setError(null);
    try {
      const result = await callAdminUsers<{ email_sent: boolean; delivery_error: string | null }>({ action: "create", email: email.trim(), full_name: fullName.trim() || undefined, company_id: company.id });
      setCredentials(null);
      if (result.email_sent) setNotice(`Invitación enviada a ${email.trim().toLowerCase()}. Debe abrir el correo y elegir su contraseña para activar el acceso.`);
      else setError(`Cuenta pendiente creada, pero NO se envió la invitación: ${result.delivery_error ?? "Error de envío"}. Corrige el envío y usa “Reenviar invitación”.`);
      setMode("list");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resendInvite = async (u: Access) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await callAdminUsers({ action: "resend_invite", user_id: u.id });
      setNotice(`Enlace de activación enviado a ${u.email}. Revisa también la carpeta de spam.`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resetPassword = async (u: Profile) => {
    if (!globalThis.confirm(`¿Generar una contraseña nueva para ${u.email}? La anterior dejará de funcionar.`)) return;
    setBusy(true);
    setError(null);
    try {
      const pw = generatePassword();
      await callAdminUsers({ action: "reset_password", user_id: u.id, password: pw });
      setCredentials({ email: u.email ?? "", password: pw });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (u: Profile) => {
    if (!globalThis.confirm(`¿Eliminar la cuenta ${u.email}? El comercio ya no podrá entrar al portal (sus pedidos no se tocan).`)) return;
    setBusy(true);
    setError(null);
    try {
      await callAdminUsers({ action: "delete", user_id: u.id });
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const unlink = async (u: Profile) => {
    if (!globalThis.confirm(`¿Desvincular ${u.email} de este comercio? La cuenta seguirá existiendo sin comercio.`)) return;
    setBusy(true);
    setError(null);
    try {
      await callAdminUsers({ action: "unlink", user_id: u.id });
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const link = async (u: Profile) => {
    if (!company) return;
    if (u.company_id && u.company_id !== company.id && !globalThis.confirm("Esta cuenta ya está vinculada a otro comercio. ¿Moverla a este?")) return;
    setBusy(true);
    setError(null);
    try {
      await callAdminUsers({ action: "link", user_id: u.id, company_id: company.id });
      setMode("list");
      setLinkQuery("");
      await load();
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };

  const whatsappText = (c: Credentials) =>
    [
      `Hola, ya tienes acceso al portal de *Relámpago Courier* para ${company?.name ?? "tu comercio"}.`,
      `Entra en ${window.location.origin}/login`,
      `Correo: ${c.email}`,
      `Contraseña: ${c.password}`,
      "Ahí puedes registrar pedidos, ver su estado, tus direcciones y tus liquidaciones. Puedes cambiar la contraseña en “Mi comercio”.",
    ].join("\n");

  const copyCredentials = async (c: Credentials) => {
    try {
      await navigator.clipboard.writeText(whatsappText(c));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      window.prompt("Copia el mensaje:", whatsappText(c));
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92dvh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Accesos al portal · {company?.name}</DialogTitle>
          <DialogDescription>Gestiona cuentas activas e invitaciones pendientes de este comercio.</DialogDescription>
        </DialogHeader>

        {error && <div role="alert" className="rounded-md bg-destructive/15 p-3 text-sm text-destructive">{error}</div>}
        {notice && <div role="status" className="rounded-md bg-green-50 p-3 text-sm text-green-800">{notice}</div>}

        {credentials && (
          <div className="space-y-2 rounded-lg border border-green-300 bg-green-50 p-3 text-sm">
            <div className="font-semibold text-green-800">Acceso listo. Mándale esto al comercio (solo se muestra ahora):</div>
            <div className="font-mono text-xs">
              Correo: {credentials.email}
              <br />
              Contraseña: {credentials.password}
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => void copyCredentials(credentials)}>
                {copied ? <Check className="mr-1 h-3.5 w-3.5 text-green-600" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
                {copied ? "Copiado" : "Copiar mensaje para WhatsApp"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setCredentials(null)}>
                Ocultar
              </Button>
            </div>
          </div>
        )}

        {mode === "create" && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-sm font-semibold">Invitar al comercio</div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="merchant-invite-email">Correo *</Label>
                <Input id="merchant-invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="comercio@gmail.com" autoFocus />
              </div>
              <div className="space-y-1">
                <Label htmlFor="merchant-invite-name">Nombre (contacto)</Label>
                <Input id="merchant-invite-name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground">Recibirá un enlace en su correo. El acceso a los datos del comercio se activa únicamente después de verificar el correo y establecer su propia contraseña.</p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setMode("list")} disabled={busy}>
                Cancelar
              </Button>
              <Button onClick={() => void create()} disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Enviar invitación
              </Button>
            </div>
          </div>
        )}

        {mode === "link" && (
          <div className="space-y-3 rounded-lg border p-3">
            <div className="text-sm font-semibold">Vincular una cuenta existente</div>
            <p className="text-xs text-muted-foreground">Solo se muestran cuentas con correo verificado y activación completada.</p>
            <Input aria-label="Buscar cuenta por correo" value={linkQuery} onChange={(e) => setLinkQuery(e.target.value)} placeholder="Buscar por correo…" autoFocus />
            <div className="space-y-1">
              {linkQuery.trim().length >= 3 && linkResults.length === 0 && <div className="text-xs text-muted-foreground">Sin resultados.</div>}
              {linkResults.map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-2 rounded border px-2 py-1 text-sm">
                  <div className="min-w-0">
                    <div className="truncate">{u.email}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {u.full_name ?? "—"}
                      {u.company_id === company?.id ? " · ya vinculada aquí" : u.company_id ? " · vinculada a otro comercio" : " · sin comercio"}
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7" onClick={() => void link(u)} disabled={busy || u.company_id === company?.id}>
                    Vincular
                  </Button>
                </div>
              ))}
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setMode("list")}>
                Cerrar
              </Button>
            </div>
          </div>
        )}

        <div className="space-y-2">
          {loading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Cargando…</div>
          ) : users.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Este comercio todavía no tiene cuenta en el portal.</div>
          ) : (
            users.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
                <UserRound className="h-5 w-5 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="truncate font-medium">{u.email ?? "(sin correo)"}</div>
                  <div className="truncate text-xs text-muted-foreground">{u.full_name ?? "—"}</div>
                  <div className={`mt-1 text-xs ${u.access_status === "active" ? "text-green-700" : "text-amber-700"}`}>{statusLabel[u.access_status]}</div>
                  {u.last_sent_at && <div className="mt-1 text-xs text-muted-foreground">Último envío: {new Date(u.last_sent_at).toLocaleString("es-PE")}</div>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {u.access_status === "active" ? <>
                  <ViewAsButton compact target={{ id: u.id, full_name: u.full_name ?? u.email, role: "client" }} />
                  <Button size="icon" variant="ghost" title="Nueva contraseña" onClick={() => void resetPassword(u)} disabled={busy}>
                    <KeyRound className="h-4 w-4" />
                  </Button>
                  <Button size="icon" variant="ghost" title="Desvincular de este comercio" onClick={() => void unlink(u)} disabled={busy}>
                    <Unlink className="h-4 w-4" />
                  </Button>
                  </> : u.access_status !== "unverified" ? <Button size="sm" variant="outline" onClick={() => void resendInvite(u)} disabled={busy}>
                    <Mail className="mr-1 h-4 w-4" /> Reenviar invitación
                  </Button> : null}
                  <Button size="icon" variant="ghost" className="text-red-600" title="Eliminar cuenta" onClick={() => void remove(u)} disabled={busy}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>

        {mode === "list" && (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={startCreate}>
              <Plus className="mr-2 h-4 w-4" /> Invitar al comercio
            </Button>
            <Button variant="ghost" onClick={() => setMode("link")}>
              <Link2 className="mr-2 h-4 w-4" /> Vincular cuenta existente
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
